// lib/pin-kiem.js — KIỂM MÃ PIN TRÊN MÁY CHỦ, dùng chung cho api/pin.js (mở khoá app) và api/ky.js (ký số chứng từ).
// Tách ra 26/11/2026 để hai cổng cùng MỘT cách đếm lần sai: sai PIN lúc ký cũng tính vào 5 lần, đủ 5 là khoá như mở app.
// Cách giành lượt thử (chống dò song song): xem chú thích đầu api/pin.js.
const crypto = require('crypto');
const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const PEPPER = crypto.createHash('sha256').update('kk-pin|' + (process.env.PIN_PEPPER || SERVICE_KEY)).digest('hex');
const SAI_TOI_DA = 5;

async function supa(path, opt) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + path, Object.assign({}, opt, {
    headers: Object.assign({ apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' }, (opt && opt.headers) || {}),
  }));
  const t = await r.text();
  if (!r.ok) throw Object.assign(new Error('Supabase ' + r.status + ': ' + t.slice(0, 200)), { st: r.status });
  return t ? JSON.parse(t) : null;
}
function bamPin(pin, salt) {
  return crypto.scryptSync(String(pin) + '|' + PEPPER, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function bangNhauHex(a, b) {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
const pinHopLe = p => /^\d{6}$/.test(String(p || ''));

/* Kiểm PIN của user `uid` (đã xác thực). Trả:
   { dung:true } | { dung:false, conLai } | { dung:false, khoa:true } | { dung:false, chuaCo:true } | { dung:false, banTranh:true }
   Mỗi lần thử phải giành lượt (tăng so_sai có điều kiện) TRƯỚC khi so — gửi song song bao nhiêu cũng chỉ so tối đa 5 lần. */
async function kiemPin(uid, pin) {
  if (!pinHopLe(pin)) return { dung: false, saiDang: true };
  const u = encodeURIComponent(uid);
  const doc1 = async () => ((await supa('user_pin?user_id=eq.' + u + '&select=hash,salt,so_sai,khoa', { method: 'GET' })) || [])[0] || null;
  let row = await doc1(), n = -1;
  for (let vong = 0; vong < 5 && n < 0; vong++) {
    if (!row) return { dung: false, chuaCo: true };
    if (row.khoa) return { dung: false, khoa: true };
    const cu = Number(row.so_sai) || 0, moi = cu + 1;
    const kq = await supa('user_pin?user_id=eq.' + u + '&so_sai=eq.' + cu + '&khoa=is.false&select=so_sai', {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ so_sai: moi, khoa: moi >= SAI_TOI_DA }) });
    if (kq && kq.length) n = moi; else row = await doc1();
  }
  if (n < 0) return { dung: false, banTranh: true };
  if (bangNhauHex(bamPin(pin, row.salt), row.hash)) {
    await supa('user_pin?user_id=eq.' + u, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ so_sai: 0, khoa: false }) });
    return { dung: true };
  }
  return n >= SAI_TOI_DA ? { dung: false, khoa: true } : { dung: false, conLai: SAI_TOI_DA - n };
}

module.exports = { kiemPin, bamPin, bangNhauHex, pinHopLe, supa, SAI_TOI_DA };
