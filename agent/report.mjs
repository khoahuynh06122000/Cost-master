// agent/report.mjs — THEO DÕI KIỂM KÊ THEO KỲ ĐÃ MỞ + AUTO-HEALING (AI chẩn đoán)
// - Chỉ báo khi kế toán ĐÃ MỞ KỲ (count_lists). Phân 3 nhóm: chưa nhập / chờ duyệt / đã duyệt.
//   Tất cả kho đã mở đều được duyệt = im lặng. Chưa mở kỳ = im lặng.
// - TÁCH 2 TIN (24/10/2026): kho BẾP -> TEAMS_FLOW_URL_BEP, kho NHÀ HÀNG -> TEAMS_FLOW_URL.
//   Bếp chỉ báo bếp, NH chỉ báo NH; mỗi bên tự xét luật im lặng riêng.
//   Kho bếp = tên kho có chữ "Bếp" — đọc đúng danh sách kho trong index.html như app (laKhoBep).
// - Lỗi kỹ thuật           -> tự thử lại 3 lần; vẫn lỗi thì gọi AI chẩn đoán rồi gửi RIÊNG Khoa (TEAMS_PERSONAL_URL).
// Bí mật lấy từ GitHub Secrets — KHÔNG nhúng key vào code.
import { readFileSync } from 'node:fs';

const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const FLOW     = process.env.TEAMS_FLOW_URL;                 // nhóm NHÀ HÀNG
const FLOW_BEP = process.env.TEAMS_FLOW_URL_BEP || '';       // nhóm BẾP (chưa đặt thì không gửi phần bếp)
const PERSONAL = process.env.TEAMS_PERSONAL_URL || FLOW;     // chat riêng Khoa (thiếu thì tạm về nhóm)
const AI_KEY   = process.env.AI_API_KEY || '';               // khóa AI để chẩn đoán (Gemini)
const AI_MODEL = process.env.AI_MODEL || 'gemini-2.5-flash'; // đổi model tại đây (hoặc set secret AI_MODEL)
const LATE_DAYS = 2;

if (!SB_URL || !SB_KEY || !FLOW) { console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY / TEAMS_FLOW_URL'); process.exit(1); }

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const dstr = t => new Date(t).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vnNorm = s => String(s == null ? '' : s).normalize('NFD').toLowerCase()
  .replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, '');

