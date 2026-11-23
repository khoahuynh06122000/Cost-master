// lib/het-han-dc.js — TỰ HỦY PHIẾU ĐIỀU CHUYỂN QUÁ HẠN DUYỆT 48 GIỜ (Khoa 09/11/2026; chuyển sang Vercel 23/11/2026).
// Trước chạy trên GitHub "mỗi giờ" nhưng GitHub thực tế 5–9 tiếng mới chạy một lần -> phiếu quá hạn vẫn nằm Chờ duyệt
// thêm nhiều giờ. Nay gọi qua api/het-han-dc.js: app gọi trong mỗi vòng đồng bộ (máy chủ tự giãn ≥ 5 phút/lần),
// Vercel Cron gọi mỗi ngày, GitHub vẫn gọi như dự phòng.
// Công thức hạn PHẢI giống dcHan() trong index.html: hạn = max(giờ lập, MOC) + 48 giờ.
// Không áp cho phiếu hủy hàng (kế toán duyệt) và phiếu admin đã "bỏ từ chối" sau khi quá hạn (reject_note còn HUY_TAG).
// Lệnh hủy có điều kiện status = Chờ duyệt: ai vừa duyệt trước thì không đụng tới, gọi chồng nhau không báo trùng.

const { tenKho, q } = require('./nhac-dc');
const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SVC = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const HAN_GIO = 48, MOC = Date.parse('2026-11-09T12:00:00+07:00'), HUY_TAG = 'Quá hạn duyệt 48 giờ';
const CHO = encodeURIComponent('Chờ duyệt');
const H = () => ({ apikey: SVC, Authorization: 'Bearer ' + SVC });
const gioVN = ms => { const d = new Date(ms + 7 * 3600e3), p = n => String(n).padStart(2, '0');
  return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ' ' + p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1); };

// Giãn cách: một lượt mỗi `phut` phút trên toàn hệ thống (dòng 'hethan_luc' trong bảng kín bao_mat_cau_hinh).
async function giuLuot(phut, now) {
  const moi = new Date(now).toISOString(), cu = new Date(now - phut * 60e3).toISOString();
  const hd = Object.assign(H(), { 'Content-Type': 'application/json' });
  const a = await fetch(SUPA_URL + '/rest/v1/bao_mat_cau_hinh?on_conflict=k', { method: 'POST',
    headers: Object.assign({}, hd, { Prefer: 'resolution=ignore-duplicates,return=representation' }),
    body: JSON.stringify({ k: 'hethan_luc', bat: true, gia_tri: moi }) });
  if (a.ok && (await a.json()).length) return true;
  const b = await fetch(SUPA_URL + '/rest/v1/bao_mat_cau_hinh?k=eq.hethan_luc&gia_tri=lt.' + encodeURIComponent(cu), { method: 'PATCH',
    headers: Object.assign({}, hd, { Prefer: 'return=representation' }), body: JSON.stringify({ gia_tri: moi }) });
  if (!b.ok) throw new Error('Giữ lượt HTTP ' + b.status);
  return (await b.json()).length > 0;
}

async function bao(appUrl, p, s, msg, loi) {
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/notifications', { method: 'POST',
      headers: Object.assign(H(), { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ id: 'NTH' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), plant_code: p, sloc_code: s,
        message: msg, kind: 'transfer', created_by: 'Hệ thống', read_flag: false }) });
    if (!r.ok) loi.push('Ghi thông báo ' + p + '|' + s + ' HTTP ' + r.status);
  } catch (e) { loi.push('Ghi thông báo: ' + e.message); }
  if (!appUrl) return;
  try {
    const subs = await q('push_subs?select=endpoint,p256dh,auth&plant_code=eq.' + p + '&sloc_code=eq.' + s);
    const uniq = [...new Map(subs.filter(z => z.endpoint).map(z => [z.endpoint, z])).values()];
    if (uniq.length) await fetch(appUrl + '/api/push-send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-service-key': SVC },
      body: JSON.stringify({ subs: uniq, title: 'Phiếu điều chuyển đã quá thời gian duyệt', body: msg, url: '/', tag: 'dchethan' }) });
  } catch (e) { loi.push('Đẩy thông báo: ' + e.message); }
}

// opt: { appUrl, gian (phút giãn cách, 0 = không giãn), now }
async function hetHanDC(opt) {
  const o = opt || {}, now = o.now || Date.now(), loi = [];
  if (!SVC) throw new Error('Thiếu SUPABASE_SERVICE_ROLE_KEY');
  if (o.gian && !(await giuLuot(o.gian, now))) return { boQua: 'Vừa kiểm tra xong' };
  const ds = await q('transfer_requests?select=id,kind,from_plant,from_sloc,to_plant,to_sloc,items,created_at,reject_note&status=eq.' + CHO);
  const quaHan = ds.filter(r => r.kind !== 'huy' && !String(r.reject_note || '').includes(HUY_TAG)).filter(r => {
    const t = Date.parse(r.created_at || '');
    return !isNaN(t) && now > Math.max(t, MOC) + HAN_GIO * 3600e3;
  });
  const kq = { cho: ds.length, quaHan: quaHan.length, huy: 0, loi };
  if (!quaHan.length) return kq;
  const keys = [...new Set(quaHan.flatMap(r => [r.from_plant + '|' + r.from_sloc, r.to_plant + '|' + r.to_sloc]))];
  const { sname } = await tenKho(o.appUrl, keys);
  for (const r of quaHan) {
    const han = Math.max(Date.parse(r.created_at), MOC) + HAN_GIO * 3600e3;
    const note = HUY_TAG + ' (hạn ' + gioVN(han) + ') — hệ thống tự hủy';
    const res = await fetch(SUPA_URL + '/rest/v1/transfer_requests?id=eq.' + encodeURIComponent(r.id) + '&status=eq.' + CHO, { method: 'PATCH',
      headers: Object.assign(H(), { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ status: 'Từ chối', reject_note: note, approved_by: 'Hệ thống', approved_at: new Date(now).toISOString() }) });
    if (!res.ok) { loi.push('Không hủy được ' + r.id + ' HTTP ' + res.status); continue; }
    if (!(await res.json()).length) continue;   // vừa được xử lý ở nơi khác
    kq.huy++;
    const nMa = r.items && typeof r.items === 'object' ? Object.keys(r.items).length : 0;
    const tu = r.from_plant ? sname(r.from_plant, r.from_sloc) : '?', den = r.to_plant ? sname(r.to_plant, r.to_sloc) : '?';
    // Bên lập: xin hàng = kho nhận; hàng dư = kho chuyển. Bên duyệt là đầu còn lại.
    const [lap, duyet] = r.kind === 'du' ? [[r.from_plant, r.from_sloc], [r.to_plant, r.to_sloc]] : [[r.to_plant, r.to_sloc], [r.from_plant, r.from_sloc]];
    const dau = '⌛ Phiếu ' + r.id + ' (' + tu + ' → ' + den + ', ' + nMa + ' mã) đã quá thời gian duyệt 48 giờ — hệ thống đã tự hủy.';
    if (lap[0]) await bao(o.appUrl, lap[0], lap[1], dau + ' Hàng chưa được ghi sổ; nếu vẫn cần hàng thì lập phiếu mới.', loi);
    if (duyet[0]) await bao(o.appUrl, duyet[0], duyet[1], dau + ' Kho này không duyệt kịp hạn. Nếu hàng đã xuất thì sổ chưa trừ kho — báo kế toán.', loi);
  }
  return kq;
}

module.exports = { hetHanDC };
