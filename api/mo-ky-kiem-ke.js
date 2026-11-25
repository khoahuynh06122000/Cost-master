// api/mo-ky-kiem-ke.js — AGENT ĐẨY DANH SÁCH MỞ KỲ KIỂM KÊ (bếp + nhà hàng) LÊN APP — 23/11/2026.
// Agent của Khoa chạy ngày 25 hằng tháng, đọc file mẫu "Mở kỳ kiểm kê" rồi gọi cổng này. Kết quả y như kế toán bấm
// "Mở kỳ kiểm kê" trong app: ghi bảng count_lists (kho + kỳ + danh sách mã), giám sát kho nhận chuông + thông báo máy.
//
// Kiểm quyền: header  Authorization: Bearer <khóa>  — dùng CHUNG khóa agent nhập kho SAP (NHAP_KHO_AGENT_KEY trên Vercel,
//   = APP_API_KEY trong .env của agent). Có đặt MO_KY_AGENT_KEY thì khóa đó cũng được nhận.
// Body JSON:
//   { period: 'YYYY-MM'  (kỳ kiểm kê; bỏ trống = kỳ của ngày 25 tháng hiện tại, giờ VN),
//     data_hash: 'chuỗi bất kỳ, giống nhau cho mọi lô của MỘT lần chạy' (bắt buộc khi chia lô),
//     batch_index, total_batches (tùy chọn, chỉ để ghi log),
//     ghi_de: false  (true = thay cả danh sách kế toán đã mở TAY trong app),
//     thu: false     (true = chỉ kiểm tra, không ghi gì),
//     records: [ { plant, sloc, material, material_description, unit }, ... ] }   tối đa 5.000 dòng / lần
//   Nhận cả tên trường tiếng Việt: ma_diem_ban / ma_kho / ma_vat_tu / ten_vat_tu / dvt.
// Lô của cùng một lần chạy (cùng data_hash) được CỘNG DỒN vào danh sách của kho → chia lô giữa chừng một kho vẫn đúng.
// Chạy lại y nguyên (cùng data_hash) không đổi gì. Lần chạy MỚI (data_hash khác) thì THAY danh sách cũ do agent mở.
// Đẩy TỪNG KHO một lần là cách nhẹ nhất. Một kho tách nhiều lần mà không kèm data_hash: trong 30 phút vẫn được cộng dồn.
// Không bao giờ đụng: kho + kỳ đã có biên bản kiểm kê ĐÃ DUYỆT; danh sách kế toán mở TAY (trừ khi ghi_de=true).
// Trả: { ok, ky, thu, kho:[{plant,sloc,ten,so_ma,ket_qua,ly_do}], boQua:[{i,lyDo}] }
//   ket_qua: 'mo_moi' | 'thay' | 'cong_don' | 'khong_doi' | 'bo_qua'

const { bocLoi } = require('../lib/ghi-loi');
const { APP_URL } = require('../lib/app-url');
const crypto = require('crypto');
const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SVC = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const KHOA = [process.env.NHAP_KHO_AGENT_KEY, process.env.MO_KY_AGENT_KEY].map(x => String(x || '').trim()).filter(Boolean);
const TOI_DA = 5000, NGUOI = 'Agent SAP';

