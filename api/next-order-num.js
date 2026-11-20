// Vercel Serverless Function — GET /api/next-order-num
// Returns the next available order number based on total existing orders in Supabase
// Format: L{YY}{NNNNNN}, e.g. L26000001

const https = require('https');

module.exports = async function handler(req, res) {
  const allowedOrigins = [
    'https://admin.laba.zemlerob.com.ua',
    'https://laba.zemlerob.com.ua',
    'http://localhost:3000',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  try {
    const year = new Date().getFullYear().toString().slice(-2); // "26"
    const prefix = `L${year}`;

    // Find the highest existing order number for the current year via RPC
    // e.g. orders with order_num like 'L26%' → extract numeric suffix → MAX + 1
    const result = await new Promise((resolve, reject) => {
      const u = new URL(`${url}/rest/v1/orders?select=order_num&order_num=like.${prefix}*&order=order_num.desc&limit=1`);
      const opts = {
        hostname: u.hostname,
        path:     u.pathname + u.search,
        method:   'GET',
        headers: {
          'apikey':        key,
          'Authorization': `Bearer ${key}`,
          'Accept':        'application/json',
        },
      };
      const req = https.request(opts, r => {
        let raw = '';
        r.on('data', c => raw += c);
        r.on('end', () => resolve({ status: r.statusCode, body: raw }));
      });
      req.on('error', reject);
      req.end();
    });

    if (result.status >= 300) {
      return res.status(500).json({ ok: false, error: `Supabase ${result.status}: ${result.body}` });
    }

    let nextNum = 1;
    try {
      const rows = JSON.parse(result.body);
      if (Array.isArray(rows) && rows.length > 0 && rows[0].order_num) {
        const lastNum = rows[0].order_num.replace(prefix, '');
        const parsed  = parseInt(lastNum, 10);
        if (!isNaN(parsed)) nextNum = parsed + 1;
      }
    } catch (_) { /* use nextNum = 1 */ }

    return res.status(200).json({ ok: true, nextNum, year });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
