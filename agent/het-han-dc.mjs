// agent/het-han-dc.mjs — TỰ HỦY PHIẾU ĐIỀU CHUYỂN QUÁ HẠN DUYỆT 48 GIỜ (Khoa 09/11/2026)
// Chạy mỗi giờ (.github/workflows/het-han-dc.yml). Phiếu xin hàng / hàng dư còn "Chờ duyệt" quá 48 giờ
// kể từ lúc lập -> chuyển sang "Từ chối" với lý do HUY_TAG, rồi báo về CẢ HAI kho (chuông trong app + đẩy về máy).
// Công thức hạn PHẢI giống dcHan() trong index.html:
//   hạn = max(giờ lập, MOC) + 48 giờ   — phiếu lập trước mốc áp dụng được tính từ mốc, không bị hủy ngay.
// Không áp cho phiếu hủy hàng (kế toán duyệt) và phiếu admin đã "bỏ từ chối" sau khi quá hạn (reject_note còn HUY_TAG).
// Lệnh hủy có điều kiện status = Chờ duyệt: ai vừa duyệt trước thì không đụng tới.
import { readFileSync } from 'node:fs';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const APP = process.env.APP_URL || 'https://cost-master-sigma.vercel.app';
const HAN_GIO = 48, MOC = Date.parse(process.env.DC_HAN_MOC || '2026-11-09T12:00:00+07:00'), HUY_TAG = 'Quá hạn duyệt 48 giờ';
if (!SB_URL || !SB_KEY) { console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const CHO = encodeURIComponent('Chờ duyệt');

async function q(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`Đọc ${path.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}
function tenKho() {
  const m = {};
  try {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dong = html.split('\n').find(l => /^const DATA\s*=\s*\{/.test(l));
    const data = JSON.parse(dong.replace(/^const DATA\s*=\s*/, '').replace(/;\s*$/, ''));
    (data.warehouses || []).forEach(w => { m[w.plant + '|' + w.sloc] = w.sloc_name; });
  } catch (e) { console.warn('Không đọc được tên kho trong index.html:', e.message); }
  return m;
}
const gioVN = ms => { const d = new Date(ms + 7 * 3600e3), p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`; };

async function bao(p, s, msg, tru) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/notifications`, { method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ id: 'NTH' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), plant_code: p, sloc_code: s,
        message: msg, kind: 'transfer', created_by: 'Hệ thống', read_flag: false }) });
    if (!r.ok) console.warn('Không ghi được thông báo', p, s, r.status, await r.text());
  } catch (e) { console.warn('Ghi thông báo lỗi', e.message); }
  try {
    const subs = await q(`push_subs?select=endpoint,p256dh,auth&plant_code=eq.${p}&sloc_code=eq.${s}`);
    const uniq = [...new Map(subs.filter(z => z.endpoint).map(z => [z.endpoint, z])).values()];
    if (uniq.length) await fetch(`${APP}/api/push-send`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subs: uniq, title: 'Phiếu điều chuyển đã quá thời gian duyệt', body: msg, url: '/', tag: 'dchethan' }) });
  } catch (e) { console.warn('Đẩy thông báo lỗi', e.message); }
}

const ds = await q(`transfer_requests?select=id,kind,from_plant,from_sloc,to_plant,to_sloc,items,created_at,reject_note&status=eq.${CHO}`);
const now = Date.now();
const quaHan = ds.filter(r => r.kind !== 'huy' && !String(r.reject_note || '').includes(HUY_TAG)).filter(r => {
  const t = Date.parse(r.created_at || '');
  return !isNaN(t) && now > Math.max(t, MOC) + HAN_GIO * 3600e3;
});
if (!quaHan.length) { console.log(`✅ Không có phiếu quá hạn (${ds.length} phiếu đang chờ duyệt).`); process.exit(0); }
const ten = tenKho(), kho = (p, s) => ten[p + '|' + s] || `kho ${p}-${s}`;
let huy = 0;
for (const r of quaHan) {
  const han = Math.max(Date.parse(r.created_at), MOC) + HAN_GIO * 3600e3;
  const note = `${HUY_TAG} (hạn ${gioVN(han)}) — hệ thống tự hủy`;
  const res = await fetch(`${SB_URL}/rest/v1/transfer_requests?id=eq.${encodeURIComponent(r.id)}&status=eq.${CHO}`, { method: 'PATCH',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'Từ chối', reject_note: note, approved_by: 'Hệ thống', approved_at: new Date().toISOString() }) });
  if (!res.ok) { console.warn('Không hủy được', r.id, res.status, await res.text()); continue; }
  const rows = await res.json();
  if (!rows.length) { console.log('Bỏ qua', r.id, '— vừa được xử lý ở nơi khác'); continue; }
  huy++;
  const nMa = r.items && typeof r.items === 'object' ? Object.keys(r.items).length : 0;
  const tu = kho(r.from_plant, r.from_sloc), den = kho(r.to_plant, r.to_sloc);
  // Bên lập: xin hàng = kho nhận; hàng dư = kho chuyển. Bên duyệt là đầu còn lại.
  const [lap, duyet] = r.kind === 'du' ? [[r.from_plant, r.from_sloc], [r.to_plant, r.to_sloc]] : [[r.to_plant, r.to_sloc], [r.from_plant, r.from_sloc]];
  const dau = `⌛ Phiếu ${r.id} (${tu} → ${den}, ${nMa} mã) đã quá thời gian duyệt 48 giờ — hệ thống đã tự hủy.`;
  if (lap[0]) await bao(lap[0], lap[1], `${dau} Hàng chưa được ghi sổ; nếu vẫn cần hàng thì lập phiếu mới.`);
  if (duyet[0]) await bao(duyet[0], duyet[1], `${dau} Kho này không duyệt kịp hạn. Nếu hàng đã xuất thì sổ chưa trừ kho — báo kế toán.`);
  console.log('Đã hủy', r.id);
}
console.log(`Đã tự hủy ${huy}/${quaHan.length} phiếu quá hạn.`);
