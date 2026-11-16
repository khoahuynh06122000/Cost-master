// lib/ghi-loi.js — GHI LỖI CỦA HÀM MÁY CHỦ vào bảng loi_app (16/11/2026, mục A2 "Theo dõi & cảnh báo").
//
// Dùng: module.exports = bocLoi('ocr', async (req, res) => { ... })
// Bọc handler: hàm trả mã >= 500 (hoặc ném lỗi) thì ghi một dòng loi_app bằng khóa service role.
// - Không bao giờ làm hỏng phản hồi: mọi lỗi khi ghi đều nuốt, tối đa chờ 2,5 giây.
// - Không ghi nội dung yêu cầu (ảnh, PIN, khóa AI...). Chỉ ghi: hàm nào, mã lỗi, câu lỗi, chi tiết ngắn.
// - Chuỗi trông như khóa / token bị che trước khi ghi.

const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function che(s, n) {
  return String(s == null ? '' : s)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza***')
    .replace(/eyJ[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-.]+/g, 'jwt***')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')
    .replace(/(sk|key|token|secret)[-_]?[0-9A-Za-z]{16,}/gi, '$1***')
    .slice(0, n || 500);
}
function uidTuToken(req) {
  try {
    const a = String((req.headers && req.headers.authorization) || '');
    if (!a.startsWith('Bearer ')) return null;
    const p = JSON.parse(Buffer.from(a.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return /^[0-9a-f-]{36}$/i.test(p.sub || '') ? p.sub : null;
  } catch (e) { return null; }
}

async function ghiLoiMayChu(row) {
  if (!SERVICE_KEY) return;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2500);
  try {
    await fetch(SUPA_URL + '/rest/v1/loi_app', {
      method: 'POST', signal: ctl.signal,
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(Object.assign({ nguon: 'may_chu', loai: 'api', so_lan: 1 }, row)),
    });
  } catch (e) { /* nuốt — ghi lỗi không được phép làm hỏng thứ gì */ }
  finally { clearTimeout(t); }
}

function bocLoi(ten, handler) {
  return async (req, res) => {
    const T0 = Date.now();
    let ma = 200, than = null;
    const st0 = res.status.bind(res), js0 = res.json.bind(res);
    res.status = c => { ma = Number(c) || ma; return st0(c); };
    res.json = b => { than = b; return js0(b); };
    let nem = null;
    try { await handler(req, res); }
    catch (e) {
      nem = e;
      if (!res.headersSent) { try { st0(500); js0({ error: 'Lỗi máy chủ' }); } catch (e2) {} }
      ma = 500;
    }
    if (ma >= 500) {
      const b = than || {};
      await ghiLoiMayChu({
        man: '/api/' + ten,
        ma: String(ma),
        thong_diep: che(nem ? (nem.message || nem) : (b.error || ('HTTP ' + ma)), 300),
        chi_tiet: che([b.detail, nem && nem.stack ? String(nem.stack).split('\n').slice(0, 3).join(' | ') : '', 'mat ' + Math.round((Date.now() - T0) / 100) / 10 + 's'].filter(Boolean).join(' · '), 1000),
        user_id: uidTuToken(req),
      });
    }
  };
}

module.exports = { bocLoi, ghiLoiMayChu, che };
