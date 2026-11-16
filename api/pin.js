// api/pin.js — Vercel serverless: MÃ PIN 6 SỐ LƯU & KIỂM TRÊN MÁY CHỦ (16/11/2026, theo cách app PKT NS làm).
//
// Vì sao ở máy chủ: lưu mã băm PIN trên máy người dùng thì ai cầm máy cũng thử hết 1.000.000 tổ hợp offline được.
// Ở đây máy chủ giữ mã băm (bảng user_pin, RLS bật, KHÔNG policy nào — chỉ khóa service role đọc/ghi được),
// đếm số lần sai, sai 5 lần thì KHÓA; muốn đặt lại phải vừa đăng nhập bằng MẬT KHẨU (trong 10 phút).
//
// Client gửi POST, Authorization: Bearer <access_token của phiên>, body { action, pin }:
//   trang_thai          -> { coPin, khoa }
//   kiem  {pin}         -> { dung:true } | { dung:false, conLai } | { dung:false, khoa:true }
//   dat   {pin}         -> { ok:true }   (chưa có PIN, hoặc đang có/đang khóa mà vừa đăng nhập bằng mật khẩu)

const crypto = require('crypto');
const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const PEPPER = crypto.createHash('sha256').update('kk-pin|' + (process.env.PIN_PEPPER || SERVICE_KEY)).digest('hex');
const SAI_TOI_DA = 5;
const MAT_KHAU_MOI_GIAY = 10 * 60;

function doc(req) {
  return new Promise((res, rej) => {
    if (req.body && typeof req.body === 'object') return res(req.body);
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e4) req.destroy(); });
    req.on('end', () => { try { res(s ? JSON.parse(s) : {}); } catch (e) { rej(new Error('Body không phải JSON')); } });
    req.on('error', rej);
  });
}
async function supa(path, opt) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + path, Object.assign({}, opt, {
    headers: Object.assign({ apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' }, (opt && opt.headers) || {}),
  }));
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
function bam(pin, salt) {
  return crypto.scryptSync(String(pin) + '|' + PEPPER, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function bangNhau(a, b) {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
// Phiên này có vừa đăng nhập bằng mật khẩu không (claim amr trong JWT do Supabase ký, đã được /auth/v1/user xác nhận hợp lệ).
function vuaDungMatKhau(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    return (p.amr || []).some(a => a && a.method === 'password' && now - Number(a.timestamp || 0) <= MAT_KHAU_MOI_GIAY);
  } catch (e) { return false; }
}
const pinHopLe = p => /^\d{6}$/.test(String(p || ''));

module.exports = async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ ready: !!SERVICE_KEY });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận GET hoặc POST' });
  if (!SERVICE_KEY) return res.status(503).json({ error: 'chua_cau_hinh' });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Thiếu phiên đăng nhập' });
  let b;
  try { b = await doc(req); } catch (e) { return res.status(400).json({ error: e.message }); }

  try {
    const rMe = await fetch(SUPA_URL + '/auth/v1/user', { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token } });
    if (!rMe.ok) return res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });
    const me = await rMe.json();
    if (!me || !me.id) return res.status(401).json({ error: 'Không xác định được người gọi' });
    const uid = encodeURIComponent(me.id);
    let row;
    try { row = ((await supa('user_pin?user_id=eq.' + uid + '&select=hash,salt,so_sai,khoa', { method: 'GET' })) || [])[0] || null; }
    catch (e) { if (/42P01|does not exist|schema cache/i.test(e.message)) return res.status(503).json({ error: 'chua_cau_hinh' }); throw e; }

    const action = String(b.action || '');
    if (action === 'trang_thai') return res.status(200).json({ coPin: !!row, khoa: !!(row && row.khoa) });

    if (action === 'kiem') {
      if (!row) return res.status(200).json({ dung: false, chuaCo: true });
      if (row.khoa) return res.status(200).json({ dung: false, khoa: true });
      if (!pinHopLe(b.pin)) return res.status(400).json({ error: 'PIN phải đủ 6 số' });
      if (bangNhau(bam(b.pin, row.salt), row.hash)) {
        if (row.so_sai) await supa('user_pin?user_id=eq.' + uid, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ so_sai: 0 }) });
        return res.status(200).json({ dung: true });
      }
      const n = (Number(row.so_sai) || 0) + 1, khoa = n >= SAI_TOI_DA;
      await supa('user_pin?user_id=eq.' + uid, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ so_sai: n, khoa }) });
      return res.status(200).json(khoa ? { dung: false, khoa: true } : { dung: false, conLai: SAI_TOI_DA - n });
    }

    if (action === 'dat') {
      if (!pinHopLe(b.pin)) return res.status(400).json({ error: 'PIN phải đủ 6 số' });
      if (row && !vuaDungMatKhau(token)) return res.status(403).json({ error: 'can_mat_khau' });
      const salt = crypto.randomBytes(16).toString('hex');
      await supa('user_pin?on_conflict=user_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: me.id, hash: bam(b.pin, salt), salt, so_sai: 0, khoa: false, cap_nhat: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'action không hợp lệ' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e).slice(0, 300) });
  }
};
