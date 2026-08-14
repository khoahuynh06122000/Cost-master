// agent/report.mjs — THEO DÕI KIỂM KÊ THEO KỲ ĐÃ MỞ + AUTO-HEALING (AI chẩn đoán)
// - Chỉ báo khi kế toán ĐÃ MỞ KỲ (count_lists). Phân 3 nhóm: chưa nhập / chờ duyệt / đã duyệt.
//   Tất cả kho đã mở đều được duyệt = im lặng. Chưa mở kỳ = im lặng.  -> gửi NHÓM (TEAMS_FLOW_URL).
// - Lỗi kỹ thuật           -> tự thử lại 3 lần; vẫn lỗi thì gọi AI chẩn đoán rồi gửi RIÊNG Khoa (TEAMS_PERSONAL_URL).
// Bí mật lấy từ GitHub Secrets — KHÔNG nhúng key vào code.

const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const FLOW     = process.env.TEAMS_FLOW_URL;                 // nhóm
const PERSONAL = process.env.TEAMS_PERSONAL_URL || FLOW;     // chat riêng Khoa (thiếu thì tạm về nhóm)
const AI_KEY   = process.env.AI_API_KEY || '';               // khóa AI để chẩn đoán (Gemini)
const AI_MODEL = process.env.AI_MODEL || 'gemini-2.5-flash'; // đổi model tại đây (hoặc set secret AI_MODEL)
const LATE_DAYS = 2;

if (!SB_URL || !SB_KEY || !FLOW) { console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY / TEAMS_FLOW_URL'); process.exit(1); }

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const dstr = t => new Date(t).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
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
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${AI_KEY}`, {
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
  // Chỉ theo dõi khi KẾ TOÁN ĐÃ MỞ KỲ: mỗi kho được mở = 1 dòng trong count_lists.
  // Trạng thái lấy từ submissions (Chờ duyệt / Đã duyệt). Tất cả đã duyệt => im lặng.
  const [plants, opened, subs, slocs] = await Promise.all([
    q('plants?select=plant_code,plant_name'),
    q('count_lists?select=plant_code,sloc_code,period,created_at'),
    q('submissions?select=plant_code,sloc_code,status,period&limit=5000'),
    q('slocs?select=plant_code,sloc_code,sloc_name').catch(() => []), // tên kho (nếu có bảng)
  ]);
  const pname = c => (plants.find(p => p.plant_code === c) || {}).plant_name || c;
  const snameMap = {};
  (Array.isArray(slocs) ? slocs : []).forEach(s => { snameMap[s.plant_code + '|' + s.sloc_code] = s.sloc_name; });
  const sname = (p, s) => snameMap[p + '|' + s] || ('kho ' + s);
  const whLabel = (p, s) => `${pname(p)} · ${sname(p, s)}`;

  // Chưa mở kỳ nào => không báo.
  if (!opened.length) { console.log('✅ Chưa có kỳ kiểm kê nào được mở — không gửi tin.'); process.exit(0); }

  // Kỳ đang theo dõi = kỳ mới nhất đã được mở.
  const activePeriod = [...new Set(opened.map(o => o.period))].sort().pop();
  const openUnits = opened.filter(o => o.period === activePeriod);

  // Trạng thái từng kho đã mở: 'done' (đã duyệt) | 'wait' (đã nhập, chờ duyệt) | 'none' (chưa nhập).
  const subOf = (p, s) => subs.filter(x => x.plant_code === p && x.sloc_code === s && x.period === activePeriod);
  const units = openUnits.map(o => {
    const ss = subOf(o.plant_code, o.sloc_code);
    const st = ss.some(x => x.status === 'Đã duyệt') ? 'done' : (ss.length ? 'wait' : 'none');
    const days = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 864e5);
    return { p: o.plant_code, s: o.sloc_code, st, days };
  });

  const none = units.filter(u => u.st === 'none');
  const wait = units.filter(u => u.st === 'wait');
  const done = units.filter(u => u.st === 'done');

  // Tất cả đã duyệt => dừng thông báo.
  if (!none.length && !wait.length) { console.log('✅ Tất cả kho đã mở đều được duyệt — không gửi tin.'); process.exit(0); }

  const perVN = (activePeriod || '').split('-').reverse().join('/'); // YYYY-MM -> MM/YYYY
  const line = u => `- ${whLabel(u.p, u.s)}`;
  let msg = `📋 THEO DÕI KIỂM KÊ — KỲ THÁNG ${perVN} (đã mở kỳ)\nThời điểm: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}\n`;
  if (none.length) msg += `\n🔴 CHƯA NHẬP (${none.length} kho):\n` +
    none.sort((a,b) => b.days - a.days).map(u => `${line(u)}${u.days >= 1 ? ` — mở kỳ ${u.days} ngày trước` : ''}`).join('\n') + '\n';
  if (wait.length) msg += `\n🟡 ĐÃ NHẬP · CHỜ KẾ TOÁN DUYỆT (${wait.length} kho):\n` +
    wait.map(line).join('\n') + '\n';
  if (done.length) msg += `\n🟢 ĐÃ DUYỆT (${done.length} kho):\n` +
    done.map(line).join('\n') + '\n';
  msg += `\nTiến độ: ${done.length}/${units.length} kho đã duyệt.`;

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
  const report = `🔧 AGENT LỖI (đã tự thử lại ${e.attempts||3} lần không được)\nThời điểm: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}\n\nChi tiết lỗi: ${(e.message||String(e)).slice(0,300)}\n\n🤖 Chẩn đoán:\n${diag}`;
  try { await postTeams(PERSONAL, report); console.log('Đã gửi báo lỗi + chẩn đoán về chat riêng Khoa.'); }
  catch (e2) { console.error('Không gửi được báo lỗi về Teams:', e2.message||e2); }
  console.log(report);
  process.exit(1);
}
