// lib/telegram.js — GỬI CẢNH BÁO VỀ TELEGRAM CỦA KHOA (16/11/2026).
// Dùng chung cho hàm máy chủ Vercel (require) và bot GitHub (createRequire).
//
// Luật Khoa chốt: chỉ gửi cho MỘT người (TELEGRAM_CHAT_ID của Khoa); 22h -> 8h sáng (giờ VN) KHÔNG gửi,
// trừ mức S1. Tin bị hoãn thì trả { hoan:true } để bot gom vào tin tóm tắt 8h.
// Bot của Khoa đang có webhook (dịch vụ khác) — chỉ GỬI tin (sendMessage), không đọc tin (getUpdates), nên không đụng nhau.

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
const GIO_NGU = 22, GIO_THUC = 8;

function gioVN(d) { return new Date((d ? d.getTime() : Date.now()) + 7 * 3600e3).getUTCHours(); }
function dangNgu(d) { const h = gioVN(d); return h >= GIO_NGU || h < GIO_THUC; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// noiDung: chuỗi (đã là HTML an toàn — tự esc phần động trước khi ghép). muc: 'S1' | 'S2' | 'S3' | 'INFO'.
async function guiTelegram(noiDung, opt) {
  const o = opt || {};
  if (!TOKEN || !CHAT) return { ok: false, loi: 'chua_cau_hinh' };
  if (o.muc !== 'S1' && !o.boQuaGioNgu && dangNgu()) return { ok: false, hoan: true };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), o.hetGio || 8000);
  try {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: String(noiDung).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    return j && j.ok ? { ok: true } : { ok: false, loi: 'telegram ' + r.status + ': ' + String((j && j.description) || '').slice(0, 200) };
  } catch (e) {
    return { ok: false, loi: String(e.message || e).slice(0, 200) };
  } finally { clearTimeout(t); }
}

module.exports = { guiTelegram, dangNgu, gioVN, esc, GIO_NGU, GIO_THUC };
