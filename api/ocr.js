// api/ocr.js — Vercel serverless: đọc ảnh biên bản NHẬP KHO (bản in) -> JSON dòng hàng.
// Gọi Gemini Vision REST thẳng (khỏi npm dep).
// Key đọc từ env Vercel (thử lần lượt, key trước hết lượt/429 thì nhảy key sau):
//   AI_API_KEY, AI_API_KEY2, AI_API_KEY3  (tương thích cả GEMINI_API_KEY / GEMINI2_API_KEY / GEMINI3_API_KEY của app beer).
// Client gửi POST { images:["data:image/jpeg;base64,..."] }  -> trả { rows:[{code,name,uom,qty}], raw }.

const AI_KEYS = [
  process.env.AI_API_KEY,  process.env.AI_API_KEY2,  process.env.AI_API_KEY3,
  process.env.GEMINI_API_KEY, process.env.GEMINI2_API_KEY, process.env.GEMINI3_API_KEY,
].map((k) => (k || '').trim()).filter(Boolean);
// Mặc định gemini-2.0-flash: rẻ quota, hào phóng, ít bị 503 hơn 2.5-flash; vision đọc bảng in tốt.
// 2.5-flash giữ làm phao dự phòng trong danh sách MODELS bên dưới.
const AI_MODEL = process.env.AI_MODEL_VISION || process.env.AI_MODEL || 'gemini-2.0-flash';

const PROMPT = `Bạn là công cụ đọc CHỨNG TỪ NHẬP KHO in trên giấy của bộ phận F&B nhà hàng.
Chứng từ có thể mang tiêu đề "Phiếu nhập kho" HOẶC "Phiếu xuất điều chuyển" — cả hai đều là hàng NHẬP về kho, xử lý như nhau.
Ảnh chụp một bảng, mỗi dòng là một mặt hàng. Các cột thường gặp theo thứ tự:
STT | Mã hàng | Tên hàng | ĐVT (đơn vị tính) | Số lượng | Số lô | Đơn giá | Thành tiền.

Nhiệm vụ: đọc CHÍNH XÁC từng dòng hàng hóa và trả về DUY NHẤT một mảng JSON, không kèm chữ nào khác.
Mỗi phần tử: {"code": string, "name": string, "uom": string, "qty": number}

QUY TẮC BẮT BUỘC:
- "qty" LẤY TỪ CỘT "SỐ LƯỢNG". TUYỆT ĐỐI KHÔNG lấy nhầm cột "Số lô", "Đơn giá" hay "Thành tiền" (các cột này thường bằng 0).
- "qty" là SỐ. Dấu chấm là DẤU THẬP PHÂN (ví dụ 31.000 = 31; 2.5 = 2.5). KHÔNG hiểu dấu chấm là hàng nghìn.
- "code": mã hàng ở cột "Mã hàng". Nếu chứng từ KHÔNG có cột mã thì để chuỗi rỗng "".
- "name": tên hàng đúng như in, giữ dấu tiếng Việt (gộp cả phần bị xuống dòng, ví dụ "Nước khoáng Sun Aqua 520ml/chai").
- "uom": đơn vị tính (CHA=chai, kg, lít, thùng, cái, lon...). Không có thì để "".
- BỎ QUA: dòng tiêu đề bảng, "TỔNG CỘNG", chữ ký, header phiếu (tên công ty, kho xuất, kho nhập, ngày, số phiếu), phần "Số tiền viết bằng chữ".
- TUYỆT ĐỐI không bịa mặt hàng hay số lượng. Chỉ đọc thứ nhìn thấy rõ. Số nào mờ/không chắc thì bỏ qua dòng đó.`;

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      code: { type: 'STRING' },
      name: { type: 'STRING' },
      uom:  { type: 'STRING' },
      qty:  { type: 'NUMBER' },
    },
    required: ['name', 'qty'],
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Chỉ nhận POST' }); return; }
  if (!AI_KEYS.length) { res.status(500).json({ error: 'Server chưa cấu hình AI_API_KEY (env Vercel)' }); return; }

  try {
    // body có thể đã parse sẵn (Vercel) hoặc là string
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const images = Array.isArray(body?.images) ? body.images : (body?.image ? [body.image] : []);
    if (!images.length) { res.status(400).json({ error: 'Thiếu ảnh (images[])' }); return; }

    const parts = [{ text: PROMPT }];
    for (const u of images.slice(0, 4)) {
      const m = String(u).match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    if (parts.length === 1) { res.status(400).json({ error: 'Ảnh không hợp lệ (cần data:image;base64)' }); return; }

    const reqBody = JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
    });

    // Danh sách model: model chính + dự phòng khi quá tải (2.0-flash thường sẵn hơn 2.5).
    const MODELS = [...new Set([AI_MODEL, 'gemini-2.0-flash', 'gemini-2.5-flash'])];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Thử tổ hợp (model × key). Lỗi tạm thời/quá tải (429,500,502,503,quota,overload) -> thử tổ hợp kế.
    // 503 (quá tải) ở tổ hợp cuối -> chờ ngắn rồi thử lại 1 lần nữa.
    let j = null, lastStatus = 0, lastDetail = '', retried503 = false;
    const attempts = [];
    for (const model of MODELS) for (let i = 0; i < AI_KEYS.length; i++) attempts.push({ model, key: AI_KEYS[i], ki: i });

    for (let a = 0; a < attempts.length; a++) {
      const { model, key, ki } = attempts[a];
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody }
      );
      if (r.ok) { j = await r.json(); break; }
      const t = await r.text().catch(() => '');
      lastStatus = r.status; lastDetail = `${model}/key#${ki + 1}: ${t.slice(0, 160)}`;
      const overloaded = r.status === 503 || /UNAVAILABLE|overload|high demand/i.test(t);
      const transient = [429, 500, 502, 503].includes(r.status) || /RESOURCE_EXHAUSTED|quota|rate|internal/i.test(t);
      const canFallback = [401, 403].includes(r.status) || transient;
      const isLast = a === attempts.length - 1;
      if (isLast && overloaded && !retried503) { retried503 = true; await sleep(1500); a--; continue; } // chờ rồi thử lại tổ hợp cuối
      if (!canFallback || isLast) {
        const msg = overloaded ? 'Model AI đang quá tải — thử lại sau vài giây' : `Gemini lỗi ${r.status}`;
        res.status(overloaded ? 503 : 502).json({ error: msg, detail: lastDetail });
        return;
      }
    }
    if (!j) { res.status(503).json({ error: 'AI tạm thời không phản hồi — thử lại sau', detail: `${lastStatus} · ${lastDetail}` }); return; }

    const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let rows = [];
    try {
      rows = JSON.parse(raw);
    } catch {
      // phòng khi model bọc ```json ... ```
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) { try { rows = JSON.parse(m[0]); } catch {} }
    }
    if (!Array.isArray(rows)) rows = [];

    rows = rows
      .map((x) => ({
        code: String(x?.code || '').trim(),
        name: String(x?.name || '').trim(),
        uom:  String(x?.uom  || '').trim(),
        qty:  Number(x?.qty),
      }))
      .filter((x) => x.name && isFinite(x.qty) && x.qty > 0);

    res.status(200).json({ rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi xử lý OCR', detail: String(e && e.message || e).slice(0, 300) });
  }
};
