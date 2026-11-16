// agent/thu-telegram.mjs — gửi MỘT tin thử để chắc kênh cảnh báo Telegram đã thông (chạy tay trên GitHub Actions).
// Trượt thì in lý do bằng "::error::" để hiện ở phần Annotations (đọc được không cần đăng nhập) — KHÔNG in token.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { guiTelegram, esc } = require('../lib/telegram.js');

const tk = (process.env.TELEGRAM_BOT_TOKEN || '').trim(), ch = (process.env.TELEGRAM_CHAT_ID || '').trim();
const moTa = 'token: ' + (tk ? 'co (' + tk.length + ' ky tu, dang ' + (/^\d+:[\w-]{20,}$/.test(tk) ? 'hop le' : 'KHONG giong token bot') + ')' : 'THIEU')
  + ' · chat_id: ' + (ch ? 'co (' + ch.length + ' ky tu, ' + (/^-?\d+$/.test(ch) ? 'toan so' : 'KHONG phai so') + ')' : 'THIEU');
console.log(moTa);

const gio = new Date(Date.now() + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
const kq = await guiTelegram(
  '✅ <b>Kiểm kê F&amp;B: kênh cảnh báo hoạt động</b>\n' +
  'Tin thử gửi lúc ' + esc(gio) + ' (giờ VN).\n' +
  'Từ giờ lỗi của app sẽ báo về đây · 22h → 8h chỉ báo lỗi S1.',
  { boQuaGioNgu: true });
if (!kq.ok) {
  const ly = kq.loi === 'chua_cau_hinh' ? 'chua co secret TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID' : kq.loi;
  console.log('::error::Gui thu KHONG duoc — ' + ly + ' — ' + moTa);
  process.exit(1);
}
console.log('Đã gửi tin thử về Telegram.');
