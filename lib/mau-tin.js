// lib/mau-tin.js — MẪU TIN TELEGRAM của bot cảnh báo (16/11/2026).
// Một chỗ duy nhất quyết định tin trông thế nào: bot thật (agent/canh-bao.mjs) và tin mẫu (agent/mau-tin-thu.mjs) cùng dùng.
// Nguyên tắc (Khoa): đọc là hiểu lỗi gì · ảnh hưởng ai · phải làm gì — không lan man. Mọi phần động đều esc().
const { esc } = require('./telegram.js');

const MUC = {
  S1: { ico: '🔴', ten: 'KHẨN', han: 'xử lý ngay' },
  S2: { ico: '🟠', ten: 'NẶNG', han: 'xử lý trong ngày' },
  S3: { ico: '🟡', ten: 'NHẸ', han: 'đợt sửa kế tiếp' },
};
const TEN_BANG = { submissions: 'phiếu kiểm kê', receipts: 'nhập kho', materials: 'danh mục vật tư', plant_materials: 'danh mục kho',
  transfers: 'sổ điều chuyển', transfer_requests: 'phiếu điều chuyển', opening_stock: 'tồn đầu kỳ', closing_stock: 'chốt tồn',
  weekly_counts: 'kiểm kê tuần', count_lists: 'danh sách mở kỳ', notifications: 'thông báo', profiles: 'người dùng',
  user_plants: 'phân quyền kho', shifts: 'bàn giao ca', spot_checks: 'kiểm đột xuất', nhan_su: 'danh bạ', auth: 'đăng nhập' };
const VACH = '━━━━━━━━━━━━━━━━━━';
const CHAN = 'Chi tiết: app → <b>Sự cố hệ thống</b>';

function thoiLuong(phut) {
  phut = Math.max(0, Math.round(phut));
  if (phut < 60) return phut + ' phút';
  const g = Math.floor(phut / 60), p = phut % 60;
  return g + ' giờ' + (p ? ' ' + p + ' phút' : '');
}
const so = n => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

// f: { muc, tieu, anhHuong, dauHieu, viec, ma, luc, tuMuc }  (tuMuc có = tin tăng mức)
function tinSuCo(f) {
  const m = MUC[f.muc] || MUC.S3;
  return [
    `${m.ico} <b>SỰ CỐ ${m.ten} · ${esc(f.tieu)}</b>`,
    f.tuMuc ? `⬆️ Tăng mức từ ${esc((MUC[f.tuMuc] || {}).ten || f.tuMuc)} lên ${m.ten}` : null,
    VACH,
    `<b>Ảnh hưởng</b>\n${esc(f.anhHuong)}`,
    `<b>Dấu hiệu</b>\n${esc(f.dauHieu)}`,
    `<b>Cần làm</b> · ${m.han}\n${esc(f.viec)}`,
    VACH,
    `<code>${esc(f.ma)}</code> · phát hiện ${esc(f.luc)}`,
  ].filter(Boolean).join('\n');
}

// r: { muc, tieu, ma, tu, den, phut, nguoi }
function tinOnLai(r) {
  const m = MUC[r.muc] || MUC.S3;
  return [
    `✅ <b>ĐÃ ỔN LẠI · ${esc(r.tieu)}</b>`,
    VACH,
    `Mức: ${m.ico} ${m.ten}`,
    `Thời gian: ${esc(r.tu)} → ${esc(r.den)} (${thoiLuong(r.phut)})`,
    r.nguoi ? `Người bị ảnh hưởng: ${r.nguoi}` : null,
    VACH,
    `<code>${esc(r.ma)}</code>`,
  ].filter(Boolean).join('\n');
}

