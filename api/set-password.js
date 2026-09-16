// api/set-password.js — Vercel serverless: ADMIN CẤP LẠI MẬT KHẨU cho người dùng.
//
// Vì sao phải làm ở máy chủ: đổi mật khẩu người khác cần SERVICE ROLE KEY của
// Supabase — khóa đó mở được mọi bảng, bỏ qua mọi quyền RLS. Để nó trong
// index.html thì ai bấm "xem mã nguồn trang" cũng lấy được, coi như mất sạch
// dữ liệu. Nên khóa chỉ nằm trong biến môi trường Vercel, client không thấy.
//
// LUỒNG KIỂM QUYỀN (không được bỏ bước nào):
//   1. Client gửi access_token của phiên đang đăng nhập.
//   2. Máy chủ hỏi Supabase token đó là ai — KHÔNG tin client tự khai mình là admin.
//   3. Đọc bảng profiles xem người đó có đúng role='admin' và status='active' không.
//   4. Đạt hết mới đổi mật khẩu.
//
// Client gửi POST:
//   Headers: Authorization: Bearer <access_token>
//   Body: { userId, password }
// Trả: { ok:true, email } hoặc { error }

const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function doc(req) {
  return new Promise((res, rej) => {
    if (req.body && typeof req.body === 'object') return res(req.body);
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { res(s ? JSON.parse(s) : {}); } catch (e) { rej(new Error('Body không phải JSON')); } });
    req.on('error', rej);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    // để kiểm nhanh máy chủ đã cấu hình khóa chưa, KHÔNG trả về khóa
    return res.status(200).json({ ready: !!SERVICE_KEY });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận GET hoặc POST' });
  if (!SERVICE_KEY) {
    return res.status(503).json({ error: 'Máy chủ chưa cấu hình SUPABASE_SERVICE_ROLE_KEY. Admin đặt biến này trên Vercel rồi Redeploy.' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Thiếu phiên đăng nhập' });

  let b;
  try { b = await doc(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  const userId = String(b.userId || '').trim();
  const password = String(b.password || '');
  if (!userId) return res.status(400).json({ error: 'Thiếu userId' });
  if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });

  try {
    // --- Bước 2: token này là ai? Hỏi Supabase, không tin client ---
    const rMe = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token },
    });
    if (!rMe.ok) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' });
    const me = await rMe.json();
    if (!me || !me.id) return res.status(401).json({ error: 'Không xác định được người gọi' });

    // --- Bước 3: người đó có phải admin đang hoạt động không? ---
    const rProf = await fetch(
      SUPA_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(me.id) + '&select=role,status,full_name',
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
    const prof = rProf.ok ? await rProf.json() : [];
    const p = Array.isArray(prof) ? prof[0] : null;
    if (!p || p.role !== 'admin' || p.status !== 'active') {
      return res.status(403).json({ error: 'Chỉ quản trị viên mới cấp lại được mật khẩu' });
    }

    // --- Bước 4: đổi mật khẩu ---
    const rSet = await fetch(SUPA_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
      method: 'PUT',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password }),
    });
    const kq = await rSet.json().catch(() => ({}));
    if (!rSet.ok) {
      return res.status(rSet.status).json({ error: (kq && (kq.msg || kq.message || kq.error_description)) || 'Supabase từ chối đổi mật khẩu' });
    }

    // Ghi nhật ký để còn truy được ai cấp lại cho ai
    try {
      await fetch(SUPA_URL + '/rest/v1/audit_log', {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_name: p.full_name || me.email || 'admin',
          role: 'admin',
          action: 'Cấp lại mật khẩu',
          detail: 'Cho tài khoản: ' + (kq.email || userId),
        }),
      });
    } catch (e) { /* ghi log hỏng thì thôi, không chặn việc chính */ }

    return res.status(200).json({ ok: true, email: kq.email || '' });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || 'Lỗi không rõ' });
  }
};
