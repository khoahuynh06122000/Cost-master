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
    // Tìm dòng theo NỘI DUNG — số dòng trôi mỗi lần thêm code (ghi cứng 1048 đã báo đỏ oan, 16/10/2026)
    const dongData = L.find(x => /^const DATA\s*=\s*\{/.test(x));
    if (!dongData) throw new Error('không tìm thấy dòng "const DATA ="');
    const D = JSON.parse(dongData.replace(/^const DATA\s*=\s*/, '').replace(/;\s*$/, ''));
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
  { re: /ilike\('reason','%'\+/, mo: false, vi: 'So mã phiếu bằng chuỗi con trên máy chủ — phiếu gốc dính phiếu "-2" (rà soát E1, sửa 13/10)' },
  { re: /reason[^;\n]{0,40}\.includes\(r\.id\)/, mo: false, vi: 'So mã phiếu bằng includes — phiếu gốc dính phiếu "-2" (sửa 24/09)' },
  { re: /const qty=Number\(raw\);\s*\n\s*if\(!isFinite\(qty\)\)\{badQty\+\+;continue;\}/, mo: false, vi: 'Ô Số lượng trống bị đọc thành 0 (sửa 05/10)', canTruoc: "if(raw===''){boTrong++;continue;}" },
  { re: /String\(r\[ngayCol\]\|\|''\)\.trim\(\)/, mo: false, vi: 'Ngày dd/mm trong file điều chuyển đưa thẳng vào new Date() — sai kỳ (rà soát B3, sửa 13/10)' },
  { re: /const today='-'\+kkYmd\(\)/, mo: false, vi: 'Chống phiếu trùng dò ngày YYYYMMDD trong mã phiếu MMDDYY — không bao giờ khớp (sửa 21/10)' },
  { re: /dbUpd\('transfer_requests',\{id:r\.id\},\{status:'Từ chối'/, mo: false, vi: 'Từ chối phiếu không điều kiện — màn cũ ghi đè phiếu người khác vừa duyệt/nhận (sửa 21/10)' },
  { re: /bSend\.onclick=\(\)=>submitReq\(\);/, mo: false, vi: 'Nút gửi phiếu điều chuyển không khoá — bấm đúp ra hai phiếu (sửa 21/10)' },
  { re: /if\(!confirm\(msg\)\)return;\s*\n\s*\(async\(\)=>\{\s*\n\s*if\(editing\)/, mo: false, vi: 'Nút Gửi phiếu kiểm kê không khoá — bấm lại lúc mạng chậm ra phiếu -2 (sửa 21/10, bản 2110-03)' },
  { re: /bOk\.onclick=\(\)=>commitKKUpload\(/, mo: false, vi: 'Nút Tạo phiếu (Up Excel) không khoá — chạm đúp ra hai phiếu kiểm kê (sửa 21/10, bản 2110-03)' },
  { re: /if\(counting\)\{\s*\n\s*if\(periodLocked\(counting\.plant/, mo: false, canTruoc: 'if(counting&&counting.tuan){_demTuanCat=counting;counting=null;}', vi: 'Màn Kiểm kê tháng vẽ luôn bộ đếm TUẦN khi đổi tab — số tháng thành số tuần (sửa 21/10, bản 2110-03)' },
  { re: /x\.name\.toLowerCase\(\)\.includes\(nm\)/, mo: false, vi: 'Quét ảnh khớp mờ tên hàng — mã mới bị thay bằng mã cũ có tên gần giống (sửa 21/10, bản 2110-03)' },
  { re: /valueAsDate=new Date\(\)/, mo: false, vi: 'Ô ngày mặc định theo giờ UTC — trước 7h sáng ra ngày hôm qua (sửa 21/10, bản 2110-03)' },
  { re: /dbUpd\('submissions',\{id:editing\.id\},patch\)/, mo: false, vi: 'Đếm bổ sung lưu không điều kiện — kế toán vừa duyệt vẫn bị sửa số (sửa 22/10, bản 2210-01)' },
  { re: /update\(patch\)\.eq\('id',editing\.id\)/, mo: false, vi: 'Đếm bổ sung kho có tiểu kho: máy chủ từ chối (0 dòng) vẫn báo thành công, xoá nháp (sửa 22/10, bản 2210-01)' },
  { re: /items\[code\]=qty;preview\.push\(\{code,name,uom,qty,isNew/, mo: false, canTruoc: 'if(gopDong(code,qty,_d,_g))continue;', vi: 'Excel kiểm kê có 2 dòng cùng mã: dòng sau đè dòng trước (sửa 22/10, bản 2210-01)' },
  { re: /\n\s+submissions=\(su\.data\|\|\[\]\)\.map/, mo: false, vi: 'Tải dữ liệu lỗi mạng ghi đè danh sách trên máy thành rỗng (sửa 22/10, bản 2210-01)' },
  { re: /dbIns\('receipts',\{id:rec\.id/, mo: false, vi: 'Nhập kho gõ tay / quét ảnh lúc mất mạng không cất vào máy — bắt nhập lại (sửa 22/10, bản 2210-02)' },
  { re: /sb\.from\('receipts'\)\.insert\(\{id:rec\.id/, mo: false, vi: 'Nạp Excel nhập kho lúc mất mạng báo "nạp lại file" thay vì cất vào máy (sửa 22/10, bản 2210-02)' },
  { re: /if\(!kqIns\.ok\)return;\s*\/\/[^\n]*\n\s*id=row\.id;/, mo: false, vi: 'Lập phiếu điều chuyển lúc mất mạng không cất vào máy — bắt lập lại (sửa 22/10, bản 2210-02)' },
  { re: /tb\.querySelectorAll\('\.chip'\)\.forEach\(c=>c\.onclick=\(\)=>\{[^}]*curFilter=/, mo: false, vi: 'Nút lọc đè lên nút chọn tiểu kho — bấm khu khác mà số vẫn vào khu đầu (sửa 23/10, bản 2310-01)' },
  { re: /if\(isPrivileged\(\)\)\{\s*\n\s*const bDel=el\('button','btn btn-ghost btn-sm','🗑 Xóa tồn đầu kỳ'\)/, mo: false, vi: 'Nút Xoá tồn đầu kỳ hiện cho kế toán — Khoa chốt chỉ admin (sửa 23/10, bản 2310-01)' },
  { re: /if\(!diff\.length\)\{toast\('Chưa thay đổi gì so với phiếu/, mo: false, canTruoc: "kieu:'ghichu',tu:vg(a)", vi: 'Đếm bổ sung chỉ sửa ngày/ghi chú bị báo "chưa thay đổi" (sửa 23/10, bản 2310-01)' },
  { re: /if\(!date\)date=ngayMacDinh;/, mo: false, vi: 'Excel nhập kho để trống ngày: lặng lẽ lấy ngày trên màn, nạp lại hôm sau nhân đôi (sửa 23/10, bản 2310-01)' },
  { re: /outbox=outbox\.filter\(x=>xong\.indexOf\(x\.id\)<0/, mo: false, vi: 'Hàng đợi dọn theo id: bản mới lưu trong lúc tự gửi bị xoá mất (sửa 23/10, bản 2310-03)' },
  { re: /outboxThem\(\{loai:'dc',id,row,base/, mo: false, vi: 'Phiếu ĐC lập lúc mất mạng không giữ giờ lập — hàng dư ghi sổ sang kỳ sau (sửa 23/10, bản 2310-03)' },
  { re: /if\(!c&&d\.khongNgay&&d\.soPhieu&&plant\)/, mo: false, vi: 'Nạp lại Excel nhập kho sau khi điền ngày thật bị tính hai lần (sửa 23/10, bản 2310-03)' },
  { re: /outboxCount\(\)\)await outboxFlush\(\);\s*\n\s*else if\(typeof navigator/, mo: false, vi: 'Hàng đợi chỉ còn mục bị từ chối làm app kẹt \"Mất mạng\" (sửa 23/10, bản 2310-04)' },
  { re: /renderList\(\);updRead\(\);vePick\(\);setMode\('tay'\);/, mo: false, vi: 'Nhận hàng: mạng đổi trạng thái xoá ô Ngày / Số phiếu đang gõ (sửa 23/10, bản 2310-04)' },
  { re: /phải đếm lại tuần này\.'\)\)return;\s*\n\s*const r=await dbDel\('weekly_counts'/, mo: false, vi: 'Xoá bản kiểm tuần đang chờ gửi thì nó quay lại (sửa 23/10, bản 2310-04)' },
  { re: /r\.code===d\.code&&soCua\(r\.note\)===sp\);/, mo: false, vi: 'Excel nhập kho: dòng có ngày khớp nhầm dòng cũ cùng số phiếu ngày khác -> dời ngày, mất hàng (sửa 23/10, bản 2310-05)' },
  { re: /Date\.UTC\(1899,11,30\)\+Math\.round\(n\)\*86400000/, mo: false, vi: 'Ngày Excel có giờ chiều bị nhảy sang hôm sau (sửa 23/10, bản 2310-06)' },
  { re: /\/Math\.max\(1,total\)\)\*100\*8\)/, mo: false, vi: 'Thanh tiến độ đếm báo đầy khi mới đếm 1/8 số mã (sửa 23/10, bản 2310-06)' },
  { re: /sb\.from\('submissions'\)\.delete\(\)\.eq\('id',s\.id\)\.then\(/, mo: false, vi: 'Từ chối biên bản báo bếp trước khi máy chủ xoá xong (sửa 23/10, bản 2310-06)' },
  { re: /ctxBar\(b,ctx,\{period:true,plants:mine\},\(\)=>\{chosen=null;nkMo=\{\};vePick\(\);renderList\(\);updRead\(\);\}\);/, mo: false, vi: 'Đổi kho khi đang xem trước Excel / ảnh: bảng vẫn còn, lưu sang kho mới (sửa 23/10, bản 2310-06)' },
  { re: /some\(c=>c\.includes\('mã'\)\|\|c\.includes\('mahang'\)/, mo: false, vi: 'Không nhận tiêu đề \"Mã vật tư\" / \"Mã VT\" -> lấy nhầm cột tên làm mã (sửa 23/10, bản 2310-06)' },
  { re: /RegExp\(\"\^Gộp \(\[\\d/, mo: false, vi: 'Mẫu dịch \"Gộp N dòng trùng mã\" mất dấu \\ nên không bao giờ khớp (sửa 23/10, bản 2310-06)' },
  { re: /toast\('✓ Đã tạo '\+list\.length\+' phiếu điều chuyển'\)/, mo: false, vi: 'Nạp Excel điều chuyển báo đã tạo dù máy chủ từ chối ghi sổ (sửa 24/10, bản 2410-01)' },
  { re: /a\.download='MaChuaKhaiBao\.xls'/, mo: false, vi: 'Mẫu mã chưa khai báo xuất HTML đuôi .xls — Excel lưu thành trang web, nạp lại không có dòng nào (sửa 24/10, bản 2410-03)' },
  { re: /if\(m\)\{m\.name=name;if\(uom\)m\.uom=uom;\}else\{const nm=\{code:x\.code,name,uom\}/, mo: false, vi: 'Khai tên mã đổi trên máy trước khi máy chủ nhận — báo đã khai mà tải lại mất (sửa 24/10, bản 2410-03)' },
  { re: /const rcp=await sb\.from\('recipes'\)\.select\('\*'\);/, mo: false, vi: 'Định lượng tải cả bảng về mọi máy mỗi 45 giây, chỉ 1.000 dòng đầu (sửa 26/10, bản 2610-01)' },
  { re: /const rcp=await sb\.from\('recipes'\)\.select\('\*'\);applyRecipes/, mo: false, vi: 'Mạng chập chờn xoá trắng công thức món / sản lượng / giải trình trên máy (sửa 24/10, bản 2410-01)' },
  { re: /if\(_loiTai\.length\)\{\s*console\.warn\([^;]*\);\s*if\(_loiTai\.some\(x=>laLoiMang\(x\.e\)\)\)datMang\(false\);\s*\}else if\(!mangOK\)datMang\(true\);/, mo: false, vi: 'Một bảng thiếu / bị chặn quyền làm app không tự bỏ \"Mất mạng\" (sửa 24/10, bản 2410-01)' },
  { re: /date:iDate\.value,period:perSel\.value/, mo: false, vi: 'Nhập kho gõ tay / quét ảnh lưu kỳ theo chip kỳ, không theo ngày nhập — hàng sang kỳ khác, lọt khoá kỳ (sửa 26/10, bản 2610-13)' },
  { re: /const \{data,error\}=await sb\.from\('transfers'\)\.insert\(row\)\.select\(\);/, mo: false, vi: 'Duyệt điều chuyển ghi sổ từng mã một — rớt mạng giữa chừng sổ thiếu dòng, phiếu kẹt (sửa 26/10, bản 2610-13)' },
  { re: /sb\.from\('transfers'\)\.select\('\*'\)\.order\('created_at',\{ascending:false\}\),/, mo: false, vi: 'Tải sổ điều chuyển không phân trang — quá 1.000 dòng là mất dòng cũ (sửa 26/10, bản 2610-13)' },
  { re: /q\.order\(orderCol,\{ascending:false\}\)\.order\('id'/, mo: false, vi: 'Phân trang tải dữ liệu theo thứ tự mới trước — dòng mới chen vào làm lặp dòng (sửa 26/10, bản 2610-13)' },
  { re: /const prev=openingStock\[key\]\?\{items:\{\.\.\.openingStock\[key\]\.items\}/, mo: false, vi: 'Duyệt biên bản lấy mốc đầu kỳ = tồn đầu kỳ hiện hành — duyệt khác thứ tự kỳ là sai mốc (sửa 26/10, bản 2610-13)' },
  { re: /if\(await daLenMayChu\(it\.sub\.id\)\)/, mo: false, vi: 'Hàng đợi chỉ so mã phiếu kiểm kê, không so nội dung — mất số đếm / mất phần sửa (sửa 26/10, bản 2610-13)' },
  { re: /trReqs\.forEach\(r=>\{\(groups\[dcSig\(r\)\]=/, mo: false, vi: 'Dọn phiếu trùng gom mọi ngày + phiếu Từ chối — xoá nhầm phiếu hợp lệ (sửa 26/10, bản 2610-13)' },
  { re: /var diem = \{\}, thang = \{\}, tu = ''/, mo: false, vi: 'File POS cộng cả giao dịch ngoài kỳ 26->25 vào kỳ — đếm hai lần (sửa 26/10, bản 2610-13)' },
  { re: /const viec=\[\];ds\.forEach\(d=>d\.t\.theoKho\.forEach\(x=>viec\.push\(\{d,x\}\)\)\);/, mo: false, vi: 'Hai điểm POS cùng một kho: điểm sau đè hàng sử dụng của điểm trước (sửa 26/10, bản 2610-13)' },
  { re: /shifts\.unshift\(rec\);log\('Bàn giao ca',[^\n]*\n\s*dbIns\('shifts'/, mo: false, vi: 'Bàn giao ca báo đã lưu + xoá số trước khi máy chủ nhận (sửa 26/10, bản 2610-13)' },
  { re: /countLists\[plant\+'\|'\+sloc\+'\|'\+period\]=\{items,by:session\.name,at:now\(\)\};\s*\n\s*dbUpsertCountList/, mo: false, vi: 'Mở kỳ báo thành công trước khi máy chủ nhận danh sách (sửa 26/10, bản 2610-13)' },
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
