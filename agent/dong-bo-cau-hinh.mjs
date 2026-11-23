// agent/dong-bo-cau-hinh.mjs — CHÉP LINK TEAMS TỪ GITHUB SECRETS VÀO BẢNG KÍN bao_mat_cau_hinh (23/11/2026)
// để hàm 17h trên Vercel (api/nhac-dc.js) đọc được mà Khoa không phải khai lại biến trên Vercel.
// Bảng bao_mat_cau_hinh: RLS bật, đã revoke anon/authenticated -> CHỈ khóa service role đọc được.
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const ds = [
  ['teams_nh', process.env.TEAMS_FLOW_URL],
  ['teams_bep', process.env.TEAMS_FLOW_URL_BEP],
  ['teams_the', process.env.TEAMS_THE],
].filter(([, v]) => v && String(v).trim()).map(([k, v]) => ({ k, bat: true, gia_tri: String(v).trim() }));
if (!ds.length) { console.log('Không có giá trị nào để chép.'); process.exit(0); }
const r = await fetch(`${SB_URL}/rest/v1/bao_mat_cau_hinh?on_conflict=k`, { method: 'POST',
  headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(ds) });
if (!r.ok) { console.error('::error::Ghi cấu hình lỗi HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
console.log('Đã chép ' + ds.map(x => x.k).join(', ') + ' vào bao_mat_cau_hinh.');
