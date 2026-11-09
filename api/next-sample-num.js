// Vercel Serverless Function — GET /api/next-sample-num
// Returns the next available sample number.
// Format: S{YY}{NNNNNNN}, e.g. S260000001
//
// Strategy: find the highest numeric suffix already issued across both
// orders.samples[].num (JSONB) and the samples table (sample_number),
// then return max+1. This avoids duplicates regardless of deletions or
// concurrent requests.

const https = require('https');

function httpsGet(hostname, path, key) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET',
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } },
      r => { let raw = ''; r.on('data', c => raw += c); r.on('end', () => resolve({ status: r.statusCode, body: raw })); }
    );
    req.on('error', reject);
    req.end();
  });
}

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

  const host = new URL(url).hostname;
  const year = new Date().getFullYear().toString().slice(-2); // "26"
  // Prefix for the current year, e.g. "S26"
  const prefix = `S${year}`;

  try {
    // Fetch both sources in parallel:
    // 1. orders.samples JSONB — only num field
    // 2. samples table — only sample_number field, filtered to current-year prefix
    const [ordersRes, samplesRes] = await Promise.allSettled([
      httpsGet(host, `/rest/v1/orders?select=samples`, key),
      httpsGet(host, `/rest/v1/samples?sample_number=like.${encodeURIComponent(prefix + '%')}&select=sample_number&limit=10000`, key),
    ]);

    let maxNum = 0;

    // Parse orders.samples[].num
    if (ordersRes.status === 'fulfilled' && ordersRes.value.status < 300) {
      const orders = JSON.parse(ordersRes.value.body);
      for (const order of orders) {
        if (!Array.isArray(order.samples)) continue;
        for (const s of order.samples) {
          const num = s.num || '';
          if (num.startsWith(prefix)) {
            const n = parseInt(num.slice(prefix.length), 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
          }
        }
      }
    }

    // Parse samples table sample_number
    if (samplesRes.status === 'fulfilled' && samplesRes.value.status < 300) {
      const rows = JSON.parse(samplesRes.value.body);
      for (const row of rows) {
        const num = row.sample_number || '';
        if (num.startsWith(prefix)) {
          const n = parseInt(num.slice(prefix.length), 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
      }
    }

    const nextNum = maxNum + 1;
    return res.status(200).json({ ok: true, nextNum, year });
  } catch (err) {
    console.error('[next-sample-num] exception:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
