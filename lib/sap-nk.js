// lib/sap-nk.js — THEO DÕI AGENT ĐẨY NHẬP KHO SAP (ZSMMQ002) — 28/11/2026.
// Khoa: "ở báo cáo lỗi báo cáo thêm việc agent up nhập kho, a thấy nó lỗi hoài".
//
// Agent trên máy kế toán (sap_zsmmq002_sync.py) cuối MỖI lượt chạy (đạt hay trượt) gửi một gói báo cáo về
// /api/nhap-kho-sap: { bao_cao_chay: { status, target_date, run_at, upload_status, total_sap_rows, matched_rows,
// summary_rows_count, error_message, log_tail:[...] } }.  Máy chủ lưu vào bảng kín bao_mat_cau_hinh:
//   sapnk_chay — lượt chạy gần nhất (JSON)
//   sapnk_ok   — các ngày đã đẩy xong { cacNgay: { 'yyyy-mm-dd': {luc, dong, up} } } (giữ 30 ngày gần nhất)
//   sapnk_day  — lô dữ liệu cuối cùng nhận được (dự phòng khi agent bản cũ chưa gửi báo cáo)
// Trượt thì báo Telegram NGAY (mức S2, sau 22h thì hoãn tới tin tóm tắt 8h). Bot cảnh báo 8h / 17h kiểm thêm:
// ngày hôm qua chưa có số SAP → mở sự cố.
const { esc } = require('./telegram.js');

const THU_MUC = 'D:\\coder\\agent-SAP\\SAP_ZSMMQ002_Auto';
const VACH = '━━━━━━━━━━━━━━━━━━';
const dmy = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const dmyCham = iso => String(iso || '').slice(0, 10).split('-').reverse().join('.');

// Đọc lỗi kỹ thuật của agent -> câu nghiệp vụ + việc cần làm. Thứ tự: cụ thể trước, chung sau.
function giaiThich(loi, logTail) {
  const s = String(loi || '') + '\n' + (Array.isArray(logTail) ? logTail.join('\n') : String(logTail || ''));
  const L = [
    [/SCREEN_LOCKED|RDP_DISCONNECTED|khoa man hinh|khóa màn hình/i,
      'Máy chạy agent đang khoá màn hình / mất phiên điều khiển nên không bấm được SAP',
      'Mở khoá máy, để máy không tự khoá màn hình lúc 17h'],
    [/No entry was found for the entry in field/i,
      'SAP báo ô lọc còn số cũ ("No entry was found…") — thường do phiên SAP đang mở sẵn ở màn khác, agent không xoá hết ô lọc',
      'Đóng các cửa sổ SAP đang mở dở rồi chạy lại'],
    [/agent SAP khac|agent SAP khác|MB5B|MIGO/i,
      'Có agent SAP khác (MB5B / MIGO…) đang chạy cùng lúc nên agent này nhường, không mở SAP',
      'Chờ agent kia chạy xong rồi chạy lại'],
    [/Khong tim thay cua so SAP Logon|không tìm thấy cửa sổ SAP Logon/i,
      'Không mở được cửa sổ SAP Logon (SAP Logon treo ở khay hệ thống)',
      'Tắt hẳn SAP Logon (cả biểu tượng dưới khay) rồi chạy lại'],
    [/Qua thoi gian cho bao cao|quá thời gian chờ|code=16/i,
      'SAP không chạy ra báo cáo ZSMMQ002 trong thời gian chờ',
      'Mở SAP xem màn ZSMMQ002 có báo lỗi gì không, đóng cửa sổ SAP dở rồi chạy lại'],
    [/dang nhap|đăng nhập|password|logon failed/i,
      'Agent không đăng nhập được SAP',
      'Kiểm tra tài khoản SAP còn dùng được (đổi mật khẩu / bị khoá?)'],
    [/HTTP Error 401|HTTP 401|Sai khóa agent/i,
      'Máy chủ app từ chối khoá của agent (sai APP_API_KEY)',
      'Đối chiếu APP_API_KEY trong .env của agent với biến NHAP_KHO_AGENT_KEY trên Vercel'],
    [/Đẩy API thất bại|URLError|timed out|HTTP Error 5\d\d|HTTP 5\d\d/i,
      'Đã lấy được số từ SAP nhưng đẩy lên app trượt (mạng / máy chủ app)',
      'Chạy lại — agent tự đẩy tiếp các lô còn thiếu, không nhân đôi'],
  ];
  for (const [re, ly, lam] of L) if (re.test(s)) return { ly, lam };
  return { ly: 'Agent dừng giữa chừng', lam: 'Mở file nhật ký của ngày đó, đọc dòng [LOI] / [LỖI FAIL]' };
}
const lenhChayLai = ngay => `python sap_zsmmq002_sync.py --date ${dmyCham(ngay)}`;

// r: bản ghi sapnk_chay
function tinTruot(r, lanThu) {
  const g = giaiThich(r.loi, r.log);
  return [
    `🟠 <b>AGENT NHẬP KHO SAP TRƯỢT · ngày ${esc(dmy(r.ngay))}</b>`,
    VACH,
    '<b>Ảnh hưởng:</b> số nhập kho SAP ngày này chưa lên app — tồn ước tính các kho thiếu phần hàng nhận',
    '',
    '<b>Vì sao</b>',
    '• ' + esc(g.ly),
    r.loi ? '• Agent báo: <code>' + esc(String(r.loi).slice(0, 160)) + '</code>' : null,
    lanThu > 1 ? `• Đã trượt ${lanThu} lượt liên tiếp cho ngày này` : null,
    '',
    `<blockquote>👉 <b>CẦN LÀM</b>\n<b>${esc(g.lam)}</b>\nChạy lại: <code>${esc(lenhChayLai(r.ngay))}</code>\n🔎 Nhật ký: <code>${esc(THU_MUC + '\\logs\\run_' + dmyCham(r.ngay) + '.log')}</code></blockquote>`,
    `Lượt chạy lúc ${esc(r.gio || '')}`,
  ].filter(x => x !== null).join('\n');
}
function tinDaLen(r) {
  return [
    `✅ <b>AGENT NHẬP KHO SAP ĐÃ ĐẨY ĐƯỢC · ngày ${esc(dmy(r.ngay))}</b>`,
    VACH,
    `• ${Number(r.dong || 0).toLocaleString('vi-VN')} dòng (kho + mã) · ${Number(r.khop || 0).toLocaleString('vi-VN')} dòng chứng từ khớp kho app`,
    `• Lúc ${esc(r.gio || '')}`,
  ].join('\n');
}

module.exports = { giaiThich, tinTruot, tinDaLen, lenhChayLai, THU_MUC, dmy, dmyCham };
