// lib/don-thong-bao.js — DỌN BẢNG notifications (Khoa 26/11/2026).
// 14 ngày một lần: giữ lại 200 thông báo mới nhất, xoá phần cũ hơn. App chỉ tải 200 thông báo gần nhất
// (chuông) nên phần xoá đi không ai còn thấy — dọn cho cơ sở dữ liệu gọn.
// KHÔNG đụng nhật ký lỗi app (loi_app) và sự cố hệ thống (su_co) — hai bảng đó không nằm ở đây.
// Gọi từ cổng /api/nhac-dc (Vercel Cron 17h mỗi ngày); tự đếm 14 ngày bằng dòng 'donthongbao_ngay' trong bao_mat_cau_hinh.

const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SVC = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const GIU = 200, CHU_KY_NGAY = 14, KHOA = 'donthongbao_ngay';
const H = (them) => Object.assign({ apikey: SVC, Authorization: 'Bearer ' + SVC }, them || {});
const ngayVN = t => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);

/* Trả { boQua } khi chưa tới hạn, { xoa, giu, moc } khi đã dọn. now: để thử. */
async function donThongBao(opt) {
  opt = opt || {};
  if (!SVC) return { boQua: 'thiếu khoá service' };
  const now = opt.now || Date.now(), homNay = ngayVN(now);
  // 1. Tới hạn chưa (lần dọn trước + 14 ngày)
  const r0 = await fetch(SUPA_URL + '/rest/v1/bao_mat_cau_hinh?select=gia_tri&k=eq.' + KHOA, { headers: H() });
  if (!r0.ok) throw new Error('Đọc lịch dọn HTTP ' + r0.status);
  const cu = ((await r0.json())[0] || {}).gia_tri || '';
  if (cu && /^\d{4}-\d{2}-\d{2}$/.test(cu) && (Date.parse(homNay) - Date.parse(cu)) / 86400e3 < CHU_KY_NGAY)
    return { boQua: 'lần dọn trước ' + cu + ', chưa đủ ' + CHU_KY_NGAY + ' ngày' };
  // 2. Giành lượt: ghi ngày hôm nay (có điều kiện giá trị cũ — hai lượt chạy cùng lúc chỉ một lượt dọn)
  let giu;
  if (!cu) {
    const a = await fetch(SUPA_URL + '/rest/v1/bao_mat_cau_hinh?on_conflict=k', { method: 'POST',
      headers: H({ 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' }),
      body: JSON.stringify({ k: KHOA, bat: true, gia_tri: homNay }) });
    giu = a.ok && (await a.json()).length > 0;
  } else {
    const b = await fetch(SUPA_URL + '/rest/v1/bao_mat_cau_hinh?k=eq.' + KHOA + '&gia_tri=eq.' + encodeURIComponent(cu), { method: 'PATCH',
      headers: H({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify({ gia_tri: homNay }) });
    giu = b.ok && (await b.json()).length > 0;
  }
  if (!giu) return { boQua: 'lượt khác đang dọn' };
  // 3. Mốc = giờ tạo của thông báo thứ 200 (mới nhất trước); chưa tới 200 thì không xoá gì
  const r1 = await fetch(SUPA_URL + '/rest/v1/notifications?select=created_at&order=created_at.desc&offset=' + (GIU - 1) + '&limit=1', { headers: H() });
  if (!r1.ok) throw new Error('Đọc thông báo HTTP ' + r1.status);
  const moc = ((await r1.json())[0] || {}).created_at;
  if (!moc) return { xoa: 0, giu: GIU, moc: null };
  const r2 = await fetch(SUPA_URL + '/rest/v1/notifications?created_at=lt.' + encodeURIComponent(moc), { method: 'DELETE',
    headers: H({ Prefer: 'count=exact,return=minimal' }) });
  if (!r2.ok) throw new Error('Xoá thông báo HTTP ' + r2.status + ' ' + (await r2.text()).slice(0, 160));
  const cr = r2.headers.get('content-range') || '';
  return { xoa: Number(cr.split('/')[1]) || 0, giu: GIU, moc };
}

module.exports = { donThongBao };
