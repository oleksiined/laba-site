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

    // Fetch all existing order numbers for the current year
    const result = await new Promise((resolve, reject) => {
      const u = new URL(`${url}/rest/v1/orders?select=order_num&order_num=like.${prefix}*`);
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

    // Build a set of taken numbers, then find the first free slot starting from 1
    const taken = new Set();
    try {
      const rows = JSON.parse(result.body);
      if (Array.isArray(rows)) {
        rows.forEach(r => {
          if (r.order_num && r.order_num.startsWith(prefix)) {
            const n = parseInt(r.order_num.slice(prefix.length), 10);
            if (!isNaN(n)) taken.add(n);
          }
        });
      }
    } catch (_) { /* taken stays empty */ }

    let nextNum = 1;
    while (taken.has(nextNum)) nextNum++;

    return res.status(200).json({ ok: true, nextNum, year });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
