// agent/thu-telegram.mjs — gửi MỘT tin thử để chắc kênh cảnh báo Telegram đã thông (chạy tay trên GitHub Actions).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { guiTelegram, esc } = require('../lib/telegram.js');

const gio = new Date(Date.now() + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
const kq = await guiTelegram(
  '✅ <b>Kiểm kê F&amp;B: kênh cảnh báo hoạt động</b>\n' +
  'Tin thử gửi lúc ' + esc(gio) + ' (giờ VN).\n' +
  'Từ giờ lỗi của app sẽ báo về đây · 22h → 8h chỉ báo lỗi S1.',
  { boQuaGioNgu: true });
if (!kq.ok) {
  console.error('Gửi thử KHÔNG được:', kq.loi === 'chua_cau_hinh' ? 'chưa có secret TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID' : kq.loi);
  process.exit(1);
}
console.log('Đã gửi tin thử về Telegram.');
