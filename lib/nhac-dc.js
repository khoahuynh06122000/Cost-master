// lib/nhac-dc.js — NHẮC DUYỆT PHIẾU ĐIỀU CHUYỂN LÚC 17H MỖI NGÀY (Khoa 23/11/2026).
//
// Trước đây phần này nằm trong tin 8h sáng (agent/report.mjs chạy trên GitHub) — nhưng lịch GitHub trễ 6–8 tiếng
// nên tin tới lúc 14h30–15h30 và tag cả phiếu vừa lập 2 phút (người duyệt xem lại thì phiếu đã duyệt → tưởng báo sai).
// Nay chạy bằng Vercel Cron 17h (vercel.json), chụp danh sách phiếu ĐANG chờ duyệt đúng lúc đó, tag NGƯỜI DUYỆT của
// từng kho (giám sát; kho không có giám sát thì bếp trưởng).
// Bên duyệt: xin/đẩy -> kho CHO hàng; hàng dư -> bếp NHẬN; hủy -> kế toán (không nhắc ở đây).
// Mỗi kho phải duyệt: 1 thông báo chuông + đẩy về máy (một lần mỗi ngày). Tin Teams tách BẾP / NHÀ HÀNG.

const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SVC = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const FLOW_NH = (process.env.TEAMS_FLOW_URL || '').trim();
const FLOW_BEP = (process.env.TEAMS_FLOW_URL_BEP || '').trim();
const THE = (process.env.TEAMS_THE || '').trim() === '1';
// Hạn 48 giờ — tính y hệt dcHan() của app và agent/het-han-dc.mjs
const HAN_MOC = Date.parse('2026-11-09T12:00:00+07:00');

const H = () => ({ apikey: SVC, Authorization: 'Bearer ' + SVC });
async function q(path) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + path, { headers: H() });
  if (!r.ok) throw new Error('Đọc ' + path.split('?')[0] + ' HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return r.json();
}
const vnNorm = s => String(s == null ? '' : s).normalize('NFD').toLowerCase()
  .replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, '');

// ----- Teams: chữ trơn hoặc Adaptive Card có @ thật (giống agent/report.mjs) -----
const MEN_RE = /⟦@([^|⟧]+)\|([^⟧]+)⟧/g;
function theTeams(text) {
  const ent = new Map(), body = [];
  let cach = false;
  for (const d of String(text).split(/\r?\n/)) {
    if (!d.trim()) { cach = true; continue; }
    const t = d.replace(MEN_RE, (_, mail, ten) => {
      const at = '<at>' + ten + '</at>';
      if (!ent.has(at)) ent.set(at, { type: 'mention', text: at, mentioned: { id: mail, name: ten } });
      return at;
    });
    body.push({ type: 'TextBlock', text: t, wrap: true, spacing: cach ? 'Medium' : 'None', weight: /^(⏰|📦)/.test(d) ? 'Bolder' : 'Default' });
    cach = false;
  }
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null,
    content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body,
      msteams: { width: 'Full', entities: [...ent.values()] } } }] };
}
async function postTeams(url, text) {
  if (THE) return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(theTeams(text)) });
  const html = String(text).replace(MEN_RE, (_, mail, ten) => ten).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: html });
}