function doc(req) {
  return new Promise((res, rej) => {
    if (req.body && typeof req.body === 'object') return res(req.body);
    let s = '';
    req.on('data', c => { s += c; if (s.length > 4.4e6) req.destroy(); });
    req.on('end', () => { try { res(s ? JSON.parse(s) : {}); } catch (e) { rej(new Error('Body không phải JSON')); } });
    req.on('error', rej);
  });
}
function bangNhau(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
async function supa(path, opt) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + path, Object.assign({}, opt, {
    headers: Object.assign({ apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' }, (opt && opt.headers) || {}),
  }));
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}
const chu = (v, n) => v == null ? '' : String(v).trim().slice(0, n || 200);
function lay(r, ...k) { for (const x of k) if (r && r[x] != null && String(r[x]).trim() !== '') return r[x]; return null; }
// Mã plant/sloc/vật tư: Excel hay đọc thành số (2013.0) -> bỏ phần .0
const ma = v => chu(v, 40).replace(/\.0+$/, '');

function kyMacDinh() {
  const d = new Date(Date.now() + 7 * 3600e3);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

// Phiên đăng nhập là admin đang hoạt động? Trả tên người dùng, không thì null.
async function laAdmin(token) {
  try {
    if (!/^eyJ/.test(token)) return null;
    const u = await fetch(SUPA_URL + '/auth/v1/user', { headers: { apikey: SVC, Authorization: 'Bearer ' + token } });
    if (!u.ok) return null;
    const id = (await u.json()).id;
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    const p = await supa('profiles?select=full_name,email,role,status&id=eq.' + id);
    const x = p && p[0];
    return x && x.role === 'admin' && x.status === 'active' ? (x.full_name || x.email || 'admin') : null;
  } catch (e) { return null; }
}

async function baoKho(appUrl, plant, sloc, ten, ky) {
  const [y, m] = ky.split('-');
  const msg = 'Đã mở kỳ kiểm kê tháng ' + m + '/' + y + ' cho kho ' + ten + '. Vào app → tab Kiểm kê → chọn kho → "Kiểm đếm trực tiếp" để đếm.';
  try {
    await supa('notifications', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id: 'NTK' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), plant_code: plant, sloc_code: sloc,
        message: msg, kind: 'countlist', created_by: NGUOI, read_flag: false }) });
  } catch (e) { console.warn('Ghi thông báo lỗi', plant, sloc, e.message); }
  try {
    const subs = await supa('push_subs?select=endpoint,p256dh,auth&plant_code=eq.' + encodeURIComponent(plant) + '&sloc_code=eq.' + encodeURIComponent(sloc));
    const uniq = [...new Map((subs || []).filter(z => z.endpoint).map(z => [z.endpoint, z])).values()];
    if (uniq.length) await fetch(appUrl + '/api/push-send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-service-key': SVC },
      body: JSON.stringify({ subs: uniq, title: 'Mở kỳ kiểm kê', body: msg, url: '/', tag: 'countlist' }) });
  } catch (e) { console.warn('Đẩy thông báo lỗi', e.message); }
}

