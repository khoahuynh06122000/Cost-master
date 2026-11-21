// Rào code khi nhờ agent khác (Antigravity) sửa NỀN MÀN ĐĂNG NHẬP — 21/11/2026.
// Chạy: node kiem-tra/rao-anti.mjs            (kiểm cây làm việc)
//       node kiem-tra/rao-anti.mjs --hook     (pre-commit: kiểm file đã stage)
// Đạt = in "RÀO ANTI: ĐẠT" và thoát 0. Trượt = liệt kê từng vi phạm và thoát 1.
//
// Kiểm 5 thứ:
//  1. Ngoài 3 vùng VUNG-ANTI (CSS / HTML / JS), index.html phải GIỐNG HỆT bản gốc (so SHA-256,
//     chỉ bỏ qua đúng giá trị APP_VER vì mỗi lần đẩy phải tăng số phiên bản).
//  2. Trong vùng CSS: mọi bộ chọn phải nhắm vào #login / .login-* ; không @import, không url(http…).
//  3. Trong vùng HTML: không <script>, không thuộc tính on…=, không form/input/iframe/link; ảnh chỉ từ anh-nen/.
//  4. Trong vùng JS: một khối (function(){…})(); tự đứng, không gọi máy chủ / lưu trữ / chuyển trang.
//  5. File thay đổi chỉ được là index.html, anh-nen/*, và xoá cabin.mp4 / cabin-poster.jpg. Ảnh ≤ 600 KB.
// Cuối cùng chạy thử cú pháp mọi khối <script> của index.html.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAU_HINH = JSON.parse(readFileSync(path.join(GOC, 'kiem-tra/rao-anti.json'), 'utf8'));
const HOOK = process.argv.includes('--hook');
if (!CAU_HINH.bat) { console.log('RÀO ANTI: đang tắt (rao-anti.json bat=false) — bỏ qua.'); process.exit(0); }

const loi = [];
const sai = (m) => loi.push(m);

let html;
if (HOOK) {
  try { html = execSync('git show :index.html', { cwd: GOC, encoding: 'utf8', maxBuffer: 64 << 20 }); }
  catch { html = readFileSync(path.join(GOC, 'index.html'), 'utf8'); }
} else html = readFileSync(path.join(GOC, 'index.html'), 'utf8');
html = html.replace(/\r\n/g, '\n');

