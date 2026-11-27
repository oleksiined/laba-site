const crypto = require('crypto');

const TOKEN_TTL_SEC = 12 * 60 * 60;

const ADMIN_ORIGINS = [
  'https://admin.laba.zemlerob.com.ua',
  'https://laba.zemlerob.com.ua',
  'http://localhost:3000',
  'http://localhost:5500',
];

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sign(payloadB64, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sessionSecret() {
  const password = process.env.ADMIN_PASSWORD;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!password || !serviceKey) return null;
  return crypto.createHash('sha256').update('laba-admin-session|' + serviceKey + '|' + password).digest('hex');
}

function issueToken() {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload = b64url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC }));
  return { token: payload + '.' + sign(payload, secret), expiresIn: TOKEN_TTL_SEC };
}

function verifyToken(token) {
  const secret = sessionSecret();
  if (!secret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expected = sign(parts[0], secret);
  if (!safeEqual(parts[1], expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function isAdmin(req) {
  return verifyToken(bearer(req));
}

function isCron(req) {
  const cron = process.env.CRON_SECRET;
  return !!cron && safeEqual(bearer(req), cron);
}

function requireAdmin(req, res) {
  if (!sessionSecret()) {
    res.status(503).json({ ok: false, error: 'Admin auth not configured' });
    return false;
  }
  if (!isAdmin(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

function applyCors(req, res, methods) {
  const origin = req.headers.origin || '';
  if (ADMIN_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = { issueToken, verifyToken, isAdmin, isCron, requireAdmin, applyCors, safeEqual, ADMIN_ORIGINS };
