// agent/dat-ver.mjs — NÂNG "BẢN TỐI THIỂU" SAU MỖI LẦN ĐẨY index.html (Khoa 16/11/2026: bản cũ không được dùng app).
// Chạy bởi .github/workflows/dat-ver-toi-thieu.yml khi index.html đổi trên main.
// 1. Đọc APP_VER trong index.html vừa đẩy → số sắp xếp được YYYYMMDDNN (cùng quy tắc verSo() trong app).
// 2. CHỜ Vercel chạy đúng bản đó (tải trang chủ, tối đa 10 phút) — nâng mốc trước khi bản mới lên là khoá oan mọi người.
// 3. Ghi bao_mat_cau_hinh(k='cong_ver').gia_tri = số đó (chỉ nâng, không bao giờ hạ). Máy chủ (SQL PHẦN 42) từ chối mọi
//    yêu cầu từ bản cũ hơn; app bản mới tự tải lại khi thấy mốc cao hơn mình.
import { readFileSync } from 'node:fs';

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const APP = (process.env.APP_URL || 'https://cost-master-sigma.vercel.app').replace(/\/+$/, '');
if (!SB_URL || !SB_KEY) { console.log('::error::Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

function verSo(v, now = new Date()) {
  const m = /^(\d{2})(\d{2})-(\d{1,2})$/.exec(String(v || '')); if (!m) return '';
  let y = now.getFullYear(); const mo = +m[2];
  if (mo > now.getMonth() + 2) y--;
  return '' + y + m[2] + m[1] + String(+m[3]).padStart(2, '0');
}
const ver = (/const APP_VER='([^']+)'/.exec(readFileSync(new URL('../index.html', import.meta.url), 'utf8')) || [])[1];
const so = verSo(ver, new Date(Date.now() + 7 * 3600e3));
if (!so) { console.log('::error::Không đọc được APP_VER trong index.html'); process.exit(1); }
console.log(`Bản vừa đẩy: ${ver} (${so})`);

let len = false;
for (let i = 0; i < 40; i++) {
  try {
    const t = await (await fetch(APP + '/?_=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } })).text();
    if (t.includes(`const APP_VER='${ver}'`)) { len = true; break; }
  } catch (e) {}
  await new Promise(r => setTimeout(r, 15000));
}
if (!len) { console.log(`::error::Sau 10 phút Vercel vẫn chưa chạy bản ${ver} — KHÔNG nâng mốc (tránh khoá oan mọi người)`); process.exit(1); }

const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
const r0 = await fetch(`${SB_URL}/rest/v1/bao_mat_cau_hinh?k=eq.cong_ver&select=gia_tri`, { headers: H });
if (!r0.ok) { const t = await r0.text(); if (/42P01|does not exist|schema cache|PGRST205/i.test(t)) { console.log('Chưa chạy SQL PHẦN 42 — bỏ qua'); process.exit(0); } console.log('::error::Đọc mốc: ' + r0.status + ' ' + t.slice(0, 160)); process.exit(1); }
const cu = ((await r0.json())[0] || {}).gia_tri || '';
if (cu && cu >= so) { console.log(`Mốc hiện tại ${cu} đã ≥ ${so} — giữ nguyên`); process.exit(0); }
const r1 = await fetch(`${SB_URL}/rest/v1/bao_mat_cau_hinh?k=eq.cong_ver`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ gia_tri: so }) });
const kq = r1.ok ? await r1.json() : [];
if (!r1.ok || !kq.length) { console.log('::error::Không nâng được mốc — ' + r1.status + (kq.length ? '' : ' (chưa có dòng cong_ver?)')); process.exit(1); }
console.log(`Đã nâng bản tối thiểu ${cu || '(trống)'} → ${so}. Máy chạy bản cũ sẽ tự tải lại / bị chặn.`);
