// api/nhan-su.js — Vercel serverless: NHẬN DANH BẠ MYSUN từ agent trên máy kế toán (16/11/2026).
//
// Agent (file .py chạy mỗi tuần trên máy Khoa) đọc danh bạ MySun, CHỈ địa điểm "Vp Bà Nà", rồi gửi lên đây.
// Khóa service role của Supabase chỉ nằm ở biến môi trường Vercel — máy chạy agent không giữ khóa đó.
//
// Kiểm quyền: header `x-agent-key` phải trùng biến môi trường NHAN_SU_AGENT_KEY.
// Body: { records:[{ma_nv,ho_ten,email_cty,sdt,bo_phan,chuc_danh,cap_do}], tong }
// Trả:  { ok, moi, capNhat, ngung, conLam }
//
// Chặn xóa nhầm: nếu lần này kéo được ÍT HƠN 70% số người đang làm trong bảng (MySun lỗi, kéo dở trang...)
// thì KHÔNG đánh dấu ai nghỉ việc, chỉ thêm / cập nhật.

const { bocLoi } = require('../lib/ghi-loi');
const crypto = require('crypto');
const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const AGENT_KEY = (process.env.NHAN_SU_AGENT_KEY || '').trim();
const TRUONG = ['ma_nv', 'ho_ten', 'email_cty', 'sdt', 'bo_phan', 'chuc_danh', 'cap_do'];

function doc(req) {
  return new Promise((res, rej) => {
    if (req.body && typeof req.body === 'object') return res(req.body);
    let s = '';
    req.on('data', c => { s += c; if (s.length > 4e6) req.destroy(); });
    req.on('end', () => { try { res(s ? JSON.parse(s) : {}); } catch (e) { rej(new Error('Body không phải JSON')); } });
    req.on('error', rej);
  });
}
function bangNhau(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function sach(r) {
  const o = {};
  TRUONG.forEach(k => { const v = r && r[k] != null ? String(r[k]).trim().slice(0, 300) : ''; o[k] = v || null; });
  // Sơ đồ vị trí: chuỗi quản lý (tối đa 15 cấp), chỉ 4 trường chữ/số
  const ql = Array.isArray(r && r.quan_ly) ? r.quan_ly.slice(0, 15).map(m => ({
    ma_nv: String((m && m.ma_nv) || '').slice(0, 20), ho_ten: String((m && m.ho_ten) || '').slice(0, 120),
    chuc_danh: String((m && m.chuc_danh) || '').slice(0, 160), so_duoi: Number(m && m.so_duoi) || 0,
  })) : null;
  o.quan_ly = ql;
  o.so_cap_duoi = r && r.so_cap_duoi != null ? Number(r.so_cap_duoi) || 0 : null;
  return o;
}
const khac = (c, r) => TRUONG.some(k => (c[k] || null) !== r[k])
  || JSON.stringify(c.quan_ly || null) !== JSON.stringify(r.quan_ly || null)
  || (c.so_cap_duoi == null ? null : Number(c.so_cap_duoi)) !== r.so_cap_duoi;
async function supa(path, opt) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + path, Object.assign({}, opt, {
    headers: Object.assign({ apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' }, (opt && opt.headers) || {}),
  }));
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}

// TỰ GẮN tài khoản app với nhân viên (Khoa 16/11/2026): email trùng email công ty, hoặc họ tên trùng tuyệt đối với
// ĐÚNG MỘT người đang làm. Không gắn chồng lên nhân viên đã gắn với tài khoản khác. Cùng luật với nsGoiY() ở app.
function vnNorm(x) {
  return String(x == null ? '' : x).normalize('NFD').toLowerCase()
    .replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, '');
}
// Họ tên phải trùng ĐÚNG CẢ DẤU (chỉ bỏ hoa/thường và khoảng trắng thừa): "Lê Thị Ly" ≠ "Lê Thị Lý".
function tenChuan(x) { return String(x == null ? '' : x).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim(); }
async function tuGan() {
  const pf = await supa('profiles?select=id,full_name,email,ma_nv,status', { method: 'GET' });
  const ns = (await supa('nhan_su?select=ma_nv,ho_ten,email_cty&dang_lam=eq.true', { method: 'GET' })) || [];
  const daDung = new Set((pf || []).filter(p => p.ma_nv).map(p => String(p.ma_nv)));
  const theoEmail = new Map(), theoTen = new Map();
  ns.forEach(r => {
    const e = String(r.email_cty || '').toLowerCase().trim();
    if (e) theoEmail.set(e, theoEmail.has(e) ? null : r.ma_nv);
    const t = tenChuan(r.ho_ten);
    if (t) theoTen.set(t, theoTen.has(t) ? null : r.ma_nv);
  });
  let n = 0;
  for (const p of (pf || [])) {
    if (p.ma_nv || p.status !== 'active') continue;
    const ma = theoEmail.get(String(p.email || '').toLowerCase().trim()) || theoTen.get(tenChuan(p.full_name)) || null;
    if (!ma || daDung.has(String(ma))) continue;
    await supa('profiles?id=eq.' + encodeURIComponent(p.id) + '&ma_nv=is.null', {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ma_nv: ma }),
    });
    daDung.add(String(ma)); n++;
  }
  return n;
}

