// lib/xac-thuc.js — kiểm người gọi cổng /api (25/11/2026). Luôn ĐÓNG khi thiếu cấu hình (fail-closed).
const crypto = require('crypto');
const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');

function bang(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function layToken(req) {
  const a = String((req.headers && req.headers.authorization) || '');
  return /^Bearer\s+/i.test(a) ? a.replace(/^Bearer\s+/i, '').trim() : '';
}
// Đúng CRON_SECRET? Chưa đặt CRON_SECRET thì LUÔN sai.
function dungCron(req) {
  const bi = (process.env.CRON_SECRET || '').trim(), tk = layToken(req);
  return !!bi && !!tk && bang(tk, bi);
}
// Phiên đăng nhập Supabase còn hiệu lực? Trả id người dùng, không thì null. Thiếu service key thì null.
async function phienHopLe(req) {
  const tk = layToken(req), svc = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!svc || !/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(tk)) return null;
  try {
    const r = await fetch(SUPA_URL + '/auth/v1/user', { headers: { apikey: svc, Authorization: 'Bearer ' + tk } });
    if (!r.ok) return null;
    const u = await r.json();
    return /^[0-9a-f-]{36}$/i.test(String((u && u.id) || '')) ? u.id : null;
  } catch (e) { return null; }
}
module.exports = { dungCron, phienHopLe, layToken };
