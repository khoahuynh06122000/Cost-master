// agent/hoc-tu-git.mjs — TỰ SINH BÀI HỌC TỪ LỊCH SỬ SỬA LỖI (Khoa 16/11/2026).
// "Khi fix thì bot đọc lịch sử fix đó, tự sinh bài học .md để nhớ việc đã làm."
//
// Quy ước commit sửa lỗi (CLAUDE.md bắt buộc): thân commit có các dòng (trailer) sau, mỗi dòng một khoá:
//   Sua-loi: <tiêu đề lỗi>                 ← BẮT BUỘC, có dòng này mới tính là commit sửa lỗi
//   Muc: S1 | S2 | S3
//   Trieu-chung: <người dùng thấy gì>
//   Nguyen-nhan: <nguyên nhân gốc>
//   Cach-sua: <đã sửa thế nào>
//   Chan-tai-phat: <quy tắc rút ra để không tái phạm>
//   Nhan-dien: <chuỗi trong câu lỗi / đầu mã sự cố để bot canh tái phát>   (tuỳ chọn)
//   Su-co: SC-ddmm-NN                        (tuỳ chọn)
// Bot đọc git log 60 ngày, mỗi commit như vậy thành MỘT bài học id 'git-<7 ký tự sha>' trong bảng so_tay
// (bản sửa = APP_VER tại commit đó). Upsert: sửa trailer ở commit mới cùng "Sua-loi" thì là bài học mới — không đè.
// Chạy trước agent/xuat-so-tay.mjs trong canh-bao.yml (cần checkout fetch-depth: 0).
import { execSync } from 'node:child_process';

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const THU = process.env.HOC_THU === '1';
if (!SB_URL || !SB_KEY) { console.log('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY — bỏ qua'); process.exit(0); }

const KHOA = { 'sua-loi': 'tieu_de', 'muc': 'muc', 'trieu-chung': 'trieu_chung', 'nguyen-nhan': 'nguyen_nhan', 'cach-sua': 'xu_ly',
  'chan-tai-phat': 'chan_tai_phat', 'nhan-dien': 'khoa_nhan_dien', 'su-co': 'ma_su_co' };
const SEP = '\u001e', END = '\u001d';
let raw = '';
try { raw = execSync(`git log --since="60 days ago" --no-merges --format=%H${SEP}%cI${SEP}%B${END}`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
catch (e) { console.log('Không đọc được git log:', e.message); process.exit(0); }

const bai = [];
for (const khoi of raw.split(END)) {
  const [sha, ngay, than] = khoi.replace(/^\s+/, '').split(SEP);
  if (!sha || !than || !/^\s*Sua-loi\s*:/mi.test(than)) continue;
  const r = { id: 'git-' + sha.slice(0, 7), loai: 'bai_hoc', ngay_sua: (ngay || '').slice(0, 10) };
  for (const dong of than.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.+?)\s*$/.exec(dong);
    if (!m) continue;
    const k = KHOA[m[1].toLowerCase()];
    if (k && !r[k]) r[k] = m[2].slice(0, 1000);
  }
  if (!r.tieu_de) continue;
  if (!/^S[123]$/.test(r.muc || '')) r.muc = 'S2';
  try { r.ban_sua = (/const APP_VER='([^']+)'/.exec(execSync(`git show ${sha}:index.html`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })) || [])[1] || null; }
  catch (e) { r.ban_sua = null; }
  r.cap_nhat_boi = 'bot (commit ' + sha.slice(0, 7) + ')';
  bai.push(r);
}
console.log(`Tìm thấy ${bai.length} commit sửa lỗi có bài học.`);
if (!bai.length || THU) { if (THU) console.log(JSON.stringify(bai, null, 1)); process.exit(0); }

// Chỉ thêm bài học CHƯA có (giữ phần admin đã sửa tay trong app).
const r = await fetch(`${SB_URL}/rest/v1/so_tay?on_conflict=id`, {
  method: 'POST',
  headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
  body: JSON.stringify(bai),
});
if (!r.ok) {
  const t = await r.text();
  if (/42P01|does not exist|schema cache|PGRST205/i.test(t)) { console.log('Chưa có bảng so_tay (PHẦN 40) — bỏ qua'); process.exit(0); }
  console.log('::error::Ghi bài học trượt — HTTP ' + r.status + ' ' + t.slice(0, 200)); process.exit(1);
}
console.log('Đã đồng bộ bài học vào so_tay.');