async function xuLy(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận POST' });
  if (!SVC) return res.status(503).json({ error: 'Máy chủ chưa cấu hình SUPABASE_SERVICE_ROLE_KEY' });
  const au = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  // Hai cách vào: khóa agent (máy chạy agent SAP) HOẶC phiên đăng nhập của ADMIN trên app (thẻ "Mở kỳ qua API" — 23/11/2026)
  let nguoiGoi = NGUOI;
  if (!au) return res.status(401).json({ error: 'Thiếu khóa' });
  if (!(KHOA.length && KHOA.some(k => bangNhau(au, k)))) {
    const ad = await laAdmin(au);
    if (!ad) return res.status(401).json({ error: 'Sai khóa API hoặc tài khoản không phải admin' });
    nguoiGoi = NGUOI + ' (thử: ' + ad + ')';
  }

  const b = await doc(req);
  const ky = chu(b.period || b.ky, 7) || kyMacDinh();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ky)) return res.status(400).json({ error: 'period phải dạng YYYY-MM' });
  const rows = Array.isArray(b.records) ? b.records : Array.isArray(b.rows) ? b.rows : null;
  if (!rows || !rows.length) return res.status(400).json({ error: 'Thiếu records' });
  if (rows.length > TOI_DA) return res.status(413).json({ error: 'Tối đa ' + TOI_DA + ' dòng mỗi lần — chia lô, cùng data_hash' });
  const coHash = !!chu(b.data_hash, 64).replace(/[^\w\-]/g, '');
  const hash = chu(b.data_hash, 64).replace(/[^\w\-]/g, '') || crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  const dau = nguoiGoi + ' · ' + hash;
  const thu = b.thu === true || b.thu === 1 || b.thu === '1';
  const ghiDe = b.ghi_de === true || b.ghi_de === 1 || b.ghi_de === '1';

  // Đọc + gom theo kho
  const boQua = [], g = {};
  rows.forEach((r, i) => {
    const plant = ma(lay(r, 'plant', 'ma_diem_ban', 'Plant')), sloc = ma(lay(r, 'sloc', 'ma_kho', 'Sloc', 'Storage Location'));
    const code = ma(lay(r, 'material', 'ma_vat_tu', 'ma', 'Material'));
    if (!plant || !sloc) return boQua.push({ i, lyDo: 'Thiếu plant / sloc' });
    if (!/^[0-9A-Za-z._\-]{2,20}$/.test(code)) return boQua.push({ i, lyDo: 'Mã vật tư không hợp lệ: ' + chu(code, 30) });
    const k = plant + '|' + sloc;
    (g[k] = g[k] || { plant, sloc, items: {} }).items[code] = {
      name: chu(lay(r, 'material_description', 'ten_vat_tu', 'ten', 'Material Description'), 200) || code,
      uom: chu(lay(r, 'unit', 'dvt', 'Unit'), 20),
    };
  });
  const khos = Object.values(g);
  if (!khos.length) return res.status(400).json({ error: 'Không có dòng hợp lệ', boQua: boQua.slice(0, 50) });

  // Kho có trên hệ thống? Đã có danh sách / biên bản đã duyệt?
  const plants = [...new Set(khos.map(x => x.plant))].map(encodeURIComponent).join(',');
  const [slocs, cls, subs] = await Promise.all([
    supa('slocs?select=plant_code,sloc_code,sloc_name&plant_code=in.(' + plants + ')'),
    supa('count_lists?select=plant_code,sloc_code,items,created_by,created_at&period=eq.' + ky + '&plant_code=in.(' + plants + ')'),
    supa('submissions?select=plant_code,sloc_code&status=eq.' + encodeURIComponent('Đã duyệt') + '&period=eq.' + ky + '&plant_code=in.(' + plants + ')'),
  ]);
  const tenKho = new Map((slocs || []).map(s => [s.plant_code + '|' + s.sloc_code, s.sloc_name]));
  const clMap = new Map((cls || []).map(c => [c.plant_code + '|' + c.sloc_code, c]));
  const daDuyet = new Set((subs || []).map(s => s.plant_code + '|' + s.sloc_code));
  const appUrl = APP_URL;

  // 25/11/2026: chạy 6 kho cùng lúc — chạy lần lượt ~87 kho × 4 lượt gọi máy chủ có thể vượt hạn 60 giây của Vercel.
  async function motKho(x) {
    const k = x.plant + '|' + x.sloc, ten = tenKho.get(k) || '', cu = clMap.get(k), n = Object.keys(x.items).length;
    const dong = { plant: x.plant, sloc: x.sloc, ten, so_ma: n };
    if (!ten) return Object.assign(dong, { ket_qua: 'bo_qua', ly_do: 'Kho chưa có trên hệ thống (bảng slocs)' });
    if (daDuyet.has(k)) return Object.assign(dong, { ket_qua: 'bo_qua', ly_do: 'Kỳ này đã duyệt biên bản kiểm kê' });
    const cuAgent = cu && String(cu.created_by || '').startsWith(NGUOI);
    if (cu && !cuAgent && !ghiDe) return Object.assign(dong, { ket_qua: 'bo_qua', ly_do: 'Kế toán đã mở kỳ tay (' + (cu.created_by || '?') + ') — gửi ghi_de=true để thay' });
    // 25/11/2026: agent đẩy TỪNG KHO một. Gửi một kho thành nhiều lần mà KHÔNG kèm data_hash thì mỗi lần một mã băm khác →
    // lần sau sẽ THAY mất lần trước. Không có data_hash + agent vừa mở kho này trong 30 phút → coi là cùng lần chạy, CỘNG DỒN.
    const ganDay = cuAgent && !coHash && cu.created_at && (Date.now() - Date.parse(cu.created_at)) < 30 * 60e3;
    const cungLan = cu && (cu.created_by === dau || ganDay);
    const items = cungLan ? Object.assign({}, cu.items || {}, x.items) : x.items;
    if (cungLan && JSON.stringify(items) === JSON.stringify(cu.items || {})) return Object.assign(dong, { so_ma: Object.keys(items).length, ket_qua: 'khong_doi' });
    const loai = cungLan ? 'cong_don' : (cu ? 'thay' : 'mo_moi');
    Object.assign(dong, { so_ma: Object.keys(items).length, ket_qua: loai });
    if (thu) return dong;
    try {
      const w = await supa('count_lists?on_conflict=plant_code,sloc_code,period', { method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ plant_code: x.plant, sloc_code: x.sloc, period: ky, items, created_by: dau, created_at: new Date().toISOString() }) });
      if (!Array.isArray(w) || !w.length) throw new Error('Máy chủ không ghi dòng nào');
      if (!cungLan) await baoKho(appUrl, x.plant, x.sloc, ten, ky);   // báo một lần mỗi lần chạy
    } catch (e) { dong.ket_qua = 'bo_qua'; dong.ly_do = 'Ghi lỗi: ' + e.message.slice(0, 200); }
    return dong;
  }
  const kq = new Array(khos.length);
  let vt = 0;
  await Promise.all(Array.from({ length: Math.min(6, khos.length) }, async () => {
    while (vt < khos.length) { const i = vt++; kq[i] = await motKho(khos[i]); }
  }));
  const loi = kq.filter(x => x.ket_qua === 'bo_qua' && /^Ghi lỗi/.test(x.ly_do || '')).length;
  return res.status(loi ? 207 : 200).json({ ok: !loi, ky, thu, batch: b.batch_index ? b.batch_index + '/' + (b.total_batches || '?') : undefined,
    kho: kq, boQua: boQua.slice(0, 100), soDongBoQua: boQua.length });
}

module.exports = bocLoi('mo-ky-kiem-ke', xuLy);
