// api/nhac-dc.js — Vercel Cron gọi lúc 17h giờ VN mỗi ngày (vercel.json "crons", 10:00 UTC).
// Nhắc người duyệt các phiếu điều chuyển đang Chờ duyệt: tin Teams (tag người duyệt) + chuông + đẩy về máy.
// Không cần khai gì thêm trên Vercel: link Teams đọc từ bảng kín bao_mat_cau_hinh (GitHub tự chép vào).
// Chống gọi bừa: chỉ chạy trong 17:00–18:59 giờ VN và MỘT lần mỗi ngày (khóa ở bảng bao_mat_cau_hinh).
// Nếu có đặt CRON_SECRET thì bắt buộc đúng header (Vercel Cron tự gửi). ?thu=1 (chỉ xem tin) cần CRON_SECRET.

const { bocLoi } = require('../lib/ghi-loi');
const { APP_URL } = require('../lib/app-url');
const { nhacDuyetDC } = require('../lib/nhac-dc');

async function xuLy(req, res) {
  const bi = (process.env.CRON_SECRET || '').trim();
  const dungBi = !!bi && String(req.headers.authorization || '') === 'Bearer ' + bi;
  if (bi && !dungBi) return res.status(401).json({ error: 'Không có quyền' });
  const thu = String((req.query && req.query.thu) || '') === '1';
  if (thu && !dungBi) return res.status(401).json({ error: 'Chế độ thử cần CRON_SECRET' });
  const gio = new Date(Date.now() + 7 * 3600e3).getUTCHours();
  if (!thu && (gio < 17 || gio > 18)) return res.status(200).json({ boQua: 'Chỉ chạy 17:00–18:59 giờ VN' });
  const appUrl = APP_URL;
  const kq = await nhacDuyetDC({ appUrl, thu, motLanNgay: !thu });
  return res.status(200).json({ phieu: kq.phieu, kho: kq.kho, thongBao: kq.thongBao, boQua: kq.boQua, loi: kq.loi, tin: thu ? kq.tin : undefined });
}

module.exports = bocLoi('nhac-dc', xuLy);
