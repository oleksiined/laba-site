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
    // Count all orders
    const result = await new Promise((resolve, reject) => {
      const u = new URL(`${url}/rest/v1/orders?select=id`);
      const opts = {
        hostname: u.hostname,
        path:     u.pathname + u.search,
        method:   'GET',
        headers: {
          'apikey':        key,
          'Authorization': `Bearer ${key}`,
          'Accept':        'application/json',
          'Prefer':        'count=exact',
        },
      };
      const req = https.request(opts, r => {
        let raw = '';
        r.on('data', c => raw += c);
        r.on('end', () => resolve({ status: r.statusCode, body: raw, headers: r.headers }));
      });
      req.on('error', reject);
      req.end();
    });

    if (result.status >= 300) {
      return res.status(500).json({ ok: false, error: `Supabase ${result.status}: ${result.body}` });
    }

    // Use Content-Range header for count, fallback to body length
    let totalOrders = 0;
    const contentRange = result.headers['content-range'];
    if (contentRange) {
      // Format: "0-N/TOTAL" or "*/TOTAL"
      const match = contentRange.match(/\/(\d+)$/);
      if (match) totalOrders = parseInt(match[1], 10);
    } else {
      const orders = JSON.parse(result.body);
      totalOrders = Array.isArray(orders) ? orders.length : 0;
    }

    const year   = new Date().getFullYear().toString().slice(-2); // "26"
    const nextNum = totalOrders + 1;

    return res.status(200).json({ ok: true, nextNum, year });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
