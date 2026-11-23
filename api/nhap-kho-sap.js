// api/nhap-kho-sap.js — Vercel serverless: NHẬN SỐ NHẬP KHO TỪ SAP (agent ZSMMQ002 trên máy kế toán) — 20/11/2026.
//
// Khoa chốt: số SAP là CHUẨN, cộng thẳng vào Nhập kho (bảng receipts). Ảnh BP quét chỉ còn để ĐỐI CHIẾU:
// khớp thì bỏ qua, lệch thì BP chọn số thực nhận (app sửa qty, giữ sap_sl = số SAP gốc).
//
// Kiểm quyền: header  Authorization: Bearer <NHAP_KHO_AGENT_KEY>   (biến môi trường Vercel).
// Body JSON: { target_date, data_hash, batch_index, total_batches, records:[…] } (đúng gói agent sap_zsmmq002_sync.py gửi;
//   nhận cả { rows:[…] }) — tối đa 1.000 dòng / lần (agent gửi lô 200). Tên trường agent (snake_case) trong ngoặc vuông:
// Mỗi dòng (nhận tên trường tiếng Việt, tên agent [snake_case], hoặc tên cột SAP gốc):
//   so_ct   [material_document]      số chứng từ SAP              — bắt buộc
//   dong    [material_doc_item]      dòng trong chứng từ           — mặc định "0"
//   nam     [material_doc_year]     năm chứng từ                  — mặc định năm của ngày
//   ngay    [posting_date]           yyyy-mm-dd hoặc dd/mm/yyyy    — bắt buộc
//   plant   [receiving_plant]        plant KHO NHẬN (điểm bán)     — bắt buộc
//   sloc    [receiving_sloc]   sloc KHO NHẬN                 — bắt buộc
//   ma      [material]               mã vật tư                     — bắt buộc
//   ten     [material_description]   tên vật tư
//   dvt     [unit]          đơn vị tính
//   sl      [qty_in]   số lượng NHẬN (dương = hàng vào kho; âm = hàng trả lại, VD Z56) — khác 0
//   loai    [movement_type]          Z55 / Z56 …
//   ghi_chu [header_text]   diễn giải
// Trả: { ok, nhan, moi, capNhat, khongDoi, giuSoBP, boQua:[{i,so_ct,ma,lyDo}], doiChieu:{khop,lech} }
//
// CHỐNG NẠP TRÙNG: id dòng = SAP-<năm>-<số CT>-<dòng>-<mã>-<plant><sloc> → agent đẩy lại cùng dữ liệu bao nhiêu lần
// cũng không nhân đôi. SAP sửa số (đảo chứng từ…) thì dòng được cập nhật — TRỪ khi BP đã chọn số thực nhận khác số SAP
// (qty ≠ sap_sl cũ): khi đó giữ số BP, chỉ cập nhật sap_sl và báo trong "giuSoBP".
// KỲ ĐÃ DUYỆT KIỂM KÊ: dòng rơi vào kho + kỳ đã duyệt biên bản thì KHÔNG ghi (đổi số Xuất của biên bản đã ký) — báo boQua.

const { bocLoi } = require('../lib/ghi-loi');
const crypto = require('crypto');
const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const AGENT_KEY = (process.env.NHAP_KHO_AGENT_KEY || '').trim();
const TOI_DA = 1000;
const KY_MOC_YMD = 20260926, KY_NGAY_CHOT = 25;   // giống hệt index.html (kyCuaYmd)

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
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
async function supa(path, opt) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + path, Object.assign({}, opt, {
    headers: Object.assign({ apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' }, (opt && opt.headers) || {}),
  }));
  const t = await r.text();
  if (!r.ok) throw Object.assign(new Error('Supabase ' + r.status + ': ' + t.slice(0, 300)), { st: r.status, body: t });
  return t ? JSON.parse(t) : null;
}
const p2 = n => String(n).padStart(2, '0');
const chu = (v, n) => v == null ? '' : String(v).trim().slice(0, n || 200);
function lay(r, ...k) { for (const x of k) if (r && r[x] != null && String(r[x]).trim() !== '') return r[x]; return null; }

