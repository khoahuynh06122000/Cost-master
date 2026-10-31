// agent/sao-luu.mjs — TỰ SAO LƯU TOÀN BỘ DỮ LIỆU APP KIỂM KÊ F&B HẰNG TUẦN (31/10/2026)
// Đọc mọi bảng nghiệp vụ trên Supabase (khoá service, chỉ ĐỌC — không ghi gì lên máy chủ),
// đóng thành 2 file rồi MÃ HOÁ bằng mật khẩu BACKUP_PASSWORD:
//   sao-luu-<ngày>.xlsx.enc     — mỗi bảng một sheet, mở bằng Excel sau khi giải mã (đưa ban kiểm soát)
//   sao-luu-<ngày>.json.gz.enc  — bản đầy đủ nguyên dạng (dùng khi cần dựng lại dữ liệu)
// Repo đang để CÔNG KHAI nên file KHÔNG BAO GIỜ được để trần: thiếu mật khẩu thì dừng, không sao lưu.
// Giải mã bằng trang giai-ma-sao-luu.html (chạy ngay trên máy, không gửi file đi đâu).
//
// Cách chạy:  node agent/sao-luu.mjs            → sao lưu, ghi ra thư mục sao-luu-out/
//             node agent/sao-luu.mjs --bao-xong → gửi tin "đã sao lưu" về Teams (sau bước tải file lên)
//             node agent/sao-luu.mjs --bao-loi  → gửi tin lỗi về Teams

import { webcrypto as crypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const PERSONAL = process.env.TEAMS_PERSONAL_URL || process.env.TEAMS_FLOW_URL;
const PASS     = process.env.BACKUP_PASSWORD || '';
const OUT      = process.env.SAO_LUU_OUT || 'sao-luu-out';
const RUN_URL  = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';

// Bảng cần sao lưu + khoá sắp xếp (phân trang phải theo thứ tự cố định, nếu không có dòng bị lặp / sót).
// CỐ Ý BỎ: user_ai_keys (khoá AI riêng của từng người — không được rời máy chủ),
//          push_subs (địa chỉ nhận thông báo của từng máy), xoa_log (nhật ký đồng bộ nội bộ).
export const BANG = [
  ['submissions',       ['id']],
  ['transfers',         ['id']],
  ['transfer_requests', ['id']],
  ['receipts',          ['id']],
  ['opening_stock',     ['plant_code','sloc_code']],
  ['closing_stock',     ['id']],
  ['count_lists',       ['plant_code','sloc_code','period']],
  ['count_zones',       ['plant_code','sloc_code']],
  ['weekly_counts',     ['id']],
  ['shifts',            ['id']],
  ['spot_checks',       ['id']],
  ['materials',         ['code']],
  ['plant_materials',   ['plant_code','code']],
  ['plants',            ['plant_code']],
  ['slocs',             ['plant_code','sloc_code']],
  ['profiles',          ['id']],
  ['user_plants',       ['user_id','plant_code','sloc_code']],
  ['kho_dong',          ['plant_code','sloc_code']],
  ['recipes',           ['id']],
  ['sales_usage',       ['plant_code','sloc_code','period']],
  ['variance_notes',    ['plant_code','sloc_code','period','code']],
  ['pos_diem_ban',      ['pos_name']],
  ['buffet_khach',      ['id']],
  ['notifications',     ['id']],
  ['audit_log',         ['id']],
];

const H = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ngayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const gioVN  = () => new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const mb = n => (n / 1048576).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' MB';

async function thu(label, fn, lan = 3) {
  let loi;
  for (let i = 1; i <= lan; i++) {
    try { return await fn(); } catch (e) { loi = e; if (e.khongThuLai) break; if (i < lan) await sleep(2000 * i); }
  }
  throw new Error(`${label}: ${loi?.message || loi}`);
}

// Đọc một trang. Trả về {rows,total}. Lỗi thiếu bảng/cột thì gắn cờ để xử lý riêng.
async function docTrang(bang, order, from, to) {
  const qs = `select=*${order ? '&order=' + order.map(c => c + '.asc.nullsfirst').join(',') : ''}`;
  const r = await fetch(`${SB_URL}/rest/v1/${bang}?${qs}`, {
    headers: { ...H(), Range: `${from}-${to}`, 'Range-Unit': 'items', Prefer: 'count=exact' } });
  if (!r.ok) {
    const b = (await r.text()).slice(0, 200);
    const e = new Error(`HTTP ${r.status} ${b}`);
    e.thieuBang = /PGRST205|42P01|does not exist|schema cache/i.test(b) && !/column/i.test(b);
    e.thieuCot = /42703|column/i.test(b);
    e.khongThuLai = r.status >= 400 && r.status < 500;
    throw e;
  }
  const cr = r.headers.get('content-range') || '';
  const total = Number((cr.split('/')[1] || '').trim());
  return { rows: await r.json(), total: Number.isFinite(total) ? total : null };
}

export async function docBang(bang, khoa) {
  // Khoá sắp xếp không có trên bảng thật (bảng dựng rời từ trước) → thử khoá khác, hết thì đọc không sắp xếp.
  const thuKhoa = [khoa, ['created_at'], ['at'], null];
  let iKhoa = 0, order = thuKhoa[0];
  const out = []; let total = null; const B = 1000;
  for (let from = 0; ; from += B) {
    let tr;
    try { tr = await thu(`${bang} [${from}]`, () => docTrang(bang, order, from, from + B - 1)); }
    catch (e) {
      if (from === 0 && order && /42703|column/i.test(e.message)) { order = thuKhoa[++iKhoa]; from = -B; continue; }
      if (/PGRST205|42P01|does not exist|schema cache/i.test(e.message) && !/column/i.test(e.message)) return { thieu: true };
      throw e;
    }
    if (total == null) total = tr.total;
    out.push(...tr.rows);
    if (tr.rows.length < B) break;
  }
  const canhBao = [];
  if (total != null && total !== out.length) canhBao.push(`đọc ${out.length}/${total} dòng`);
  if (!order && out.length > 1000) canhBao.push('không có khoá sắp xếp — có thể lặp/sót dòng');
  return { rows: out, total, canhBao };
}

// Mã hoá: "KKB1" | salt(16) | iv(12) | ciphertext+tag  — AES-256-GCM, khoá PBKDF2-SHA256 200.000 vòng.
export async function maHoa(buf, matKhau) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(matKhau), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf));
  const out = new Uint8Array(4 + 16 + 12 + ct.length);
  out.set(new TextEncoder().encode('KKB1'), 0); out.set(salt, 4); out.set(iv, 20); out.set(ct, 32);
  return Buffer.from(out);
}

