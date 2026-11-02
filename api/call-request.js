// Vercel Serverless Function — POST /api/call-request
// Saves "Замовити дзвінок" form data to Supabase as an order

const https = require('https');

function httpsPost(url, key, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=representation',
      },
    }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  const allowedOrigins = [
    'https://laba.zemlerob.com.ua',
    'http://localhost:3000',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { name, phone, comment } = body || {};
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  // Generate a simple order num: CR + timestamp
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const ts = String(now.getTime()).slice(-4);
  const orderNum = `CR${yy}${mm}${dd}${ts}`;
  const date = `${dd}.${mm}.20${yy}`;

  const payload = {
    order_num:  orderNum,
    name:       name,
    phone:      phone,
    email:      null,
    company:    null,
    payer_type: 'private',
    items:      [],
    samples:    [],
    delivery:   null,
    payment:    null,
    promo:      null,
    discount:   0,
    total:      0,
    notes:      comment ? `📞 Запит дзвінка\nКоментар: ${comment}` : '📞 Запит дзвінка',
  };

  try {
    const result = await httpsPost(`${url}/rest/v1/orders`, key, payload);
    if (result.status >= 300) {
      console.error('Supabase error:', result.status, result.body);
      return res.status(500).json({ ok: false, error: `Supabase ${result.status}` });
    }
    return res.status(200).json({ ok: true, orderNum });
  } catch (err) {
    console.error('call-request error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