// Tên kho lấy từ DATA.warehouses trong index.html — CÙNG nguồn với laKhoBep() của app,
// để bot và app luôn nhận cùng một tập kho bếp. Đọc hỏng thì rơi về bảng slocs.
function khoTrongApp() {
  try {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dong = html.split('\n').find(l => /^const DATA\s*=\s*\{/.test(l));
    const data = JSON.parse(dong.replace(/^const DATA\s*=\s*/, '').replace(/;\s*$/, ''));
    const m = {};
    (data.warehouses || []).forEach(w => { m[w.plant + '|' + w.sloc] = w.sloc_name; diemApp[w.plant] = w.plant_name; });
    return m;
  } catch (e) { console.warn('Không đọc được danh sách kho trong index.html:', e.message); return {}; }
}
const diemApp = {};   // tên điểm bán trong app, dự phòng khi bảng plants thiếu điểm mới

// Tuần ISO 'YYYY-Www' — y hệt tuanCua() của app để khớp cột weekly_counts.week.
// Nhận một Date mà các trường UTC mang giờ VIỆT NAM (gioVN()).
function tuanCua(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const nam = t.getUTCFullYear();
  const t1 = new Date(Date.UTC(nam, 0, 4));
  t1.setUTCDate(t1.getUTCDate() - ((t1.getUTCDay() + 6) % 7) + 3);
  return nam + '-W' + String(1 + Math.round((t - t1) / 604800000)).padStart(2, '0');
}
const gioVN = () => new Date(Date.now() + 7 * 3600e3);   // máy GitHub chạy giờ UTC
// 'YYYY-Www' -> 'dd/mm – dd/mm/yyyy' (thứ Hai – Chủ nhật)
function khoangTuan(W) {
  const [nam, w] = [+W.slice(0, 4), +W.slice(-2)];
  const t1 = new Date(Date.UTC(nam, 0, 4));
  const thu2 = new Date(t1.getTime() - ((t1.getUTCDay() + 6) % 7) * 864e5 + (w - 1) * 7 * 864e5);
  const cn = new Date(thu2.getTime() + 6 * 864e5);
  const f = d => String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${f(thu2)} – ${f(cn)}/${cn.getUTCFullYear()}`;
}

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
  const snameMap = {};
  (Array.isArray(slocs) ? slocs : []).forEach(s => { snameMap[s.plant_code + '|' + s.sloc_code] = s.sloc_name; });
  const khoApp = khoTrongApp();
  const sname = (p, s) => khoApp[p + '|' + s] || snameMap[p + '|' + s] || ('kho ' + s);
  const laBep = (p, s) => vnNorm(khoApp[p + '|' + s] || snameMap[p + '|' + s] || '').includes('bep');
  const pname = c => (plants.find(p => p.plant_code === c) || {}).plant_name || diemApp[c] || c;
  const whLabel = (p, s) => `${pname(p)} · ${sname(p, s)}`;
  // Mọi kho bếp (cùng danh sách app dùng ở màn Kiểm kê tuần của kế toán)
  const dsKhoBep = () => {
    const nguon = Object.keys(khoApp).length ? khoApp : snameMap;
    return Object.keys(nguon).filter(k => vnNorm(nguon[k]).includes('bep'))
      .map(k => { const [p, s] = k.split('|'); return { p, s }; });
  };

  // Chưa mở kỳ nào => phần kỳ tháng im lặng (phần kiểm kê TUẦN của bếp vẫn báo).
  if (!opened.length) console.log('Chưa có kỳ kiểm kê tháng nào được mở.');

  // Kỳ đang theo dõi = kỳ mới nhất đã được mở.
  const activePeriod = [...new Set(opened.map(o => o.period))].sort().pop() || '';
  const openUnits = opened.filter(o => o.period === activePeriod);

  // Trạng thái từng kho đã mở: 'done' (đã duyệt) | 'wait' (đã nhập, chờ duyệt) | 'none' (chưa nhập).
  const subOf = (p, s) => subs.filter(x => x.plant_code === p && x.sloc_code === s && x.period === activePeriod);
  const units = openUnits.map(o => {
    const ss = subOf(o.plant_code, o.sloc_code);
    const st = ss.some(x => x.status === 'Đã duyệt') ? 'done' : (ss.length ? 'wait' : 'none');
    const days = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 864e5);
    return { p: o.plant_code, s: o.sloc_code, st, days };
  });

  const perVN = (activePeriod || '').split('-').reverse().join('/'); // YYYY-MM -> MM/YYYY
  /* Cửa sổ kiểm kê tháng (rule Khoa 29/10/2026): BP chỉ nhập từ ngày 25 tới cuối tháng của kỳ đó; qua tháng là đóng,
     kho chưa nhập phải nhờ kế toán nhập bù. */
  function dongCuaSo(per) {
    const [y, m] = String(per || '').split('-').map(Number);
    if (!y || !m) return '';
    const cuoi = new Date(Date.UTC(y, m, 0)).getUTCDate(), mm = String(m).padStart(2, '0');
    const h = gioVN(), hy = h.getUTCFullYear(), hm = h.getUTCMonth() + 1, hd = h.getUTCDate();
    const truoc = hy < y || (hy === y && (hm < m || (hm === m && hd < 25)));
    const sau = hy > y || (hy === y && hm > m);
    if (truoc) return `⏳ Bộ phận nhập kiểm kê từ 25/${mm} đến ${cuoi}/${mm} — chưa tới thời gian nhập.\n`;
    if (sau) return `⛔ Đã hết thời gian nhập (25/${mm}–${cuoi}/${mm}). Kho chưa nhập không tự nhập được nữa — kế toán nhập bù.\n`;
    return `🗓 Đang trong thời gian nhập: 25/${mm} → ${cuoi}/${mm}.\n`;
  }
  const line = u => `- ${whLabel(u.p, u.s)}`;

  // Dựng 1 tin cho 1 nhóm kho. Trả null khi nhóm đó không có kho mở kỳ hoặc đã duyệt hết (im lặng).
  function dungTin(ten, ds) {
    const none = ds.filter(u => u.st === 'none');
    const wait = ds.filter(u => u.st === 'wait');
    const done = ds.filter(u => u.st === 'done');
    if (!none.length && !wait.length) return null;
    let msg = `📋 THEO DÕI KIỂM KÊ ${ten} — KỲ THÁNG ${perVN} (đã mở kỳ)\nThời điểm: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}\n` + dongCuaSo(activePeriod);
    if (none.length) msg += `\n🔴 CHƯA NHẬP (${none.length} kho):\n` +
      none.sort((a,b) => b.days - a.days).map(u => `${line(u)}${u.days >= 1 ? ` — mở kỳ ${u.days} ngày trước` : ''}`).join('\n') + '\n';
    if (wait.length) msg += `\n🟡 ĐÃ NHẬP · CHỜ KẾ TOÁN DUYỆT (${wait.length} kho):\n` +
      wait.map(line).join('\n') + '\n';
    if (done.length) msg += `\n🟢 ĐÃ DUYỆT (${done.length} kho):\n` +
      done.map(line).join('\n') + '\n';
    msg += `\nTiến độ: ${done.length}/${ds.length} kho đã duyệt.`;
    return msg;
  }

  // ===== KIỂM KÊ TUẦN CỦA BẾP (24/10/2026) =====
  // Mỗi kho bếp mỗi tuần ISO một bản (weekly_counts). Báo tuần này bếp nào đã/chưa kiểm.
  // Bếp nào cũng đã kiểm tuần này => phần tuần im lặng.
  async function phanTuan() {
    const W = tuanCua(gioVN()), W0 = tuanCua(new Date(gioVN().getTime() - 7 * 864e5));
    let ban;
    try { ban = await q(`weekly_counts?select=plant_code,sloc_code,week,count,created_by,created_at&week=in.(${W},${W0})`); }
    catch (e) { console.warn('Không đọc được kiểm kê tuần:', e.message); return `🍳 KIỂM KÊ TUẦN — ${W}\n⚠ Không đọc được số kiểm tuần lần này (xem log GitHub).`; }
    const tatCaBep = dsKhoBep();
    if (!tatCaBep.length) return null;
    const cua = (u, w) => ban.filter(b => b.plant_code === u.p && b.sloc_code === u.s && b.week === w)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const da = tatCaBep.filter(u => cua(u, W)), chua = tatCaBep.filter(u => !cua(u, W));
    if (!chua.length) { console.log(`✅ Kiểm tuần ${W}: mọi bếp đã kiểm.`); return null; }
    const daTuanTruoc = tatCaBep.filter(u => cua(u, W0)).length;
    const gioLuu = t => new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    let m = `🍳 KIỂM KÊ TUẦN — Tuần ${W.slice(-2)} (${khoangTuan(W)})\nĐã kiểm: ${da.length}/${tatCaBep.length} bếp\n`;
    m += `\n🔴 CHƯA KIỂM TUẦN NÀY (${chua.length} bếp):\n` +
      chua.map(u => `${line(u)}${cua(u, W0) ? '' : ' — tuần trước cũng chưa kiểm'}`).join('\n') + '\n';
    if (da.length) m += `\n🟢 ĐÃ KIỂM (${da.length} bếp):\n` +
      da.map(u => { const b = cua(u, W); return `${line(u)} — ${b.count || 0} mã${b.created_by ? ' · ' + b.created_by : ''} · ${gioLuu(b.created_at)}`; }).join('\n') + '\n';
    m += `\nTuần trước (tuần ${W0.slice(-2)}): ${daTuanTruoc}/${tatCaBep.length} bếp đã kiểm.`;
    return m;
  }

  // ===== NHẮC DUYỆT PHIẾU ĐIỀU CHUYỂN MỖI NGÀY (Khoa 29/10/2026) =====
  // Nhiều kho xuất hàng rồi quên duyệt -> sổ không trừ kho, kiểm kê cuối tháng lệch. Mỗi sáng: mỗi kho đang có
  // phiếu chờ CHÍNH MÌNH duyệt nhận 1 thông báo (chuông trong app + đẩy về máy), kèm quy định phải duyệt.
  // Bên duyệt: xin/đẩy -> kho CHO hàng; hàng dư -> bếp NHẬN; hủy -> kế toán (không nhắc ở đây).
  // Lỗi ở phần này KHÔNG làm hỏng tin Teams.
  async function nhacDuyetDC() {
    const out = { bep: [], nh: [] };
    try {
      const ds = await q('transfer_requests?select=id,kind,from_plant,from_sloc,to_plant,to_sloc,created_at&status=eq.' + encodeURIComponent('Chờ duyệt'));
      const g = {};
      ds.forEach(r => {
        if (r.kind === 'huy') return;
        const [p, s] = r.kind === 'du' ? [r.to_plant, r.to_sloc] : [r.from_plant, r.from_sloc];
        if (!p) return;
        const k = p + '|' + s; (g[k] = g[k] || { p, s, n: 0, cu: r.created_at }).n++;
        if (String(r.created_at) < String(g[k].cu)) g[k].cu = r.created_at;
      });
      const ks = Object.values(g);
      if (!ks.length) { console.log('✅ Không có phiếu điều chuyển nào chờ duyệt.'); return out; }
      const h = gioVN();
      const dauNgay = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), h.getUTCDate()) - 7 * 3600e3).toISOString();
      let daNhac = [];
      try { daNhac = await q(`notifications?select=plant_code,sloc_code&kind=eq.dcnhac&created_at=gte.${dauNgay}`); } catch (e) {}
      const APP = process.env.APP_URL || 'https://cost-master-sigma.vercel.app';
      for (const x of ks) {
        const ngay = Math.floor((Date.now() - new Date(x.cu).getTime()) / 864e5);
        const _v = new Date(new Date(x.cu).getTime() + 7 * 3600e3), ngayLap = String(_v.getUTCDate()).padStart(2, '0') + '/' + String(_v.getUTCMonth() + 1).padStart(2, '0');
        (laBep(x.p, x.s) ? out.bep : out.nh).push(`- ${whLabel(x.p, x.s)} — ${x.n} phiếu, cũ nhất ${ngay} ngày`);
        if (daNhac.some(d => d.plant_code === x.p && d.sloc_code === x.s)) continue;   // chạy lại trong ngày: không nhắc 2 lần
        const msg = `⏰ ${whLabel(x.p, x.s)} đang có ${x.n} phiếu điều chuyển Chờ tôi duyệt (cũ nhất lập ${ngayLap} — ${ngay} ngày). ⚠ Quy định: đã xuất hàng cho kho khác thì PHẢI duyệt phiếu ngay trong ngày — chưa duyệt thì sổ chưa trừ kho, kiểm kê cuối tháng sẽ lệch. Vào Nhập kho & ĐC → Chờ tôi duyệt.`;
        try {
          const r = await fetch(`${SB_URL}/rest/v1/notifications`, { method: 'POST',
            headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ id: 'NTB' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), plant_code: x.p, sloc_code: x.s,
              message: msg, kind: 'dcnhac', created_by: 'Hệ thống', read_flag: false }) });
          if (!r.ok) console.warn('Không ghi được thông báo nhắc duyệt', x.p, x.s, r.status, await r.text());
        } catch (e) { console.warn('Ghi thông báo nhắc duyệt lỗi', e.message); }
        try {
          const subs = await q(`push_subs?select=endpoint,p256dh,auth&plant_code=eq.${x.p}&sloc_code=eq.${x.s}`);
          const uniq = [...new Map(subs.filter(z => z.endpoint).map(z => [z.endpoint, z])).values()];
          if (uniq.length) await fetch(`${APP}/api/push-send`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subs: uniq, title: 'Phiếu điều chuyển chờ duyệt', body: msg, url: '/', tag: 'dcnhac' }) });
        } catch (e) { console.warn('Đẩy thông báo nhắc duyệt lỗi', e.message); }
      }
      console.log(`Đã nhắc duyệt điều chuyển: ${ks.length} kho.`);
    } catch (e) { console.warn('Nhắc duyệt điều chuyển lỗi (bỏ qua):', e.message); }
    return out;
  }
  const nhac = await nhacDuyetDC();
  const phanDC = ds => ds.length ? `⏰ PHIẾU ĐIỀU CHUYỂN CHỜ DUYỆT (${ds.length} kho):\n${ds.join('\n')}\n⚠ Quy định: đã xuất hàng thì phải duyệt phiếu ngay trong ngày — chưa duyệt thì sổ chưa trừ kho, kiểm kê cuối tháng sẽ lệch.` : null;

  // Bếp chỉ báo bếp, NH chỉ báo NH — mỗi nhóm một link Teams.
  const tuanBep = await phanTuan();
  const nhom = [
    { ten: 'BẾP',      url: FLOW_BEP, ds: units.filter(u =>  laBep(u.p, u.s)), them: [tuanBep, phanDC(nhac.bep)] },
    { ten: 'NHÀ HÀNG', url: FLOW,     ds: units.filter(u => !laBep(u.p, u.s)), them: [phanDC(nhac.nh)] },
  ];
  for (const g of nhom) {
    const msg = [dungTin(g.ten, g.ds), ...g.them].filter(Boolean).join('\n\n━━━━━━━━━━━━\n\n');
    if (!msg) { console.log(`✅ ${g.ten}: không có gì cần báo — không gửi tin.`); continue; }
    if (!g.url) { console.warn(`⚠ ${g.ten}: chưa đặt TEAMS_FLOW_URL_BEP — bỏ qua phần này.`); console.log(msg); continue; }
    await withRetry(`Gửi cảnh báo ${g.ten} về Teams`, async () => {
      const r = await postTeams(g.url, msg);
      if (!r.ok && r.status !== 0) throw new Error(`Teams HTTP ${r.status}`);
    });
    console.log(`Đã gửi cảnh báo ${g.ten}.`); console.log(msg);
  }

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
