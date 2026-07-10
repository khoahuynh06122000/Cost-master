// agent/report.mjs — CẢNH BÁO LỆCH CẬP NHẬT → MS Teams (webhook)
// Chỉ gửi tin khi CÓ điểm bán lệch cập nhật (>=1 ngày). Không có gì lệch = im lặng.
// Mức độ: 1-2 ngày = ⚠ nhắc nhở · >2 ngày = 🔴 khẩn.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const FLOW   = process.env.TEAMS_FLOW_URL;
if (!SB_URL || !SB_KEY || !FLOW) { console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY / TEAMS_FLOW_URL'); process.exit(1); }

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
async function q(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`Supabase ${path.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0,120)}`);
  return r.json();
}
const dstr = t => new Date(t).toLocaleDateString('vi-VN');

try {
  // 1) Điểm bán đang có giám sát/bếp trưởng active phụ trách
  const [plants, profiles, userPlants, subs, shifts] = await Promise.all([
    q('plants?select=plant_code,plant_name'),
    q('profiles?select=id,role,status'),
    q('user_plants?select=user_id,plant_code'),
    q('submissions?select=plant_code,created_at&order=created_at.desc&limit=2000'),
    q('shifts?select=plant_code,created_at&order=created_at.desc&limit=2000'),
  ]);
  const pname = c => (plants.find(p => p.plant_code === c) || {}).plant_name || c;
  const activeIds = new Set(profiles.filter(p => (p.role==='giam_sat'||p.role==='bep_truong') && p.status==='active').map(p=>p.id));
  const watched = [...new Set(userPlants.filter(u => activeIds.has(u.user_id)).map(u => u.plant_code))];

  // 2) Lần cập nhật gần nhất của mỗi điểm bán (kiểm kê + bàn giao ca)
  const lastOf = {};
  [...subs, ...shifts].forEach(r => {
    const t = new Date(r.created_at).getTime();
    if (!lastOf[r.plant_code] || t > lastOf[r.plant_code]) lastOf[r.plant_code] = t;
  });

  // 3) Tính lệch: >=1 ngày là có cảnh báo
  const items = watched.map(pc => {
    const last = lastOf[pc] || null;
    const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
    return { pc, last, days };
  }).filter(x => x.last === null || x.days >= 1);

  if (!items.length) { console.log('✅ Không có điểm bán nào lệch cập nhật — không gửi tin.'); process.exit(0); }

  // 4) Soạn tin cảnh báo (khẩn xếp trước)
  items.sort((a,b) => (b.days ?? 999) - (a.days ?? 999));
  const urgent = items.filter(x => x.last === null || x.days > 2);
  const mild   = items.filter(x => x.last !== null && x.days >= 1 && x.days <= 2);
  let msg = `⚠ CẢNH BÁO LỆCH CẬP NHẬT KIỂM KÊ — ${new Date().toLocaleString('vi-VN')}\n`;
  if (urgent.length) msg += `\n🔴 KHẨN (quá 2 ngày hoặc chưa từng cập nhật):\n` +
    urgent.map(x => `- ${pname(x.pc)}: ${x.last ? `gần nhất ${dstr(x.last)} (${x.days} ngày)` : 'CHƯA cập nhật lần nào'}`).join('\n') + '\n';
  if (mild.length) msg += `\n⚠ Nhắc nhở (lệch 1-2 ngày):\n` +
    mild.map(x => `- ${pname(x.pc)}: gần nhất ${dstr(x.last)} (${x.days} ngày)`).join('\n') + '\n';
  msg += `\nTổng: ${items.length} điểm bán cần đôn đốc cập nhật.`;

  const r = await fetch(FLOW, { method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body: msg });
  console.log('Teams HTTP:', r.status); console.log(msg);
  if (!r.ok && r.status !== 0) { console.error(await r.text().catch(()=>'')); process.exit(1); }
} catch (e) {
  // auto-heal tối thiểu: lỗi hệ thống cũng bắn về Teams để Khoa biết agent hỏng
  console.error(e);
  try { await fetch(FLOW, { method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'},
    body: `🔧 AGENT LỖI khi kiểm tra cảnh báo: ${String(e.message||e).slice(0,200)}` }); } catch {}
  process.exit(1);
}
