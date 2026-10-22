// Vercel Serverless Function — GET /api/materials
// Returns catalog_materials from Supabase for the admin panel

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
    const result = await new Promise((resolve, reject) => {
      const u = new URL(`${url}/rest/v1/catalog_materials?select=material_id,name,status&order=sort_order.asc.nullslast,material_id`);
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

    const materials = JSON.parse(result.body);
    return res.status(200).json({ ok: true, materials });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
