
## NHẮC DUYỆT ĐIỀU CHUYỂN CHUYỂN SANG 17H (VERCEL CRON) — 23/11/2026
Khoa: tin nhắc tag người duyệt cả phiếu vừa lập (Cổng thành 1 duyệt xong vẫn thấy mình bị tag) → *"báo theo 17h hàng ngày"*.
- **Lịch GitHub trễ 6–8 tiếng mỗi ngày** (đo 12 ngày: cron 01:00 UTC chạy 07:07–08:37 UTC; canh-bao 10:00 UTC chạy 17–19h UTC;
  het-han-dc "mỗi giờ" thực tế 5–9 tiếng/lần). Tin "8h sáng" thực tế tới 14h30–15h30. **Việc cần đúng giờ KHÔNG đặt trên GitHub cron.**
- Phần nhắc duyệt ĐC tách khỏi `agent/report.mjs` sang `lib/nhac-dc.js` + `api/nhac-dc.js`, gọi bằng **Vercel Cron** `0 10 * * *`
  (17h VN; gói Hobby nổ trong khoảng 17:00–17:59). Chụp phiếu Chờ duyệt đúng lúc chạy, tin ghi "chốt lúc HH:MM ngày dd/mm",
  tag người duyệt (giám sát; không có thì bếp trưởng), tách BẾP / NHÀ HÀNG; chuông `dcnhac` + push mỗi kho một lần/ngày.
- **Không bắt Khoa khai biến trên Vercel** (Khoa: "sao em không chỉnh code mà anh phải đi chỉnh"): workflow
  `dong-bo-cau-hinh.yml` (chạy khi push + mỗi ngày) chép `TEAMS_FLOW_URL` / `TEAMS_FLOW_URL_BEP` / `TEAMS_THE` từ GitHub
  secrets vào bảng kín `bao_mat_cau_hinh` (k = teams_nh / teams_bep / teams_the; chỉ service role đọc được), `lib/nhac-dc.js`
  đọc từ đó khi Vercel không có biến. Link Teams KHÔNG ghi trong code (repo công khai).
- Chống gọi bừa (không có CRON_SECRET): chỉ chạy 17:00–18:59 VN + MỘT lần/ngày (khóa dòng `nhacdc_ngay` trong bao_mat_cau_hinh).
  Có đặt `CRON_SECRET` thì bắt buộc đúng header. `?thu=1` (chỉ dựng tin) cần CRON_SECRET.
- Tin 8h (report.mjs) giờ chỉ còn tiến độ kiểm kê tháng + kiểm kê tuần.