// D: { luc, conMo:[{ma,muc,tieu}], dem:[{ma,muc,tieu,daOn}], homQua:{S1,S2}, loi:{lan,nguoi,top:[{k,n,lan}]},
//      eg:{homQuaMB,nguongMB,kyMB,hanMB,duBaoMB,tuKy,denKy,nang:[{k,mb}]}, banCu:{ver,ten:[]}, ghiChu:[] }
function tinTomTat(D) {
  const out = [];
  const conS1 = (D.conMo || []).some(r => r.muc === 'S1');
  const tt = !(D.conMo || []).length ? '🟢 Hệ thống ổn định'
    : `${conS1 ? '🔴' : '🟠'} Còn ${D.conMo.length} sự cố đang mở`;
  out.push(`☀️ <b>TÓM TẮT HỆ THỐNG · ${esc(D.luc)}</b>`, VACH, `<b>Tình trạng:</b> ${tt}`);
  (D.conMo || []).slice(0, 5).forEach(r => out.push(`   ${(MUC[r.muc] || MUC.S3).ico} <code>${esc(r.ma)}</code> ${esc(r.tieu)}`));

  const hq = D.homQua || {};
  const sc = [`• Hôm qua: ${hq.S1 || 0} KHẨN · ${hq.S2 || 0} NẶNG`];
  if ((D.dem || []).length) sc.push('• Trong đêm (22h → 8h):\n' + D.dem.slice(0, 5).map(r =>
    `   ${(MUC[r.muc] || MUC.S3).ico} <code>${esc(r.ma)}</code> ${esc(r.tieu)} — ${r.daOn ? 'đã ổn' : '<b>còn mở</b>'}`).join('\n'));
  out.push('', '<b>Sự cố</b>', ...sc);

  if (D.loi) {
    out.push('', `<b>Lỗi phía người dùng</b> · ${esc(D.loi.khoang || '24 giờ')}`);
    if (!D.loi.lan) out.push('• Không ghi nhận lỗi nào');
    else {
      out.push(`• ${so(D.loi.lan)} lần · ${D.loi.nguoi} người`);
      (D.loi.top || []).slice(0, 3).forEach((x, i) => out.push(`   ${i + 1}. ${esc(String(x.k).slice(0, 70))} — ${x.n} người`));
    }
  }
  if (D.eg) {
    const E = D.eg, pt = E.hanMB ? Math.round(E.duBaoMB / E.hanMB * 100) : 0;
    out.push('', '<b>Dung lượng Supabase (Egress)</b>');
    out.push(`• Hôm qua: ~${so(E.homQuaMB)} MB` + (E.homQuaMB > E.nguongMB ? ` ⚠️ vượt ngưỡng ${E.nguongMB} MB/ngày` : ` (ngưỡng ${E.nguongMB} MB)`));
    if (E.kyMB != null) out.push(`• Kỳ ${esc(E.tuKy)}–${esc(E.denKy)}: ${so(E.kyMB / 1024)} / ${so(E.hanMB / 1024)} GB · dự báo ${so(E.duBaoMB / 1024)} GB (${pt}%)` + (pt > 100 ? ' 🔴' : pt > 80 ? ' 🟠' : ''));
    if ((E.nang || []).length) out.push(`• Tải nhiều nhất: ${E.nang.map(x => esc(TEN_BANG[x.k] || x.k) + ' ' + so(x.mb) + ' MB').join(' · ')}`);
  }
  if (D.banCu && (D.banCu.ten || []).length) {
    const t = D.banCu.ten;
    out.push('', '<b>Phiên bản</b>', `• ${t.length} người còn chạy bản cũ (mới nhất <code>${esc(D.banCu.ver)}</code>): ${esc(t.slice(0, 6).join(', '))}${t.length > 6 ? '…' : ''}`);
  }
  if ((D.ghiChu || []).length) out.push('', `⚠️ Bot không kiểm được: ${esc(D.ghiChu.join(' · ').slice(0, 200))}`);
  out.push(VACH, CHAN);
  return out.join('\n');
}

module.exports = { MUC, tinSuCo, tinOnLai, tinTomTat, thoiLuong };