// ---------- 1. tách 3 vùng ----------
const VUNG = {
  CSS:  [/\/\* >>> VUNG-ANTI:CSS BAT-DAU >>>/, /\/\* <<< VUNG-ANTI:CSS KET-THUC <<< \*\//],
  HTML: [/<!-- >>> VUNG-ANTI:HTML BAT-DAU >>>/, /<!-- <<< VUNG-ANTI:HTML KET-THUC <<< -->/],
  JS:   [/\/\* >>> VUNG-ANTI:JS BAT-DAU >>>/,  /\/\* <<< VUNG-ANTI:JS KET-THUC <<< \*\//],
};
const noiDung = {};
let ngoai = html;
for (const [ten, [mo, dong]] of Object.entries(VUNG)) {
  const nMo = (html.match(new RegExp(mo.source, 'g')) || []).length;
  const nDong = (html.match(new RegExp(dong.source, 'g')) || []).length;
  if (nMo !== 1 || nDong !== 1) { sai(`Dòng đánh dấu vùng ${ten} phải có đúng 1 cặp (đang có ${nMo} mở / ${nDong} đóng). Không được xoá hay nhân đôi dòng đánh dấu.`); continue; }
  const a = ngoai.search(mo), b = ngoai.search(dong);
  if (b < a) { sai(`Vùng ${ten}: dòng KET-THUC nằm trước BAT-DAU.`); continue; }
  // nội dung = từ hết dòng mở (sau dấu đóng chú thích) tới đầu dòng đóng
  const motDong = ngoai.slice(a);
  const hetMo = ten === 'HTML' ? motDong.indexOf('-->') + 3 : motDong.indexOf('*/') + 2;
  noiDung[ten] = ngoai.slice(a + hetMo, b);
  ngoai = ngoai.slice(0, a + hetMo) + `\n@@VUNG-${ten}@@\n` + ngoai.slice(b);
}
const ngoaiChuan = ngoai.replace(/const APP_VER='[^']*';/, "const APP_VER='@@';");
const bam = createHash('sha256').update(ngoaiChuan, 'utf8').digest('hex');
if (process.env.RAO_ANTI_IN_BAM === '1') { console.log(bam); process.exit(0); }
if (!loi.length && bam !== CAU_HINH.sha256) {
  sai('Code NGOÀI 3 vùng được phép đã bị thay đổi (SHA-256 khác bản gốc). Hoàn tác mọi chỗ sửa ngoài vùng VUNG-ANTI rồi chạy lại.'
    + ' Gợi ý xem chỗ khác: git diff -- index.html');
}

// ---------- 2. vùng CSS ----------
if (noiDung.CSS != null) {
  const css = noiDung.CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/@import/i.test(css)) sai('Vùng CSS: cấm @import.');
  if (/url\(\s*['"]?\s*(https?:|\/\/)/i.test(css)) sai('Vùng CSS: cấm url(http…) — ảnh phải để trong thư mục anh-nen/ của repo.');
  if (/url\(\s*['"]?\s*data:/i.test(css)) sai('Vùng CSS: cấm nhúng ảnh base64 (data:) — để ảnh thành file trong anh-nen/.');
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)/gi)) {
    const u = m[1].trim();
    if (!/^anh-nen\/[\w.\-]+$/.test(u) && !/^cabin(-poster)?\.(jpg|mp4)$/.test(u)) sai(`Vùng CSS: url(${u}) — ảnh chỉ được lấy từ anh-nen/<tên file>.`);
  }
  // duyệt khối: bộ chọn ở tầng ngoài hoặc trong @media/@supports phải nhắm vào màn đăng nhập
  const HOP = /^(html\.dark\s+|html:not\([^)]*\)\s+)?(#login\b|#loginVid\b|\.login-[\w-]+)/;
  let i = 0, sau = 0;
  const duyet = (den) => {
    while (i < css.length) {
      const k = css.indexOf('{', i), d = css.indexOf('}', i);
      if (d !== -1 && (k === -1 || d < k)) { i = d + 1; if (den) return; continue; }
      if (k === -1) break;
      const chon = css.slice(i, k).trim();
      i = k + 1;
      if (/^@keyframes/i.test(chon)) { let n = 1; while (i < css.length && n) { if (css[i] === '{') n++; else if (css[i] === '}') n--; i++; } continue; }
      if (/^@(media|supports)/i.test(chon)) { sau++; duyet(true); sau--; continue; }
      if (/^@/.test(chon)) { sai(`Vùng CSS: cấm khối ${chon.slice(0, 40)}.`); }
      else for (const c of chon.split(',').map(x => x.trim()).filter(Boolean)) {
        if (!HOP.test(c)) sai(`Vùng CSS: bộ chọn "${c}" không thuộc màn đăng nhập — chỉ được nhắm #login, #loginVid hoặc .login-…`);
      }
      // bỏ qua thân khai báo
      const d2 = css.indexOf('}', i); i = d2 === -1 ? css.length : d2 + 1;
    }
  };
  duyet(false);
}

// ---------- 3. vùng HTML ----------
if (noiDung.HTML != null) {
  const h = noiDung.HTML;
  if (/<\s*script/i.test(h)) sai('Vùng HTML: cấm <script>.');
  if (/\son[a-z]+\s*=/i.test(h)) sai('Vùng HTML: cấm thuộc tính sự kiện (onclick=, onload=…).');
  if (/<\s*(form|input|button|textarea|select|iframe|object|embed|link|meta|base|a)\b/i.test(h)) sai('Vùng HTML: chỉ được dùng thẻ trình bày (div, img, picture, source, video, span) — cấm form/input/button/iframe/link/a.');
  if (/(https?:)?\/\/[a-z0-9]/i.test(h.replace(/<!--[\s\S]*?-->/g, ''))) sai('Vùng HTML: cấm đường dẫn ra ngoài (http…).');
  for (const m of h.matchAll(/\b(src|srcset|poster|href)\s*=\s*["']([^"']*)["']/gi)) {
    for (const u of m[2].split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean)) {
      if (!/^anh-nen\/[\w.\-]+$/.test(u) && !/^cabin(-poster)?\.(jpg|mp4)$/.test(u)) sai(`Vùng HTML: ${m[1]}="${u}" — chỉ được lấy file từ anh-nen/.`);
    }
  }
  if (/\bid\s*=\s*["'](?!loginVid\b|login-[\w-]+)/i.test(h)) sai('Vùng HTML: id mới phải bắt đầu bằng "login-" (tránh trùng id của app).');
}

// Đúng một khối (function(){…})(); : quét ngoặc (bỏ qua chuỗi), ngoặc mở đầu phải đóng ngay trước "()" cuối cùng.
function motKhoi(js) {
  if (!/^\(\s*function\b/.test(js)) return false;
  let sau = 0, q = null;
  for (let i = 0; i < js.length; i++) {
    const ch = js[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') sau++;
    else if (ch === ')' || ch === '}' || ch === ']') { sau--; if (sau === 0) return /^\(\s*\)\s*;?\s*$/.test(js.slice(i + 1)); }
  }
  return false;
}

// ---------- 4. vùng JS ----------
if (noiDung.JS != null) {
  const js = noiDung.JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').trim();
  const CAM = [
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/, 'gọi mạng'],
    [/\bsb\b|supabase|\bsession\b|\bdbLoadAll\b|\bdb[A-Z]\w*\(/, 'đụng dữ liệu / phiên đăng nhập của app'],
    [/localStorage|sessionStorage|indexedDB|document\.cookie|caches\b/, 'lưu trữ trình duyệt'],
    [/\beval\b|new\s+Function|setTimeout\s*\(\s*['"`]|import\s*\(|\bimport\s/, 'chạy code động / import'],
    [/location\s*(\.|=)|history\.|window\.open|\.submit\s*\(/, 'chuyển trang'],
    [/innerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'chèn HTML'],
    [/https?:\/\//, 'đường dẫn ra ngoài'],
    [/\bwindow\.\w+\s*=|\bglobalThis\b|\bself\.\w+\s*=/, 'gắn biến lên window (mọi thứ phải nằm gọn trong khối)'],
  ];
  if (js) {
    for (const [re, ten] of CAM) if (re.test(js)) sai(`Vùng JS: cấm ${ten} (khớp ${re}).`);
    if (!motKhoi(js)) sai('Vùng JS: phải là đúng MỘT khối (function(){ … })(); — không có code nào nằm ngoài khối.');
    try { new vm.Script(js); } catch (e) { sai('Vùng JS: lỗi cú pháp — ' + e.message); }
  }
}

// ---------- 5. file thay đổi ----------
try {
  const lenh = HOOK ? 'git diff --cached --name-status' : 'git status --porcelain --untracked-files=all';
  const dong = execSync(lenh, { cwd: GOC, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const d of dong) {
    let tt, f;
    if (HOOK) { [tt, f] = d.split('\t'); } else { tt = d.slice(0, 2).trim(); f = d.slice(3).replace(/^"|"$/g, ''); }
    if (CAU_HINH.boQua?.includes(f)) continue;
    const xoa = /D/.test(tt);
    if (f === 'index.html') continue;
    if (/^anh-nen\/[\w.\-]+\.(jpe?g|webp|avif|png)$/i.test(f)) {
      if (!xoa && existsSync(path.join(GOC, f)) && statSync(path.join(GOC, f)).size > 600 * 1024) sai(`${f} nặng quá 600 KB — nén lại (mục tiêu ~300 KB).`);
      continue;
    }
    if (xoa && /^cabin(-poster)?\.(jpg|mp4)$/.test(f)) continue;
    sai(`File ngoài phạm vi bị thay đổi: ${f} (${tt}). Chỉ được sửa index.html, thêm ảnh vào anh-nen/, xoá cabin.mp4 / cabin-poster.jpg.`);
  }
} catch (e) { sai('Không đọc được git status: ' + e.message); }

// ---------- 6. cú pháp toàn bộ script ----------
let soKhoi = 0;
for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  soKhoi++;
  try { new vm.Script(m[1]); } catch (e) { sai(`Khối <script> thứ ${soKhoi}: lỗi cú pháp — ${e.message}`); }
}

if (loi.length) {
  console.log('RÀO ANTI: TRƯỢT — ' + loi.length + ' vi phạm:');
  loi.forEach((m, k) => console.log(`  ${k + 1}. ${m}`));
  console.log('Không commit / không push khi còn vi phạm. Luật đầy đủ: docs/RAO-ANTI-man-dang-nhap.md');
  process.exit(1);
}
console.log(`RÀO ANTI: ĐẠT — ngoài vùng không đổi, 3 vùng đúng luật, ${soKhoi} khối script đúng cú pháp.`);
