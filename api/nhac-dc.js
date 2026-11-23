// api/nhac-dc.js — Vercel Cron gọi lúc 17h giờ VN mỗi ngày (vercel.json "crons", 10:00 UTC).
// Nhắc người duyệt các phiếu điều chuyển đang Chờ duyệt: tin Teams (tag người duyệt) + chuông + đẩy về máy.
// Bảo vệ: Vercel Cron tự gửi "Authorization: Bearer <CRON_SECRET>" khi biến CRON_SECRET được đặt.
// Gọi tay để thử: cùng header đó, thêm ?thu=1 để chỉ xem tin, không gửi gì.

const { bocLoi } = require('../lib/ghi-loi');
const { nhacDuyetDC } = require('../lib/nhac-dc');

async function xuLy(req, res) {
  const bi = (process.env.CRON_SECRET || '').trim();
  if (!bi) return res.status(503).json({ error: 'Chưa đặt CRON_SECRET trên Vercel' });
  if (String(req.headers.authorization || '') !== 'Bearer ' + bi) return res.status(401).json({ error: 'Không có quyền' });
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^a-z0-9.\-:]/gi, '');
  const appUrl = (process.env.APP_URL || (host ? 'https://' + host : 'https://cost-master-sigma.vercel.app')).replace(/\/+$/, '');
  const thu = String((req.query && req.query.thu) || '') === '1';
  const kq = await nhacDuyetDC({ appUrl, thu });
  return res.status(200).json(kq);
}

module.exports = bocLoi('nhac-dc', xuLy);
