// agent/canh-bao.mjs — BOT THEO DÕI & CẢNH BÁO LỖI APP (16/11/2026, bước 3: A3 + A4 + A5 + A6 + A7).
// Chạy 15 phút/lần (.github/workflows/canh-bao.yml). Không dùng AI. Báo về Telegram của Khoa (lib/telegram.js).
//
// Phân mức theo SU-CO-phan-muc-va-mau-tin.md (Khoa duyệt 16/11/2026):
//   S1 — app/Supabase không trả lời (2 lần liền) · Vercel chạy bản cũ > 15 phút · sổ điều chuyển ghi trùng /
//        phiếu đã duyệt mà sổ thiếu dòng · >= 10 người cùng một lỗi trong 30 phút · Egress dự báo > 100% và còn <= 3 ngày
//   S2 — >= 3 người cùng một lỗi trong 30 phút · một hàm /api lỗi >= 5 lần trong 30 phút · bot định kỳ không chạy ·
//        Egress dự báo > 80%
//   S3 — còn lại: không mở sự cố, chỉ vào tin tóm tắt 8h.
// Giờ yên lặng 22h → 8h (giờ VN): chỉ S1 được gửi; sự cố S2 mở trong đêm vào tin tóm tắt 8h.
// Mỗi sự cố: MỘT tin mở + MỘT tin "đã ổn lại" (60 phút không còn dấu hiệu); tăng mức thì báo thêm.
// Trạng thái lưu ở bảng su_co (SQL PHẦN 38). Supabase sập (không lưu được trạng thái) thì chỉ báo mỗi giờ một lần.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { guiTelegram, dangNgu, esc } = require('../lib/telegram.js');

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const APP = (process.env.APP_URL || 'https://cost-master-sigma.vercel.app').replace(/\/+$/, '');
const REPO = process.env.GITHUB_REPOSITORY || 'khoahuynh06122000/Cost-master';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const THU = process.env.CANH_BAO_THU === '1';           // chạy thử: in ra màn, không gửi, không ghi
const NOW = Number(process.env.CANH_BAO_NOW || Date.now());
const HAN_AN_HAN = Date.parse(process.env.EGRESS_AN_HAN || '2026-11-29T23:59:00+07:00');
const EG_HAN_MB = Number(process.env.EGRESS_HAN_MB || 5120), EG_NGAY_MB = 160, KY_EG_NGAY = 5;  // kỳ Supabase bắt đầu ngày 5
const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
const RANK = { S3: 1, S2: 2, S1: 3 };
const ICO = { S1: '🔴', S2: '🟠', S3: '🟡' };
const vnDate = ms => new Date(ms + 7 * 3600e3);
const p2 = n => String(n).padStart(2, '0');
const gioNgay = ms => { const d = vnDate(ms); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const ngayISO = ms => vnDate(ms).toISOString().slice(0, 10);
const log = (...a) => console.log(...a);

async function q(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw Object.assign(new Error(`${path.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`), { st: r.status });
  return r.json();
}
async function ghi(method, path, body) {
  if (THU) { log('[thử] ' + method + ' ' + path, JSON.stringify(body || '').slice(0, 200)); return; }
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
}
async function gui(text, muc) {
  if (THU) { log('[thử] TELEGRAM (' + muc + '):\n' + text + '\n'); return { ok: true }; }
  const kq = await guiTelegram(text, { muc });
  if (!kq.ok && !kq.hoan) console.warn('Gửi Telegram trượt:', kq.loi);
  return kq;
}
const thieuBang = e => /42P01|does not exist|schema cache|PGRST205/i.test(String(e && e.message));

// ---------------------------------------------------------------- 1. THU DẤU HIỆU
const phat = [];   // {khoa, muc, tieu, anhHuong, dauHieu, viec, nguoi, lan, haiLan}
const ghiChu = []; // lỗi khi chạy chính bot (không làm dừng bot)

// 1a. App trên Vercel còn mở được + đúng phiên bản
let verRepo = '', verWeb = '';
try { verRepo = (/const APP_VER='([^']+)'/.exec(readFileSync(new URL('../index.html', import.meta.url), 'utf8')) || [])[1] || ''; } catch (e) {}
try {
  const r = await fetch(APP + '/?_=' + NOW, { headers: { 'Cache-Control': 'no-cache' } });
  const t = r.ok ? await r.text() : '';
  verWeb = (/const APP_VER='([^']+)'/.exec(t) || [])[1] || '';
  if (!r.ok || !verWeb) phat.push({ khoa: 'web_sap', muc: 'S1', haiLan: true, tieu: 'Trang app không mở được',
    anhHuong: 'mọi người dùng', dauHieu: 'tải ' + APP + ' → ' + (r.ok ? 'không thấy phiên bản trong trang' : 'HTTP ' + r.status),
    viec: 'mở Vercel → Deployments xem bản mới nhất có lỗi build không' });
} catch (e) {
  phat.push({ khoa: 'web_sap', muc: 'S1', haiLan: true, tieu: 'Trang app không mở được', anhHuong: 'mọi người dùng',
    dauHieu: 'không kết nối được ' + APP + ' (' + String(e.message).slice(0, 80) + ')', viec: 'mở Vercel → Deployments kiểm tra' });
}
if (verRepo && verWeb && verRepo !== verWeb) {
  let tuoi = 0;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits?path=index.html&per_page=1`, { headers: GH_TOKEN ? { Authorization: 'Bearer ' + GH_TOKEN } : {} });
    const j = await r.json(); tuoi = (NOW - Date.parse(j[0].commit.committer.date)) / 60000;
  } catch (e) { tuoi = 999; }
  if (tuoi > 15) phat.push({ khoa: 'deploy_cu', muc: 'S1', tieu: 'Vercel vẫn chạy bản cũ',
    anhHuong: 'bản sửa mới chưa tới người dùng', dauHieu: `trên web ${verWeb} · trong repo ${verRepo} · đẩy cách đây ${Math.round(tuoi)} phút`,
    viec: 'mở Vercel → Deployments xem bản ' + verRepo + ' có build lỗi không' });
}

// 1b. Supabase còn trả lời
let sbOK = true;
try { await q('plants?select=plant_code&limit=1'); }
catch (e) { sbOK = false; phat.push({ khoa: 'sb_sap', muc: 'S1', haiLan: true, tieu: 'Máy chủ dữ liệu (Supabase) không trả lời',
  anhHuong: 'không ai đăng nhập / gửi phiếu được', dauHieu: String(e.message).slice(0, 160),
  viec: e.st === 402 ? 'Supabase báo vượt hạn mức (402) — nâng gói Pro hoặc chờ kỳ mới' : 'mở Supabase → Project status' }); }

let loiApp = [], suCo = [], suCoOK = true;
if (sbOK) {
  // 1c. Lỗi từ máy người dùng + hàm máy chủ trong 30 phút
  const tu30 = new Date(NOW - 30 * 60000).toISOString();
  try { loiApp = await q(`loi_app?select=nguon,loai,thong_diep,ma,man,user_id,may,ten,ver,so_lan&da_xu_ly=eq.false&at=gte.${tu30}&limit=5000`); }
  catch (e) { if (!thieuBang(e)) ghiChu.push('đọc loi_app: ' + e.message); }
  const nhom = new Map();
  for (const x of loiApp) {
    const k = x.nguon === 'may_chu' ? 'api|' + x.man : 'app|' + x.loai + '|' + x.thong_diep + '|' + (x.ma || '');
    const g = nhom.get(k) || { x, nguoi: new Set(), lan: 0, ten: new Set() };
    g.nguoi.add(x.user_id || x.may || '?'); g.lan += Number(x.so_lan) || 1; if (x.ten) g.ten.add(x.ten);
    nhom.set(k, g);
  }
  for (const [k, g] of nhom) {
    const n = g.nguoi.size, tenDs = [...g.ten].slice(0, 4).join(', ') + (g.ten.size > 4 ? '…' : '');
    if (k.startsWith('api|')) {
      if (g.lan >= 5) phat.push({ khoa: 'loi|' + k, muc: 'S2', tieu: 'Hàm máy chủ ' + g.x.man + ' lỗi liên tục', nguoi: n, lan: g.lan,
        anhHuong: `${g.lan} lần lỗi / 30 phút · ${n} người`, dauHieu: g.x.thong_diep, viec: g.x.man === '/api/ocr' ? 'xem log Vercel; báo BP tạm nhập Excel / gõ tay' : 'xem log Vercel của hàm này' });
    } else if (n >= 3) {
      phat.push({ khoa: 'loi|' + k, muc: n >= 10 ? 'S1' : 'S2', tieu: 'Nhiều người cùng gặp lỗi: ' + g.x.thong_diep.slice(0, 90), nguoi: n, lan: g.lan,
        anhHuong: `${n} người trong 30 phút${tenDs ? ' (' + tenDs + ')' : ''}`, dauHieu: `màn ${g.x.man || '?'} · bản ${g.x.ver || '?'}` + (g.x.ma ? ' · mã ' + g.x.ma : ''),
        viec: 'xem chi tiết trong bảng loi_app' });
    }
  }

  // 1d. Sổ điều chuyển: ghi trùng / phiếu đã duyệt mà sổ thiếu dòng
  try { suCo = await q(`su_co?select=*&trang_thai=in.(nghi,mo)`); }
  catch (e) { suCoOK = false; ghiChu.push(thieuBang(e) ? 'chưa có bảng su_co — chạy SQL PHẦN 38' : 'đọc su_co: ' + e.message); }
  const dangMo = new Set(suCo.map(r => r.id));
  try {
    const tu14 = ngayISO(NOW - 14 * 86400e3), moi3 = NOW - 3 * 86400e3;
    const so = await q(`transfers?select=id,date,code,qty,from_key,to_key,reason,created_at&date=gte.${tu14}&limit=20000`);
    const van = new Map();
    for (const t of so) {
      const k = [t.date, t.code, Number(t.qty), t.from_key, t.to_key, t.reason].join('|');
      const g = van.get(k) || { n: 0, moi: 0, t }; g.n++; g.moi = Math.max(g.moi, Date.parse(t.created_at || 0) || 0); van.set(k, g);
    }
    for (const [k, g] of van) {
      const khoa = 'so_trung|' + k;
      if (g.n > 1 && (g.moi >= moi3 || dangMo.has(khoa))) phat.push({ khoa, muc: 'S1', tieu: 'Sổ điều chuyển bị ghi trùng',
        anhHuong: `mã ${g.t.code} · SL ${g.t.qty} ghi ${g.n} lần · ${g.t.from_key} → ${g.t.to_key}`, dauHieu: 'lý do sổ: ' + String(g.t.reason || '').slice(0, 120),
        viec: 'admin vào Điều chuyển → Theo dõi sổ điều chuyển, xoá dòng đánh dấu "ghi trùng"' });
    }
    const da = await q(`transfer_requests?select=id,kind,items,approved_at,approved_by,from_plant,from_sloc,to_plant,to_sloc&status=eq.${encodeURIComponent('Đã duyệt')}&approved_at=gte.${tu14}&limit=5000`);
    for (const r of da) {
      if (NOW - Date.parse(r.approved_at || 0) < 5 * 60000) continue;
      const can = Object.values(r.items || {}).filter(v => (Number(v && (v.qtyOk ?? v.qtyReq)) || 0) > 0).length;
      const maCan = new Set(Object.entries(r.items || {}).filter(([, v]) => (Number(v && (v.qtyOk ?? v.qtyReq)) || 0) > 0).map(([k]) => k));
      const co = new Set(so.filter(t => { const s = String(t.reason || ''); return (s === r.id || s.endsWith(' · ' + r.id)) && maCan.has(String(t.code)); }).map(t => String(t.code))).size;
      if (co < can) phat.push({ khoa: 'so_thieu|' + r.id, muc: 'S1', tieu: 'Phiếu đã duyệt mà sổ thiếu dòng',
        anhHuong: `phiếu ${r.id} · sổ có ${co}/${can} dòng · ${r.from_plant}-${r.from_sloc} → ${r.to_plant || 'HỦY'}${r.to_sloc ? '-' + r.to_sloc : ''}`,
        dauHieu: `duyệt bởi ${r.approved_by || '?'} lúc ${gioNgay(Date.parse(r.approved_at))}`, viec: 'đối chiếu phiếu với sổ, bổ sung dòng thiếu (câu rà trong CLAUDE.md)' });
    }
  } catch (e) { ghiChu.push('kiểm sổ điều chuyển: ' + e.message); }

  // 1e. Egress (app tự đếm, mục A5)
  try {
    const d = vnDate(NOW); let y = d.getUTCFullYear(), m = d.getUTCMonth();
    if (d.getUTCDate() < KY_EG_NGAY) { m--; if (m < 0) { m = 11; y--; } }
    const bd = Date.UTC(y, m, KY_EG_NGAY) - 7 * 3600e3, kt = Date.UTC(y, m + 1, KY_EG_NGAY) - 7 * 3600e3;
    const eg = await q(`egress_ngay?select=ngay,bytes&ngay=gte.${ngayISO(bd)}&limit=20000`);
    const mb = eg.reduce((s, r) => s + Number(r.bytes || 0), 0) / 1048576;
    const ngayQua = Math.max(1, (NOW - bd) / 86400e3), duBao = mb / ngayQua * ((kt - bd) / 86400e3);
    globalThis.__eg = { mb, duBao, bd, kt };
    const conAnHan = (HAN_AN_HAN - NOW) / 86400e3;
    if (duBao > EG_HAN_MB && conAnHan >= 0 && conAnHan <= 3) phat.push({ khoa: 'egress_100', muc: 'S1', tieu: 'Egress Supabase sắp vượt hạn mức',
      anhHuong: 'quá hạn ân hạn Supabase sẽ khoá app (lỗi 402)', dauHieu: `kỳ này ~${mb.toFixed(0)} MB · dự báo ${(duBao / 1024).toFixed(1)} GB / ${EG_HAN_MB / 1024} GB · còn ${conAnHan.toFixed(1)} ngày ân hạn`,
      viec: 'nâng Supabase lên gói Pro, hoặc giảm dữ liệu tải lúc mở app' });
    else if (duBao > EG_HAN_MB * 0.8) phat.push({ khoa: 'egress_80', muc: 'S2', tieu: 'Egress Supabase dự báo vượt 80% hạn mức',
      anhHuong: 'nguy cơ vượt gói Free cuối kỳ', dauHieu: `kỳ này ~${mb.toFixed(0)} MB · dự báo ${(duBao / 1024).toFixed(1)} GB / ${EG_HAN_MB / 1024} GB (số app tự đếm)`,
      viec: 'xem bảng egress_ngay để biết máy / bảng nào tải nhiều' });
  } catch (e) { if (!thieuBang(e)) ghiChu.push('đọc egress_ngay: ' + e.message); }
}

// 1f. Bot định kỳ có chạy đúng lịch không (A6)
for (const [file, ten, gioToiDa] of [['daily-report.yml', 'Bot báo cáo 8h sáng', 27], ['het-han-dc.yml', 'Bot tự huỷ phiếu quá hạn', 3]]) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/runs?per_page=1`, { headers: GH_TOKEN ? { Authorization: 'Bearer ' + GH_TOKEN } : {} });
    const run = ((await r.json()).workflow_runs || [])[0];
    if (!run) continue;
    const tuoi = (NOW - Date.parse(run.created_at)) / 3600e3;
    if (tuoi > gioToiDa) phat.push({ khoa: 'bot|' + file, muc: 'S2', tieu: ten + ' không chạy', anhHuong: 'việc tự động của bot bị bỏ lỡ',
      dauHieu: `lần chạy gần nhất cách đây ${tuoi.toFixed(1)} giờ`, viec: 'GitHub → Actions xem workflow có bị tắt (GitHub tự tắt sau 60 ngày repo không hoạt động)' });
    else if (run.status === 'completed' && run.conclusion === 'failure') phat.push({ khoa: 'bot_loi|' + file, muc: 'S2', tieu: ten + ' chạy bị lỗi',
      anhHuong: 'việc tự động của bot bị bỏ lỡ', dauHieu: `lần chạy lúc ${gioNgay(Date.parse(run.created_at))} kết thúc lỗi`, viec: 'GitHub → Actions mở lượt chạy đó xem dòng đỏ' });
  } catch (e) { ghiChu.push('kiểm bot ' + file + ': ' + e.message); }
}

