// api/ky.js — KÝ SỐ PHIẾU ĐIỀU CHUYỂN (26/11/2026, đem từ cách app BCSX-SKB ký phiếu nhập về app Kiểm kê).
//
// Một chữ ký trả lời ba câu hỏi:
//   AI KÝ     — người đăng nhập (mật khẩu) + nhập lại mã PIN ngay lúc ký (máy chủ kiểm, sai 5 lần là khoá như mở app);
//               chữ ký mang họ tên + mã NV + email công ty theo DANH BẠ và nét chữ ký vẽ tay (bảng chu_ky_mau, bất biến).
//   KÝ CÁI GÌ — mã băm SHA-256 nội dung phiếu (lib/chu-ky-dc.js), MÁY CHỦ tự tính từ phiếu trong CSDL — trình duyệt không tự khai.
//   KÝ LÚC NÀO — giờ máy chủ.
// Chỉ cổng này (khoá service role) ghi được cột transfer_requests.chu_ky — trigger SQL PHẦN 48 chặn mọi đường khác.
//
// POST, Authorization: Bearer <phiên>, body { id, vai, pin, qty? }   — hoặc { action:'luu_mau', net, rong, cao, ten, pin? }
//   vai: 'lap' | 'giao' | 'nhan' | 'duyet'  — qty {mã:số} bắt buộc cho ô ký lúc DUYỆT/NHẬN (giao xin, nhan hàng dư, duyet hủy)
// Trả { ok:true, chuKy } | { loi:'<mã>', ... }  (mã lỗi để app nói thành câu nghiệp vụ)
const { bocLoi } = require('../lib/ghi-loi');
const { kiemPin, supa } = require('../lib/pin-kiem');
const { noiDungDC, soCuaO, bamSha256 } = require('../lib/chu-ky-dc');

const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const VAI = ['lap', 'giao', 'nhan', 'duyet'];

function doc(req) {
  return new Promise((res, rej) => {
    if (req.body && typeof req.body === 'object') return res(req.body);
    let s = '';
    req.on('data', c => { s += c; if (s.length > 2e5) req.destroy(); });
    req.on('end', () => { try { res(s ? JSON.parse(s) : {}); } catch (e) { rej(new Error('Body không phải JSON')); } });
    req.on('error', rej);
  });
}
const enc = encodeURIComponent;

