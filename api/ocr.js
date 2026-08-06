// api/ocr.js — Vercel serverless: đọc ảnh biên bản NHẬP KHO (bản in) -> JSON dòng hàng.
// Gọi Gemini Vision REST thẳng (khỏi npm dep).
// Key đọc từ env Vercel (thử lần lượt, key trước hết lượt/429 thì nhảy key sau):
//   AI_API_KEY, AI_API_KEY2, AI_API_KEY3  (tương thích cả GEMINI_API_KEY / GEMINI2_API_KEY / GEMINI3_API_KEY của app beer).
// Client gửi POST { images:["data:image/jpeg;base64,..."] }  -> trả { rows:[{code,name,uom,qty}], raw }.

const AI_KEYS = [
  process.env.AI_API_KEY,  process.env.AI_API_KEY2,  process.env.AI_API_KEY3,
  process.env.GEMINI_API_KEY, process.env.GEMINI2_API_KEY, process.env.GEMINI3_API_KEY,
].map((k) => (k || '').trim()).filter(Boolean);
const AI_MODEL = process.env.AI_MODEL_VISION || process.env.AI_MODEL || 'gemini-2.5-flash';

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

    // Thử lần lượt từng key. 429/hết lượt/hết quota (403,401) -> nhảy key kế. Lỗi khác -> báo luôn.
    let j = null, lastErr = '';
    for (let i = 0; i < AI_KEYS.length; i++) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${AI_KEYS[i]}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody }
      );
      if (r.ok) { j = await r.json(); break; }
      const t = await r.text().catch(() => '');
      lastErr = `key#${i + 1} lỗi ${r.status}: ${t.slice(0, 200)}`;
      // key hết lượt / không hợp lệ -> thử key tiếp; các lỗi này mới đáng nhảy key
      const canFallback = [429, 401, 403].includes(r.status) || /RESOURCE_EXHAUSTED|quota|rate/i.test(t);
      if (!canFallback || i === AI_KEYS.length - 1) {
        res.status(502).json({ error: `Gemini lỗi ${r.status}`, detail: t.slice(0, 300) });
        return;
      }
    }
    if (!j) { res.status(502).json({ error: 'Tất cả key đều lỗi', detail: lastErr }); return; }

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
