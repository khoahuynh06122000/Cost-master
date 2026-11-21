# Việc giao: thay nền màn đăng nhập bằng ảnh Bà Nà

Tài liệu này dành cho agent được giao sửa nền màn đăng nhập (Antigravity hoặc agent khác).
App nằm trọn trong một file `index.html` (~17.000 dòng) đang chạy thật cho cả bộ phận F&B.
Bạn **chỉ được sửa nền màn đăng nhập**. Mọi phần khác của app đã được rào và có script tự kiểm.

## Việc cần làm

1. Bỏ video `cabin.mp4` và ảnh `cabin-poster.jpg` (ảnh do AI tạo). Xoá hai file này khỏi repo.
2. Thay bằng **ảnh thật của Bà Nà** do chủ dự án đưa. Đặt ảnh trong thư mục `anh-nen/` ở gốc repo,
   ví dụ `anh-nen/ba-na-ngang.jpg` (máy tính) và `anh-nen/ba-na-doc.jpg` (điện thoại, nếu có).
   - Mỗi ảnh **≤ 600 KB** (nên nhắm ~300 KB). Ảnh ngang rộng ~2000–2400 px, JPEG chất lượng ~78.
   - Không nhúng ảnh dạng base64 vào `index.html`.
3. Có thể thêm hiệu ứng ảnh phóng chậm (Ken Burns), nhưng phải tắt khi người dùng bật
   `prefers-reduced-motion: reduce`.
4. Chỉnh lớp phủ tối (`.login-overlay`, `.login-vign`) sao cho chữ trắng bên trái
   ("Kiểm kê & đối chiếu số liệu F&B") và thẻ đăng nhập bên phải vẫn đọc rõ trên ảnh mới.
5. Tăng số phiên bản: dòng `const APP_VER='DDMM-NN';` trong `index.html`
   (VD đang `2111-02` thì đổi `2111-03`; sang ngày khác thì `2211-01`). Đây là dòng duy nhất
   ngoài vùng rào được phép đổi.

## Ba vùng được sửa

Trong `index.html` có đúng ba vùng nằm giữa hai dòng đánh dấu. **Chỉ sửa bên trong các vùng này.
Không xoá, không đổi chữ, không nhân đôi các dòng đánh dấu.**

| Vùng | Dòng mở | Dòng đóng | Được làm |
|---|---|---|---|
| CSS | `/* >>> VUNG-ANTI:CSS BAT-DAU >>>` | `/* <<< VUNG-ANTI:CSS KET-THUC <<< */` | Style cho nền: `.login-bgfx`, `.login-vid`, `.login-poster`, `.login-overlay`, `.login-vign`, hoặc class mới bắt đầu bằng `.login-` |
| HTML | `<!-- >>> VUNG-ANTI:HTML BAT-DAU >>>` | `<!-- <<< VUNG-ANTI:HTML KET-THUC <<< -->` | Các lớp nền nằm ngay đầu `<div id="login">`: `div`, `img`, `picture`, `source`, `span` |
| JS | `/* >>> VUNG-ANTI:JS BAT-DAU >>>` | `/* <<< VUNG-ANTI:JS KET-THUC <<< */` | Một khối `(function(){ … })();` tự đứng. Bỏ video thì khối này có thể rỗng |

### Luật trong từng vùng

**CSS**
- Mọi bộ chọn phải nhắm vào màn đăng nhập: `#login…`, `#loginVid`, `.login-…`
  (cho phép tiền tố `html.dark `). Có thể dùng `@media`, `@supports`, `@keyframes`.
- Cấm `@import`, cấm `url(http…)`, cấm `url(data:…)`. Ảnh chỉ lấy từ `anh-nen/<tên file>`.
- Không được đụng `.login-stage`, `.login-card2`, `.login-hero2`, `.lh-*`, ô nhập, nút: các phần đó nằm ngoài vùng.

**HTML**
- Cấm `<script>`, cấm thuộc tính sự kiện (`onclick=`, `onload=`…).
- Cấm `form`, `input`, `button`, `a`, `iframe`, `link`, `meta`.
- `src` / `srcset` / `poster` chỉ trỏ vào `anh-nen/…`. Không đường dẫn ra ngoài.
- `id` mới phải bắt đầu bằng `login-`. Ảnh nền là trang trí, nên để `alt=""` và `aria-hidden="true"`.

**JS**
- Đúng một khối `(function(){ … })();`, không code nào nằm ngoài khối.
- Cấm: gọi mạng (`fetch`, `XMLHttpRequest`, `WebSocket`), đụng dữ liệu app (`sb`, `supabase`,
  `session`, hàm `db…`), lưu trữ (`localStorage`, `sessionStorage`, `indexedDB`, cookie),
  `eval` / `new Function` / `import`, chuyển trang (`location`, `history`, `window.open`),
  chèn HTML (`innerHTML`…), gắn biến lên `window`.

## File được thay đổi

Chỉ được: sửa `index.html`, thêm ảnh vào `anh-nen/`, xoá `cabin.mp4` và `cabin-poster.jpg`.
Không sửa file nào khác: `sw.js`, `api/`, `agent/`, `vercel.json`, `manifest.webmanifest`,
`kiem-tra/`, `docs/`, `CLAUDE.md`, `SQL-*.sql`.

## Kiểm tra bắt buộc trước khi commit

```
node kiem-tra/rao-anti.mjs
```

Phải in `RÀO ANTI: ĐẠT`. Nếu `TRƯỢT`, script liệt kê từng vi phạm. Sửa hết rồi chạy lại.
Repo có pre-commit hook chạy đúng script này, nên commit sẽ bị chặn khi còn vi phạm.

- **Không sửa `kiem-tra/rao-anti.mjs` hay `kiem-tra/rao-anti.json`.** Không dùng `git commit --no-verify`.
  Chủ dự án giữ một bản mã kiểm riêng ở ngoài repo và sẽ đối chiếu lại sau khi bạn làm xong.
- Script báo "Code NGOÀI 3 vùng được phép đã bị thay đổi" thì xem `git diff -- index.html`
  và hoàn tác mọi chỗ nằm ngoài vùng.

## Kiểm tra bằng mắt

Mở `index.html` qua một máy chủ tĩnh, ví dụ `python -m http.server`, rồi xem màn đăng nhập ở
các bề rộng **320 / 390 / 428 / 768 / 1280 / 1920 px**:

- Không có thanh cuộn ngang. Ảnh phủ kín màn, không méo, không lộ viền.
- Chữ trắng bên trái và thẻ đăng nhập đọc rõ. Thẻ đăng nhập vẫn bấm được.
- Trên điện thoại (≤ 820 px), ảnh dùng bản dọc nếu có, không thì cắt từ ảnh ngang
  (`object-position` / `background-position` sao cho phần đẹp nhất nằm trong khung).
- Bật "giảm chuyển động" của hệ điều hành thì ảnh đứng yên.
- Màn đăng nhập phải tải nhanh: tổng ảnh nền tải về ≤ 600 KB.

## Commit

Một commit, tiếng Việt, ví dụ: `Màn đăng nhập: nền ảnh thật Bà Nà thay video cabin (bản 2111-03)`.
Đây không phải sửa lỗi nên **không** ghi dòng `Sua-loi:`.
