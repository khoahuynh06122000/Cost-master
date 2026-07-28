// agent/admin-audit.mjs — "BÁC SĨ DỮ LIỆU" (health-check quản trị hàng tuần)
// Quét Supabase, gom các vấn đề âm thầm tồn tại -> gửi 1 báo cáo về Teams RIÊNG Khoa.
// CHỈ phát hiện & báo, KHÔNG tự sửa master data (không bịa tên hàng — tên đúng lấy từ ERP).
// Không có vấn đề nào = vẫn gửi 1 tin "hệ thống ổn" (để Khoa biết agent còn sống).
// Bí mật lấy từ GitHub Secrets — KHÔNG nhúng key vào code.

const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const FLOW     = process.env.TEAMS_FLOW_URL;                 // nhóm (dự phòng)
const PERSONAL = process.env.TEAMS_PERSONAL_URL || FLOW;     // chat riêng Khoa (đích chính)
const AI_KEY   = process.env.AI_API_KEY || '';              // Gemini để viết nhận định (tùy chọn)
const AI_MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';// đổi model tại đây (hoặc set secret AI_MODEL)
const STALE_DAYS = 2;   // phiếu Chờ duyệt treo quá ngần này ngày = cảnh báo
const BIG_AMOUNT = 500000;  // tiền bù đột xuất >= mức này = đáng chú ý
const BIG_DIFF   = 5;   // số mã lệch tồn cuối / điểm bán >= mức này = đáng chú ý

if (!SB_URL || !SB_KEY || !PERSONAL) { console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY / TEAMS_PERSONAL_URL'); process.exit(1); }

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowVN = () => new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const dstr  = t => new Date(t).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const vnd   = n => (Number(n) || 0).toLocaleString('vi-VN') + 'đ';
const daysSince = t => Math.floor((Date.now() - new Date(t).getTime()) / 864e5);

// kỳ hiện tại theo giờ VN: 'YYYY-MM'
function curPeriod() {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }); // YYYY-MM-DD
  return s.slice(0, 7);
}

async function postTeams(url, text) {
  return fetch(url, { method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body: text });
}

// --- retry: thử lại tối đa 3 lần, chờ tăng dần ---
async function withRetry(label, fn, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; console.error(`[thử ${i}/${tries}] ${label}: ${e.message||e}`); if (i < tries) await sleep(2000 * i); }
  }
  const err = new Error(`${label} — thất bại sau ${tries} lần: ${lastErr?.message||lastErr}`);
  err.attempts = tries; err.original = String(lastErr?.message||lastErr); throw err;
}

// --- đọc REST (1 trang, tối đa 1000 dòng) ---
async function q(path) {
  return withRetry(`Đọc ${path.split('?')[0]}`, async () => {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
    if (!r.ok) { const b = (await r.text()).slice(0,160); const e = new Error(`HTTP ${r.status} ${b}`); e.httpStatus = r.status; throw e; }
    return r.json();
  });
}

