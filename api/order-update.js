// Vercel Serverless Function — PATCH /api/order-update
// Updates order status or samples in Supabase

const https = require('https');

module.exports = async function handler(req, res) {
  const allowedOrigins = [
    'https://admin.laba.zemlerob.com.ua',
    'http://localhost:3000',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { id, ...fields } = body || {};
  if (!id) return res.status(400).json({ error: 'Missing order id' });

  // Only allow updating specific fields for safety
  const allowed = ['status', 'samples', 'payment', 'company', 'name', 'edrpou', 'phone', 'email', 'payer_type', 'notes'];
  const update = {};
  for (const k of allowed) {
    if (k in fields) update[k] = fields[k];
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: 'No fields to update' });

  const payload = JSON.stringify(update);

  try {
    const result = await new Promise((resolve, reject) => {
      const u = new URL(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`);
      const opts = {
        hostname: u.hostname,
        path:     u.pathname + u.search,
        method:   'PATCH',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'apikey':         key,
          'Authorization':  `Bearer ${key}`,
          'Prefer':         'return=minimal',
        },
      };
      const req2 = https.request(opts, r => {
        let raw = '';
        r.on('data', c => raw += c);
        r.on('end', () => resolve({ status: r.statusCode, body: raw }));
      });
      req2.on('error', reject);
      req2.write(payload);
      req2.end();
    });

    if (result.status >= 300) {
      return res.status(500).json({ ok: false, error: `Supabase ${result.status}: ${result.body}` });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
