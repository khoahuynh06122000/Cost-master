// kiem-tra/kiem-tuan.mjs — TỰ KIỂM APP MỖI TUẦN (không dùng AI, không tốn token).
//
// Đúc kết từ đợt rà soát 05/10/2026 (20 agent, 241 phát hiện): những gì kiểm được bằng
// MÁY thì để máy kiểm hằng tuần; phần cần phán đoán thì dùng bộ rà soát AI
// (kiem-tra/ra-soat-ai.js) khi cần.
//
// CHỈ ĐỌC: không ghi, không xoá gì trên Supabase. Không POST tới API đổi mật khẩu / gửi push.
// Bí mật lấy từ GitHub Secrets (giống agent/report.mjs). Chạy tay: node kiem-tra/kiem-tuan.mjs
//
// Kết quả gửi RIÊNG Khoa (TEAMS_PERSONAL_URL); có lỗi đỏ thì job GitHub báo thất bại.

import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.SITE_URL || 'https://cost-master-sigma.vercel.app').replace(/\/+$/, '');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const L = HTML.split('\n');

// Khoá đọc CSDL: có khoá service thì kiểm được cả số liệu; không có thì dùng khoá công khai
// nằm sẵn trong index.html (chỉ kiểm được bảng/cột, bỏ qua phần số liệu).
const SB_URL = (process.env.SUPABASE_URL || (HTML.match(/SB_DIRECT='([^']+)'/) || [])[1] || '').replace(/\/+$/, '');
const SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
const SB_KEY = SERVICE || (HTML.match(/SB_KEY='([^']+)'/) || [])[1] || '';
const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
const TEAMS = process.env.TEAMS_PERSONAL_URL || process.env.TEAMS_FLOW_URL || '';

const KQ = [];   // {nhom, muc:'ok'|'vang'|'do', ten, chi}
const ghi = (nhom, muc, ten, chi = '') => KQ.push({ nhom, muc, ten, chi });
// Mạng hay cắt kết nối giữa chừng khi gọi liên tục -> tự thử lại 3 lần, đừng báo đỏ oan.
const doc = async (u, o) => {
  let loi;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(u, o); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, t, j }; }
    catch (e) { loi = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw loi;
};

// ------------------------------------------------------------------ 1. cú pháp
function kiemCuPhap() {
  const re = /<script>([\s\S]*?)<\/script>/g; let m, n = 0, loi = 0;
  while ((m = re.exec(HTML))) { n++; try { new vm.Script(m[1]); } catch (e) { loi++; ghi('Cú pháp', 'do', 'Khối script ' + n + ' lỗi cú pháp', e.message); } }
  for (const f of ['sw.js', 'api/ocr.js', 'api/push-send.js', 'api/set-password.js']) {
    try { new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^\s*import .*$/gm, '')); }
    catch (e) { loi++; ghi('Cú pháp', 'do', f + ' lỗi cú pháp', e.message); }
  }
  if (!loi) ghi('Cú pháp', 'ok', n + ' khối script + 4 file máy chủ', '');
}

