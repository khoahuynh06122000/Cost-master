// agent/report.mjs — CẢNH BÁO LỆCH CẬP NHẬT + AUTO-HEALING (AI chẩn đoán)
// - Cảnh báo trễ cập nhật  -> gửi NHÓM  (TEAMS_FLOW_URL). Không có gì lệch = im lặng.
// - Lỗi kỹ thuật           -> tự thử lại 3 lần; vẫn lỗi thì gọi AI chẩn đoán rồi gửi RIÊNG Khoa (TEAMS_PERSONAL_URL).
// Bí mật lấy từ GitHub Secrets — KHÔNG nhúng key vào code.

const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const FLOW     = process.env.TEAMS_FLOW_URL;                 // nhóm
const PERSONAL = process.env.TEAMS_PERSONAL_URL || FLOW;     // chat riêng Khoa (thiếu thì tạm về nhóm)
const AI_KEY   = process.env.AI_API_KEY || '';               // khóa AI để chẩn đoán (Gemini)
const LATE_DAYS = 2;

if (!SB_URL || !SB_KEY || !FLOW) { console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY / TEAMS_FLOW_URL'); process.exit(1); }

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const dstr = t => new Date(t).toLocaleDateString('vi-VN');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function postTeams(url, text) {
  return fetch(url, { method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body: text });
}

// --- retry: tự thử lại tối đa 3 lần, chờ tăng dần (2s,4s,8s) ---
async function withRetry(label, fn, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      console.error(`[thử ${i}/${tries}] ${label}: ${e.message||e}`);
      if (i < tries) await sleep(2000 * i);
    }
  }
  const err = new Error(`${label} — thất bại sau ${tries} lần: ${lastErr?.message||lastErr}`);
  err.attempts = tries; err.original = String(lastErr?.message||lastErr);
  throw err;
}

async function q(path) {
  return withRetry(`Đọc ${path.split('?')[0]}`, async () => {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
    if (!r.ok) { const b = (await r.text()).slice(0,160); const e = new Error(`HTTP ${r.status} ${b}`); e.httpStatus = r.status; throw e; }
    return r.json();
  });
}

// --- AI chẩn đoán lỗi (Gemini). Không có key hoặc lỗi thì trả null để dùng chẩn đoán dự phòng ---
async function aiDiagnose(errText) {
  if (!AI_KEY) return null;
  const prompt = `Bạn là kỹ sư vận hành. Một agent Node.js đọc Supabase REST rồi gửi cảnh báo về MS Teams vừa bị lỗi.
Lỗi: """${errText}"""
Trả lời NGẮN GỌN tiếng Việt đúng 3 dòng, mỗi dòng bắt đầu bằng nhãn:
Nguyên nhân: ...
Tự sửa được không: (Có/Không) - vì sao
Cách khắc phục: (các bước ngắn)`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${AI_KEY}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{ parts:[{ text: prompt }] }] })
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch { return null; }
}

// --- chẩn đoán dự phòng khi không có AI (dựa mã lỗi) ---
function ruleDiagnose(e) {
  const s = (e.original||e.message||'').toLowerCase();
  if (e.httpStatus === 401 || e.httpStatus === 403 || s.includes('401') || s.includes('403'))
    return 'Nguyên nhân: Sai hoặc thiếu quyền SUPABASE_SERVICE_KEY.\nTự sửa được không: Không - cần người cập nhật key.\nCách khắc phục: Lấy lại Secret key trong Supabase → cập nhật secret SUPABASE_SERVICE_KEY trên GitHub.';
  if (e.httpStatus === 404 || s.includes('404') || s.includes('does not exist') || s.includes('relation'))
    return 'Nguyên nhân: Thiếu bảng/cột trong Supabase (chưa chạy SQL migration).\nTự sửa được không: Không - cần chạy SQL.\nCách khắc phục: Chạy các file schema còn thiếu trong Supabase SQL Editor.';
  if (s.includes('fetch') || s.includes('network') || s.includes('timeout') || s.includes('enotfound'))
    return 'Nguyên nhân: Lỗi mạng/kết nối tạm thời tới Supabase.\nTự sửa được không: Có - thường tự hết ở lần chạy sau.\nCách khắc phục: Đã tự thử lại 3 lần; nếu lặp lại nhiều, kiểm tra SUPABASE_URL.';
  return 'Nguyên nhân: Lỗi chưa phân loại.\nTự sửa được không: Chưa rõ.\nCách khắc phục: Xem log GitHub Actions để biết chi tiết.';
}

try {
  // ===== THU THẬP DỮ LIỆU (mỗi truy vấn đã có retry) =====
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

  const lastOf = {};
  [...subs, ...shifts].forEach(r => { const t = new Date(r.created_at).getTime(); if (!lastOf[r.plant_code] || t > lastOf[r.plant_code]) lastOf[r.plant_code] = t; });

  const items = watched.map(pc => {
    const last = lastOf[pc] || null;
    const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
    return { pc, last, days };
  }).filter(x => x.last === null || x.days >= 1);

  if (!items.length) { console.log('✅ Không có điểm bán nào lệch cập nhật — không gửi tin.'); process.exit(0); }

  items.sort((a,b) => (b.days ?? 999) - (a.days ?? 999));
  const urgent = items.filter(x => x.last === null || x.days > 2);
  const mild   = items.filter(x => x.last !== null && x.days >= 1 && x.days <= 2);
  let msg = `⚠ CẢNH BÁO LỆCH CẬP NHẬT KIỂM KÊ — ${new Date().toLocaleString('vi-VN')}\n`;
  if (urgent.length) msg += `\n🔴 KHẨN (quá 2 ngày hoặc chưa từng cập nhật):\n` +
    urgent.map(x => `- ${pname(x.pc)}: ${x.last ? `gần nhất ${dstr(x.last)} (${x.days} ngày)` : 'CHƯA cập nhật lần nào'}`).join('\n') + '\n';
  if (mild.length) msg += `\n⚠ Nhắc nhở (lệch 1-2 ngày):\n` +
    mild.map(x => `- ${pname(x.pc)}: gần nhất ${dstr(x.last)} (${x.days} ngày)`).join('\n') + '\n';
  msg += `\nTổng: ${items.length} điểm bán cần đôn đốc cập nhật.`;

  // gửi cảnh báo vào NHÓM (có retry)
  await withRetry('Gửi cảnh báo về nhóm Teams', async () => {
    const r = await postTeams(FLOW, msg);
    if (!r.ok && r.status !== 0) throw new Error(`Teams HTTP ${r.status}`);
  });
  console.log('Đã gửi cảnh báo về nhóm.'); console.log(msg);

} catch (e) {
  // ===== AUTO-HEALING: đã thử lại nhưng vẫn lỗi -> AI chẩn đoán -> báo RIÊNG Khoa =====
  console.error('LỖI:', e.message||e);
  const diag = (await aiDiagnose(e.message||String(e))) || ruleDiagnose(e);
  const report = `🔧 AGENT LỖI (đã tự thử lại ${e.attempts||3} lần không được)\nThời điểm: ${new Date().toLocaleString('vi-VN')}\n\nChi tiết lỗi: ${(e.message||String(e)).slice(0,300)}\n\n🤖 Chẩn đoán:\n${diag}`;
  try { await postTeams(PERSONAL, report); console.log('Đã gửi báo lỗi + chẩn đoán về chat riêng Khoa.'); }
  catch (e2) { console.error('Không gửi được báo lỗi về Teams:', e2.message||e2); }
  console.log(report);
  process.exit(1);
}
