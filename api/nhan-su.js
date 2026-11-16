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
  return o;
}
async function supa(path, opt) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + path, Object.assign({}, opt, {
    headers: Object.assign({ apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' }, (opt && opt.headers) || {}),
  }));
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}

module.exports = async (req, res) => {
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
    const cu = await supa('nhan_su?select=' + TRUONG.join(',') + ',dang_lam', { method: 'GET' });
    const cuMap = new Map((cu || []).map(r => [r.ma_nv, r]));
    let moi = 0, capNhat = 0;
    const ghi = [];
    theoMa.forEach((r, ma) => {
      const c = cuMap.get(ma);
      if (!c) { moi++; ghi.push(r); return; }
      if (!c.dang_lam || TRUONG.some(k => (c[k] || null) !== r[k])) { capNhat++; ghi.push(r); }
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
    return res.status(200).json({ ok: true, moi, capNhat, ngung, boQuaNgung, conLam: theoMa.size });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e).slice(0, 400) });
  }
};
