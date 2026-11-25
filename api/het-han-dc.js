// api/het-han-dc.js — tự hủy phiếu điều chuyển quá hạn duyệt 48 giờ (xem lib/het-han-dc.js).
// Người gọi: app (mỗi vòng đồng bộ, kèm phiên đăng nhập) và Vercel Cron (mỗi ngày, kèm CRON_SECRET). Máy chủ tự giãn ≥ 5 phút/lần.
// RÀ BẢO MẬT 25/11/2026: bắt buộc CRON_SECRET hoặc phiên đăng nhập hợp lệ (trước đây ai gọi cũng được).
const { bocLoi } = require('../lib/ghi-loi');
const { APP_URL } = require('../lib/app-url');
const { hetHanDC } = require('../lib/het-han-dc');

const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SVC = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const crypto = require('crypto');
const bang = (a, b) => a.length === b.length && a.length > 0 && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function duocGoi(req) {
  const a = String(req.headers.authorization || ''), tk = a.startsWith('Bearer ') ? a.slice(7).trim() : '';
  if (!tk) return false;
  const bi = (process.env.CRON_SECRET || '').trim();
  if (bi && bang(tk, bi)) return true;
  if (!/^eyJ/.test(tk) || !SVC) return false;
  try { return (await fetch(SUPA_URL + '/auth/v1/user', { headers: { apikey: SVC, Authorization: 'Bearer ' + tk } })).ok; } catch (e) { return false; }
}

async function xuLy(req, res) {
  if (!(await duocGoi(req))) return res.status(401).json({ error: 'Cần đăng nhập' });
  const appUrl = APP_URL;
  const kq = await hetHanDC({ appUrl, gian: 5 });
  return res.status(200).json({ boQua: kq.boQua, cho: kq.cho, quaHan: kq.quaHan, huy: kq.huy, loi: kq.loi && kq.loi.length ? kq.loi : undefined });
}

module.exports = bocLoi('het-han-dc', xuLy);
