// api/pin.js — Vercel serverless: MÃ PIN 6 SỐ LƯU & KIỂM TRÊN MÁY CHỦ (16/11/2026, theo cách app PKT NS làm).
//
// Vì sao ở máy chủ: lưu mã băm PIN trên máy người dùng thì ai cầm máy cũng thử hết 1.000.000 tổ hợp offline được.
// Ở đây máy chủ giữ mã băm (bảng user_pin, RLS bật, KHÔNG policy nào — chỉ khóa service role đọc/ghi được),
// đếm số lần sai, sai 5 lần thì KHÓA; muốn đặt lại phải vừa đăng nhập bằng MẬT KHẨU (trong 10 phút).
//
// RÀ BẢO MẬT 16/11/2026 (Khoa: "PIN là lớp thứ 2, không được lộ cửa sau"):
//  1. GIÀNH LƯỢT THỬ TRƯỚC KHI SO PIN. Bản cũ đọc so_sai → so → ghi so_sai+1: gửi 100 yêu cầu song song thì cả 100
//     đều thấy so_sai=0 → dò được cả triệu tổ hợp. Nay mỗi lần thử phải TĂNG so_sai bằng lệnh có điều kiện
//     (so_sai = giá trị vừa đọc, chưa khoá); tăng không được = đã có yêu cầu khác giành → đọc lại, tối đa 5 vòng.
//     Chỉ yêu cầu đã giành được lượt mới được so PIN → tối đa 5 lần so trước khi khoá, dù gửi song song bao nhiêu.
//  2. MỞ KHOÁ THEO PHIÊN ĐĂNG NHẬP. Nhập đúng / đặt PIN → ghi user_pin_mo(session_id của JWT, hạn 12 giờ).
//     SQL PHẦN 41 thêm cổng RLS: bảng dữ liệu chỉ trả số cho phiên đã mở khoá PIN — mở F12 gọi thẳng hàm trong
//     app hay dùng token đánh cắp đều không đọc được dữ liệu nếu chưa nhập đúng PIN trên chính phiên đó.
//
// Client gửi POST, Authorization: Bearer <access_token của phiên>, body { action, pin }:
//   trang_thai          -> { coPin, khoa, mo }   (mo = phiên này đang mở khoá)
//   kiem  {pin}         -> { dung:true } | { dung:false, conLai } | { dung:false, khoa:true }
//   dat   {pin}         -> { ok:true }   (chưa có PIN, hoặc đang có/đang khóa mà vừa đăng nhập bằng mật khẩu)

const { bocLoi } = require('../lib/ghi-loi');
const { kiemPin } = require('../lib/pin-kiem');
const crypto = require('crypto');
const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const PEPPER = crypto.createHash('sha256').update('kk-pin|' + (process.env.PIN_PEPPER || SERVICE_KEY)).digest('hex');
const SAI_TOI_DA = 5;
const MAT_KHAU_MOI_GIAY = 10 * 60;
const MO_GIO = 12;

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
  if (!r.ok) throw Object.assign(new Error('Supabase ' + r.status + ': ' + t.slice(0, 200)), { st: r.status });
  return t ? JSON.parse(t) : null;
}
function bam(pin, salt) {
  return crypto.scryptSync(String(pin) + '|' + PEPPER, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function bangNhau(a, b) {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
// Đọc claim của JWT — CHỈ gọi sau khi /auth/v1/user đã xác nhận token hợp lệ (chữ ký do Supabase kiểm).
function claim(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) || {}; }
  catch (e) { return {}; }
}
function vuaDungMatKhau(c) {
  const now = Math.floor(Date.now() / 1000);
  return (c.amr || []).some(a => a && a.method === 'password' && now - Number(a.timestamp || 0) <= MAT_KHAU_MOI_GIAY);
}
const pinHopLe = p => /^\d{6}$/.test(String(p || ''));
const uuid = s => /^[0-9a-f-]{36}$/i.test(String(s || ''));
const thieuBang = e => /42P01|does not exist|schema cache|PGRST205/i.test(String(e && e.message));

// Mở khoá PIN cho ĐÚNG phiên đăng nhập này (bảng user_pin_mo — SQL PHẦN 41). Chưa có bảng thì bỏ qua (cổng RLS cũng chưa có).
async function moPhien(uid, sid) {
  if (!uuid(sid)) return;
  try {
    await supa('user_pin_mo?on_conflict=session_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ session_id: sid, user_id: uid, mo_den: new Date(Date.now() + MO_GIO * 3600e3).toISOString() }) });
  } catch (e) { if (!thieuBang(e)) throw e; }
}
async function phienDangMo(sid) {
  if (!uuid(sid)) return false;
  try { const r = await supa('user_pin_mo?session_id=eq.' + sid + '&mo_den=gt.' + encodeURIComponent(new Date().toISOString()) + '&select=session_id', { method: 'GET' }); return !!(r && r.length); }
  catch (e) { return false; }
}

const xuLy = async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ ready: !!SERVICE_KEY });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận GET hoặc POST' });
  if (!SERVICE_KEY) return res.status(503).json({ error: 'chua_cau_hinh' });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Thiếu phiên đăng nhập' });
  let b;
  try { b = await doc(req); } catch (e) { return res.status(400).json({ error: e.message }); }

  const rMe = await fetch(SUPA_URL + '/auth/v1/user', { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token } });
  if (!rMe.ok) return res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });
  const me = await rMe.json();
  if (!me || !me.id) return res.status(401).json({ error: 'Không xác định được người gọi' });
  const c = claim(token), sid = c.session_id;
  const uid = encodeURIComponent(me.id);
  const doc1 = async () => ((await supa('user_pin?user_id=eq.' + uid + '&select=hash,salt,so_sai,khoa', { method: 'GET' })) || [])[0] || null;
  let row;
  try { row = await doc1(); }
  catch (e) { if (thieuBang(e)) return res.status(503).json({ error: 'chua_cau_hinh' }); throw e; }

  const action = String(b.action || '');
  // datLai: admin cấp lại mật khẩu đã khoá PIN (khoá với so_sai = 0; khoá do sai 5 lần thì so_sai = 5)
  if (action === 'trang_thai') return res.status(200).json({ coPin: !!row, khoa: !!(row && row.khoa), datLai: !!(row && row.khoa && !Number(row.so_sai)), mo: !!row && !row.khoa && await phienDangMo(sid) });

  if (action === 'kiem') {
    if (!pinHopLe(b.pin)) return res.status(400).json({ error: 'PIN phải đủ 6 số' });
    // Giành MỘT lượt thử (tăng so_sai có điều kiện) TRƯỚC khi so PIN — dùng chung lib/pin-kiem.js với cổng ký số.
    const k = await kiemPin(me.id, b.pin);
    if (k.banTranh) return res.status(429).json({ error: 'Đang có nhiều lần thử cùng lúc — thử lại sau ít giây' });
    if (k.dung) { await moPhien(me.id, sid); return res.status(200).json({ dung: true }); }
    return res.status(200).json(k);
  }

  if (action === 'dat') {
    if (!pinHopLe(b.pin)) return res.status(400).json({ error: 'PIN phải đủ 6 số' });
    if (row && !vuaDungMatKhau(c)) return res.status(403).json({ error: 'can_mat_khau' });
    const salt = crypto.randomBytes(16).toString('hex');
    await supa('user_pin?on_conflict=user_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: me.id, hash: bam(b.pin, salt), salt, so_sai: 0, khoa: false, cap_nhat: new Date().toISOString() }),
    });
    await moPhien(me.id, sid);
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: 'action không hợp lệ' });
};
module.exports = bocLoi('pin', xuLy);
