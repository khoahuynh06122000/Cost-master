// api/ocr.js — Vercel serverless: đọc ảnh biên bản NHẬP KHO (bản in) -> JSON dòng hàng.
// Gọi Gemini Vision REST thẳng (khỏi npm dep). Key giấu trong env Vercel: AI_API_KEY.
// Client gửi POST { images:["data:image/jpeg;base64,..."] }  -> trả { rows:[{code,name,uom,qty}], raw }.

const AI_KEY   = process.env.AI_API_KEY || '';
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
  if (!AI_KEY) { res.status(500).json({ error: 'Server chưa cấu hình AI_API_KEY' }); return; }

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

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
        }),
      }
    );

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      res.status(502).json({ error: `Gemini lỗi ${r.status}`, detail: t.slice(0, 300) });
      return;
    }

    const j = await r.json();
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
