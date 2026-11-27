const { issueToken, safeEqual, applyCors } = require('./_auth');

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function tooMany(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    attempts.set(ip, { start: now, count: 0 });
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function registerFailure(ip) {
  const rec = attempts.get(ip) || { start: Date.now(), count: 0 };
  rec.count += 1;
  attempts.set(ip, rec);
}

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ ok: false, error: 'Admin auth not configured' });
  }

  const ip = clientIp(req);
  if (tooMany(ip)) return res.status(429).json({ ok: false, error: 'Too many attempts' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const password = body && typeof body.password === 'string' ? body.password : '';

  if (!password || !safeEqual(password, expected)) {
    registerFailure(ip);
    await new Promise(r => setTimeout(r, 400));
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }

  attempts.delete(ip);
  const issued = issueToken();
  return res.status(200).json({ ok: true, token: issued.token, expiresIn: issued.expiresIn });
};