// Ngày: Date ISO / yyyy-mm-dd / dd/mm/yyyy / dd.mm.yyyy / số sê-ri Excel → 'yyyy-mm-dd' (kiểm lịch thật), sai → null
function ngayIso(v) {
  if (v == null || v === '') return null;
  let y, m, d;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); }
  else {
    const s = String(v).trim();
    let k = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (k) { y = +k[1]; m = +k[2]; d = +k[3]; }
    else if ((k = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(s))) { d = +k[1]; m = +k[2]; y = +k[3]; }
    else if ((k = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) { y = +k[1]; m = +k[2]; d = +k[3]; }
    else return null;
  }
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || y < 2020 || y > 2100) return null;
  return y + '-' + p2(m) + '-' + p2(d);
}
function kyCua(iso) {
  let [y, m, d] = iso.split('-').map(Number);
  if (y * 10000 + m * 100 + d >= KY_MOC_YMD && d > KY_NGAY_CHOT) { m++; if (m > 12) { m = 1; y++; } }
  return y + '-' + p2(m);
}
function soLuong(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).trim().replace(/\s/g, '');
  if (!s) return NaN;
  // SAP xuất số dạng 1,500.25 hoặc -729.33 → bỏ dấu phẩy ngăn nghìn, dấu chấm là thập phân (đúng quy ước app)
  return Number(s.replace(/,/g, ''));
}
function chuanHoa(r) {
  const ngay = ngayIso(lay(r, 'ngay', 'posting_date', 'Posting Date'));
  const so_ct = chu(lay(r, 'so_ct', 'material_document', 'Material Document'), 30);
  const dong = chu(lay(r, 'dong', 'material_doc_item', 'Material Doc.Item') ?? '0', 10) || '0';
  const nam = chu(lay(r, 'nam', 'material_doc_year', 'Material Doc. Year'), 4) || (ngay ? ngay.slice(0, 4) : '');
  const plant = chu(lay(r, 'plant', 'receiving_plant', 'Receiving plant'), 10);
  const sloc = chu(lay(r, 'sloc', 'receiving_sloc', 'Receiving stor. loc.'), 10);
  const ma = chu(lay(r, 'ma', 'material', 'Material'), 30);
  return {
    so_ct, dong, nam, ngay, plant, sloc, ma,
    ten: chu(lay(r, 'ten', 'material_description', 'Material Description'), 200),
    dvt: chu(lay(r, 'dvt', 'unit', 'Unit of Entry'), 20),
    sl: soLuong(lay(r, 'sl', 'qty_in', 'Qty in unit of entry')),
    loai: chu(lay(r, 'loai', 'movement_type', 'Movement Type'), 10),
    ghi_chu: chu(lay(r, 'ghi_chu', 'header_text', 'Document Header Text'), 160),
  };
}
const MA_OK = /^[0-9A-Za-z._\-]{2,30}$/;
const KHO_OK = /^[0-9A-Za-z]{1,10}$/;
const enc = s => encodeURIComponent(s);
const inList = a => '(' + a.map(x => '"' + String(x).replace(/"/g, '') + '"').join(',') + ')';

const xuLy = async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ ready: !!(SERVICE_KEY && AGENT_KEY), toiDa: TOI_DA });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận GET hoặc POST' });
  if (!SERVICE_KEY || !AGENT_KEY) return res.status(503).json({ error: 'Máy chủ chưa cấu hình NHAP_KHO_AGENT_KEY / SUPABASE_SERVICE_ROLE_KEY' });
  const auth = String(req.headers.authorization || '');
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(req.headers['x-agent-key'] || '').trim();
  if (!tok || !bangNhau(tok, AGENT_KEY)) return res.status(401).json({ error: 'Sai khóa agent' });

  let b;
  try { b = await doc(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  // Gói của agent sap_zsmmq002_sync.py: { target_date, data_hash, batch_index, total_batches, records:[…] }
  const rows = Array.isArray(b) ? b : (b && Array.isArray(b.records) ? b.records : (b && Array.isArray(b.rows) ? b.rows : null));
  if (!rows) return res.status(400).json({ error: 'Thiếu mảng records' });
  if (rows.length > TOI_DA) return res.status(413).json({ error: 'Quá ' + TOI_DA + ' dòng một lần — chia lô nhỏ hơn' });
  const nguon = chu(b && b.nguon, 20) || 'ZSMMQ002';

  // ---- 1. Chuẩn hoá + kiểm từng dòng
  const boQua = [], hop = [];
  rows.forEach((r0, i) => {
    const r = chuanHoa(r0);
    const bo = lyDo => boQua.push({ i, so_ct: r.so_ct, ma: r.ma, lyDo });
    if (!r.so_ct) return bo('thiếu số chứng từ');
    if (!r.ngay) return bo('ngày không đọc được');
    if (!KHO_OK.test(r.plant) || !KHO_OK.test(r.sloc)) return bo('thiếu / sai plant hoặc sloc kho nhận');
    if (!MA_OK.test(r.ma)) return bo('mã vật tư không hợp lệ');
    if (!isFinite(r.sl) || r.sl === 0) return bo('số lượng không hợp lệ hoặc bằng 0');
    r.id = ('SAP-' + r.nam + '-' + r.so_ct + '-' + r.dong + '-' + r.ma + '-' + r.plant + r.sloc).slice(0, 120);
    r.ky = kyCua(r.ngay);
    r.i = i;
    hop.push(r);
  });
  // Trùng id trong cùng lô: cộng dồn (SAP đôi khi tách lô cùng dòng) — giữ một dòng
  const theoId = new Map();
  hop.forEach(r => { const c = theoId.get(r.id); if (c) c.sl = Math.round((c.sl + r.sl) * 1e6) / 1e6; else theoId.set(r.id, r); });
  let ds = [...theoId.values()];
  if (!ds.length) return res.status(200).json({ ok: true, nhan: rows.length, moi: 0, capNhat: 0, khongDoi: 0, giuSoBP: [], boQua, doiChieu: { khop: 0, lech: 0 } });

  // ---- 2. Kho phải có trên máy chủ (bảng slocs) — kho lạ thì không ghi, báo lại để thêm kho trước
  const khoCan = [...new Set(ds.map(r => r.plant))];
  const slocs = await supa('slocs?select=plant_code,sloc_code&plant_code=in.' + enc(inList(khoCan)), { method: 'GET' });
  const coKho = new Set((slocs || []).map(x => x.plant_code + '|' + x.sloc_code));
  ds = ds.filter(r => coKho.has(r.plant + '|' + r.sloc) || (boQua.push({ i: r.i, so_ct: r.so_ct, ma: r.ma, lyDo: 'kho ' + r.plant + '/' + r.sloc + ' chưa có trong app' }), false));

  // ---- 3. Kỳ đã duyệt kiểm kê → không ghi
  if (ds.length) {
    const kys = [...new Set(ds.map(r => r.ky))];
    const da = await supa('submissions?select=plant_code,sloc_code,period&status=eq.' + enc('Đã duyệt') + '&period=in.' + enc(inList(kys))
      + '&plant_code=in.' + enc(inList([...new Set(ds.map(r => r.plant))])), { method: 'GET' });
    const khoa = new Set((da || []).map(x => x.plant_code + '|' + x.sloc_code + '|' + x.period));
    ds = ds.filter(r => !khoa.has(r.plant + '|' + r.sloc + '|' + r.ky) || (boQua.push({ i: r.i, so_ct: r.so_ct, ma: r.ma, lyDo: 'kỳ ' + r.ky + ' của kho đã duyệt kiểm kê' }), false));
  }

  // ---- 4. Tách mới / đã có
  const daCo = new Map();
  for (let k = 0; k < ds.length; k += 150) {
    const ids = ds.slice(k, k + 150).map(r => r.id);
    const q = await supa('receipts?select=id,qty,sap_sl,date&id=in.' + enc(inList(ids)), { method: 'GET' });
    (q || []).forEach(x => daCo.set(x.id, x));
  }
  // Tên trong danh mục: mã chưa có / chưa có tên → kèm "tên đề xuất" để kế toán duyệt như mã BP đưa lên
  const ma = [...new Set(ds.map(r => r.ma))], coTen = new Set();
  for (let k = 0; k < ma.length; k += 200) {
    const q = await supa('materials?select=code,name&code=in.' + enc(inList(ma.slice(k, k + 200))), { method: 'GET' });
    (q || []).forEach(x => { const n = String(x.name || '').trim(); if (n && n !== '?' && n !== x.code) coTen.add(x.code); });
  }
  // ---- 4b. SAP LÀ CHUẨN (Khoa 23/11/2026): mã chưa có tên trong danh mục tổng thì TỰ KHAI tên + ĐVT theo SAP,
  // không chờ kế toán duyệt. Chỉ điền mã thiếu tên (trống / "?" / bằng chính mã) — KHÔNG ghi đè tên kế toán đã đặt.
  // Kèm học mã vào danh mục KHO (plant_materials). Ghi trượt thì bỏ qua, dòng nhập kho vẫn ghi như cũ (kèm tên đề xuất).
  const maTuKhai = [];
  try {
    const can = new Map();
    ds.forEach(r => { if (!coTen.has(r.ma) && r.ten && !can.has(r.ma)) can.set(r.ma, { code: r.ma, name: r.ten.slice(0, 200), uom: r.dvt || null }); });
    const dsMa = [...can.values()];
    for (let k = 0; k < dsMa.length; k += 200) {
      await supa('materials?on_conflict=code', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(dsMa.slice(k, k + 200)) });
    }
    dsMa.forEach(m => { coTen.add(m.code); maTuKhai.push({ ma: m.code, ten: m.name, dvt: m.uom }); });
  } catch (e) { console.warn('Tự khai mã SAP lỗi:', e.message); }
  try {
    const pm = [...new Map(ds.map(r => [r.plant + '|' + r.ma, { plant_code: r.plant, code: r.ma }])).values()];
    for (let k = 0; k < pm.length; k += 300) {
      await supa('plant_materials?on_conflict=plant_code,code', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(pm.slice(k, k + 300)) });
    }
  } catch (e) { console.warn('Học mã vào danh mục kho lỗi:', e.message); }

  const moi = [], capNhat = [], giuSoBP = [];
  let khongDoi = 0;
  ds.forEach(r => {
    const c = daCo.get(r.id);
    if (!c) {
      const tenDX = coTen.has(r.ma) ? '' : (r.ten ? ' [tên đề xuất: ' + r.ten.replace(/[\[\]]/g, ' ').slice(0, 120) + ']' : '') + ' [mã chờ khai báo]';
      moi.push({ id: r.id, plant_code: r.plant, sloc_code: r.sloc, code: r.ma, name: coTen.has(r.ma) ? (r.ten || r.ma) : r.ma, uom: r.dvt || null,
        qty: r.sl, date: r.ngay, period: r.ky, sap_ct: r.so_ct, sap_sl: r.sl,
        note: ('[SAP ' + nguon + ' ' + r.so_ct + (r.loai ? ' ' + r.loai : '') + ']' + (r.ghi_chu ? ' ' + r.ghi_chu : '') + tenDX).slice(0, 400),
        created_by: 'SAP (agent)' });
      return;
    }
    const sapCu = c.sap_sl == null ? Number(c.qty) : Number(c.sap_sl);
    if (sapCu === r.sl && String(c.date).slice(0, 10) === r.ngay) { khongDoi++; return; }
    const bpDaChon = c.sap_sl != null && Number(c.qty) !== Number(c.sap_sl);
    if (bpDaChon) { giuSoBP.push({ so_ct: r.so_ct, ma: r.ma, sapCu, sapMoi: r.sl, soBP: Number(c.qty) }); capNhat.push({ id: r.id, patch: { sap_sl: r.sl } }); return; }
    capNhat.push({ id: r.id, patch: { qty: r.sl, sap_sl: r.sl, date: r.ngay, period: r.ky } });
  });

  // ---- 5. Ghi
  try {
    for (let k = 0; k < moi.length; k += 200) {
      await supa('receipts?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(moi.slice(k, k + 200)) });
    }
  } catch (e) {
    if (/sap_ct|sap_sl|PGRST204|schema cache/i.test(String(e.message))) return res.status(503).json({ error: 'Máy chủ chưa chạy SQL PHẦN 43 (cột sap_ct / sap_sl của receipts)' });
    throw e;
  }
  for (const u of capNhat) {
    await supa('receipts?id=eq.' + enc(u.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(u.patch) });
  }

  // ---- 6. Đối chiếu tự động với ảnh BP đã quét trước khi số SAP về (bảng doi_chieu_nhap, trạng thái cho_sap)
  let khop = 0, lech = 0;
  const khoaNgay = [...new Set(ds.map(r => r.plant + '|' + r.sloc + '|' + r.ngay))];
  try {
    for (const kn of khoaNgay) {
      const [p, s, d] = kn.split('|');
      const cho = await supa('doi_chieu_nhap?select=id,code,sl_anh&trang_thai=eq.cho_sap&plant_code=eq.' + enc(p) + '&sloc_code=eq.' + enc(s) + '&date=eq.' + d, { method: 'GET' });
      if (!cho || !cho.length) continue;
      const sap = await supa('receipts?select=code,sap_sl,qty&sap_ct=not.is.null&plant_code=eq.' + enc(p) + '&sloc_code=eq.' + enc(s) + '&date=eq.' + d, { method: 'GET' });
      const tong = {};
      (sap || []).forEach(x => { tong[x.code] = (tong[x.code] || 0) + Number(x.sap_sl == null ? x.qty : x.sap_sl); });
      for (const c of cho) {
        const t = tong[c.code];
        const tt = t == null ? 'chi_anh' : (Math.abs(t - Number(c.sl_anh)) < 1e-6 ? 'khop' : 'lech');
        if (tt === 'khop') khop++; else if (tt === 'lech') lech++;
        await supa('doi_chieu_nhap?id=eq.' + enc(c.id) + '&trang_thai=eq.cho_sap', { method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ trang_thai: tt, sl_sap: t == null ? null : Math.round(t * 1e6) / 1e6, updated_at: new Date().toISOString() }) });
      }
      // Báo BP kho đó khi có dòng lệch / ảnh có mà SAP không có
      const can = cho.filter(c => tong[c.code] == null || Math.abs(tong[c.code] - Number(c.sl_anh)) >= 1e-6).length;
      if (can) {
        try {
          await supa('notifications', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
            id: 'NTS' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), plant_code: p, sloc_code: s, kind: 'sapdc',
            message: 'Số SAP ngày ' + d.split('-').reverse().join('/') + ' đã về: ' + can + ' mã khác với ảnh phiếu đã quét — vào Nhập kho & ĐC → Nhận hàng từ kho tổng → Đối chiếu SAP để chọn số thực nhận.',
            created_by: 'Hệ thống', read_flag: false }) });
        } catch (e) { /* thông báo trượt không làm hỏng lượt nhận số */ }
      }
    }
  } catch (e) {
    if (!/42P01|does not exist|schema cache|PGRST205/i.test(String(e.message))) throw e;   // chưa chạy SQL PHẦN 43 phần bảng đối chiếu
  }

  return res.status(200).json({ ok: true, nhan: rows.length, moi: moi.length, capNhat: capNhat.length - giuSoBP.length, khongDoi, giuSoBP, boQua, doiChieu: { khop, lech } });
};
module.exports = bocLoi('nhap-kho-sap', xuLy);