// Tên kho: bảng slocs/plants trên máy chủ; kho chưa có thì đọc DATA nhúng trong index.html (cùng nguồn laKhoBep của app).
async function tenKho(appUrl, canKhoa) {
  const [slocs, plants] = await Promise.all([
    q('slocs?select=plant_code,sloc_code,sloc_name').catch(() => []),
    q('plants?select=plant_code,plant_name').catch(() => []),
  ]);
  const sn = {}, pn = {};
  slocs.forEach(s => { sn[s.plant_code + '|' + s.sloc_code] = s.sloc_name; });
  plants.forEach(p => { pn[p.plant_code] = p.plant_name; });
  if (canKhoa.some(k => !sn[k]) && appUrl) {
    try {
      const html = await (await fetch(appUrl + '/index.html')).text();
      const dong = html.split('\n').find(l => /^const DATA\s*=\s*\{/.test(l));
      const data = JSON.parse(dong.replace(/^const DATA\s*=\s*/, '').replace(/;\s*$/, ''));
      (data.warehouses || []).forEach(w => { const k = w.plant + '|' + w.sloc; if (!sn[k]) sn[k] = w.sloc_name; if (!pn[w.plant]) pn[w.plant] = w.plant_name; });
    } catch (e) { console.warn('Không đọc được danh sách kho trong index.html:', e.message); }
  }
  return { sname: (p, s) => sn[p + '|' + s] || ('kho ' + s), pname: p => pn[p] || p, laBep: (p, s) => vnNorm(sn[p + '|' + s]).includes('bep') };
}

// Người duyệt của từng kho để @: giám sát được gán kho (gán cả điểm bán = mọi kho); không có giám sát thì bếp trưởng.
async function nguoiDuyetKho() {
  const nd = {};
  const pf = await q('profiles?select=id,full_name,email,ma_nv,role&status=eq.active&role=in.(giam_sat,bep_truong)');
  if (!pf.length) return nd;
  const up = await q('user_plants?select=user_id,plant_code,sloc_code&user_id=in.(' + pf.map(x => x.id).join(',') + ')');
  const mas = [...new Set(pf.map(x => x.ma_nv).filter(Boolean))];
  let ns = [];
  if (mas.length) { try { ns = await q('nhan_su?select=ma_nv,ho_ten,email_cty&ma_nv=in.(' + mas.map(encodeURIComponent).join(',') + ')'); } catch (e) {} }
  const nsMa = new Map(ns.map(x => [x.ma_nv, x]));
  const laMailCty = m => /@(banahills|sungroup)\.com\.vn$/i.test(String(m || '').trim());
  const tt = Object.fromEntries(pf.map(x => {
    const n = x.ma_nv && nsMa.get(x.ma_nv);
    const mail = (n && n.email_cty) || (laMailCty(x.email) ? x.email : '');
    return [x.id, { ten: (n && n.ho_ten) || x.full_name || x.email, mail: String(mail || '').trim(), role: x.role }];
  }));
  up.forEach(u => { const a = tt[u.user_id]; if (!a) return; (nd[u.plant_code + '|' + (u.sloc_code || '*')] = nd[u.plant_code + '|' + (u.sloc_code || '*')] || []).push(a); });
  return nd;
}

const baoLau = ms => { const g = Math.max(0, Math.floor(ms / 3600e3)); return g < 24 ? g + ' giờ' : Math.floor(g / 24) + ' ngày' + (g % 24 ? ' ' + (g % 24) + ' giờ' : ''); };

// opt: { appUrl, thu (true = chỉ dựng tin, không gửi gì), now }
async function nhacDuyetDC(opt) {
  const o = opt || {};
  const now = o.now || Date.now();
  if (!SVC) throw new Error('Thiếu SUPABASE_SERVICE_ROLE_KEY');
  const ds = (await q('transfer_requests?select=id,kind,from_plant,from_sloc,to_plant,to_sloc,created_by,created_at&status=eq.' + encodeURIComponent('Chờ duyệt')))
    .filter(r => r.kind !== 'huy');
  const g = {};
  ds.forEach(r => {
    const [p, s] = r.kind === 'du' ? [r.to_plant, r.to_sloc] : [r.from_plant, r.from_sloc];
    if (!p) return;
    const k = p + '|' + s;
    (g[k] = g[k] || { p, s, cu: r.created_at, ds: [] }).ds.push(r);
    if (String(r.created_at) < String(g[k].cu)) g[k].cu = r.created_at;
  });
  const ks = Object.values(g).sort((a, b) => String(a.cu).localeCompare(String(b.cu)));
  const kq = { phieu: ds.length, kho: ks.length, tin: {}, thongBao: 0, loi: [] };
  if (!ks.length) return kq;

  const canKhoa = [...new Set([...Object.keys(g), ...ds.map(r => r.to_plant + '|' + r.to_sloc), ...ds.map(r => r.from_plant + '|' + r.from_sloc)])];
  const { sname, pname, laBep } = await tenKho(o.appUrl, canKhoa);
  let nd = {};
  try { nd = await nguoiDuyetKho(); } catch (e) { kq.loi.push('Đọc người duyệt: ' + e.message); }
  const tagKho = (p, s) => {
    const all = [...(nd[p + '|' + s] || []), ...(nd[p + '|*'] || [])];
    const gs = all.filter(a => a.role === 'giam_sat');
    const chon = [...new Map((gs.length ? gs : all).map(a => [a.mail || a.ten, a])).values()];
    return chon.length ? ' ' + chon.map(a => a.mail ? '⟦@' + a.mail + '|' + a.ten + '⟧' : a.ten).join(', ') : '';
  };
  const dongPhieu = r => {
    const t = Date.parse(r.created_at), con = Math.ceil((Math.max(t, HAN_MOC) + 48 * 3600e3 - now) / 3600e3);
    const diem = r.kind === 'du' ? sname(r.from_plant, r.from_sloc) : sname(r.to_plant, r.to_sloc);
    return '• ' + diem + ' — tạo ' + baoLau(now - t) + ' trước · ' + (con > 0 ? 'còn ' + con + ' giờ' : 'quá hạn, sắp tự hủy');
  };
  const h = new Date(now + 7 * 3600e3);
  const ngayVN = String(h.getUTCDate()).padStart(2, '0') + '/' + String(h.getUTCMonth() + 1).padStart(2, '0');
  const gioVN = String(h.getUTCHours()).padStart(2, '0') + ':' + String(h.getUTCMinutes()).padStart(2, '0');
  const dungTin = nhom => {
    if (!nhom.length) return '';
    const tong = nhom.reduce((a, x) => a + x.ds.length, 0);
    return '⏰ ' + tong + ' PHIẾU ĐIỀU CHUYỂN CHƯA DUYỆT — chốt lúc ' + gioVN + ' ngày ' + ngayVN + ' (hạn duyệt 48 giờ, quá hạn tự hủy)\n\n' +
      nhom.map(x => '📦 Chờ ' + sname(x.p, x.s) + ' duyệt:' + tagKho(x.p, x.s) + '\n' +
        x.ds.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map(dongPhieu).join('\n')).join('\n\n');
  };
  kq.tin.bep = dungTin(ks.filter(x => laBep(x.p, x.s)));
  kq.tin.nh = dungTin(ks.filter(x => !laBep(x.p, x.s)));
  if (o.thu) return kq;

  // Teams
  for (const [ten, url, msg] of [['BẾP', FLOW_BEP, kq.tin.bep], ['NHÀ HÀNG', FLOW_NH, kq.tin.nh]]) {
    if (!msg) continue;
    if (!url) { kq.loi.push('Chưa đặt link Teams nhóm ' + ten); continue; }
    try { const r = await postTeams(url, msg); if (!r.ok) kq.loi.push('Teams ' + ten + ' HTTP ' + r.status); }
    catch (e) { kq.loi.push('Teams ' + ten + ': ' + e.message); }
  }

  // Chuông trong app + đẩy về máy: mỗi kho một lần mỗi ngày
  const dauNgay = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), h.getUTCDate()) - 7 * 3600e3).toISOString();
  let daNhac = [];
  try { daNhac = await q('notifications?select=plant_code,sloc_code&kind=eq.dcnhac&created_at=gte.' + dauNgay); } catch (e) {}
  for (const x of ks) {
    if (daNhac.some(d => d.plant_code === x.p && d.sloc_code === x.s)) continue;
    const _v = new Date(new Date(x.cu).getTime() + 7 * 3600e3);
    const ngayLap = String(_v.getUTCDate()).padStart(2, '0') + '/' + String(_v.getUTCMonth() + 1).padStart(2, '0');
    const ngay = Math.floor((now - new Date(x.cu).getTime()) / 864e5);
    const msg = '⏰ ' + pname(x.p) + ' · ' + sname(x.p, x.s) + ' đang có ' + x.ds.length + ' phiếu điều chuyển Chờ tôi duyệt (cũ nhất lập ' + ngayLap + ' — ' + ngay + ' ngày). ⚠ Quy định: đã xuất hàng cho kho khác thì PHẢI duyệt phiếu ngay trong ngày — chưa duyệt thì sổ chưa trừ kho, kiểm kê cuối tháng sẽ lệch. Phiếu quá 48 giờ chưa duyệt sẽ bị hệ thống tự hủy. Vào Nhập kho & ĐC → Chờ tôi duyệt.';
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/notifications', { method: 'POST',
        headers: Object.assign(H(), { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ id: 'NTB' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), plant_code: x.p, sloc_code: x.s,
          message: msg, kind: 'dcnhac', created_by: 'Hệ thống', read_flag: false }) });
      if (r.ok) kq.thongBao++; else kq.loi.push('Ghi thông báo ' + x.p + '|' + x.s + ' HTTP ' + r.status);
    } catch (e) { kq.loi.push('Ghi thông báo: ' + e.message); }
    if (o.appUrl) {
      try {
        const subs = await q('push_subs?select=endpoint,p256dh,auth&plant_code=eq.' + x.p + '&sloc_code=eq.' + x.s);
        const uniq = [...new Map(subs.filter(z => z.endpoint).map(z => [z.endpoint, z])).values()];
        if (uniq.length) await fetch(o.appUrl + '/api/push-send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-service-key': SVC },
          body: JSON.stringify({ subs: uniq, title: 'Phiếu điều chuyển chờ duyệt', body: msg, url: '/', tag: 'dcnhac' }) });
      } catch (e) { kq.loi.push('Đẩy thông báo: ' + e.message); }
    }
  }
  return kq;
}

module.exports = { nhacDuyetDC };
