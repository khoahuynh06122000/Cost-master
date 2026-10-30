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
// 12/10/2026: Google đã TẮT gemini-2.0-flash (06/2026) và từ 18/09/2026 chỉ cấp
// gemini-2.5-flash cho dự án đã dùng nó từ trước — khóa BP mới tạo chỉ có đời 3.x.
// Nên alias 'gemini-flash-latest' (luôn trỏ bản Flash mới nhất) được thử TRƯỚC.
const AI_MODEL = process.env.AI_MODEL_VISION || process.env.AI_MODEL || '';

const PROMPT = `Bạn là công cụ đọc CHỨNG TỪ NHẬP KHO in trên giấy của bộ phận F&B nhà hàng.
Chứng từ có thể mang tiêu đề "Phiếu nhập kho" HOẶC "Phiếu xuất điều chuyển" — cả hai đều là hàng NHẬP về kho, xử lý như nhau.
Ảnh chụp một bảng, mỗi dòng là một mặt hàng. Các cột thường gặp theo thứ tự:
STT | Mã hàng | Tên hàng | ĐVT (đơn vị tính) | Số lượng | Số lô | Đơn giá | Thành tiền.

Nhiệm vụ: đọc CHÍNH XÁC từng dòng hàng hóa và trả về DUY NHẤT một mảng JSON, không kèm chữ nào khác.
Mỗi phần tử: {"code": string, "name": string, "uom": string, "qty": number, "ngay": string}

QUY TẮC BẮT BUỘC:
- "qty" LẤY TỪ CỘT "SỐ LƯỢNG". TUYỆT ĐỐI KHÔNG lấy nhầm cột "Số lô", "Đơn giá" hay "Thành tiền" (các cột này thường bằng 0).
- "qty" là SỐ. Dấu chấm là DẤU THẬP PHÂN (ví dụ 31.000 = 31; 2.5 = 2.5). KHÔNG hiểu dấu chấm là hàng nghìn.
- "code": mã hàng ở cột "Mã hàng". Nếu chứng từ KHÔNG có cột mã thì để chuỗi rỗng "".
- "name": tên hàng đúng như in, giữ dấu tiếng Việt (gộp cả phần bị xuống dòng, ví dụ "Nước khoáng Sun Aqua 520ml/chai").
- "uom": đơn vị tính (CHA=chai, kg, lít, thùng, cái, lon...). Không có thì để "".
- "ngay": NGÀY LẬP CHỨNG TỪ in ở phần đầu phiếu (Ngày ... tháng ... năm ..., hoặc ô "Ngày"), viết dạng dd/mm/yyyy. Mọi dòng của cùng một phiếu ghi cùng ngày đó; nhiều ảnh là nhiều phiếu thì mỗi dòng theo ngày của phiếu chứa nó. Không thấy rõ ngày thì để "". KHÔNG đoán ngày.
- BỎ QUA (không tạo dòng hàng): dòng tiêu đề bảng, "TỔNG CỘNG", chữ ký, header phiếu (tên công ty, kho xuất, kho nhập, số phiếu — riêng NGÀY thì ghi vào trường "ngay"), phần "Số tiền viết bằng chữ".
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
      ngay: { type: 'STRING' },
    },
    required: ['name', 'qty'],
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Chỉ nhận POST' }); return; }

  try {
    // body có thể đã parse sẵn (Vercel) hoặc là string
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    // Key RIÊNG của người dùng (nhập trong app, lưu ở máy họ) được ưu tiên trước key
    // chung của công ty: ai tự khai key thì thường vì key chung chưa có hoặc hết lượt.
    // KHÔNG ghi log key này ở bất cứ đâu; phần `detail` trả về chỉ ghi "key#N".
    const userKey = String(body?.key || '').trim();
    /* Model do client bao da chay duoc (nut "Thu khoa" tim ra roi nho lai).
       Dat len dau danh sach de khoi phai do lai tu dau moi lan quet. */
    const userModel = String(body?.model || '').trim();
    const modelOK = /^[a-zA-Z0-9._-]{3,60}$/.test(userModel) ? userModel : '';
    const keys = (userKey && userKey.length < 200 ? [userKey] : []).concat(AI_KEYS);
    if (!keys.length) {
      res.status(400).json({ error: 'Chưa có khóa AI — vào "Cài đặt AI quét ảnh" ở tab Nhập kho & ĐC, dán khóa rồi bấm Lưu khóa (khóa đi theo tài khoản)' });
      return;
    }
    const images = Array.isArray(body?.images) ? body.images : (body?.image ? [body.image] : []);
    if (!images.length) { res.status(400).json({ error: 'Thiếu ảnh (images[])' }); return; }

    const parts = [{ text: PROMPT }];
    for (const u of images.slice(0, 4)) {
      const m = String(u).match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    if (parts.length === 1) { res.status(400).json({ error: 'Ảnh không hợp lệ (cần data:image;base64)' }); return; }

    /* TẮT/GIẢM "suy nghĩ" của model (20/10/2026). Gemini 2.5 và 3.x mặc định tự suy nghĩ trước khi
       trả lời — đọc một phiếu 50-90 dòng mất 40-90s, vượt hạn 60s của Vercel -> BP thấy lỗi 504.
       Đọc bảng không cần suy luận. 2.5: thinkingBudget 0 · 3.x: thinkingLevel 'low'.
       Model nào không nhận tham số này (400) thì gửi lại đúng model đó KHÔNG kèm nó. */
    function thinkCfg(model) {
      if (/gemini-3/i.test(model)) return { thinkingLevel: 'low' };
      if (/gemini-2\.5/i.test(model)) return /pro/i.test(model) ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
      if (/latest/i.test(model)) return { thinkingLevel: 'low' };
      return null;
    }
    function bodyFor(model, coThink) {
      const gc = { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 };
      const tc = coThink ? thinkCfg(model) : null;
      if (tc) gc.thinkingConfig = tc;
      return JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: gc });
    }

    /* Danh sách thử sẵn. CHỈ là nước đi đầu — tên model của Google đổi theo thời
       gian và không phải khóa nào cũng có đủ; hết danh sách thì đi hỏi Google
       (modelCuaKhoa bên dưới) chứ không chịu thua. */
    const MODELS = [...new Set([modelOK, AI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean))];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    /* Ngân sách thời gian: Gemini đọc ảnh bảng mất 8-20s/lượt, mà vòng thử là
       (số model x số key). Hết ngân sách thì DỪNG và nói rõ, để người dùng nhận
       được câu trả lời thay vì bị Vercel cắt giữa chừng (client chỉ thấy 504). */
    const T0 = Date.now(), NGAN_SACH = 45000, HAN_CUNG = 54000;  // Vercel cắt ở 60s

    // Chấm điểm để lấy model đọc ảnh tốt nhất mà khóa đó thật sự có.
    // Chấm theo SỐ PHIÊN BẢN, không ghi cứng 2.5/2.0 — bản cũ trừ nặng "preview" và
    // không biết đời 3.x nên chọn trúng model đã tắt. Flash > Pro (Pro thường không miễn phí).
    function diemModel(n) {
      let d = 0;
      const v = String(n).match(/gemini-(\d+)(?:\.(\d+))?/i);
      if (v) d += (Number(v[1]) + Number(v[2] || 0) / 10) * 2;
      if (/flash/i.test(n)) d += 10; else if (/pro/i.test(n)) d += 3;
      if (/latest/i.test(n)) d += 0.5;
      if (/lite/i.test(n)) d -= 1;
      if (/preview|exp|thinking/i.test(n)) d -= 1.5;
      return d;
    }
    let dsKhoa = null;                      // null = chưa hỏi; [] = hỏi rồi, không có gì
    let hoiDuoc = false, soModelTho = 0;    // phân biệt "hỏi không được" với "hỏi được mà rỗng"
    async function modelCuaKhoa(key) {
      if (dsKhoa) return dsKhoa;
      dsKhoa = [];
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`);
        if (!r.ok) return dsKhoa;
        const d = await r.json();
        hoiDuoc = true; soModelTho = (d.models || []).length;
        dsKhoa = (d.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => String(m.name || '').replace(/^models\//, ''))
          .filter((n) => /gemini/i.test(n) && !/embed|aqa|tts|audio|image|live|learnlm|computer|robot|nano/i.test(n))
          .sort((a, b) => diemModel(b) - diemModel(a));
      } catch { dsKhoa = []; }
      return dsKhoa;
    }

    let j = null, lastStatus = 0, lastDetail = '', retried503 = false;
    let co404 = false, khongMienPhi = false, dungHan = null, modelDung = '';

    async function thuCacModel(models) {
      const attempts = [];
      for (const model of models) for (let i = 0; i < keys.length; i++) attempts.push({ model, key: keys[i], ki: i });
      for (let a = 0; a < attempts.length; a++) {
        const { model, key, ki } = attempts[a];
        if (Date.now() - T0 > NGAN_SACH) return { hetGio: a };
        /* Mỗi lượt gọi có hạn riêng = phần thời gian còn lại trước mốc 54s, để chính hàm này
           trả lời được (kèm lý do) thay vì bị Vercel cắt giữa chừng không một lời. */
        const goi = async (coThink) => {
          const ac = new AbortController();
          const tm = setTimeout(() => ac.abort(), Math.max(3000, HAN_CUNG - (Date.now() - T0)));
          try {
            return await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyFor(model, coThink), signal: ac.signal }
            );
          } finally { clearTimeout(tm); }
        };
        let r;
        try { r = await goi(true); }
        catch (e) { lastDetail = `${model}/key#${ki + 1}: qua ${Math.round((Date.now() - T0) / 1000)}s chua tra loi`; return { hetGio: a + 1 }; }
        if (r.status === 400 && thinkCfg(model)) {
          const t0 = await r.clone().text().catch(() => '');
          if (/think/i.test(t0)) {
            try { r = await goi(false); }
            catch (e) { lastDetail = `${model}/key#${ki + 1}: qua ${Math.round((Date.now() - T0) / 1000)}s chua tra loi`; return { hetGio: a + 1 }; }
          }
        }
        if (r.ok) { j = await r.json(); modelDung = model; return { ok: true }; }
        const t = await r.text().catch(() => '');
        lastStatus = r.status; lastDetail = `${model}/key#${ki + 1}: ${t.slice(0, 300)}`;
        if (r.status === 404 || /not found|is not supported|no longer available/i.test(t)) co404 = true;
        // 429 kèm "limit: 0" = model này KHÔNG miễn phí cho khóa đó -> coi như không có, thử model khác.
        if (r.status === 429 && /limit:\s*0\b/i.test(t)) { co404 = true; khongMienPhi = true; }
        const overloaded = r.status === 503 || /UNAVAILABLE|overload|high demand/i.test(t);
        const transient = [429, 500, 502, 503].includes(r.status) || /RESOURCE_EXHAUSTED|quota|rate|internal/i.test(t);
        /* 404 PHẢI đi tiếp. Trước đây nó rơi vào nhánh "dừng hẳn" nên model đầu
           tiên không tồn tại là cả vòng thử chết ngay — đúng lỗi 01/10/2026. */
        const canFallback = [401, 403, 404].includes(r.status) || transient;
        const isLast = a === attempts.length - 1;
        if (isLast && overloaded && !retried503) { retried503 = true; await sleep(1500); a--; continue; }
        if (!canFallback) { dungHan = { overloaded }; return { dung: true }; }
        if (isLast) return { het: true, overloaded };
      }
      return { het: true };
    }

    let kq = await thuCacModel(MODELS);
    // Hết danh sách ghi cứng mà toàn "không có model" -> hỏi Google rồi thử tiếp.
    if (!j && !kq.dung && kq.hetGio == null && co404) {
      const ds = (await modelCuaKhoa(keys[0])).filter((n) => MODELS.indexOf(n) < 0).slice(0, 4);
      if (ds.length) kq = await thuCacModel(ds);
    }

    if (!j) {
      if (kq.hetGio != null) {
        res.status(504).json({ error: 'Đọc ảnh quá lâu — thử lại với ít ảnh hơn',
          detail: `het ngan sach ${Math.round((Date.now() - T0) / 1000)}s sau ${kq.hetGio} luot · ${lastDetail}` });
        return;
      }
      const quaTai = (dungHan && dungHan.overloaded) || kq.overloaded;
      if (co404 && !quaTai) {
        /* Khóa qua được cửa xác thực (khóa sai thì Google trả 400) nhưng không có
           model đọc ảnh nào -> nói đúng chuyện đó, và kèm danh sách model khóa đó
           CÓ để còn lần ra được. */
        res.status(502).json({ error: 'Khóa AI này không dùng được model đọc ảnh nào',
          detail: `${khongMienPhi ? 'co model khong mien phi (limit 0) · ' : ''}da thu: ${MODELS.join(', ')} · khoa co: ${(dsKhoa && dsKhoa.length) ? dsKhoa.slice(0, 8).join(', ')
            : (hoiDuoc ? `0/${soModelTho} model dung duoc` : '(hoi Google khong duoc)')} · ${lastDetail}` });
        return;
      }
      const msg = quaTai ? 'Model AI đang quá tải — thử lại sau vài giây'
                : (lastStatus ? `Gemini lỗi ${lastStatus}` : 'AI tạm thời không phản hồi — thử lại sau');
      res.status(quaTai ? 503 : 502).json({ error: msg, detail: lastDetail || String(lastStatus) });
      return;
    }

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
        ngay: String(x?.ngay || '').trim().slice(0, 20),
      }))
      .filter((x) => x.name && isFinite(x.qty) && x.qty > 0);

    // Tra ve ten model da chay duoc -> client nho lai, lan sau khoi do lai tu dau.
    res.status(200).json({ rows, count: rows.length, model: modelDung });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi xử lý OCR', detail: String(e && e.message || e).slice(0, 300) });
  }
};
