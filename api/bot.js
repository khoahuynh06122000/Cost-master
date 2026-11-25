// api/bot.js — chạy các bot định kỳ bằng Vercel Cron thay cho lịch GitHub (lịch GitHub trễ 4–10 tiếng, Khoa 25/11/2026).
//   ?viec=sang  (8h VN, cron 0 1 * * *)  : agent/report.mjs (tiến độ kiểm kê → Teams) + agent/canh-bao.mjs (Telegram, kèm tóm tắt)
//   ?viec=chieu (17h VN, cron 0 10 * * *): agent/canh-bao.mjs
// Chạy NGUYÊN các script cũ bằng tiến trình con (node), không chép lại logic -> GitHub bấm tay vẫn chạy y như cũ.
// Bắt buộc CRON_SECRET (Vercel Cron tự gửi header Authorization).
const { spawn } = require('child_process');
const path = require('path');
const { bocLoi } = require('../lib/ghi-loi');

const SUPA_URL = (process.env.SUPABASE_URL || 'https://jygrdbuwveitrlfuwigs.supabase.co').replace(/\/+$/, '');
const SVC = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

async function cauHinhTeams() {
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/bao_mat_cau_hinh?select=k,gia_tri&k=in.(teams_nh,teams_bep,teams_the)',
      { headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
    if (!r.ok) return {};
    return Object.fromEntries((await r.json()).map(x => [x.k, String(x.gia_tri || '').trim()]));
  } catch (e) { return {}; }
}

function chay(file, env, hanMs) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'agent', file)], { env, cwd: path.join(__dirname, '..') });
    let out = '';
    const nghe = d => { out += d; if (out.length > 20000) out = out.slice(-20000); };
    p.stdout.on('data', nghe); p.stderr.on('data', nghe);
    const t = setTimeout(() => { out += '\n[hết giờ]'; p.kill('SIGKILL'); }, hanMs);
    p.on('close', code => { clearTimeout(t); resolve({ file, code, log: out.slice(-1500) }); });
    p.on('error', e => { clearTimeout(t); resolve({ file, code: -1, log: String(e.message) }); });
  });
}

async function xuLy(req, res) {
  const bi = (process.env.CRON_SECRET || '').trim();
  if (!bi || String(req.headers.authorization || '') !== 'Bearer ' + bi) return res.status(401).json({ error: 'Không có quyền' });
  const viec = String((req.query && req.query.viec) || '');
  if (!['sang', 'chieu'].includes(viec)) return res.status(400).json({ error: 'viec = sang | chieu' });
  if (!SVC) return res.status(500).json({ error: 'Thiếu SUPABASE_SERVICE_ROLE_KEY' });
  const ch = await cauHinhTeams();
  const env = Object.assign({}, process.env, {
    SUPABASE_URL: SUPA_URL, SUPABASE_SERVICE_KEY: SVC,
    TEAMS_FLOW_URL: process.env.TEAMS_FLOW_URL || ch.teams_nh || '',
    TEAMS_FLOW_URL_BEP: process.env.TEAMS_FLOW_URL_BEP || ch.teams_bep || '',
    TEAMS_THE: process.env.TEAMS_THE || ch.teams_the || '',
    BOT_NOI_CHAY: 'vercel',
    CANH_BAO_CHO: '12000',   // thử lại sau 12 giây (không phải 45) để vừa hạn 60 giây của hàm
  });
  const viecs = viec === 'sang' ? ['report.mjs', 'canh-bao.mjs'] : ['canh-bao.mjs'];
  const kq = await Promise.all(viecs.map(f => chay(f, env, 52000)));
  const loi = kq.filter(k => k.code !== 0);
  return res.status(loi.length ? 500 : 200).json({ viec, ketQua: kq.map(k => ({ file: k.file, code: k.code, log: k.code ? k.log : undefined })) });
}

module.exports = bocLoi('bot', xuLy);