// --- đọc TẤT CẢ dòng (phân trang bằng Range) cho bảng có thể >1000 dòng (materials...) ---
async function qAll(path) {
  const out = []; const step = 1000; let from = 0;
  while (true) {
    const to = from + step - 1;
    const page = await withRetry(`Đọc ${path.split('?')[0]} [${from}-${to}]`, async () => {
      const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${to}`, 'Range-Unit': 'items' } });
      if (!r.ok) { const b = (await r.text()).slice(0,160); const e = new Error(`HTTP ${r.status} ${b}`); e.httpStatus = r.status; throw e; }
      return r.json();
    });
    out.push(...page);
    if (page.length < step) break;
    from += step;
  }
  return out;
}

// --- AI viết nhận định (tùy chọn — chỉ khi có key). Số do code lo, AI chỉ diễn giải. ---
async function aiSummary(problems) {
  if (!AI_KEY || !problems.length) return null;
  const brief = problems.map(p => `- ${p.title}: ${p.count} (${p.level})`).join('\n');
  const prompt = `Bạn là trợ lý quản trị hệ thống kiểm kê F&B. Dưới đây là các vấn đề dữ liệu vừa quét được:
${brief}
Viết NGẮN GỌN tiếng Việt, tối đa 4 dòng: (1) 1 câu nhận định tổng thể mức độ khỏe/không; (2) liệt kê 2-3 việc nên ưu tiên xử lý trước theo thứ tự. Không bịa thêm số, chỉ dựa dữ liệu trên.`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${AI_KEY}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{ parts:[{ text: prompt }] }] })
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch { return null; }
}

function ruleDiagnose(e) {
  const s = (e.original||e.message||'').toLowerCase();
  if (e.httpStatus === 401 || e.httpStatus === 403 || s.includes('401') || s.includes('403'))
    return 'Nguyên nhân: Sai/thiếu quyền SUPABASE_SERVICE_KEY.\nCách khắc phục: Lấy lại Secret key trong Supabase → cập nhật secret trên GitHub.';
  if (e.httpStatus === 404 || s.includes('404') || s.includes('does not exist') || s.includes('relation'))
    return 'Nguyên nhân: Thiếu bảng/cột trong Supabase.\nCách khắc phục: Chạy các file schema còn thiếu trong Supabase SQL Editor.';
  if (s.includes('fetch') || s.includes('network') || s.includes('timeout') || s.includes('enotfound'))
    return 'Nguyên nhân: Lỗi mạng tạm thời tới Supabase.\nCách khắc phục: Đã tự thử lại 3 lần; nếu lặp lại, kiểm tra SUPABASE_URL.';
  return 'Nguyên nhân: Lỗi chưa phân loại.\nCách khắc phục: Xem log GitHub Actions để biết chi tiết.';
}

// duyệt jsonb items {code: qty} tìm giá trị âm
function negatives(items) {
  const out = [];
  if (items && typeof items === 'object') for (const [code, v] of Object.entries(items)) {
    const n = typeof v === 'number' ? v : Number(v && v.qty != null ? v.qty : v);
    if (!isNaN(n) && n < 0) out.push({ code, qty: n });
  }
  return out;
}

try {
  const PERIOD = curPeriod();
  // ===== THU THẬP DỮ LIỆU =====
  const [plants, profiles, userPlants, subs, spots, closings, openings, materials] = await Promise.all([
    q('plants?select=plant_code,plant_name'),
    q('profiles?select=id,full_name,role,status,created_at'),
    q('user_plants?select=user_id,plant_code'),
    q('submissions?select=id,plant_code,sloc_code,status,period,items,created_at&order=created_at.desc&limit=3000'),
    q('spot_checks?select=id,plant_code,description,amount,status,created_at&order=created_at.desc&limit=2000'),
    q('closing_stock?select=plant_code,sloc_code,period,recon,items,created_at&order=created_at.desc&limit=1000'),
    q('opening_stock?select=plant_code,sloc_code,items'),
    qAll('materials?select=code,name'),
  ]);
  const pname = c => (plants.find(p => p.plant_code === c) || {}).plant_name || c;
  const problems = [];  // {title, level, count, lines[]}
  const add = (title, level, lines) => { if (lines.length) problems.push({ title, level, count: lines.length, lines }); };

  // ① Mã vật tư thiếu tên (name rỗng / '?' / trùng code)
  {
    const bad = materials.filter(m => { const nm = (m.name == null ? '' : String(m.name)).trim(); return !nm || nm === '?' || nm === String(m.code).trim(); });
    add('① Mã vật tư thiếu tên (name = code / rỗng)', 'vàng',
      bad.slice(0, 15).map(m => `- ${m.code}`).concat(bad.length > 15 ? [`…và ${bad.length - 15} mã nữa`] : []));
    if (bad.length) problems[problems.length-1].count = bad.length; // đếm tổng thật
  }

  // ② Phiếu kiểm kê "Chờ duyệt" treo lâu
  {
    const stale = subs.filter(s => /chờ duyệt/i.test(s.status || '') && daysSince(s.created_at) >= STALE_DAYS);
    add(`② Phiếu kiểm kê "Chờ duyệt" treo ≥ ${STALE_DAYS} ngày`, 'đỏ',
      stale.slice(0, 15).map(s => `- ${pname(s.plant_code)} · phiếu ${s.id} · ${dstr(s.created_at)} (${daysSince(s.created_at)} ngày)`)
        .concat(stale.length > 15 ? [`…và ${stale.length - 15} phiếu nữa`] : []));
    if (stale.length) problems[problems.length-1].count = stale.length;
  }

  // ③ Đột xuất chưa duyệt + tiền bù đang treo
  {
    const pend = spots.filter(s => /chờ duyệt/i.test(s.status || ''));
    const sum = pend.reduce((a, s) => a + (Number(s.amount) || 0), 0);
    const lines = pend.slice(0, 12).map(s => `- ${pname(s.plant_code)} · ${vnd(s.amount)}${(Number(s.amount)||0) >= BIG_AMOUNT ? ' ⚠' : ''} · ${dstr(s.created_at)}`);
    if (pend.length) lines.push(`→ Tổng tiền bù đang chờ duyệt: ${vnd(sum)} (${pend.length} vụ)`);
    add('③ Kiểm kê đột xuất chưa duyệt', 'vàng', lines);
    if (pend.length) problems[problems.length-1].count = pend.length;
  }

  // ④ Tồn âm (trong tồn đầu kỳ & tồn cuối kỳ)
  {
    const lines = [];
    openings.forEach(o => { const neg = negatives(o.items); if (neg.length) lines.push(`- [đầu kỳ] ${pname(o.plant_code)}/${o.sloc_code}: ${neg.slice(0,3).map(x=>x.code+'='+x.qty).join(', ')}${neg.length>3?` +${neg.length-3}`:''}`); });
    closings.forEach(c => { const neg = negatives(c.items); if (neg.length) lines.push(`- [cuối kỳ ${c.period||''}] ${pname(c.plant_code)}/${c.sloc_code}: ${neg.slice(0,3).map(x=>x.code+'='+x.qty).join(', ')}${neg.length>3?` +${neg.length-3}`:''}`); });
    add('④ Tồn âm (số lượng < 0)', 'đỏ', lines.slice(0, 15).concat(lines.length > 15 ? [`…và ${lines.length - 15} dòng nữa`] : []));
  }

  // ⑤ Chênh lệch tồn cuối lớn (recon.diffCnt cao) — chỉ xét kỳ gần nhất mỗi điểm bán
  {
    const seen = new Set(); const big = [];
    for (const c of closings) { // đã sort desc theo created_at -> lần đầu gặp = mới nhất
      const key = c.plant_code + '|' + c.sloc_code;
      if (seen.has(key)) continue; seen.add(key);
      const d = c.recon && (c.recon.diffCnt != null ? c.recon.diffCnt : (Array.isArray(c.recon.diff) ? c.recon.diff.length : 0)) || 0;
      if (d >= BIG_DIFF) big.push({ key, name: pname(c.plant_code) + '/' + c.sloc_code, d, period: c.period });
    }
    big.sort((a, b) => b.d - a.d);
    add(`⑤ Chênh lệch tồn cuối lớn (≥ ${BIG_DIFF} mã lệch)`, 'vàng',
      big.slice(0, 12).map(x => `- ${x.name} · ${x.d} mã lệch · kỳ ${x.period || '?'}`));
  }

  // ⑥ Kho chưa kiểm kê kỳ hiện tại (chỉ tính điểm bán có người phụ trách active)
  {
    const activeIds = new Set(profiles.filter(p => (p.role==='giam_sat'||p.role==='bep_truong') && p.status==='active').map(p=>p.id));
    const watched = [...new Set(userPlants.filter(u => activeIds.has(u.user_id)).map(u => u.plant_code))];
    const donePlants = new Set(subs.filter(s => (s.period||'') === PERIOD).map(s => s.plant_code));
    const missing = watched.filter(pc => !donePlants.has(pc));
    add(`⑥ Kho CHƯA có phiếu kiểm kê kỳ ${PERIOD}`, 'đỏ', missing.slice(0, 20).map(pc => `- ${pname(pc)}`));
    if (missing.length) problems[problems.length-1].count = missing.length;
  }

  // ⑦ User active nhưng chưa được gán kho
  {
    const assigned = new Set(userPlants.map(u => u.user_id));
    const orphan = profiles.filter(p => (p.role==='giam_sat'||p.role==='bep_truong') && p.status==='active' && !assigned.has(p.id));
    add('⑦ Người dùng active chưa gán kho phụ trách', 'vàng',
      orphan.slice(0, 15).map(p => `- ${p.full_name || p.id} (${p.role})`));
  }

  // ⑧ Tài khoản đang chờ duyệt (pending)
  {
    const pend = profiles.filter(p => p.status === 'pending');
    add('⑧ Tài khoản chờ admin duyệt', 'vàng',
      pend.slice(0, 15).map(p => `- ${p.full_name || p.id}${p.created_at ? ' · đăng ký ' + dstr(p.created_at) : ''}`));
    if (pend.length) problems[problems.length-1].count = pend.length;
  }

  // ===== ĐÓNG GÓI BÁO CÁO =====
  const nRed = problems.filter(p => p.level === 'đỏ').length;
  const header = `🩺 BÁC SĨ DỮ LIỆU — Kiểm kê F&B\nThời điểm: ${nowVN()} · Kỳ: ${PERIOD}`;

  if (!problems.length) {
    const msg = `${header}\n\n✅ Không phát hiện vấn đề nào trong 8 hạng mục quét. Hệ thống sạch.`;
    await withRetry('Gửi báo cáo (sạch) về Teams', async () => { const r = await postTeams(PERSONAL, msg); if (!r.ok && r.status !== 0) throw new Error(`Teams HTTP ${r.status}`); });
    console.log('Đã gửi báo cáo: hệ thống sạch.'); process.exit(0);
  }

  const icon = l => l === 'đỏ' ? '🔴' : '🟡';
  let body = `${header}\n\n📋 Phát hiện ${problems.length} nhóm vấn đề` + (nRed ? ` (${nRed} nhóm đỏ cần xử lý sớm)` : '') + `:\n`;
  for (const p of problems) body += `\n${icon(p.level)} ${p.title} — ${p.count}\n${p.lines.join('\n')}\n`;

  const ai = await aiSummary(problems);
  if (ai) body += `\n🤖 Nhận định & ưu tiên:\n${ai}\n`;
  body += `\n(Agent chỉ phát hiện & báo — không tự sửa dữ liệu. Xử lý trong app hoặc báo em.)`;

  await withRetry('Gửi báo cáo sức khỏe về Teams', async () => { const r = await postTeams(PERSONAL, body); if (!r.ok && r.status !== 0) throw new Error(`Teams HTTP ${r.status}`); });
  console.log('Đã gửi báo cáo sức khỏe.'); console.log(body);

} catch (e) {
  console.error('LỖI:', e.message||e);
  const diag = ruleDiagnose(e);
  const report = `🔧 AGENT BÁC SĨ DỮ LIỆU LỖI (đã tự thử lại ${e.attempts||3} lần không được)\nThời điểm: ${nowVN()}\n\nChi tiết: ${(e.message||String(e)).slice(0,300)}\n\n🤖 Chẩn đoán:\n${diag}`;
  try { await postTeams(PERSONAL, report); console.log('Đã gửi báo lỗi về chat riêng Khoa.'); }
  catch (e2) { console.error('Không gửi được báo lỗi:', e2.message||e2); }
  process.exit(1);
}