// ------------------------------------------------------------------ 2. máy chủ còn sống, bản deploy đúng
async function kiemMayChu() {
  const verRepo = (HTML.match(/APP_VER='([^']+)'/) || [])[1];
  try {
    const r = await doc(SITE + '/index.html', { cache: 'no-store' });
    const verWeb = (r.t.match(/APP_VER='([^']+)'/) || [])[1];
    if (r.s !== 200) ghi('Máy chủ', 'do', 'Trang app không mở được', 'HTTP ' + r.s);
    else if (verWeb !== verRepo) ghi('Máy chủ', 'vang', 'Bản trên web khác bản trong repo', 'web ' + verWeb + ' · repo ' + verRepo);
    else ghi('Máy chủ', 'ok', 'Trang app chạy bản ' + verWeb);
  } catch (e) { ghi('Máy chủ', 'do', 'Không tới được ' + SITE, e.message); }

  for (const f of ['/sw.js', '/manifest.webmanifest']) {
    const r = await doc(SITE + f).catch(e => ({ s: 0, t: e.message }));
    if (r.s !== 200) ghi('Máy chủ', 'do', f + ' không tải được', 'HTTP ' + r.s);
  }
  const p = await doc(SITE + '/api/push-send').catch(e => ({ s: 0 }));
  if (p.s !== 200) ghi('Máy chủ', 'do', 'API thông báo đẩy không trả lời', 'HTTP ' + p.s);
  else if (!(p.j && p.j.ready)) ghi('Máy chủ', 'vang', 'API thông báo đẩy chưa có khoá VAPID — app chỉ báo khi đang mở');

  // Quét ảnh: không khoá phải bị từ chối đúng câu; khoá giả phải đi tới Google rồi bị Google từ chối.
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const post = b => doc(SITE + '/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).catch(e => ({ s: 0, t: e.message }));
  const a = await post({ images: [px] });
  const b = await post({ key: 'AIzaKIEM-TRA-TUAN-KHOA-GIA-000000', images: [px] });
  if (a.s === 400 && /khóa AI/i.test(a.t) && b.s === 502 && /lỗi 400/.test(b.t)) ghi('Máy chủ', 'ok', 'API quét ảnh: chặn đúng khi thiếu khoá, đi tới Google bình thường');
  else ghi('Máy chủ', 'do', 'API quét ảnh trả lời lạ', 'không khoá → ' + a.s + ' · khoá giả → ' + b.s + ' ' + String(b.t).slice(0, 120));
}

// ------------------------------------------------------------------ 3. CSDL khớp code
async function kiemCsdl() {
  if (!SB_URL || !SB_KEY) { ghi('CSDL', 'vang', 'Thiếu địa chỉ / khoá Supabase — bỏ qua'); return; }
  const cap = new Map();   // bảng -> Set cột
  const them = (t, c) => { if (!cap.has(t)) cap.set(t, new Set()); if (c) cap.get(t).add(c); };
  for (let i = 1047; i < L.length; i++) {
    const l = L[i]; if (l.length > 3000) continue;   // bỏ 2 dòng dữ liệu nhúng
    const re = /sb\.from\(\s*'([a-z_]+)'\s*\)([^;]*)/g; let m;
    while ((m = re.exec(l))) {
      const t = m[1], duoi = m[2]; them(t);
      // CHỈ lấy cột nằm ngay trong chuỗi gọi của chính lệnh này (cùng dòng) — lấy rộng hơn
      // sẽ vớ cột của lệnh bên cạnh (bài học đợt rà soát 05/10).
      (duoi.match(/\.(eq|neq|in|like|ilike|order|gte|lte|gt|lt|is)\(\s*'([a-z_]+)'/g) || []).forEach(s => them(t, s.match(/'([a-z_]+)'/)[1]));
      const sel = duoi.match(/\.select\(\s*'([^']*)'/); if (sel) sel[1].split(',').map(x => x.trim()).filter(x => /^[a-z_]+$/.test(x)).forEach(c => them(t, c));
      const pl = duoi.match(/\.(insert|upsert|update)\(\s*\{([^}]*)\}/); if (pl) (pl[2].match(/([a-z_]+)\s*:/g) || []).forEach(k => /_/.test(k) && them(t, k.replace(/[\s:]/g, '')));
    }
  }
  let thieu = 0, soCot = 0;
  for (const [t, cols] of cap) {
    const r = await doc(`${SB_URL}/rest/v1/${t}?select=*&limit=1`, { headers: H });
    if (r.j && r.j.code === 'PGRST205') { thieu++; ghi('CSDL', 'do', 'Thiếu bảng ' + t, 'code đang dùng mà máy chủ không có'); continue; }
    for (const c of cols) {
      soCot++;
      const x = await doc(`${SB_URL}/rest/v1/${t}?select=${c}&limit=1`, { headers: H });
      if (x.j && x.j.code === '42703') { thieu++; ghi('CSDL', 'do', `Thiếu cột ${t}.${c}`, 'code đang dùng mà máy chủ không có'); }
    }
  }
  if (!thieu) ghi('CSDL', 'ok', `${cap.size} bảng, ${soCot} cột code dùng — đều có trên máy chủ`);
  // Khoá CÔNG KHAI không được đọc ra dòng dữ liệu nào (RLS phải chặn)
  const pub = (HTML.match(/SB_KEY='([^']+)'/) || [])[1];
  if (pub) {
    const lo = [];
    for (const t of cap.keys()) {
      const r = await doc(`${SB_URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: pub, Authorization: 'Bearer ' + pub } });
      if (r.s === 200 && Array.isArray(r.j) && r.j.length) lo.push(t);
    }
    if (lo.length) ghi('CSDL', 'do', 'Khoá công khai ĐỌC ĐƯỢC dữ liệu: ' + lo.join(', '), 'RLS bị hở — ai cũng xem được');
    else ghi('CSDL', 'ok', 'Khoá công khai không đọc được dòng dữ liệu nào');
  }
}

// ------------------------------------------------------------------ 4. số liệu (cần khoá service)
async function tatCa(bang, cot) {
  const out = []; for (let o = 0; ; o += 1000) {
    const r = await doc(`${SB_URL}/rest/v1/${bang}?select=${cot}&order=id&offset=${o}&limit=1000`, { headers: H });
    if (r.s !== 200 || !Array.isArray(r.j)) throw new Error(bang + ' HTTP ' + r.s + ' ' + String(r.t).slice(0, 100));
    out.push(...r.j); if (r.j.length < 1000) return out;
  }
}
async function kiemSoLieu() {
  if (!SERVICE) { ghi('Số liệu', 'vang', 'Không có khoá service — bỏ qua phần kiểm số liệu (chạy trên GitHub mới có)'); return; }
  const tr = await tatCa('transfers', 'id,date,code,qty,from_key,to_key,reason');
  const rq = await tatCa('transfer_requests', 'id,status,items');
  const su = await tatCa('submissions', 'id,status,user_name,items');
  const rc = await tatCa('receipts', 'id');

  // 4a. Ngưỡng 1.000 dòng: app tải các bảng này KHÔNG phân trang (rà soát 05/10, mục B5)
  for (const [t, n] of [['transfers', tr.length], ['submissions', su.length], ['receipts', rc.length]]) {
    const gh = t === 'receipts' ? 2000 : 1000;
    if (n >= gh) ghi('Số liệu', 'do', `Bảng ${t} đã ${n} dòng — VƯỢT ngưỡng app tải được (${gh})`, 'dòng cũ đang rơi khỏi công thức Xuất (tính) / tồn ước tính');
    else if (n >= gh * 0.8) ghi('Số liệu', 'vang', `Bảng ${t} đã ${n}/${gh} dòng — sắp chạm ngưỡng`, 'cần sửa phân trang trước khi vượt');
  }
  // 4b. Phiếu đã duyệt mà sổ thiếu / thừa dòng (khớp ĐUÔI CHÍNH XÁC mã phiếu — bài học 24/09)
  const laCua = (t, id) => t.reason === id || String(t.reason || '').endsWith(' · ' + id);
  const lech = [];
  for (const r of rq.filter(x => x.status === 'Đã duyệt')) {
    const phai = Object.values(r.items || {}).filter(v => Number(v && (v.qtyOk ?? v.qtyReq)) > 0).length;
    const co = tr.filter(t => laCua(t, r.id)).length;
    if (co !== phai) lech.push(`${r.id} (phải ${phai}, sổ ${co})`);
  }
  if (lech.length) ghi('Số liệu', 'do', lech.length + ' phiếu đã duyệt mà sổ lệch số dòng', lech.slice(0, 10).join(' · '));
  else ghi('Số liệu', 'ok', 'Mọi phiếu điều chuyển đã duyệt đều khớp sổ');
  // 4c. Dòng sổ ghi trùng (cùng ngày, mã, SL, hai đầu kho, lý do) → trừ kho gấp đôi
  const van = {}; tr.forEach(t => { const k = [t.date, t.code, t.qty, t.from_key, t.to_key, t.reason].join('|'); van[k] = (van[k] || 0) + 1; });
  const trung = Object.entries(van).filter(([, n]) => n > 1);
  if (trung.length) ghi('Số liệu', 'do', trung.length + ' nhóm dòng sổ bị ghi trùng', trung.slice(0, 5).map(([k, n]) => k.split('|').slice(0, 3).join(' ') + ' ×' + n).join(' · '));
  else ghi('Số liệu', 'ok', 'Sổ điều chuyển không có dòng ghi trùng');
  // 4d. Phiếu kiểm kê nạp từ Excel có nhiều mã bằng 0 (hậu quả lỗi ô trống → 0, đã sửa 05/10)
  const nghi = su.filter(s => /nhập từ Excel/.test(s.user_name || '')).map(s => {
    const v = Object.values(s.items || {}); const z = v.filter(x => Number(x) === 0).length; return { s, z, n: v.length };
  }).filter(x => x.n >= 10 && x.z / x.n >= 0.3);
  if (nghi.length) ghi('Số liệu', 'vang', nghi.length + ' phiếu nạp từ Excel có ≥30% mã bằng 0 — soát xem có phải ô bỏ trống không',
    nghi.slice(0, 8).map(x => `${x.s.id} [${x.s.status}] ${x.z}/${x.n}`).join(' · '));
}

// ------------------------------------------------------------------ 5. dữ liệu nhúng + từ điển
function kiemNhung() {
  try {
    const D = JSON.parse(L[1048].replace(/^const DATA\s*=\s*/, '').replace(/;\s*$/, ''));
    const ma = {}; D.materials.forEach(m => { ma[m.code] = (ma[m.code] || 0) + 1; });
    const trung = Object.values(ma).filter(n => n > 1).length;
    const rong = D.materials.filter(m => !String(m.code || '').trim() || !String(m.name || '').trim()).length;
    const i = HTML.indexOf('const KHO_TAT'); let kt = {};
    if (i > 0) { const j = HTML.indexOf('{', i); let d = 0, e = j; for (; e < HTML.length; e++) { if (HTML[e] === '{') d++; else if (HTML[e] === '}' && !--d) break; } kt = Function('return ' + HTML.slice(j, e + 1))(); }
    const thieuTat = D.warehouses.filter(w => !((w.plant + '|' + w.sloc) in kt) && !(w.sloc in kt));
    const vals = Object.values(kt); const tatTrung = vals.length - new Set(vals).size;
    if (trung || rong || thieuTat.length || tatTrung) ghi('Dữ liệu nhúng', 'do', 'Danh mục/kho nhúng có vấn đề',
      `mã trùng ${trung} · mã/tên rỗng ${rong} · kho thiếu chữ tắt ${thieuTat.length} · chữ tắt trùng ${tatTrung}`);
    else ghi('Dữ liệu nhúng', 'ok', `${D.warehouses.length} kho, ${D.materials.length} mã — sạch; chữ tắt mã phiếu đủ`);
  } catch (e) { ghi('Dữ liệu nhúng', 'do', 'Không đọc được khối DATA', e.message); }
  try {
    const a = HTML.indexOf('const TXT={'), b = HTML.indexOf('function L(s){');
    const ctx = {}; vm.createContext(ctx); vm.runInContext(HTML.slice(a, b).replace(/^(const|let) /gm, 'var '), ctx);
    const en = Object.keys(ctx.TXT.en), hi = Object.keys(ctx.TXT.hi);
    const lech = en.filter(k => !(k in ctx.TXT.hi)).length + hi.filter(k => !(k in ctx.TXT.en)).length;
    const lo = ctx.TXT_RE.filter(x => !x || !x.re || typeof x.re.test !== 'function').length;
    if (lech || lo) ghi('Ngôn ngữ', 'do', 'Từ điển hỏng', `khoá Anh/Ấn lệch ${lech} · mẫu hỏng ${lo} (mẫu hỏng làm cả app mất dịch)`);
    else ghi('Ngôn ngữ', 'ok', `${en.length} khoá Anh = Ấn, ${ctx.TXT_RE.length} mẫu đều chạy`);
  } catch (e) { ghi('Ngôn ngữ', 'do', 'Không chạy được khối từ điển', e.message); }
}

// ------------------------------------------------------------------ 6. lỗi đã biết không được tái phát
// Mỗi mẫu là một lỗi THẬT từng gặp. Mẫu còn "mở" = lỗi đã phát hiện, chưa sửa (báo vàng);
// mẫu đã sửa mà xuất hiện lại = tái phát (báo đỏ).
const MAU = [
  { re: /ilike\('reason','%'\+/, mo: true, vi: 'So mã phiếu bằng chuỗi con trên máy chủ — phiếu gốc dính phiếu "-2" (rà soát E1)' },
  { re: /reason[^;\n]{0,40}\.includes\(r\.id\)/, mo: false, vi: 'So mã phiếu bằng includes — phiếu gốc dính phiếu "-2" (sửa 24/09)' },
  { re: /const qty=Number\(raw\);\s*\n\s*if\(!isFinite\(qty\)\)\{badQty\+\+;continue;\}/, mo: false, vi: 'Ô Số lượng trống bị đọc thành 0 (sửa 05/10)', canTruoc: "if(raw===''){boTrong++;continue;}" },
  { re: /period:periodOfDate\(t\.date\)/, mo: true, vi: 'Ngày dd/mm trong file điều chuyển đưa thẳng vào new Date() — sai kỳ (rà soát B3)' },
];
function kiemTaiPhat() {
  for (const m of MAU) {
    const co = m.re.test(HTML) && !(m.canTruoc && HTML.includes(m.canTruoc));
    if (co) ghi('Lỗi đã biết', m.mo ? 'vang' : 'do', (m.mo ? 'Chưa sửa: ' : 'TÁI PHÁT: ') + m.vi);
    else if (m.mo) ghi('Lỗi đã biết', 'ok', 'Đã hết: ' + m.vi + ' — có thể chuyển mẫu này sang "đã sửa"');
  }
}

// ------------------------------------------------------------------ chạy
const NHAN = { ok: '✅', vang: '🟡', do: '🔴' };
// Mỗi hạng mục chạy riêng: một hạng mục hỏng không được làm mất kết quả các hạng mục khác.
for (const [ten, f] of [['Cú pháp', kiemCuPhap], ['Dữ liệu nhúng', kiemNhung], ['Lỗi đã biết', kiemTaiPhat],
  ['Máy chủ', kiemMayChu], ['CSDL', kiemCsdl], ['Số liệu', kiemSoLieu]]) {
  try { await f(); }
  catch (e) { ghi(ten, 'do', 'Không kiểm được hạng mục này', String(e && (e.cause && e.cause.code || e.message) || e)); console.error(ten, e); }
}

const dem = k => KQ.filter(x => x.muc === k).length;
const ngay = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const dau = dem('do') ? `🔴 KIỂM TRA APP TUẦN ${ngay}: ${dem('do')} lỗi cần xử lý` : dem('vang') ? `🟡 KIỂM TRA APP TUẦN ${ngay}: chạy được, ${dem('vang')} điểm cần để ý` : `✅ KIỂM TRA APP TUẦN ${ngay}: mọi thứ ổn`;
const than = KQ.filter(x => x.muc !== 'ok').map(x => `${NHAN[x.muc]} [${x.nhom}] ${x.ten}${x.chi ? ' — ' + x.chi : ''}`)
  .concat([`(${dem('ok')} hạng mục đạt: ` + KQ.filter(x => x.muc === 'ok').map(x => x.nhom).filter((v, i, a) => a.indexOf(v) === i).join(', ') + ')']);
const tin = [dau, ...than].join('\n');
console.log(tin);
if (TEAMS) { try { await fetch(TEAMS, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: tin }); } catch (e) { console.error('Không gửi được Teams:', e.message); } }
process.exit(dem('do') ? 1 : 0);