const xuLy = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận POST' });
  if (!SERVICE_KEY) return res.status(503).json({ loi: 'chua_cau_hinh' });
  const tk = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!/^eyJ/.test(tk)) return res.status(401).json({ loi: 'het_phien' });
  let b;
  try { b = await doc(req); } catch (e) { return res.status(400).json({ loi: 'du_lieu', error: e.message }); }
  const rMe = await fetch(SUPA_URL + '/auth/v1/user', { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + tk } });
  if (!rMe.ok) return res.status(401).json({ loi: 'het_phien' });
  const me = await rMe.json();
  if (!me || !/^[0-9a-f-]{36}$/i.test(String(me.id || ''))) return res.status(401).json({ loi: 'het_phien' });

  // CHỮ KÝ MẪU (Khoa 26/11/2026): gắn theo tài khoản; vẽ lần đầu không hỏi PIN (vừa nhập PIN vào app), VẼ LẠI phải nhập
  // đúng PIN. Mẫu cũ KHÔNG xoá — phiếu đã ký vẫn phải hiện đúng nét ký lúc đó; mẫu mới nhất là mẫu dùng từ nay.
  if (b.action === 'luu_mau') {
    const net = String(b.net || ''), ten = String(b.ten || '').trim().slice(0, 120);
    const rong = Math.round(Number(b.rong) || 0), cao = Math.round(Number(b.cao) || 0);
    if (!/^[ML0-9. -]+$/.test(net) || net.length < 20 || net.length > 60000 || rong < 50 || rong > 2000 || cao < 30 || cao > 1000)
      return res.status(400).json({ loi: 'mau_khong_hop_le' });
    const cu = ((await supa('chu_ky_mau?user_id=eq.' + me.id + '&select=id&limit=1', { method: 'GET' })) || [])[0];
    if (cu) {
      const k = await kiemPin(me.id, b.pin);
      if (k.saiDang) return res.status(400).json({ loi: 'pin_sai_dang' });
      if (k.banTranh) return res.status(429).json({ loi: 'ban_tranh' });
      if (!k.dung) return res.status(403).json(k.khoa ? { loi: 'pin_khoa' } : k.chuaCo ? { loi: 'pin_chua_co' } : { loi: 'pin_sai', conLai: k.conLai });
    }
    const d = new Date(Date.now() + 7 * 3600e3), h = n => String(n).padStart(2, '0');
    const idMau = me.id + '_' + d.getUTCFullYear() + h(d.getUTCMonth() + 1) + h(d.getUTCDate()) + h(d.getUTCHours()) + h(d.getUTCMinutes()) + h(d.getUTCSeconds());
    const pf0 = ((await supa('profiles?id=eq.' + me.id + '&select=full_name,ma_nv', { method: 'GET' })) || [])[0] || {};
    const dong = { id: idMau, user_id: me.id, ten: ten || pf0.full_name || '', ma_nv: pf0.ma_nv || null, net, rong, cao,
      bam: bamSha256((ten || pf0.full_name || '') + '|' + net) };
    await supa('chu_ky_mau', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(dong) });
    return res.status(200).json({ ok: true, mau: dong });
  }
  const id = String(b.id || '').trim(), vai = String(b.vai || '');
  if (!id || id.length > 80 || !VAI.includes(vai)) return res.status(400).json({ loi: 'du_lieu' });

  // 1. Người ký: tài khoản đang hoạt động, đã gắn danh bạ, đã có chữ ký mẫu
  const pf = ((await supa('profiles?id=eq.' + me.id + '&select=full_name,role,status,ma_nv', { method: 'GET' })) || [])[0];
  if (!pf || pf.status !== 'active') return res.status(403).json({ loi: 'khong_hoat_dong' });
  if (!pf.ma_nv) return res.status(409).json({ loi: 'chua_gan_danh_ba' });
  const ns = ((await supa('nhan_su?ma_nv=eq.' + enc(pf.ma_nv) + '&select=ma_nv,ho_ten,email_cty', { method: 'GET' })) || [])[0];
  if (!ns) return res.status(409).json({ loi: 'chua_gan_danh_ba' });
  const mau = ((await supa('chu_ky_mau?user_id=eq.' + me.id + '&select=id&order=id.desc&limit=1', { method: 'GET' })) || [])[0];
  if (!mau) return res.status(409).json({ loi: 'chua_co_mau' });

  // 2. Phiếu + quyền ký đúng ô
  const r0 = ((await supa('transfer_requests?id=eq.' + enc(id) + '&select=id,kind,from_plant,from_sloc,to_plant,to_sloc,items,status,chu_ky', { method: 'GET' })) || []);
  if (r0.length !== 1) return res.status(404).json({ loi: r0.length ? 'trung_ma' : 'khong_co_phieu' });
  const row = r0[0];
  const r = { id: row.id, kind: row.kind, fromPlant: row.from_plant, fromSloc: row.from_sloc, toPlant: row.to_plant, toSloc: row.to_sloc };
  const ck = row.chu_ky || {}, items = row.items || {};
  const laAdmin = pf.role === 'admin', laKT = ['admin', 'ketoan_vien'].includes(pf.role);
  const up = (await supa('user_plants?user_id=eq.' + me.id + '&select=plant_code,sloc_code', { method: 'GET' })) || [];
  const cua = (p, s) => !!p && up.some(u => u.plant_code === p && (!u.sloc_code || u.sloc_code === s));
  const benLap = r.kind === 'xin' ? cua(r.toPlant, r.toSloc) : cua(r.fromPlant, r.fromSloc);
  let ok = false, canTrangThai = 'Chờ duyệt';
  if (vai === 'lap') ok = (laAdmin || benLap) && !ck.lap;
  else if (vai === 'giao') ok = ['xin', 'day'].includes(r.kind) && (laAdmin || cua(r.fromPlant, r.fromSloc));
  else if (vai === 'duyet') ok = r.kind === 'huy' && laKT;
  else if (vai === 'nhan') {
    if (r.kind === 'du') ok = laAdmin || cua(r.toPlant, r.toSloc);
    else if (r.kind === 'xin') { ok = (laAdmin || cua(r.toPlant, r.toSloc)) && !ck.nhan; canTrangThai = 'Đã duyệt'; }
  }
  if (!ok) return res.status(403).json({ loi: vai === 'lap' && ck.lap ? 'da_ky' : vai === 'nhan' && ck.nhan ? 'da_ky' : 'khong_quyen' });
  if (row.status !== canTrangThai) return res.status(409).json({ loi: 'sai_trang_thai', trangThai: row.status });
  // Một người không ký hai ô đối nhau của cùng phiếu (bên giao ≠ bên nhận / người lập ≠ người duyệt)
  const doiNhau = { giao: ['lap', 'nhan'], duyet: ['lap'], nhan: r.kind === 'du' ? ['lap'] : ['giao'], lap: ['giao', 'duyet'] }[vai] || [];
  if (!laAdmin && doiNhau.some(k => ck[k] && ck[k].uid === me.id)) return res.status(409).json({ loi: 'cung_nguoi' });
  // Nội dung lúc lập phải còn nguyên (không ai sửa số xin sau khi người lập ký)
  if (vai !== 'lap' && ck.lap && bamSha256(noiDungDC(r, 'lap', soCuaO(items, 'lap'))) !== ck.lap.bam) return res.status(409).json({ loi: 'noi_dung_doi' });

  // 3. Số đem ký
  let qty;
  if (vai === 'lap' || (vai === 'nhan' && r.kind === 'xin')) qty = soCuaO(items, vai === 'lap' ? 'lap' : 'giao');
  else {
    qty = {};
    const vao = b.qty || {};
    for (const c of Object.keys(items)) {
      const q = Number(vao[c] != null ? vao[c] : 0);
      if (!isFinite(q) || q < 0 || q > (Number(items[c].qtyReq) || 0) + 1e-9) return res.status(400).json({ loi: 'so_vuot', ma: c });
      qty[c] = q;
    }
    if (!Object.values(qty).some(q => q > 0)) return res.status(400).json({ loi: 'so_rong' });
  }

  // 4. PIN — kiểm SAU các bước trên để bấm nhầm phiếu không mất lượt thử
  const k = await kiemPin(me.id, b.pin);
  if (k.saiDang) return res.status(400).json({ loi: 'pin_sai_dang' });
  if (k.banTranh) return res.status(429).json({ loi: 'ban_tranh' });
  if (!k.dung) return res.status(403).json(k.khoa ? { loi: 'pin_khoa' } : k.chuaCo ? { loi: 'pin_chua_co' } : { loi: 'pin_sai', conLai: k.conLai });

  // 5. Ghi chữ ký — có điều kiện trạng thái, người khác vừa xử lý thì 0 dòng
  const sig = { vai, uid: me.id, ten: ns.ho_ten || pf.full_name || '', maNv: ns.ma_nv, emailCty: ns.email_cty || '',
    chuKyId: mau.id, bam: bamSha256(noiDungDC(r, vai, qty)), luc: new Date().toISOString(), xacThuc: 'MATKHAU+PIN' };
  const moi = Object.assign({}, ck, { [vai]: sig });
  const w = await supa('transfer_requests?id=eq.' + enc(id) + '&status=eq.' + enc(canTrangThai) + '&select=id', {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ chu_ky: moi }) });
  if (!Array.isArray(w) || !w.length) return res.status(409).json({ loi: 'sai_trang_thai' });
  return res.status(200).json({ ok: true, chuKy: moi });
};
// Chưa chạy SQL PHẦN 48 (thiếu bảng chu_ky_mau / cột chu_ky) -> báo 'chua_bat' để app duyệt như cũ, không kẹt phiếu.
const boc = async (req, res) => {
  try { return await xuLy(req, res); }
  catch (e) {
    if (/42P01|42703|does not exist|schema cache|PGRST20[45]/i.test(String(e && e.message))) return res.status(503).json({ loi: 'chua_bat' });
    throw e;
  }
};
module.exports = bocLoi('ky', boc);
