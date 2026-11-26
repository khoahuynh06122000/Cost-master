# Sổ tay xử lý lỗi & bài học — app Kiểm kê F&B

> File này do bot **tự xuất** từ bảng `so_tay` + `su_co` sau mỗi lượt kiểm (8h, 17h). **Đừng sửa tay** — sửa trong app:
> *Sự cố hệ thống → Sổ tay & bài học* (chỉ admin). Bài học có **dấu hiệu nhận diện** thì bot tự báo ♻️ TÁI PHÁT khi lỗi quay lại.

Cập nhật: 09:36 26/11/2026 · 10 hướng dẫn · 23 bài học · 20 sự cố 30 ngày

## Mục lục
- [Hướng dẫn xử lý](#hướng-dẫn-xử-lý)
- [Bài học đã sửa](#bài-học-đã-sửa)
- [Sự cố 30 ngày gần đây](#sự-cố-30-ngày-gần-đây)

## Hướng dẫn xử lý

### Bộ phận báo lỗi đã sửa rồi mà vẫn gặp

- **Mức:** 🟡 NHẸ
- **Triệu chứng:** BP báo đúng lỗi đã sửa; câu chữ trên màn khác với bản hiện tại.
- **Kiểm tra:** Hỏi số "Phiên bản" cuối thanh bên; so với APP_VER mới nhất. Tin tóm tắt 8h có mục "Phiên bản" liệt kê ai còn bản cũ.
- **Xử lý:** Điện thoại: vuốt tắt hẳn app rồi mở lại. Máy tính: Ctrl+Shift+R. Vẫn không lên thì xem Vercel đã deploy xong chưa (1–2 phút sau khi đẩy).
- **Chặn tái phát:** Mỗi lần đẩy phải tăng APP_VER. Bật thông báo cho bộ phận mẫu "phiên bản app" khi có bản sửa quan trọng.

### Cần quay lại bản trước gấp

- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Bản vừa đẩy gây lỗi diện rộng, chưa kịp sửa.
- **Kiểm tra:** Xác định bản cuối chạy ổn (số APP_VER, commit).
- **Xử lý:** Vercel → Deployments → bản chạy ổn → Promote to Production. Nếu bản lỗi có chạy SQL mới: chạy câu hoàn tác ghi kèm trong SQL-tong-hop.sql. Bật thông báo cho bộ phận.
- **Chặn tái phát:** Bản có SQL: ghi sẵn câu hoàn tác và dấu hiệu phải quay bản trước khi đẩy.

### Người dùng quên PIN / PIN bị khoá

- **Mức:** 🟡 NHẸ
- **Triệu chứng:** Màn "Mã PIN đang bị khóa" sau 5 lần sai.
- **Kiểm tra:** Không cần kiểm gì thêm — khoá là đúng thiết kế.
- **Xử lý:** Người dùng bấm "Đăng nhập lại bằng mật khẩu" rồi đặt PIN mới. Quên cả mật khẩu: "Quên mật khẩu?" hoặc admin cấp lại mật khẩu.
- **Chặn tái phát:** Không tắt khoá 5 lần sai; không lưu PIN dạng đọc được ở bất kỳ đâu.

### Hàng đợi chờ gửi kẹt / chip "Mất mạng" không tắt

- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Chip mất mạng còn hiện dù có sóng; phiếu "(chờ gửi)" nằm nhiều ngày.
- **Kiểm tra:** Bấm chip để xem hàng đợi; Lỗi ghi nhận 24 giờ có lỗi máy chủ từ chối không (mục bị từ chối 3 lần thì kẹt).
- **Xử lý:** Mục bị máy chủ từ chối: đọc lý do, sửa dữ liệu rồi gửi lại hoặc nhờ BP nhập lại phần đó. KHÔNG xoá dữ liệu app trên máy BP khi còn mục chờ gửi.
- **Chặn tái phát:** Mọi lệnh ghi phải phân biệt lỗi MẠNG (xếp hàng đợi) với lỗi MÁY CHỦ TỪ CHỐI (báo ngay).

### Phiếu đã duyệt mà sổ thiếu dòng

- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Tin S1 "Phiếu đã duyệt mà sổ thiếu dòng" kèm danh sách mã chưa vào sổ.
- **Kiểm tra:** App → Nhập kho & ĐC → Toàn bộ phiếu yêu cầu → tìm mã phiếu; đối chiếu SL thực giao với sổ.
- **Xử lý:** Chèn đúng dòng còn thiếu, sao chép ngày / kho / lý do từ dòng anh em cùng phiếu (có điều kiện not exists để không chèn trùng).
- **Chặn tái phát:** Khớp mã phiếu bằng đuôi chính xác (dcLaDongSoCua), không dùng includes / like '%…%' — phiếu -2 dính phiếu gốc.

### Sổ điều chuyển ghi trùng

- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Tin S1 "Sổ điều chuyển bị ghi trùng"; kho nguồn bị trừ hai lần.
- **Kiểm tra:** App → Nhập kho & ĐC → Theo dõi sổ điều chuyển: dòng có nhãn "ghi trùng".
- **Xử lý:** Admin xoá đúng dòng thừa (nút 🗑 trên dòng ghi trùng). KHÔNG mở lại rồi duyệt lại phiếu — làm vậy ghi lại cả phiếu với ngày mới.
- **Chặn tái phát:** Nút duyệt phải khoá trong lúc ghi; ghi sổ một lệnh cả phiếu; kiểm phiếu đã duyệt / sổ đã có dòng trước khi ghi.

### Quét ảnh nhập kho không chạy

- **Mức:** 🟠 NẶNG
- **Triệu chứng:** BP báo quét ảnh lỗi; tin "Hàm máy chủ /api/ocr lỗi liên tục".
- **Kiểm tra:** Nhờ BP bấm "📋 Sao chép chi tiết lỗi". Đọc mã: chưa có khóa → khai khóa; Gemini 400/401/403 → khóa sai; 429 → hết lượt ngày; 503 → Google quá tải; 504 → ảnh quá nhiều / quá lâu.
- **Xử lý:** Bật thông báo cho bộ phận mẫu "quét ảnh" (tạm nhập Excel / gõ tay). Sửa theo đúng mã lỗi ở trên.
- **Chặn tái phát:** Không ghi cứng tên model Gemini; giữ cơ chế tự tìm model và giới hạn 54 giây trong api/ocr.js.

### Vercel vẫn chạy bản cũ / trang không mở được

- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Tin S1 "Vercel vẫn chạy bản cũ" hoặc "Trang app không mở được".
- **Kiểm tra:** Vercel → Deployments: bản mới nhất có trạng thái Error không, đọc log build.
- **Xử lý:** Lỗi build: sửa rồi đẩy lại. Cần gấp: Vercel → bản trước đó → Promote to Production (quay lại bản chạy được).
- **Chặn tái phát:** Trước khi đẩy luôn chạy kiểm cú pháp (ck.js) cho index.html và node --check cho api/*.js.

### Không ai đăng nhập được / Supabase trả 402

- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Mọi người cùng lỗi; tin S1 "Máy chủ dữ liệu không trả lời"; Supabase báo vượt hạn mức.
- **Kiểm tra:** Supabase → Usage: Egress kỳ này. Tin tóm tắt 8h mục Egress (dự báo, bảng tải nhiều nhất).
- **Xử lý:** Nâng gói Pro ngay (có hiệu lực tức thì). Bật thông báo cho bộ phận mẫu "đăng nhập".
- **Chặn tái phát:** Theo dõi dự báo Egress mỗi sáng; >80% thì xem bảng egress_ngay để giảm tải trước khi vượt.

### Không gửi được phiếu: "JWT expired" / phiên hết hạn

- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Hộp lỗi có chữ JWT expired hoặc PGRST301, thường sau khi máy khoá màn lâu.
- **Kiểm tra:** Lỗi ghi nhận 24 giờ: có nhiều người cùng lỗi không; họ đang chạy bản nào (bản cũ trước 3010-06 chưa có tự gia hạn).
- **Xử lý:** Bảo BP đóng hẳn app mở lại (số vẫn ở nháp, đừng nhập lại). Nếu vẫn lỗi: đăng xuất rồi đăng nhập lại.
- **Chặn tái phát:** fetchGiaHan tự gia hạn phiên một lần rồi gửi lại — đừng gỡ khi sửa phần kết nối Supabase.

## Bài học đã sửa

### Cổng gửi thông báo nhận địa chỉ bất kỳ + vài chỗ dễ thiếu dữ liệu

- **Sửa:** 26/11/2026 · bản `2611-01`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** agent rà soát báo push-send không kiểm endpoint, opening_stock đọc không phân trang, model Claude sai tên, nhập kho SAP cập nhật từng dòng dễ quá 60 giây
- **Nguyên nhân gốc:** push-send gọi fetch tới mọi URL client gửi lên; opening_stock dùng select('*') một lần (cắt ở 1.000 dòng); claude-sonnet-5 không tồn tại; vòng for await tuần tự
- **Cách sửa:** push-send chỉ gửi tới máy chủ Web Push chuẩn (https, FCM/WNS/Apple/Mozilla, không cổng lạ); opening_stock qua fetchAllRows; model claude-sonnet-5-5; nhap-kho-sap chayGioi 8 lệnh song song; vercel.json thêm nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy
- **Chặn tái phát:** cổng /api gọi ra ngoài theo địa chỉ client gửi phải có danh sách cho phép; mọi bảng có thể vượt 1.000 dòng đọc qua fetchAllRows; vòng ghi Supabase trong hàm Vercel chạy song song có giới hạn

### Bot cảnh báo nhiễu vì sổ lỗi ghi cả thông báo chặn nghiệp vụ

- **Sửa:** 26/11/2026 · bản `2611-02`
- **Mức:** 🟡 NHẸ
- **Triệu chứng:** danh sách lỗi người dùng đầy "Phiếu đã quá hạn duyệt 48 giờ", "Kho đang kiểm kê", "Dữ liệu chưa được đưa lên… do mạng", "Script error." — không phải lỗi app
- **Nguyên nhân gốc:** ghiLoiApp ghi MỌI errBox và mọi window.onerror, kể cả hộp chặn đúng luật và lỗi script khác nguồn (trình duyệt giấu chi tiết)
- **Cách sửa:** LOI_KHONG_GHI bỏ 5 tiêu đề chặn nghiệp vụ / báo mất mạng; bỏ "Script error." không chi tiết
- **Chặn tái phát:** hộp báo chặn đúng luật thêm tiêu đề vào LOI_KHONG_GHI; sổ lỗi chỉ dành cho lỗi thật

### Bot báo cáo 8h và bot cảnh báo chạy trễ nhiều tiếng

- **Sửa:** 25/11/2026 · bản `2511-01`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Tin tiến độ kiểm kê 8h tới chiều; cảnh báo lỗi app trễ 4-5 tiếng
- **Nguyên nhân gốc:** Lịch tự chạy (schedule) của GitHub Actions gói miễn phí bị xếp hàng trễ 4-10 tiếng
- **Cách sửa:** api/bot.js chạy nguyên agent/report.mjs + agent/canh-bao.mjs bằng tiến trình con, gọi bằng Vercel Cron (CRON_SECRET); GitHub chỉ còn bấm tay + cập nhật sổ tay; bot ghi giờ chạy vào bao_mat_cau_hinh thay cho đọc lịch sử Actions
- **Chặn tái phát:** Việc cần đúng giờ không đặt trên lịch GitHub Actions — dùng Vercel Cron

### Cổng API mở cho người lạ khi thiếu cấu hình / không kiểm đăng nhập

- **Sửa:** 25/11/2026 · bản `2511-05`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** agent rà bảo mật báo /api/nhac-dc fail-open khi thiếu CRON_SECRET và /api/ocr không kiểm người gọi
- **Nguyên nhân gốc:** nhac-dc chỉ kiểm khóa khi biến CRON_SECRET có đặt; ocr nhận POST của bất kỳ ai
- **Cách sửa:** lib/xac-thuc.js (dungCron so khóa an toàn thời gian, phienHopLe hỏi Supabase /auth/v1/user); nhac-dc thiếu CRON_SECRET thì trả 503, sai khóa 401; ocr bắt buộc phiên đăng nhập, app gửi kèm access_token
- **Chặn tái phát:** mọi cổng /api phải đóng khi thiếu biến môi trường (fail-closed) và kiểm người gọi ngay dòng đầu; dùng chung lib/xac-thuc.js

### Hàm máy chủ dựng địa chỉ gọi nội bộ từ header Host và cổng tự hủy phiếu không xác thực

- **Sửa:** 25/11/2026 · bản `2511-02`
- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Agent harness báo: /api/het-han-dc không kiểm xác thực; het-han-dc / nhac-dc / mo-ky-kiem-ke lấy x-forwarded-host làm appUrl
- **Nguyên nhân gốc:** appUrl dựng từ header do người gọi tự đặt, rồi fetch(appUrl + '/api/push-send') kèm x-service-key — giả Host là lộ khóa service role; het-han-dc mở cho mọi người
- **Cách sửa:** lib/app-url.js cố định APP_URL (biến môi trường hoặc địa chỉ thật), bỏ hẳn đọc header Host; het-han-dc bắt buộc CRON_SECRET hoặc phiên đăng nhập hợp lệ, app gửi kèm token; bỏ workflow GitHub het-han-dc.yml (không có mật khẩu)
- **Chặn tái phát:** Không bao giờ dựng URL gọi đi từ header của request; mọi cổng /api phải có xác thực

### Màn nhập mã PIN giật, lag trên máy tính

- **Sửa:** 25/11/2026 · bản `2511-04`
- **Mức:** 🟡 NHẸ
- **Triệu chứng:** PC rê chuột bấm số PIN thấy màn giật, phím phản hồi chậm
- **Nguyên nhân gốc:** nền màn đăng nhập vẫn chạy đủ 60 hiệu ứng sau thẻ PIN; mỗi lần rê chuột 6 lớp nền nghiêng + vệt sáng theo chuột vẽ lại cả màn; vệt sáng mép thẻ chạy bằng left (tính lại bố cục mỗi khung), lời chào dùng clip-path + filter (chạy trên luồng chính, đúng lúc đang tải dữ liệu)
- **Cách sửa:** màn PIN gắn lớp pin-tinh: dừng hiệu ứng nền (giữ khung hình), tắt nghiêng theo chuột, ẩn sao băng và vệt sáng chuột; lcEdge chạy bằng transform; pinGlow bằng opacity; lời chào hiện từng chữ bằng opacity + transform; bỏ blur khi thẻ rời đi
- **Chặn tái phát:** hiệu ứng trên màn đăng nhập / PIN chỉ dùng transform + opacity; không animate left/width/filter/clip-path; không để hiệu ứng nền chạy sau màn cần gõ phím

### Tin kiểm tra app tuần báo sai và lọt vào nhóm Teams Bếp

- **Sửa:** 23/11/2026 · bản `2311-01`
- **Mức:** 🟡 NHẸ
- **Triệu chứng:** Nhóm Teams Bếp nhận tin 'KIỂM TRA APP TUẦN… receipts vượt ngưỡng 2000' và danh sách phiếu kiểm kê cũ
- **Nguyên nhân gốc:** kiem-tuan.mjs còn so số dòng với ngưỡng 1.000/2.000 dù app đã phân trang (fetchAllRows) từ 1910-02; mục ≥30% mã bằng 0 báo lại cả phiếu đã duyệt; tin gửi qua TEAMS_PERSONAL_URL mà link đó đổ vào nhóm Bếp
- **Cách sửa:** Kiểm app có tải bảng lớn bằng fetchAllRows thay cho đếm ngưỡng; chỉ soát phiếu Chờ duyệt; tin kiểm tra tuần + báo lỗi bot 8h gửi Telegram của Khoa
- **Chặn tái phát:** Tin kỹ thuật chỉ gửi Telegram của Khoa, không qua link Teams; luật kiểm của bot phải sửa theo khi app đã sửa gốc
- **Dấu hiệu nhận diện (bot canh):** `VƯỢT ngưỡng app tải được`

### Màn đăng nhập giật, không mượt sau khi thay nền ảnh Bà Nà

- **Sửa:** 21/11/2026 · bản `2111-04`
- **Mức:** 🟡 NHẸ
- **Triệu chứng:** Màn đăng nhập bản 2111-03 giật từng nhịp, hiệu ứng mây/sao không mượt
- **Nguyên nhân gốc:** 7 lớp phủ toàn màn dùng mix-blend-mode:screen và 5 lớp có filter blur 16-34px vẫn chạy animation nên GPU phải trộn + làm mờ lại cả màn mỗi khung hình; vệt sáng mây animate background-position (vẽ lại toàn màn mỗi khung); rê chuột đổi biến CSS trên #login làm tính lại kiểu cả khung đăng nhập mỗi khung hình
- **Cách sửa:** Bỏ mix-blend-mode và filter blur/drop-shadow trên lớp chuyển động (gradient vốn đã mờ; cột sáng dùng mask), vệt sáng chạy bằng transform, will-change cho lớp dịch theo chuột, JS đặt transform thẳng lên 6 lớp nền và biến đèn chuột lên đúng phần tử đèn
- **Chặn tái phát:** Hiệu ứng chạy liên tục chỉ animate transform/opacity; không đặt mix-blend-mode hay filter blur lên lớp toàn màn đang chuyển động; không đổi biến CSS trên phần tử cha lớn mỗi khung hình

### Bot cảnh báo báo lúc 3h sáng, một phiếu báo thành nhiều tin, gắn nhầm nhãn tái phát

- **Sửa:** 17/11/2026 · bản `1611-22`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Telegram nhận tin lúc 3h sáng; một phiếu ghi trùng nhiều mã thành nhiều tin KHẨN; tin ghi đã sửa ở bản 2409-11 mà vẫn báo khẩn; bot học từ commit lỗi All object keys must match
- **Nguyên nhân gốc:** GitHub chạy lịch trễ (lịch 17h chạy lúc 3h); sổ trùng gom theo từng dòng mã thay vì theo phiếu; bài học khớp theo đầu mã dấu hiệu (so_trung|, so_thieu|) nên mọi sổ trùng / thiếu đều bị gắn tái phát; sổ lấy theo ngày ghi sổ nên phiếu ghi lùi kỳ cũ bị coi là thiếu dòng; insert nhiều bài học thiếu khoá
- **Cách sửa:** Lượt chạy theo lịch ngoài khung 7–12h và 16–21h thì bỏ qua; gom sổ trùng theo phiếu (một tin, liệt kê các mã); lấy sổ theo lúc ghi + hỏi lại sổ của đúng phiếu trước khi báo thiếu; bài học chỉ khớp câu lỗi người dùng; chuẩn hoá đủ khoá khi ghi bài học
- **Chặn tái phát:** Báo động phải gom theo đối tượng nghiệp vụ (phiếu, kho), không theo từng dòng; nhãn tái phát chỉ dùng khi đúng câu lỗi cũ quay lại; bot theo lịch phải tự kiểm khung giờ

### Bot báo 18 phiếu sổ thiếu dòng oan vì chỉ đọc 1.000 dòng sổ

- **Sửa:** 17/11/2026 · bản `1611-22`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Tin KHẨN 18 phiếu đã duyệt mà sổ thiếu dòng cùng lúc; tin bot tự huỷ phiếu không chạy
- **Nguyên nhân gốc:** Bot đọc transfers một lần — Supabase chỉ trả tối đa 1.000 dòng nên phần sổ còn lại bị coi là thiếu; GitHub chạy lịch mỗi giờ thực tế 5–9 tiếng một lần nhưng ngưỡng báo là 3 tiếng
- **Cách sửa:** Hàm qDu đọc đủ mọi trang (limit 1000 + offset, sắp theo khoá ổn định) cho sổ, phiếu, lỗi, Egress; ngưỡng bot tự huỷ phiếu 14 giờ
- **Chặn tái phát:** Mọi truy vấn bảng có thể quá 1.000 dòng — kể cả trong bot / agent — phải phân trang; ngưỡng giám sát lịch GitHub phải tính độ trễ thực tế

### Bản kiểm PIN lưu trên máy có thể bị dò offline

- **Sửa:** 16/11/2026 · bản `1611-21`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Mất mạng vẫn mở app được bằng PIN kiểm trên máy; ai lấy được dữ liệu trình duyệt có thể dò ra PIN 6 số
- **Nguyên nhân gốc:** Để BP mở app lúc mất sóng, app lưu bản băm PIN trong localStorage
- **Cách sửa:** Bỏ hẳn bản kiểm trên máy (xoá kk_pin_v1 khi mở app); mất mạng hiện màn Chưa kết nối mạng, có mạng tự mở màn PIN; app đang mở rớt mạng vẫn đếm tiếp
- **Chặn tái phát:** Không lưu bất kỳ dạng nào của PIN / mật khẩu trên máy người dùng; mọi lần mở khoá phải qua máy chủ

### Mã PIN dò được bằng nhiều yêu cầu song song

- **Sửa:** 16/11/2026 · bản `1611-19`
- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Gửi hàng loạt yêu cầu kiểm PIN cùng lúc thì bộ đếm sai 5 lần không khoá kịp.
- **Nguyên nhân gốc:** api/pin.js đọc so_sai rồi mới ghi so_sai+1 — các yêu cầu song song cùng thấy so_sai = 0.
- **Cách sửa:** Mỗi lần thử phải tăng so_sai bằng lệnh có điều kiện rồi mới được so PIN; thử 60 yêu cầu song song chỉ so 5 lần.
- **Chặn tái phát:** Mọi bộ đếm giới hạn số lần (PIN, mật khẩu, OTP) phải giành lượt bằng cập nhật có điều kiện trên máy chủ TRƯỚC khi kiểm.

### Lách được màn PIN khi chặn yêu cầu kiểm PIN hoặc gọi hàm bằng F12

- **Sửa:** 16/11/2026 · bản `1611-20`
- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Máy chưa có bản kiểm ngoại tuyến mà /api/pin lỗi thì app cho vào thẳng; 401 cũng cho qua; F12 gọi thẳng hàm là vào app.
- **Nguyên nhân gốc:** pinQua có nhánh cho qua khi không kiểm được; PIN chỉ là màn khoá phía trình duyệt, dữ liệu không đòi PIN.
- **Cách sửa:** Bỏ mọi nhánh cho qua; cổng RLS chỉ trả dữ liệu cho phiên đã nhập đúng PIN, app bắt lỗi PIN_KHOA để hỏi lại PIN.
- **Chặn tái phát:** Lớp bảo mật nào cũng phải được máy chủ cưỡng chế; nhánh lỗi của bước xác thực luôn là TỪ CHỐI.

### Ai cũng gửi được thông báo đẩy kèm đường link tuỳ ý

- **Sửa:** 16/11/2026 · bản `1611-20`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** /api/push-send nhận yêu cầu không cần đăng nhập, link có thể dẫn ra trang lừa đảo.
- **Nguyên nhân gốc:** Hàm máy chủ không kiểm người gọi, không lọc url; service worker mở mọi url.
- **Cách sửa:** Bắt buộc phiên đăng nhập hoặc khoá service role của bot; url chỉ nhận đường dẫn nội bộ; service worker chặn link khác origin.
- **Chặn tái phát:** Mọi hàm /api phải xác thực người gọi ở máy chủ; link do dữ liệu bên ngoài đưa vào phải ép về đường dẫn nội bộ.

### Không gửi được phiếu vì phiên hết hạn

- **Sửa:** 30/10/2026 · bản `3010-06`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Gửi phiếu kiểm kê báo "JWT expired" sau khi điện thoại khoá màn lâu.
- **Nguyên nhân gốc:** Bộ hẹn giờ tự gia hạn phiên của supabase-js bị trình duyệt tạm dừng khi app chạy nền.
- **Cách sửa:** fetchGiaHan: gặp 401 JWT expired thì gia hạn một lần rồi gửi lại.
- **Chặn tái phát:** Không gỡ fetchGiaHan khi sửa phần khởi tạo Supabase.
- **Dấu hiệu nhận diện (bot canh):** `JWT expired`

### Quét ảnh lỗi 504 vì quá giờ — ♻️ tái phát 1 lần

- **Sửa:** 20/10/2026 · bản `2010-01`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Quét phiếu dài trả 504, không có lý do.
- **Nguyên nhân gốc:** Gemini 2.5/3.x mặc định "suy nghĩ" trước khi trả lời → vượt 60 giây của Vercel.
- **Cách sửa:** Hạ mức suy nghĩ theo model; mỗi lượt gọi có hạn giờ, tự trả 504 kèm lý do trước mốc 54 giây.
- **Chặn tái phát:** Giữ thinkCfg và giới hạn giờ trong api/ocr.js; phiếu dài thì chụp từng tờ.
- **Dấu hiệu nhận diện (bot canh):** `Đọc ảnh quá lâu`
- **Tái phát gần nhất:** 17:38 24/11/2026

### Nhập kho bị quét lặp nhiều lần

- **Sửa:** 19/10/2026 · bản `1910-03`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Cùng ngày + mã + SL lưu 5–7 lần ở 4 kho bếp.
- **Nguyên nhân gốc:** Lưu một phần mà báo lỗi đỏ (uid trùng) + không thấy hàng đã nhập (giới hạn 1.000 dòng) → BP quét lại cả phiếu.
- **Cách sửa:** Sửa uid + phân trang; thêm cột Người nhập để truy ai quét lúc nào; dọn 1.639 dòng (có bảng sao lưu).
- **Chặn tái phát:** Báo lỗi phải nói đúng phần nào đã lên máy chủ, phần nào chưa — báo sai làm người dùng nhập lại.

### Danh mục kho / nhập kho thiếu dữ liệu vì giới hạn 1.000 dòng

- **Sửa:** 19/10/2026 · bản `1910-01`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Lỗi trùng khoá plant_materials_pkey khi nhập kho; tồn ước tính thiếu phần nhập cũ.
- **Nguyên nhân gốc:** select('*') không phân trang — Supabase chỉ trả 1.000 dòng đầu.
- **Cách sửa:** Tải qua fetchAllRows (phân trang, sắp theo khoá ổn định).
- **Chặn tái phát:** Mọi bảng có thể quá 1.000 dòng phải đi qua fetchAllRows.
- **Dấu hiệu nhận diện (bot canh):** `plant_materials_pkey`

### Lưu phân quyền làm người dùng mất sạch kho

- **Sửa:** 16/10/2026 · bản `1610-08`
- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Gán kho mới cho người dùng thì họ mất cả kho cũ, app vẫn báo "Đã lưu".
- **Nguyên nhân gốc:** Lưu bằng xoá rồi chèn, không kiểm lỗi chèn; kho mới chưa có trong bảng plants (khoá ngoại) nên chèn trượt.
- **Cách sửa:** Chèn phần thêm trước, lỗi thì dừng; chèn được mới gỡ phần bỏ tick. SQL thêm plants/slocs cho kho mới.
- **Chặn tái phát:** Thao tác "xoá rồi ghi lại" phải đảo thành "ghi trước, xoá sau" và kiểm error từng bước. Thêm kho vào DATA thì thêm cả plants/slocs.
- **Dấu hiệu nhận diện (bot canh):** `user_plants_plant_code_fkey`

### Lưu nhập kho lỗi trùng khoá receipts_pkey

- **Sửa:** 16/10/2026 · bản `1610-02`
- **Mức:** 🟠 NẶNG
- **Triệu chứng:** Thêm tất cả sau quét ảnh báo duplicate key receipts_pkey.
- **Nguyên nhân gốc:** uid() quá ngắn (5 ký tự thời gian + 2 số ngẫu nhiên) → 20 dòng cùng mili-giây trùng 89%.
- **Cách sửa:** uid mới: thời gian đầy đủ + bộ đếm + 3 ký tự ngẫu nhiên; ghi từng dòng, dòng trượt ở lại bảng xem trước.
- **Chặn tái phát:** Mã sinh ở client phải có bộ đếm tăng dần, không chỉ dựa thời gian + ngẫu nhiên ngắn.
- **Dấu hiệu nhận diện (bot canh):** `receipts_pkey`

### Phiếu gốc và phiếu -2 dính dòng sổ của nhau

- **Sửa:** 24/09/2026 · bản `2409-11`
- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Duyệt phiếu gốc bị chặn oan; xoá phiếu gốc xoá luôn dòng sổ của phiếu -2.
- **Nguyên nhân gốc:** Tìm dòng sổ bằng reason.includes(id) — mã gốc nằm trọn trong mã -2.
- **Cách sửa:** Helper dcLaDongSoCua khớp đuôi chính xác, thay 6 chỗ; máy chủ dùng like '%'||id rồi lọc lại.
- **Chặn tái phát:** Mã có hậu tố -2/-3: không so khớp bằng includes / like '%…%' / replace.

### Hai điểm bán trùng mã phiếu điều chuyển

- **Sửa:** 24/09/2026 · bản `2409-02`
- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Nhiều phiếu khác hàng nhưng cùng một mã trong một ngày.
- **Nguyên nhân gốc:** nextDCId đếm phiếu nó đọc được, mà RLS giấu phiếu kho khác → hai kho cùng lấy một mã.
- **Cách sửa:** insTrReqSafe tự nhảy hậu tố khi trùng khoá + unique index trên máy chủ + mã mới mang cả hai đầu kho.
- **Chặn tái phát:** Không bao giờ cấp mã bằng cách đếm dữ liệu client đọc được; máy chủ phải có ràng buộc unique.
- **Dấu hiệu nhận diện (bot canh):** `transfer_requests_id_uniq`

### Phiếu điều chuyển ghi sổ hai lần

- **Sửa:** 15/09/2026 · bản `1509`
- **Mức:** 🔴 KHẨN
- **Triệu chứng:** Phiếu DC-1040-2017-20260915 nằm hai lần trong sổ, hàng bị trừ kho gấp đôi.
- **Nguyên nhân gốc:** Nút Duyệt không khoá trong lúc ghi; ghi từng mã mất vài giây, người duyệt bấm lại.
- **Cách sửa:** Khoá nút + cờ _dangDuyet + kiểm phiếu đã duyệt / sổ đã có dòng trước khi ghi.
- **Chặn tái phát:** Mọi nút ghi dữ liệu phải khoá trong lúc chạy; kiểm trạng thái trên máy chủ trước khi ghi.

## Sự cố 30 ngày gần đây

| Mã | Mức | Sự cố | Mở lúc | Đóng | Trạng thái |
|---|---|---|---|---|---|
| SC-2411-01 | 🟠 NẶNG | Tái phát: Quét ảnh lỗi 504 vì quá giờ | 17:38 24/11/2026 | 09:09 26/11/2026 | Đã xử lý |
| SC-1711-02 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-03 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-04 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-05 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-06 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-07 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-08 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-09 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-10 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-01 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-11 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-12 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-13 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-14 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-15 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-16 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-17 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-18 | 🔴 KHẨN | Phiếu đã duyệt mà sổ thiếu dòng | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
| SC-1711-19 | 🟠 NẶNG | Bot tự huỷ phiếu quá hạn không chạy | 03:00 17/11/2026 | 08:44 17/11/2026 | Đã ổn lại |
