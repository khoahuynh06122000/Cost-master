// lib/app-url.js — địa chỉ app CỐ ĐỊNH để hàm máy chủ gọi nội bộ (push-send, tải index.html).
// RÀ BẢO MẬT 25/11/2026: KHÔNG được dựng từ header Host / x-forwarded-host — kẻ gọi giả Host là kéo được lệnh
// fetch (kèm x-service-key = khoá service role) sang máy của họ. Chỉ lấy biến APP_URL hoặc địa chỉ thật.
const APP_URL = (process.env.APP_URL || 'https://cost-master-sigma.vercel.app').trim().replace(/\/+$/, '');
module.exports = { APP_URL };
