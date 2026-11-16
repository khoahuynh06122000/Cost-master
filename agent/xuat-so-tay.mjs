// agent/xuat-so-tay.mjs — XUẤT SỔ TAY XỬ LÝ LỖI + BÀI HỌC + SỔ SỰ CỐ ra docs/SO-TAY-SU-CO.md (16/11/2026).
// Chạy sau mỗi lượt bot cảnh báo (canh-bao.yml); workflow commit file nếu nội dung đổi. Nguồn: bảng so_tay (PHẦN 40) + su_co (PHẦN 38).
// Không ghi tên người trong file (repo công khai) — chỉ nội dung kỹ thuật + nghiệp vụ.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const OUT = new URL('../docs/SO-TAY-SU-CO.md', import.meta.url);
if (!SB_URL || !SB_KEY) { console.log('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY — bỏ qua xuất sổ tay'); process.exit(0); }
const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
async function q(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
}
const MUC = { S1: '🔴 KHẨN', S2: '🟠 NẶNG', S3: '🟡 NHẸ' };
const dd = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
const gio = ts => { if (!ts) return ''; const d = new Date(Date.parse(ts) + 7 * 3600e3); const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const mot = s => String(s || '').replace(/\r?\n/g, ' ').replace(/\|/g, '/').replace(/[<>`*_\[\]]/g, '').trim();
// Repo CÔNG KHAI: sự cố gốc từ câu lỗi người dùng (loi|...) chỉ ghi loại, không chép câu lỗi tự do (có thể chứa tên, mã kho...).
const tenSuCo = r => { const id = String(r.id || '');
  if (id.startsWith('loi|app|')) return 'Nhiều người cùng gặp một lỗi (chi tiết trong app)';
  if (id.startsWith('loi|api|')) return 'Hàm máy chủ ' + mot(id.split('|')[2]) + ' lỗi liên tục';
  return mot(r.tieu_de); };
const dong = (nhan, gt) => gt ? `- **${nhan}:** ${String(gt).trim()}` : null;

let st = [], sc = [];
try { st = await q('so_tay?select=*&order=loai.asc,cap_nhat_at.desc&limit=1000'); }
catch (e) { if (/42P01|does not exist|schema cache|PGRST205/i.test(e.message)) { console.log('Chưa có bảng so_tay (PHẦN 40) — bỏ qua'); process.exit(0); } throw e; }
try { sc = await q(`su_co?select=id,ma,muc,tieu_de,mo_at,dong_at,trang_thai,da_xu_ly&id=not.like.tomtat*&trang_thai=neq.nghi&mo_at=gte.${new Date(Date.now() - 30 * 86400e3).toISOString()}&order=mo_at.desc&limit=200`); }
catch (e) { console.warn('Không đọc được su_co:', e.message); }

const hd = st.filter(r => r.loai === 'huong_dan');
const bh = st.filter(r => r.loai === 'bai_hoc').sort((a, b) => String(b.ngay_sua || '').localeCompare(String(a.ngay_sua || '')));
const L = [];
L.push('# Sổ tay xử lý lỗi & bài học — app Kiểm kê F&B', '',
  '> File này do bot **tự xuất** từ bảng `so_tay` + `su_co` sau mỗi lượt kiểm (8h, 17h). **Đừng sửa tay** — sửa trong app:',
  '> *Sự cố hệ thống → Sổ tay & bài học* (chỉ admin). Bài học có **dấu hiệu nhận diện** thì bot tự báo ♻️ TÁI PHÁT khi lỗi quay lại.', '',
  `Cập nhật: ${gio(new Date().toISOString())} · ${hd.length} hướng dẫn · ${bh.length} bài học · ${sc.length} sự cố 30 ngày`, '',
  '## Mục lục', '- [Hướng dẫn xử lý](#hướng-dẫn-xử-lý)', '- [Bài học đã sửa](#bài-học-đã-sửa)', '- [Sự cố 30 ngày gần đây](#sự-cố-30-ngày-gần-đây)', '');

L.push('## Hướng dẫn xử lý', '');
for (const r of hd) {
  L.push(`### ${r.tieu_de}`, '', ...[dong('Mức', MUC[r.muc] || r.muc), dong('Triệu chứng', r.trieu_chung), dong('Kiểm tra', r.kiem_tra),
    dong('Xử lý', r.xu_ly), dong('Chặn tái phát', r.chan_tai_phat)].filter(Boolean), '');
}
L.push('## Bài học đã sửa', '');
if (!bh.length) L.push('_Chưa có bài học._', '');
for (const r of bh) {
  L.push(`### ${r.tieu_de}${r.tai_phat_lan ? ` — ♻️ tái phát ${r.tai_phat_lan} lần` : ''}`, '', ...[
    dong('Sửa', [r.ngay_sua ? dd(r.ngay_sua) : '', r.ban_sua ? 'bản `' + r.ban_sua + '`' : ''].filter(Boolean).join(' · ')),
    dong('Mức', MUC[r.muc] || r.muc), dong('Sự cố', r.ma_su_co), dong('Triệu chứng', r.trieu_chung),
    dong('Nguyên nhân gốc', r.nguyen_nhan), dong('Cách sửa', r.xu_ly), dong('Chặn tái phát', r.chan_tai_phat),
    dong('Dấu hiệu nhận diện (bot canh)', r.khoa_nhan_dien ? '`' + r.khoa_nhan_dien + '`' : ''),
    r.tai_phat_cuoi ? dong('Tái phát gần nhất', gio(r.tai_phat_cuoi)) : null].filter(Boolean), '');
}
L.push('## Sự cố 30 ngày gần đây', '');
if (!sc.length) L.push('_Không có sự cố._', '');
else {
  L.push('| Mã | Mức | Sự cố | Mở lúc | Đóng | Trạng thái |', '|---|---|---|---|---|---|');
  sc.forEach(r => L.push(`| ${mot(r.ma)} | ${MUC[r.muc] || mot(r.muc)} | ${tenSuCo(r)} | ${gio(r.mo_at)} | ${gio(r.dong_at)} | ${r.da_xu_ly ? 'Đã xử lý' : r.trang_thai === 'dong' ? 'Đã ổn lại' : '**Đang mở**'} |`));
  L.push('');
}
const md = L.join('\n');
// Bỏ dòng "Cập nhật:" khi so sánh để không commit chỉ vì đổi giờ
const bo = s => s.replace(/^Cập nhật: .*$/m, '');
const cu = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
if (bo(cu) === bo(md)) { console.log('Sổ tay không đổi — không ghi.'); process.exit(0); }
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(OUT, md, 'utf8');
console.log(`Đã ghi docs/SO-TAY-SU-CO.md (${hd.length} hướng dẫn, ${bh.length} bài học, ${sc.length} sự cố).`);
