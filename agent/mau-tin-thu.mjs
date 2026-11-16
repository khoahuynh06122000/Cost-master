// agent/mau-tin-thu.mjs — GỬI 4 TIN MẪU về Telegram để Khoa duyệt giao diện tin (16/11/2026).
// Chạy tự động mỗi khi đẩy thay đổi mẫu tin (.github/workflows/mau-tin-thu.yml). Số liệu là GIẢ, có dòng ghi rõ "TIN MẪU".
// Khoa duyệt xong thì xoá workflow mau-tin-thu.yml — bot thật chỉ chạy theo lịch 8h / 17h.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { guiTelegram } = require('../lib/telegram.js');
const { tinSuCo, tinOnLai, tinTomTat } = require('../lib/mau-tin.js');

const MAU = '🧪 <i>TIN MẪU — số liệu giả để xem giao diện</i>\n\n';
const tin = [
  tinSuCo({ muc: 'S1', tieu: 'Sổ điều chuyển bị ghi trùng', ma: 'SC-1611-03', luc: '08:00 17/11/2026',
    anhHuong: 'Quầy LH Bia → Bếp LH Bia · mã 10024629 Nước Fuze Tea 450ml · SL 240 — kho nguồn bị trừ 2 lần',
    lyDo: ['2 dòng sổ giống hệt nhau: cùng ngày 16/11, cùng mã, cùng số lượng, cùng kho đi / đến', 'Cùng thuộc phiếu LDA-MTD-111626, duyệt lúc 14:32 bởi Lương Đình Linh'],
    viec: 'Xoá dòng có nhãn "ghi trùng" (chỉ admin)', traCuu: 'App → Nhập kho & ĐC → Theo dõi sổ điều chuyển' }),
  tinSuCo({ muc: 'S2', tieu: 'Quét ảnh nhập kho lỗi hàng loạt', ma: 'SC-1611-04', luc: '17:00 17/11/2026',
    anhHuong: '6 người không quét được ảnh nhập kho (Bếp Bánh, NH Bharata, Bếp Bốn Mùa…)',
    lyDo: ['Hàm quét ảnh trả lỗi 504 "Đọc ảnh quá lâu" 19 lần từ 12:00', 'Lỗi xảy ra ở mọi loại máy, cùng bản 1611-18'],
    viec: 'Bật thông báo cho bộ phận (mẫu "quét ảnh") để BP tạm nhập Excel; xem log hàm quét ảnh', traCuu: 'App → Sự cố hệ thống → Lỗi ghi nhận 24 giờ' }),
  tinOnLai({ muc: 'S2', tieu: 'Quét ảnh nhập kho lỗi hàng loạt', ma: 'SC-1611-04', tu: '12:05 17/11/2026', den: '17:00 17/11/2026', phut: 295, nguoi: 6 }),
  tinTomTat({ luc: '08:00 · 18/11/2026',
    conMo: [{ ma: 'SC-1711-03', muc: 'S1', tieu: 'Sổ điều chuyển bị ghi trùng' }],
    dem: [{ ma: 'SC-1811-01', muc: 'S2', tieu: 'Bot tự huỷ phiếu quá hạn không chạy', daOn: true }],
    homQua: { S1: 1, S2: 1 },
    loi: { khoang: 'từ 0h hôm qua', lan: 27, nguoi: 9, top: [
      { k: 'Không lưu được nhập kho', n: 4, lan: 11 },
      { k: 'Máy chủ /api/ocr: Đọc ảnh quá lâu', n: 6, lan: 9 },
      { k: 'Phiên đăng nhập hết hạn', n: 2, lan: 3 }] },
    eg: { homQuaMB: 182, nguongMB: 160, hanMB: 5120, kyMB: 1946, duBaoMB: 4710, tuKy: '05/11', denKy: '05/12',
      nang: [{ k: 'submissions', mb: 71 }, { k: 'receipts', mb: 38 }, { k: 'materials', mb: 25 }] },
    banCu: { ver: '1611-18', ten: ['Bùi Thị Ngọc Quý', 'Khan Rahimuddin', 'Nguyễn Minh Sâm'] },
    ghiChu: [] }),
];
let loi = 0;
for (const t of tin) {
  const kq = await guiTelegram(MAU + t, { boQuaGioNgu: true });
  if (!kq.ok) { loi++; console.log('::error::Gửi tin mẫu trượt — ' + kq.loi); }
  await new Promise(r => setTimeout(r, 1200));
}
console.log(`Đã gửi ${tin.length - loi}/${tin.length} tin mẫu.`);
if (loi) process.exit(1);