// ---------------------------------------------------------------- 2. MỞ / ĐÓNG / BÁO SỰ CỐ
const dem = ngayISO(NOW).slice(5).replace('-', '');
let soMoi = 0;
if (sbOK && suCoOK) { try { soMoi = (await q(`su_co?select=id&ma=like.SC-${dem.slice(2)}${dem.slice(0, 2)}-*`)).length; } catch (e) {} }
function maMoi() { const d = vnDate(NOW); soMoi++; return `SC-${p2(d.getUTCDate())}${p2(d.getUTCMonth() + 1)}-${p2(soMoi)}`; }
const tinMo = (f, ma, tang) => `${ICO[f.muc]} <b>${f.muc} · ${esc(f.tieu)}</b>${tang ? ' (tăng mức)' : ''}\n` +
  `Lúc: ${esc(gioNgay(NOW))}\nẢnh hưởng: ${esc(f.anhHuong)}\nDấu hiệu: ${esc(f.dauHieu)}\nViệc nên làm: ${esc(f.viec)}\nMã sự cố: ${esc(ma)}`;
const coTheGui = muc => muc === 'S1' || (muc === 'S2' && !dangNgu(new Date(NOW)));

if (!sbOK || !suCoOK) {
  // Không lưu được trạng thái: chỉ báo S1 mỗi giờ một lần (phút đầu giờ), tránh nhắn 4 lần/giờ.
  if (vnDate(NOW).getUTCMinutes() < 15) for (const f of phat.filter(f => f.muc === 'S1'))
    await gui(tinMo(f, '(chưa lưu được trạng thái — nhắc lại mỗi giờ)'), 'S1');
} else {
  const theoKhoa = new Map(suCo.map(r => [r.id, r]));
  const thay = new Set();
  for (const f of phat) {
    thay.add(f.khoa);
    const cu = theoKhoa.get(f.khoa);
    const nowIso = new Date(NOW).toISOString();
    if (!cu) {
      if (f.haiLan) { await ghi('POST', 'su_co', { id: f.khoa, muc: f.muc, tieu_de: f.tieu, chi_tiet: f.dauHieu, trang_thai: 'nghi', mo_at: nowIso, cap_nhat_at: nowIso }); continue; }
      const ma = maMoi(); const gioi = coTheGui(f.muc);
      const kq = gioi ? await gui(tinMo(f, ma), f.muc) : { ok: false };
      await ghi('POST', 'su_co', { id: f.khoa, ma, muc: f.muc, tieu_de: f.tieu, anh_huong: f.anhHuong, chi_tiet: f.dauHieu, viec: f.viec,
        trang_thai: 'mo', mo_at: nowIso, cap_nhat_at: nowIso, da_bao_muc: kq.ok ? f.muc : null, so_nguoi: f.nguoi || null });
      continue;
    }
    const ma = cu.ma || maMoi();
    const patch = { cap_nhat_at: nowIso, muc: RANK[f.muc] > RANK[cu.muc] ? f.muc : cu.muc, anh_huong: f.anhHuong, chi_tiet: f.dauHieu, so_nguoi: f.nguoi || cu.so_nguoi };
    if (cu.trang_thai === 'nghi') Object.assign(patch, { trang_thai: 'mo', ma, mo_at: nowIso, tieu_de: f.tieu, viec: f.viec });
    const daBao = cu.trang_thai === 'nghi' ? null : cu.da_bao_muc;
    if (!cu.da_xu_ly && coTheGui(f.muc) && (!daBao || RANK[f.muc] > RANK[daBao])) {
      const kq = await gui(tinMo(f, ma, !!daBao), f.muc);
      if (kq.ok) patch.da_bao_muc = f.muc;
    }
    await ghi('PATCH', 'su_co?id=eq.' + encodeURIComponent(f.khoa), patch);
  }
  // Đóng sự cố không còn dấu hiệu
  for (const r of suCo) {
    if (thay.has(r.id)) continue;
    if (r.trang_thai === 'nghi') { await ghi('DELETE', 'su_co?id=eq.' + encodeURIComponent(r.id)); continue; }
    const vang = (NOW - Date.parse(r.cap_nhat_at || r.mo_at)) / 60000;
    if (vang < 60) continue;
    const keo = Math.round((Date.parse(r.cap_nhat_at || r.mo_at) - Date.parse(r.mo_at)) / 60000);
    if (r.da_bao_muc && coTheGui(r.muc)) await gui(`✅ <b>Đã ổn lại · ${esc(r.ma || '')} · ${esc(r.tieu_de || '')}</b>\n` +
      `Kéo dài: ${esc(gioNgay(Date.parse(r.mo_at)))} → ${esc(gioNgay(Date.parse(r.cap_nhat_at || r.mo_at)))} (${keo} phút)` +
      (r.so_nguoi ? ` · ${r.so_nguoi} người bị` : ''), r.muc);
    await ghi('PATCH', 'su_co?id=eq.' + encodeURIComponent(r.id), { trang_thai: 'dong', dong_at: new Date(NOW).toISOString() });
  }
}