const xuLy = async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ ready: !!(SERVICE_KEY && AGENT_KEY) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận GET hoặc POST' });
  if (!SERVICE_KEY || !AGENT_KEY) return res.status(503).json({ error: 'Máy chủ chưa cấu hình NHAN_SU_AGENT_KEY / SUPABASE_SERVICE_ROLE_KEY' });
  if (!bangNhau(req.headers['x-agent-key'] || '', AGENT_KEY)) return res.status(401).json({ error: 'Sai khóa agent' });

  let b;
  try { b = await doc(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  const ds = (Array.isArray(b.records) ? b.records : []).map(sach).filter(r => r.ma_nv && r.ho_ten);
  if (!ds.length) return res.status(400).json({ error: 'Không có nhân sự hợp lệ' });
  if (Number(b.tong) && ds.length !== Number(b.tong)) return res.status(400).json({ error: `Kéo chưa đủ: ${ds.length}/${b.tong} người — không ghi` });
  const theoMa = new Map(ds.map(r => [r.ma_nv, r]));

  try {
    let cu;
    try { cu = await supa('nhan_su?select=' + TRUONG.join(',') + ',quan_ly,so_cap_duoi,dang_lam,nguon', { method: 'GET' }); }
    catch (e) { cu = await supa('nhan_su?select=' + TRUONG.join(',') + ',quan_ly,so_cap_duoi,dang_lam', { method: 'GET' }); }
    // Hồ sơ admin KHAI TAY (nguon='app', VD kế toán ngoài MySun) không thuộc danh bạ MySun: không cập nhật, không đánh dấu nghỉ.
    cu = (cu || []).filter(r => (r.nguon || 'mysun') !== 'app');
    const cuMap = new Map((cu || []).map(r => [r.ma_nv, r]));
    let moi = 0, capNhat = 0;
    const ghi = [];
    theoMa.forEach((r, ma) => {
      const c = cuMap.get(ma);
      if (!c) { moi++; ghi.push(r); return; }
      if (!c.dang_lam || khac(c, r)) { capNhat++; ghi.push(r); }
    });
    const now = new Date().toISOString();
    for (let i = 0; i < ghi.length; i += 500) {
      await supa('nhan_su?on_conflict=ma_nv', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(ghi.slice(i, i + 500).map(r => Object.assign({}, r, { dang_lam: true, cap_nhat_luc: now }))),
      });
    }
    const dangLamCu = (cu || []).filter(r => r.dang_lam).map(r => r.ma_nv);
    const vang = dangLamCu.filter(m => !theoMa.has(m));
    let ngung = 0, boQuaNgung = false;
    if (vang.length && dangLamCu.length && theoMa.size < dangLamCu.length * 0.7) boQuaNgung = true;
    else {
      for (let i = 0; i < vang.length; i += 100) {
        const nhom = vang.slice(i, i + 100).map(m => '"' + m.replace(/"/g, '') + '"').join(',');
        await supa('nhan_su?ma_nv=in.(' + encodeURIComponent(nhom) + ')', {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ dang_lam: false, cap_nhat_luc: now }),
        });
        ngung += vang.slice(i, i + 100).length;
      }
    }
    let daGan = 0, loiGan = '';
    try { daGan = await tuGan(); } catch (e) { loiGan = String(e.message || e).slice(0, 200); }
    return res.status(200).json({ ok: true, moi, capNhat, ngung, boQuaNgung, conLam: theoMa.size, daGan, loiGan });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e).slice(0, 400) });
  }
};
module.exports = bocLoi('nhan-su', xuLy);
