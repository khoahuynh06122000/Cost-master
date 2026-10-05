# Thư mục kiểm tra app

Hai tầng, đúc kết từ đợt rà soát toàn app ngày 05/10/2026.

## 1. Tự kiểm hằng tuần — `kiem-tuan.mjs` (miễn phí, không dùng AI)

Chạy tự động **7h30 sáng thứ Hai** trên GitHub (`.github/workflows/kiem-tra-tuan.yml`), kết quả gửi về **Teams riêng của Khoa**. Có lỗi đỏ thì job GitHub báo thất bại.

Kiểm (chỉ đọc, không ghi gì):

| Hạng mục | Kiểm gì |
|---|---|
| Cú pháp | mọi khối script trong `index.html` + `sw.js` + `api/*.js` |
| Máy chủ | trang app mở được, bản trên web = bản trong repo, `sw.js`/manifest tải được, API thông báo có khoá, API quét ảnh chặn đúng khi thiếu khoá và vẫn đi tới Google |
| CSDL | mọi bảng + cột code đang dùng đều có trên Supabase; khoá công khai không đọc được dòng dữ liệu nào |
| Số liệu | bảng sổ sắp/đã vượt ngưỡng 1.000 dòng app tải được · phiếu điều chuyển đã duyệt mà sổ lệch số dòng · dòng sổ ghi trùng · phiếu kiểm kê nạp từ Excel có nhiều mã bằng 0 |
| Dữ liệu nhúng | mã vật tư trùng/rỗng, kho thiếu chữ viết tắt mã phiếu, chữ tắt trùng |
| Ngôn ngữ | từ điển Anh = Ấn, không mẫu dịch nào hỏng |
| Lỗi đã biết | các lỗi thật từng gặp không được tái phát; lỗi đã phát hiện chưa sửa báo vàng |

Chạy tay trên máy: `node kiem-tra/kiem-tuan.mjs` (không có khoá service thì bỏ qua phần Số liệu). Chạy tay trên GitHub: tab **Actions → Kiem tra app hang tuan → Run workflow**.

Sửa xong một lỗi trong danh sách `MAU` thì đổi `mo: true` → `mo: false` để nó canh tái phát.

## 2. Rà soát AI toàn app — `ra-soat-ai.js` (chạy khi cần)

20 agent đọc từng dòng (12 vùng code + 8 hướng quét chéo), rồi phản biện theo lô. **Không chạy tự động**: mỗi lần tốn vài triệu token và đã từng chạm giới hạn phiên.

Nên chạy trước một đợt cải tiến lớn. Cách chạy: bảo Claude *"chia lại vùng code cho `kiem-tra/ra-soat-ai.js` theo index.html hiện tại rồi chạy workflow đó"*.

Kết quả đợt đầu: `RA-SOAT-CODE-2026-10-05.md` (ngoài repo, thư mục dự án).