// ---------------------------------------------------------------- 3. TIN TÓM TẮT 8H SÁNG
const d = vnDate(NOW);
if (sbOK && suCoOK && d.getUTCHours() >= 8 && d.getUTCHours() < 22) {
  const homNay = ngayISO(NOW), khoaTT = 'tomtat|' + homNay;
  let daGui = false;
  try { daGui = (await q(`su_co?select=id&id=eq.${encodeURIComponent(khoaTT)}`)).length > 0; } catch (e) { daGui = true; }
  if (!daGui) {
    const homQua = ngayISO(NOW - 86400e3);
    const tuQua = new Date(Date.parse(homQua + 'T00:00:00+07:00')).toISOString(), toiQua = new Date(Date.parse(homQua + 'T22:00:00+07:00')).toISOString();
    const sang = new Date(Date.parse(homNay + 'T08:00:00+07:00')).toISOString();
    const dong = [];
    try {
      const sc = await q(`su_co?select=ma,muc,tieu_de,mo_at,trang_thai,da_bao_muc&mo_at=gte.${tuQua}&id=not.like.tomtat*&order=mo_at.asc&limit=200`);
      const dem3 = mu => sc.filter(r => r.muc === mu && r.mo_at < sang).length;
      const dem = sc.filter(r => r.mo_at >= toiQua && r.mo_at < sang);
      if (dem.length) dong.push('• Trong đêm: ' + dem.map(r => `${ICO[r.muc] || ''} ${esc(r.ma || '')} ${esc(r.tieu_de || '')}${r.trang_thai === 'dong' ? ' (đã ổn)' : ' (CÒN MỞ)'}`).join('\n   '));
      dong.push(`• Hôm qua: ${dem3('S1')} S1 · ${dem3('S2')} S2` + (sc.some(r => r.trang_thai === 'mo') ? ` · còn mở ${sc.filter(r => r.trang_thai === 'mo').length}` : ''));
    } catch (e) { dong.push('• (không đọc được sổ sự cố: ' + esc(e.message.slice(0, 80)) + ')'); }
    try {
      const la = await q(`loi_app?select=nguon,loai,thong_diep,man,user_id,may,so_lan&at=gte.${tuQua}&at=lt.${sang}&limit=10000`);
      const g = new Map();
      for (const x of la) { const k = (x.nguon === 'may_chu' ? x.man + ': ' : '') + x.thong_diep; const v = g.get(k) || { n: new Set(), lan: 0 }; v.n.add(x.user_id || x.may); v.lan += Number(x.so_lan) || 1; g.set(k, v); }
      const top = [...g].sort((a, b) => b[1].n.size - a[1].n.size || b[1].lan - a[1].lan).slice(0, 5);
      dong.push(`• Lỗi ghi nhận: ${la.length} lần` + (top.length ? '\n   ' + top.map(([k, v]) => `– ${esc(k.slice(0, 80))} (${v.n.size} người)`).join('\n   ') : ''));
    } catch (e) { if (!thieuBang(e)) dong.push('• (không đọc được loi_app)'); }
    try {
      const eg = await q(`egress_ngay?select=ten,bytes,ver,bang&ngay=eq.${homQua}&limit=5000`);
      const mb = eg.reduce((s, r) => s + Number(r.bytes || 0), 0) / 1048576;
      const bang = {}; eg.forEach(r => Object.entries(r.bang || {}).forEach(([k, v]) => { bang[k] = (bang[k] || 0) + Number(v || 0); }));
      const nang = Object.entries(bang).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${(v / 1048576).toFixed(0)} MB`).join(', ');
      const E = globalThis.__eg;
      dong.push(`• Egress hôm qua ~${mb.toFixed(0)} MB${mb > EG_NGAY_MB ? ' ⚠ quá ' + EG_NGAY_MB + ' MB' : ''}` +
        (E ? ` · kỳ này ${(E.mb / 1024).toFixed(2)}/${EG_HAN_MB / 1024} GB · dự báo ${(E.duBao / 1024).toFixed(1)} GB` : '') + (nang ? `\n   nặng nhất: ${esc(nang)}` : '') + ' (app tự đếm)');
      const cu = [...new Set(eg.filter(r => r.ver && verRepo && r.ver !== verRepo).map(r => r.ten || '?'))];
      if (cu.length) dong.push(`• Còn chạy bản cũ (khác ${esc(verRepo)}): ${cu.length} người — ${esc(cu.slice(0, 8).join(', '))}${cu.length > 8 ? '…' : ''}`);
    } catch (e) { if (!thieuBang(e)) dong.push('• (không đọc được egress_ngay)'); }
    if (ghiChu.length) dong.push('• Bot gặp trục trặc khi kiểm: ' + esc(ghiChu.join(' · ').slice(0, 300)));
    const kq = await gui(`☀️ <b>Tóm tắt ${esc(gioNgay(NOW).slice(0, 5))} ${esc(homNay.split('-').reverse().slice(0, 2).join('/'))}</b>\n` + dong.join('\n'), 'INFO');
    if (kq.ok) await ghi('POST', 'su_co', { id: khoaTT, muc: 'S3', tieu_de: 'Tin tóm tắt ' + homNay, trang_thai: 'dong', mo_at: new Date(NOW).toISOString(), dong_at: new Date(NOW).toISOString() });
  }
}

log(`Xong · ${phat.length} dấu hiệu (${phat.map(f => f.muc + ':' + f.khoa.slice(0, 40)).join(', ') || 'không có'})` + (ghiChu.length ? ' · ghi chú: ' + ghiChu.join(' | ') : ''));