const CELL_MAX = 32000; // Excel giới hạn 32.767 ký tự/ô
function oExcel(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string' && v.length > CELL_MAX) return v.slice(0, CELL_MAX) + ' …[cắt bớt — xem bản .json]';
  return v;
}

async function taoExcel(du, tomTat) {
  const XLSX = (await import('xlsx')).default || (await import('xlsx'));
  const wb = XLSX.utils.book_new();
  const ts = [['Bảng', 'Số dòng', 'Ghi chú'], ...tomTat.map(t => [t.bang, t.thieu ? '' : t.n, t.ghiChu || ''])];
  ts.unshift([`Sao lưu dữ liệu app Kiểm kê F&B — ${gioVN()}`], []);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ts), 'Tom tat');
  for (const [bang] of BANG) {
    const rows = du[bang]; if (!rows) continue;
    const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const aoa = [cols, ...rows.map(r => cols.map(c => oExcel(r[c])))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), bang.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

async function guiTeams(text) {
  if (!PERSONAL) { console.log(text); return; }
  try { await fetch(PERSONAL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: text }); }
  catch (e) { console.error('Không gửi được Teams:', e.message); }
}

async function saoLuu() {
  if (!SB_URL || !SB_KEY) throw new Error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY');
  if (!PASS || PASS.length < 8) throw new Error('Chưa đặt mật khẩu sao lưu BACKUP_PASSWORD (ít nhất 8 ký tự) trong GitHub Secrets — không sao lưu để tránh để lộ dữ liệu.');
  const du = {}, tomTat = [];
  for (const [bang, khoa] of BANG) {
    const kq = await docBang(bang, khoa);
    if (kq.thieu) { tomTat.push({ bang, thieu: true, ghiChu: 'bảng chưa có trên máy chủ' }); continue; }
    du[bang] = kq.rows;
    tomTat.push({ bang, n: kq.rows.length, ghiChu: kq.canhBao.join('; ') });
  }
  const ngay = ngayVN();
  const json = gzipSync(Buffer.from(JSON.stringify({ app: 'Kiem ke F&B', luc: new Date().toISOString(), bang: du })));
  const xlsx = await taoExcel(du, tomTat);
  mkdirSync(OUT, { recursive: true });
  const f1 = `${OUT}/sao-luu-${ngay}.xlsx.enc`, f2 = `${OUT}/sao-luu-${ngay}.json.gz.enc`;
  const e1 = await maHoa(xlsx, PASS), e2 = await maHoa(json, PASS);
  writeFileSync(f1, e1); writeFileSync(f2, e2);
  const tongDong = tomTat.reduce((a, t) => a + (t.n || 0), 0);
  const canhBao = tomTat.filter(t => t.ghiChu);
  const tin = [
    `💾 SAO LƯU DỮ LIỆU APP KIỂM KÊ F&B — ${gioVN()}`,
    `✓ ${tomTat.filter(t => !t.thieu).length} bảng · ${tongDong.toLocaleString('vi-VN')} dòng · Excel ${mb(e1.length)} · bản đầy đủ ${mb(e2.length)}`,
    ...tomTat.filter(t => !t.thieu).sort((a, b) => b.n - a.n).slice(0, 8).map(t => `  • ${t.bang}: ${t.n.toLocaleString('vi-VN')} dòng`),
    ...(canhBao.length ? ['⚠ Cần xem:', ...canhBao.map(t => `  • ${t.bang}: ${t.ghiChu}`)] : []),
    'File đã mã hoá, giữ 90 ngày. Tải về tại mục Artifacts của lượt chạy, giải mã bằng trang giai-ma-sao-luu.html.',
  ].join('\n');
  writeFileSync(`${OUT}/tom-tat.txt`, tin);
  console.log(tin);
}

const arg = process.argv[2];
if (arg === '--bao-xong') {
  const f = `${OUT}/tom-tat.txt`;
  await guiTeams((existsSync(f) ? readFileSync(f, 'utf8') : '💾 Sao lưu xong') + (RUN_URL ? `\nLượt chạy: ${RUN_URL}` : ''));
} else if (arg === '--bao-loi') {
  const f = `${OUT}/loi.txt`;
  await guiTeams(`❌ SAO LƯU DỮ LIỆU THẤT BẠI — ${gioVN()}\n${existsSync(f) ? readFileSync(f, 'utf8') : 'Lỗi ở bước tải file lên.'}${RUN_URL ? `\nXem: ${RUN_URL}` : ''}`);
} else if (process.argv[1] && process.argv[1].endsWith('sao-luu.mjs')) {
  try { await saoLuu(); }
  catch (e) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/loi.txt`, String(e.message || e)); console.error(e); process.exit(1); }
}
