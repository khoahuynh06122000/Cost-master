// agent/canh-bao.mjs — BOT THEO DÕI & CẢNH BÁO LỖI APP (16/11/2026, bước 3: A3 + A4 + A5 + A6 + A7).
// Chạy 2 lần/ngày lúc 8h và 17h giờ VN (.github/workflows/canh-bao.yml — Khoa 16/11/2026: 15 phút/lần là quá dày).
// Mỗi lượt xét dữ liệu TỪ LƯỢT TRƯỚC tới giờ (dấu mốc lưu ở su_co id 'tomtat_lan_chay'). Không dùng AI. Báo về Telegram của Khoa (lib/telegram.js).
//
// Phân mức theo SU-CO-phan-muc-va-mau-tin.md (Khoa duyệt 16/11/2026):
//   S1 — app/Supabase không trả lời (thử lại sau 45 giây vẫn không được) · Vercel chạy bản cũ > 15 phút · sổ điều chuyển ghi trùng /
//        phiếu đã duyệt mà sổ thiếu dòng · >= 10 người cùng một lỗi từ lượt trước · Egress dự báo > 100% và còn <= 3 ngày
//   S2 — >= 3 người cùng một lỗi · một hàm /api lỗi >= 5 lần (đều tính từ lượt trước) · bot định kỳ không chạy ·
//        Egress dự báo > 80%
//   S3 — còn lại: không mở sự cố, chỉ vào tin tóm tắt 8h.
// Giờ yên lặng 22h → 8h (giờ VN): chỉ S1 được gửi; sự cố S2 mở trong đêm vào tin tóm tắt 8h.
// Mỗi sự cố: MỘT tin mở + MỘT tin "đã ổn lại" (lượt sau không còn dấu hiệu); tăng mức thì báo thêm.
// Trạng thái lưu ở bảng su_co (SQL PHẦN 38). Supabase sập (không lưu được trạng thái) thì vẫn báo S1 mỗi lượt.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { guiTelegram, dangNgu, esc } = require('../lib/telegram.js');
const { tinSuCo, tinOnLai, tinTomTat } = require('../lib/mau-tin.js');

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
{ const gio = new Date(NOW + 7 * 3600e3).getUTCHours();
  if (process.env.GITHUB_EVENT_NAME === 'schedule' && !((gio >= 7 && gio < 12) || (gio >= 16 && gio < 21))) {
    console.log(`Lịch chạy rơi vào ${gio}h (GitHub chạy trễ) — ngoài khung 8h / 17h, bỏ qua lượt này.`); process.exit(0);
  } }
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
// Đọc ĐỦ mọi trang: Supabase chỉ trả tối đa 1.000 dòng mỗi lần (17/11/2026: đọc một lần → 18 phiếu bị báo "thiếu dòng" oan).
async function qDu(path, khoa) {
  const out = [];
  for (let off = 0; off < 200000; off += 1000) {
    const t = await q(`${path}&order=${khoa || 'id'}.asc&limit=1000&offset=${off}`);
    out.push(...t); if (t.length < 1000) break;
  }
  return out;
}
async function ghi(method, path, body, prefer) {
  if (THU) { log('[thử] ' + method + ' ' + path, JSON.stringify(body || '').slice(0, 200)); return; }
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: { ...H, 'Content-Type': 'application/json', Prefer: prefer || 'return=minimal' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
}
async function gui(text, muc) {
  if (THU) { log('[thử] TELEGRAM (' + muc + '):\n' + text + '\n'); return { ok: true }; }
  const kq = await guiTelegram(text, { muc });
  if (!kq.ok && !kq.hoan) console.warn('Gửi Telegram trượt:', kq.loi);
  return kq;
}
const CHO_THU_LAI = Number(process.env.CANH_BAO_CHO ?? 45000);
const ngu = ms => new Promise(r => setTimeout(r, ms));
const thieuBang = e => /42P01|does not exist|schema cache|PGRST205/i.test(String(e && e.message));

// ---------------------------------------------------------------- 1. THU DẤU HIỆU
const phat = [];   // {khoa, muc, tieu, anhHuong, dauHieu, viec, nguoi, lan, haiLan}
const ghiChu = []; // lỗi khi chạy chính bot (không làm dừng bot)

// 1a. App trên Vercel còn mở được + đúng phiên bản
let verRepo = '', verWeb = '';
// Chạy trên Vercel (api/bot.js) thì index.html cạnh script là CHÍNH bản đang chạy -> đọc bản trong repo GitHub để so.
if (process.env.BOT_NOI_CHAY === 'vercel') {
  try { const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/index.html?_=${NOW}`); if (r.ok) verRepo = (/const APP_VER='([^']+)'/.exec(await r.text()) || [])[1] || ''; } catch (e) {}
} else {
  try { verRepo = (/const APP_VER='([^']+)'/.exec(readFileSync(new URL('../index.html', import.meta.url), 'utf8')) || [])[1] || ''; } catch (e) {}
}
async function moWeb() {
  const r = await fetch(APP + '/?_=' + NOW + Math.random(), { headers: { 'Cache-Control': 'no-cache' } });
  return { r, t: r.ok ? await r.text() : '' };
}
try {
  let { r, t } = await moWeb().catch(async () => { await ngu(CHO_THU_LAI); return moWeb(); });
  if (!r.ok || !/const APP_VER=/.test(t)) { await ngu(CHO_THU_LAI); ({ r, t } = await moWeb()); }
  verWeb = (/const APP_VER='([^']+)'/.exec(t) || [])[1] || '';
  if (!r.ok || !verWeb) phat.push({ khoa: 'web_sap', muc: 'S1', tieu: 'Trang app không mở được',
    anhHuong: 'mọi người dùng', dauHieu: 'tải ' + APP + ' → ' + (r.ok ? 'không thấy phiên bản trong trang' : 'HTTP ' + r.status),
    viec: 'mở Vercel → Deployments xem bản mới nhất có lỗi build không' });
} catch (e) {
  phat.push({ khoa: 'web_sap', muc: 'S1', tieu: 'Trang app không mở được', anhHuong: 'mọi người dùng',
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
try { await q('plants?select=plant_code&limit=1').catch(async () => { await ngu(CHO_THU_LAI); return q('plants?select=plant_code&limit=1'); }); }
catch (e) { sbOK = false; phat.push({ khoa: 'sb_sap', muc: 'S1', tieu: 'Máy chủ dữ liệu (Supabase) không trả lời',
  anhHuong: 'không ai đăng nhập / gửi phiếu được', dauHieu: String(e.message).slice(0, 160),
  viec: e.st === 402 ? 'Supabase báo vượt hạn mức (402) — nâng gói Pro hoặc chờ kỳ mới' : 'mở Supabase → Project status' }); }

let loiApp = [], suCo = [], suCoOK = true;
if (sbOK) {
  // 1c. Lỗi từ máy người dùng + hàm máy chủ TỪ LƯỢT TRƯỚC (tối đa 24 giờ; chưa có mốc thì 12 giờ)
  let tuLan = NOW - 12 * 3600e3;
  try { const m = await q(`su_co?select=cap_nhat_at&id=eq.tomtat_lan_chay`); if (m[0] && m[0].cap_nhat_at) tuLan = Math.max(NOW - 24 * 3600e3, Date.parse(m[0].cap_nhat_at)); } catch (e) {}
  globalThis.__tuLan = tuLan;
  const tu30 = new Date(tuLan).toISOString(), tuNhan = 'từ ' + gioNgay(tuLan).slice(0, 5) + ' ' + gioNgay(tuLan).slice(6, 11);
  try { loiApp = await qDu(`loi_app?select=id,nguon,loai,thong_diep,ma,chi_tiet,man,user_id,may,ten,ver,so_lan&da_xu_ly=eq.false&at=gte.${tu30}`); }
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
        anhHuong: `${g.lan} lần lỗi ${tuNhan} · ${n} người`, dauHieu: g.x.thong_diep, viec: g.x.man === '/api/ocr' ? 'xem log Vercel; báo BP tạm nhập Excel / gõ tay' : 'xem log Vercel của hàm này' });
    } else if (n >= 3) {
      phat.push({ khoa: 'loi|' + k, muc: n >= 10 ? 'S1' : 'S2', tieu: 'Nhiều người cùng gặp lỗi: ' + g.x.thong_diep.slice(0, 90), nguoi: n, lan: g.lan,
        anhHuong: `${n} người ${tuNhan}${tenDs ? ' (' + tenDs + ')' : ''}`, dauHieu: `màn ${g.x.man || '?'} · bản ${g.x.ver || '?'}` + (g.x.ma ? ' · mã ' + g.x.ma : ''),
        viec: 'xem chi tiết trong bảng loi_app' });
    }
  }

  // 1d. Sổ điều chuyển: ghi trùng / phiếu đã duyệt mà sổ thiếu dòng
  try { suCo = await q(`su_co?select=*&trang_thai=in.(nghi,mo)`); }
  catch (e) { suCoOK = false; ghiChu.push(thieuBang(e) ? 'chưa có bảng su_co — chạy SQL PHẦN 38' : 'đọc su_co: ' + e.message); }
  const dangMo = new Set(suCo.map(r => r.id));
  try {
    // Khoa 17/11/2026: (1) một phiếu ghi trùng nhiều mã chỉ được báo MỘT tin — gom theo phiếu (reason); (2) phiếu duyệt
    // hôm nay nhưng ghi sổ vào kỳ cũ (ngày sổ lùi xa) KHÔNG được coi là "sổ thiếu dòng" — lấy sổ theo lúc GHI (created_at),
    // và trước khi báo thiếu thì hỏi lại sổ của đúng phiếu đó, không giới hạn ngày.
    const tu14 = ngayISO(NOW - 14 * 86400e3), tu14ts = new Date(NOW - 14 * 86400e3).toISOString(), moi3 = NOW - 3 * 86400e3;
    const so = await qDu(`transfers?select=id,date,code,qty,from_key,to_key,reason,created_at&or=(created_at.gte.${tu14ts},date.gte.${tu14})`);
    const van = new Map();
    for (const t of so) {
      const k = [t.date, t.code, Number(t.qty), t.from_key, t.to_key, t.reason].join('|');
      const g = van.get(k) || { n: 0, moi: 0, t }; g.n++; g.moi = Math.max(g.moi, Date.parse(t.created_at || 0) || 0); van.set(k, g);
    }
    const theoPhieu = new Map();   // reason -> các dòng bị ghi trùng
    for (const [, g] of van) {
      if (g.n < 2) continue;
      const r = String(g.t.reason || ''); const pk = r || ('khong-ly-do|' + g.t.date + '|' + g.t.from_key + '|' + g.t.to_key);
      const x = theoPhieu.get(pk) || { ma: [], moi: 0, t: g.t }; x.ma.push(g); x.moi = Math.max(x.moi, g.moi); theoPhieu.set(pk, x);
    }
    for (const [pk, x] of theoPhieu) {
      const mp = (/·\s*([A-Za-z0-9][A-Za-z0-9-]+)\s*$/.exec(pk) || [])[1] || '';
      const khoa = 'so_trung|' + (mp || pk).slice(0, 120);
      if (!(x.moi >= moi3 || dangMo.has(khoa))) continue;
      const ds = x.ma.map(g => `${g.t.code} (SL ${g.t.qty} × ${g.n})`);
      phat.push({ khoa, muc: 'S1', tieu: 'Sổ điều chuyển bị ghi trùng' + (mp ? ' · phiếu ' + mp : ''),
        anhHuong: `${x.ma.length} mã bị ghi lặp · ${x.t.from_key} → ${x.t.to_key} — kho nguồn bị trừ thêm`,
        lyDo: [`Mã bị ghi lặp: ${ds.slice(0, 6).join(', ')}${ds.length > 6 ? '…' : ''}`, `Các dòng giống hệt nhau: cùng ngày ${x.t.date}, cùng mã, cùng số lượng, cùng kho đi / đến`],
        dauHieu: 'sổ ghi trùng' });
    }
    const da = await qDu(`transfer_requests?select=id,kind,items,approved_at,approved_by,from_plant,from_sloc,to_plant,to_sloc&status=eq.${encodeURIComponent('Đã duyệt')}&approved_at=gte.${tu14ts}`);
    for (const r of da) {
      if (NOW - Date.parse(r.approved_at || 0) < 5 * 60000) continue;
      const maCan = new Set(Object.entries(r.items || {}).filter(([, v]) => (Number(v && (v.qtyOk ?? v.qtyReq)) || 0) > 0).map(([k]) => k));
      const cuaPhieu = t => { const s0 = String(t.reason || ''); return s0 === r.id || s0.endsWith(' · ' + r.id); };
      let daGhi = new Set(so.filter(cuaPhieu).map(t => String(t.code)));
      if ([...maCan].some(c => !daGhi.has(c))) {
        // Hỏi lại sổ của đúng phiếu này, không giới hạn ngày (phiếu ghi sổ lùi vào kỳ cũ).
        try {
          const lai = await qDu(`transfers?select=id,code,reason&reason=like.${encodeURIComponent('*' + r.id)}`);
          daGhi = new Set(lai.filter(cuaPhieu).map(t => String(t.code)));
        } catch (e) { ghiChu.push('hỏi lại sổ phiếu ' + r.id + ': ' + e.message); continue; }
      }
      const thieuMa = [...maCan].filter(c => !daGhi.has(c));
      if (!thieuMa.length) continue;
      phat.push({ khoa: 'so_thieu|' + r.id, muc: 'S1', tieu: 'Phiếu đã duyệt mà sổ thiếu dòng · phiếu ' + r.id,
        lyDo: [`Phiếu duyệt ${maCan.size} mã nhưng sổ chỉ ghi ${maCan.size - thieuMa.length} mã`, 'Mã chưa vào sổ: ' + thieuMa.slice(0, 6).join(', ') + (thieuMa.length > 6 ? '…' : ''),
          `Duyệt bởi ${r.approved_by || '?'} lúc ${gioNgay(Date.parse(r.approved_at))}`],
        anhHuong: `${r.from_plant}-${r.from_sloc} → ${r.to_plant || 'HỦY'}${r.to_sloc ? '-' + r.to_sloc : ''} · ${thieuMa.length} mã chưa trừ / cộng kho`,
        dauHieu: 'sổ thiếu dòng' });
    }
  } catch (e) { ghiChu.push('kiểm sổ điều chuyển: ' + e.message); }

  // 1e. Egress (app tự đếm, mục A5)
  try {
    const d = vnDate(NOW); let y = d.getUTCFullYear(), m = d.getUTCMonth();
    if (d.getUTCDate() < KY_EG_NGAY) { m--; if (m < 0) { m = 11; y--; } }
    const bd = Date.UTC(y, m, KY_EG_NGAY) - 7 * 3600e3, kt = Date.UTC(y, m + 1, KY_EG_NGAY) - 7 * 3600e3;
    const eg = await qDu(`egress_ngay?select=ngay,may,user_id,bytes&ngay=gte.${ngayISO(bd)}`, 'ngay.asc,may.asc,user_id');
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

// 1f. Bot định kỳ có chạy đúng lịch không (A6). Từ 25/11/2026 các bot chạy trên Vercel Cron, mỗi lượt tự ghi giờ chạy
// vào bảng kín bao_mat_cau_hinh: 'bot_report_luc' (agent/report.mjs) · 'hethan_luc' (lib/het-han-dc.js).
if (sbOK) {
  let moc = {};
  try { moc = Object.fromEntries((await q('bao_mat_cau_hinh?select=k,gia_tri&k=in.(bot_report_luc,hethan_luc)')).map(x => [x.k, x.gia_tri])); }
  catch (e) { ghiChu.push('đọc giờ chạy bot: ' + e.message); }
  for (const [k, ten, gioToiDa] of [['bot_report_luc', 'Bot báo cáo kiểm kê 8h sáng', 27], ['hethan_luc', 'Bot tự huỷ phiếu quá hạn', 14]]) {
    const t = Date.parse(moc[k] || '');
    if (!t) continue;   // chưa từng ghi (lần đầu sau khi đổi) -> chưa xét
    const tuoi = (NOW - t) / 3600e3;
    if (tuoi > gioToiDa) phat.push({ khoa: 'bot|' + k, muc: 'S2', tieu: ten + ' không chạy', anhHuong: 'việc tự động của bot bị bỏ lỡ',
      dauHieu: `lần chạy gần nhất cách đây ${tuoi.toFixed(1)} giờ`, viec: 'Vercel → Logs xem hàm /api/bot hoặc /api/het-han-dc' });
  }
}

// TÁI PHÁT (Khoa 16/11/2026): lỗi đã sửa phải được nhớ để không tái phạm. Bảng so_tay (PHẦN 40) loại 'bai_hoc' có
// khoa_nhan_dien: dấu hiệu nào khớp (đầu mã su_co, hoặc chuỗi trong câu lỗi) thì gắn nhãn TÁI PHÁT + dẫn bài học.
// Lỗi người dùng khớp bài học mà chưa đủ ngưỡng mở sự cố (1–2 người) vẫn mở sự cố S2 "tái phát".
let baiHoc = [];
if (sbOK) {
  try { baiHoc = (await q(`so_tay?select=id,tieu_de,muc,ban_sua,ngay_sua,chan_tai_phat,khoa_nhan_dien&loai=eq.bai_hoc&khoa_nhan_dien=not.is.null&limit=500`)).filter(b => String(b.khoa_nhan_dien || '').trim()); }
  catch (e) { if (!thieuBang(e)) ghiChu.push('đọc sổ tay: ' + e.message); }
}
const khopBH = (b, txt) => String(txt || '').toLowerCase().includes(String(b.khoa_nhan_dien).trim().toLowerCase());
for (const b of baiHoc) {
  const k = String(b.khoa_nhan_dien).trim();
  const trung = phat.filter(f => f.khoa.startsWith('loi|') && (khopBH(b, f.tieu) || khopBH(b, f.dauHieu)));
  trung.forEach(f => { if (!f.baiHoc) f.baiHoc = b; });
  if (trung.length) continue;
  const gap = loiApp.filter(x => khopBH(b, x.thong_diep) || khopBH(b, x.ma) || khopBH(b, x.chi_tiet));
  if (!gap.length) continue;
  const nguoi = new Set(gap.map(x => x.user_id || x.may)), ten = [...new Set(gap.map(x => x.ten).filter(Boolean))];
  phat.push({ khoa: 'tai_phat|' + b.id, muc: (b.muc === 'S1' ? 'S1' : 'S2'), tieu: 'Tái phát: ' + b.tieu_de, baiHoc: b, nguoi: nguoi.size,
    anhHuong: `${nguoi.size} người gặp lại${ten.length ? ' (' + ten.slice(0, 4).join(', ') + ')' : ''}`,
    lyDo: [`Câu lỗi khớp dấu hiệu "${String(b.khoa_nhan_dien).trim()}" của bài học đã sửa`, `Gần nhất: ${String(gap[0].thong_diep || '').slice(0, 90)} · màn ${gap[0].man || '?'} · bản ${gap[0].ver || '?'}`],
    dauHieu: 'tái phát' });
}

// Việc cần làm + chỗ tra cứu (Khoa 16/11/2026: làm nổi phần xử lý, lý do gạch đầu dòng)
const HUONG = [
  ['web_sap', 'Kiểm tra bản build mới nhất có lỗi không; lỗi thì build lại bản trước', 'Vercel → Deployments'],
  ['deploy_cu', 'Xem bản ' + verRepo + ' build có lỗi không; lỗi thì sửa rồi đẩy lại', 'Vercel → Deployments'],
  ['sb_sap', null, 'Supabase → Project status · Usage'],
  ['loi|api|/api/ocr', 'Bật thông báo cho bộ phận (mẫu "quét ảnh") để BP tạm nhập Excel; xem log hàm quét ảnh', 'App → Sự cố hệ thống → Lỗi ghi nhận 24 giờ'],
  ['loi|api|', 'Xem log của hàm này để biết nguyên nhân', 'App → Sự cố hệ thống → Lỗi ghi nhận 24 giờ'],
  ['loi|app|', 'Xem ai bị, ở màn nào, bản nào; lỗi kéo dài thì bật thông báo cho bộ phận', 'App → Sự cố hệ thống → Lỗi ghi nhận 24 giờ'],
  ['so_trung|', 'Xoá dòng có nhãn "ghi trùng" (chỉ admin)', 'App → Nhập kho & ĐC → Theo dõi sổ điều chuyển'],
  ['so_thieu|', 'Đối chiếu phiếu với sổ, bổ sung các mã chưa vào sổ', 'App → Nhập kho & ĐC → Toàn bộ phiếu yêu cầu → tìm mã phiếu'],
  ['egress_100', 'Nâng Supabase lên gói Pro trước hạn, hoặc giảm dữ liệu tải lúc mở app', 'Supabase → Usage · bảng egress_ngay'],
  ['egress_80', 'Xem máy / bảng nào tải nhiều để giảm', 'Supabase → Usage · bảng egress_ngay'],
  ['bot|', 'Bật lại workflow nếu GitHub đã tự tắt (repo 60 ngày không hoạt động)', 'GitHub → Actions'],
  ['bot_loi|', 'Mở lượt chạy lỗi, đọc dòng đỏ', 'GitHub → Actions'],
  ['tai_phat|', 'Đối chiếu với bản sửa cũ xem bị gỡ / hỏng ở đâu; sửa lại rồi bổ sung bài học', 'App → Sự cố hệ thống → Sổ tay & bài học'],
];
for (const f of phat) {
  const h = HUONG.find(([k]) => f.khoa.startsWith(k));
  if (h) { if (h[1]) f.viec = h[1]; f.traCuu = h[2]; }
  if (!f.lyDo) f.lyDo = String(f.dauHieu || '').split(' · ').filter(Boolean);
}

// ---------------------------------------------------------------- 2. MỞ / ĐÓNG / BÁO SỰ CỐ
const dem = ngayISO(NOW).slice(5).replace('-', '');
let soMoi = 0;
if (sbOK && suCoOK) { try { soMoi = (await q(`su_co?select=id&ma=like.SC-${dem.slice(2)}${dem.slice(0, 2)}-*`)).length; } catch (e) {} }
function maMoi() { const d = vnDate(NOW); soMoi++; return `SC-${p2(d.getUTCDate())}${p2(d.getUTCMonth() + 1)}-${p2(soMoi)}`; }
const tinMo = (f, ma, tuMuc) => tinSuCo({ ...f, ma, luc: gioNgay(NOW), tuMuc: tuMuc || null });
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
      if (f.baiHoc) { try { const b = (await q(`so_tay?select=tai_phat_lan&id=eq.${encodeURIComponent(f.baiHoc.id)}`))[0] || {};
        await ghi('PATCH', 'so_tay?id=eq.' + encodeURIComponent(f.baiHoc.id), { tai_phat_lan: (Number(b.tai_phat_lan) || 0) + 1, tai_phat_cuoi: new Date(NOW).toISOString() }); } catch (e) { ghiChu.push('ghi tái phát: ' + e.message); } }
      const kq = gioi ? await gui(tinMo(f, ma), f.muc) : { ok: false };
      await ghi('POST', 'su_co', { id: f.khoa, ma, muc: f.muc, tieu_de: f.tieu, anh_huong: f.anhHuong, chi_tiet: (f.lyDo || []).join(' · ') || f.dauHieu, viec: f.viec + (f.traCuu ? ' — tra: ' + f.traCuu : ''),
        trang_thai: 'mo', mo_at: nowIso, cap_nhat_at: nowIso, da_bao_muc: kq.ok ? f.muc : null, so_nguoi: f.nguoi || null });
      continue;
    }
    const ma = cu.ma || maMoi();
    const patch = { cap_nhat_at: nowIso, muc: RANK[f.muc] > RANK[cu.muc] ? f.muc : cu.muc, anh_huong: f.anhHuong, chi_tiet: f.dauHieu, so_nguoi: f.nguoi || cu.so_nguoi };
    if (cu.trang_thai === 'nghi') Object.assign(patch, { trang_thai: 'mo', ma, mo_at: nowIso, tieu_de: f.tieu, viec: f.viec });
    const daBao = cu.trang_thai === 'nghi' ? null : cu.da_bao_muc;
    if (!cu.da_xu_ly && coTheGui(f.muc) && (!daBao || RANK[f.muc] > RANK[daBao])) {
      const kq = await gui(tinMo(f, ma, daBao), f.muc);
      if (kq.ok) patch.da_bao_muc = f.muc;
    }
    await ghi('PATCH', 'su_co?id=eq.' + encodeURIComponent(f.khoa), patch);
  }
  // Đóng sự cố không còn dấu hiệu
  for (const r of suCo) {
    if (thay.has(r.id)) continue;
    if (r.trang_thai === 'nghi') { await ghi('DELETE', 'su_co?id=eq.' + encodeURIComponent(r.id)); continue; }
    if (r.da_bao_muc && coTheGui(r.muc)) await gui(tinOnLai({ muc: r.muc, tieu: r.tieu_de || '', ma: r.ma || '',
      tu: gioNgay(Date.parse(r.mo_at)), den: gioNgay(NOW), phut: (NOW - Date.parse(r.mo_at)) / 60000, nguoi: r.so_nguoi }), r.muc);
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
    const D = { luc: gioNgay(NOW).slice(0, 5) + ' · ' + homNay.split('-').reverse().join('/'), conMo: [], dem: [], homQua: { S1: 0, S2: 0 }, ghiChu: [...ghiChu] };
    try {
      const sc = await q(`su_co?select=ma,muc,tieu_de,mo_at,trang_thai,da_xu_ly&mo_at=gte.${tuQua}&id=not.like.tomtat*&order=mo_at.asc&limit=200`);
      const mo = await q(`su_co?select=ma,muc,tieu_de&trang_thai=eq.mo&da_xu_ly=eq.false&order=mo_at.asc&limit=50`);
      D.conMo = mo.filter(r => r.ma).map(r => ({ ma: r.ma, muc: r.muc, tieu: r.tieu_de }));
      ['S1', 'S2'].forEach(mu => { D.homQua[mu] = sc.filter(r => r.muc === mu && r.mo_at < sang).length; });
      D.dem = sc.filter(r => r.mo_at >= toiQua && r.mo_at < sang).map(r => ({ ma: r.ma, muc: r.muc, tieu: r.tieu_de, daOn: r.trang_thai === 'dong' }));
    } catch (e) { D.ghiChu.push('sổ sự cố'); }
    try {
      const la = await qDu(`loi_app?select=id,nguon,thong_diep,man,user_id,may,so_lan&at=gte.${tuQua}&at=lt.${sang}`);
      const g = new Map(), nguoi = new Set();
      for (const x of la) { const k = (x.nguon === 'may_chu' ? 'Máy chủ ' + x.man + ': ' : '') + x.thong_diep; const v = g.get(k) || { n: new Set(), lan: 0 };
        v.n.add(x.user_id || x.may); nguoi.add(x.user_id || x.may); v.lan += Number(x.so_lan) || 1; g.set(k, v); }
      D.loi = { khoang: 'từ 0h hôm qua', lan: la.reduce((s, x) => s + (Number(x.so_lan) || 1), 0), nguoi: nguoi.size,
        top: [...g].sort((a, b) => b[1].n.size - a[1].n.size || b[1].lan - a[1].lan).slice(0, 3).map(([k, v]) => ({ k, n: v.n.size, lan: v.lan })) };
    } catch (e) { if (!thieuBang(e)) D.ghiChu.push('lỗi người dùng'); }
    try {
      const eg = await qDu(`egress_ngay?select=ngay,may,user_id,ten,bytes,ver,bang&ngay=eq.${homQua}`, 'ngay.asc,may.asc,user_id');
      const bang = {}; eg.forEach(r => Object.entries(r.bang || {}).forEach(([k, v]) => { bang[k] = (bang[k] || 0) + Number(v || 0); }));
      const E = globalThis.__eg, dd = ms => ngayISO(ms).split('-').reverse().slice(0, 2).join('/');
      D.eg = { homQuaMB: eg.reduce((s, r) => s + Number(r.bytes || 0), 0) / 1048576, nguongMB: EG_NGAY_MB, hanMB: EG_HAN_MB,
        kyMB: E ? E.mb : null, duBaoMB: E ? E.duBao : 0, tuKy: E ? dd(E.bd) : '', denKy: E ? dd(E.kt) : '',
        nang: Object.entries(bang).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ k, mb: v / 1048576 })) };
      D.banCu = { ver: verRepo, ten: [...new Set(eg.filter(r => r.ver && verRepo && r.ver !== verRepo).map(r => r.ten || '?'))] };
    } catch (e) { if (!thieuBang(e)) D.ghiChu.push('Egress'); }
    const kq = await gui(tinTomTat(D), 'INFO');
    if (kq.ok) await ghi('POST', 'su_co', { id: khoaTT, muc: 'S3', tieu_de: 'Tin tóm tắt ' + homNay, trang_thai: 'dong', mo_at: new Date(NOW).toISOString(), dong_at: new Date(NOW).toISOString() });
  }
}

if (sbOK && suCoOK) { try { await ghi('POST', 'su_co?on_conflict=id', { id: 'tomtat_lan_chay', muc: 'S3', tieu_de: 'Mốc lượt kiểm gần nhất', trang_thai: 'dong', mo_at: new Date(NOW).toISOString(), cap_nhat_at: new Date(NOW).toISOString() }, 'resolution=merge-duplicates,return=minimal'); } catch (e) { console.warn('ghi mốc', e.message); } }
log(`Xong · ${phat.length} dấu hiệu (${phat.map(f => f.muc + ':' + f.khoa.slice(0, 40)).join(', ') || 'không có'})` + (ghiChu.length ? ' · ghi chú: ' + ghiChu.join(' | ') : ''));
