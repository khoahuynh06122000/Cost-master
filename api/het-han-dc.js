// api/het-han-dc.js — tự hủy phiếu điều chuyển quá hạn duyệt 48 giờ (xem lib/het-han-dc.js).
// Ai gọi cũng được (chỉ hủy phiếu ĐÃ quá hạn — gọi thêm không gây hại); máy chủ tự giãn ≥ 5 phút/lần.
// Người gọi: app (mỗi vòng đồng bộ), Vercel Cron (mỗi ngày), GitHub het-han-dc.yml (dự phòng).
const { bocLoi } = require('../lib/ghi-loi');
const { hetHanDC } = require('../lib/het-han-dc');

async function xuLy(req, res) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^a-z0-9.\-:]/gi, '');
  const appUrl = (process.env.APP_URL || (host ? 'https://' + host : 'https://cost-master-sigma.vercel.app')).replace(/\/+$/, '');
  const kq = await hetHanDC({ appUrl, gian: 5 });
  return res.status(200).json({ boQua: kq.boQua, cho: kq.cho, quaHan: kq.quaHan, huy: kq.huy, loi: kq.loi && kq.loi.length ? kq.loi : undefined });
}

module.exports = bocLoi('het-han-dc', xuLy);
