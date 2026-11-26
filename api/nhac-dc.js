// api/nhac-dc.js — Vercel Cron gọi lúc 17h giờ VN mỗi ngày (vercel.json "crons", 10:00 UTC).
// Nhắc người duyệt các phiếu điều chuyển đang Chờ duyệt: tin Teams (tag người duyệt) + chuông + đẩy về máy.
// Không cần khai gì thêm trên Vercel: link Teams đọc từ bảng kín bao_mat_cau_hinh (GitHub tự chép vào).
// Chống gọi bừa: chỉ chạy trong 17:00–18:59 giờ VN và MỘT lần mỗi ngày (khóa ở bảng bao_mat_cau_hinh).
// BẮT BUỘC CRON_SECRET (Vercel Cron tự gửi header). Thiếu biến trên Vercel thì cổng đóng (503).

const { bocLoi } = require('../lib/ghi-loi');
const { APP_URL } = require('../lib/app-url');
const { nhacDuyetDC } = require('../lib/nhac-dc');
const { dungCron } = require('../lib/xac-thuc');
const { donThongBao } = require('../lib/don-thong-bao');

async function xuLy(req, res) {
  // 25/11/2026: ĐÓNG khi thiếu CRON_SECRET (trước đây thiếu biến là ai gọi cũng chạy).
  if (!(process.env.CRON_SECRET || '').trim()) return res.status(503).json({ error: 'Máy chủ chưa cấu hình CRON_SECRET' });
  if (!dungCron(req)) return res.status(401).json({ error: 'Không có quyền' });
  const thu = String((req.query && req.query.thu) || '') === '1';
  const gio = new Date(Date.now() + 7 * 3600e3).getUTCHours();
  if (!thu && (gio < 17 || gio > 18)) return res.status(200).json({ boQua: 'Chỉ chạy 17:00–18:59 giờ VN' });
  const appUrl = APP_URL;
  const kq = await nhacDuyetDC({ appUrl, thu, motLanNgay: !thu });
  // 26/11/2026: dọn thông báo cũ — 14 ngày một lần, giữ 200 cái mới nhất. Lỗi phần này không làm hỏng phần nhắc duyệt.
  let don = null;
  if (!thu) { try { don = await donThongBao(); } catch (e) { don = { loi: String(e.message || e) }; console.warn('Dọn thông báo lỗi:', e); } }
  return res.status(200).json({ phieu: kq.phieu, kho: kq.kho, thongBao: kq.thongBao, boQua: kq.boQua, loi: kq.loi, tin: thu ? kq.tin : undefined, donThongBao: don });
}

module.exports = bocLoi('nhac-dc', xuLy);
