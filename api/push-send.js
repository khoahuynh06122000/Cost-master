// api/push-send.js — Vercel serverless: GỬI THÔNG BÁO ĐẨY (Web Push) về máy người dùng
// kể cả khi app đã ĐÓNG HẲN.
//
// Vì sao tự viết mã hoá thay vì dùng thư viện web-push:
//   repo này không có package.json (api/ocr.js cũng gọi REST thẳng "khỏi npm dep").
//   Thêm dependency là thêm bước npm install vào quy trình deploy đang chạy ổn.
//   node:crypto có đủ ECDH + HKDF + AES-GCM nên làm được hết.
//
// Chuẩn áp dụng:
//   RFC 8291 — mã hoá payload aes128gcm
//   RFC 8292 — xác thực VAPID (JWT ES256)
//
// Client gửi POST:
//   { subs:[{endpoint,p256dh,auth}, ...], title, body, url, tag }
// Trả:
//   { sent, failed, gone:[endpoint...] }   gone = subscription đã chết, client nên xoá khỏi DB.

const crypto = require('crypto');

const VAPID_PUBLIC = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:khoahd@banahills.com.vn').trim();

/* ---------- tiện ích base64url ---------- */
const b64uEnc = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDec = (str) =>
  Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* ---------- dựng khoá EC từ thành phần thô ---------- */
// Node cần khoá dạng JWK hoặc DER. Public key đẩy từ trình duyệt là 65 byte thô (0x04||X||Y).
function publicKeyFromRaw(raw) {
  const b = Buffer.from(raw);
  if (b.length !== 65 || b[0] !== 4) throw new Error('p256dh khong dung dinh dang (can 65 byte, byte dau 0x04)');
  return crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: b64uEnc(b.subarray(1, 33)), y: b64uEnc(b.subarray(33, 65)) },
    format: 'jwk',
  });
}
function privateKeyFromRaw(dRaw, pubRaw) {
  const p = Buffer.from(pubRaw);
  return crypto.createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64uEnc(p.subarray(1, 33)), y: b64uEnc(p.subarray(33, 65)),
      d: b64uEnc(dRaw),
    },
    format: 'jwk',
  });
}

/* ---------- JWT ES256 cho VAPID ---------- */
// Node ký ra chữ ký DER; JWT cần dạng thô r||s (64 byte) nên phải chuyển.
function derToRaw(der) {
  let off = 2;
  if (der[1] & 0x80) off = 2 + (der[1] & 0x7f);
  const take = () => {
    if (der[off++] !== 0x02) throw new Error('chu ky DER hong');
    let len = der[off++];
    let v = der.subarray(off, off + len);
    off += len;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);      // bỏ byte 0 đệm
    const out = Buffer.alloc(32);
    v.copy(out, 32 - v.length);
    return out;
  };
  return Buffer.concat([take(), take()]);
}

function vapidHeader(audience) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) throw new Error('Thieu VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY tren Vercel');
  const header = b64uEnc(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64uEnc(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,   // chuẩn cho phép tối đa 24h
    sub: VAPID_SUBJECT,
  }));
  const signingInput = header + '.' + payload;
  const key = privateKeyFromRaw(b64uDec(VAPID_PRIVATE), b64uDec(VAPID_PUBLIC));
  const der = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'der' });
  const jwt = signingInput + '.' + b64uEnc(derToRaw(der));
  return { Authorization: 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC };
}

/* ---------- mã hoá payload theo RFC 8291 (aes128gcm) ---------- */
function encryptPayload(plaintext, p256dhB64, authB64) {
  const clientPub = b64uDec(p256dhB64);
  const authSecret = b64uDec(authB64);
  if (authSecret.length !== 16) throw new Error('auth phai dai 16 byte');

  // Cặp khoá dùng một lần cho riêng lần gửi này
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();                 // 65 byte
  const shared = ecdh.computeSecret(clientPub);          // 32 byte

  // PRK gốc: HKDF(shared, salt=auth, info="WebPush: info\0"||clientPub||serverPub)
  const info1 = Buffer.concat([
    Buffer.from('WebPush: info\0'), clientPub, serverPub,
  ]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, info1, 32));

  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // Bản rõ phải kết thúc bằng byte đệm 0x02 (bản ghi cuối)
  const padded = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  // Thân bản tin: salt(16) | rs(4) | idlen(1) | serverPub(65) | ciphertext
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub, ct]);
}

/* ---------- gửi tới một subscription ---------- */
async function sendOne(sub, payloadStr) {
  const url = new URL(sub.endpoint);
  const body = encryptPayload(payloadStr, sub.p256dh, sub.auth);
  const headers = Object.assign(
    {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': String(body.length),
      TTL: '86400',                       // giữ 1 ngày nếu máy đang tắt
      Urgency: 'normal',
    },
    vapidHeader(url.origin)
  );
  const r = await fetch(sub.endpoint, { method: 'POST', headers, body });
  return { status: r.status, text: r.ok ? '' : (await r.text().catch(() => '')).slice(0, 200) };
}

/* ---------- handler ---------- */
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    // Cho client hỏi khoá công khai + biết máy chủ đã sẵn sàng chưa
    return res.status(200).json({ ready: !!(VAPID_PUBLIC && VAPID_PRIVATE), publicKey: VAPID_PUBLIC });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận GET hoặc POST' });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(503).json({ error: 'Máy chủ chưa cấu hình VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY' });
  }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || !Array.isArray(b.subs) || !b.subs.length) {
    return res.status(400).json({ error: 'Thiếu danh sách subs' });
  }
  if (b.subs.length > 200) return res.status(400).json({ error: 'Tối đa 200 máy một lần gửi' });

  const payload = JSON.stringify({
    title: String(b.title || 'Kiểm kê F&B').slice(0, 120),
    body: String(b.body || '').slice(0, 400),
    url: String(b.url || '/').slice(0, 300),
    tag: String(b.tag || 'kiemke').slice(0, 60),
  });

  let sent = 0, failed = 0;
  const gone = [];
  await Promise.all(b.subs.map(async (s) => {
    if (!s || !s.endpoint || !s.p256dh || !s.auth) { failed++; return; }
    try {
      const r = await sendOne(s, payload);
      if (r.status >= 200 && r.status < 300) sent++;
      else if (r.status === 404 || r.status === 410) { gone.push(s.endpoint); failed++; }
      else { failed++; console.error('push', r.status, r.text); }
    } catch (e) {
      failed++;
      console.error('push loi', (e && e.message) || e);
    }
  }));

  return res.status(200).json({ sent, failed, gone });
};

// Xuất riêng để test cục bộ (không ảnh hưởng khi chạy trên Vercel)
module.exports._internal = { encryptPayload, vapidHeader, b64uEnc, b64uDec, publicKeyFromRaw };
