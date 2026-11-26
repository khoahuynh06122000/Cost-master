// lib/chu-ky-dc.js — NỘI DUNG PHIẾU ĐIỀU CHUYỂN ĐEM BĂM KHI KÝ SỐ (26/11/2026, theo cách app BCSX-SKB ký phiếu nhập).
// Máy chủ (api/ky.js) băm nội dung này lúc ký; app băm lại lúc hiện phiếu để báo "nội dung đã đổi sau khi ký".
// HÀM `noiDungDC` TRONG index.html PHẢI GIỐNG HỆT HÀM DƯỚI — đổi một bên là mọi chữ ký cũ báo "đã đổi".
//
// Ô ký theo loại phiếu (Khoa 26/11/2026: ai LẬP phiếu không quan trọng — chỉ cần chữ ký NGƯỜI XUẤT và NGƯỜI NHẬN;
// cuối tháng kế toán tải phiếu về thì phiếu tự khoá, PDF đóng dấu đỏ "Kế toán đã chốt" — ô 'kt' trong chu_ky):
//   xin : giao (bên cho, ký lúc duyệt, số THỰC GIAO) · nhan (bên xin, ký lúc nhận hàng, số thực giao)
//   du  : giao (bên chuyển, ký lúc lập, số CHUYỂN)   · nhan (bếp, ký lúc nhận, số thực nhận)
//   huy : giao (kho hủy, ký lúc lập, số HỦY)         · duyet (kế toán, ký lúc duyệt, số duyệt hủy)
const crypto = require('crypto');

const so3 = n => String(Math.round((Number(n) || 0) * 1000) / 1000);

/* qty: { mã: số } — số dùng cho ô ký (lap = số xin; ô khác = số thực giao / nhận / duyệt). Mã số 0 không vào nội dung. */
function noiDungDC(r, vai, qty) {
  const ds = Object.keys(qty || {}).filter(c => Number(qty[c]) > 0).map(c => String(c).trim() + '=' + so3(qty[c])).sort();
  return ['DIEU_CHUYEN', r.id, r.kind, (r.fromPlant || '') + '-' + (r.fromSloc || ''),
    r.toPlant ? r.toPlant + '-' + (r.toSloc || '') : 'HUY', vai === 'lap' ? 'LAP' : 'GIAO', ds.join(';')].join('|');
}
/* Số của từng ô ký lấy từ items của phiếu: lap = qtyReq; ô khác = qtyOk (chưa có thì qtyReq). */
function soCuaO(items, vai) {
  const out = {};
  Object.keys(items || {}).forEach(c => {
    const it = items[c] || {};
    out[c] = vai === 'lap' ? Number(it.qtyReq) || 0 : Number(it.qtyOk != null ? it.qtyOk : it.qtyReq) || 0;
  });
  return out;
}
const bamSha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* Ô ký lúc DUYỆT / NHẬN (ghi sổ) · ô ký lúc LẬP (người lập là bên xuất hàng) · các ô của phiếu */
const O_DUYET = { xin: 'giao', day: 'giao', du: 'nhan', huy: 'duyet' };
const O_LAP = { du: 'giao', huy: 'giao' };
const O_KY = { xin: ['giao', 'nhan'], day: ['giao', 'nhan'], du: ['giao', 'nhan'], huy: ['giao', 'duyet'] };
/* Ô ký này đem băm số nào: 'lap' = số xin / chuyển / hủy (qtyReq) khi ký lúc lập; 'giao' = số thực giao / nhận / duyệt. */
const nguonSo = (kind, vai) => O_LAP[kind] === vai ? 'lap' : 'giao';

module.exports = { noiDungDC, soCuaO, bamSha256, O_DUYET, O_LAP, O_KY, nguonSo };
