// Vercel Serverless Function — GET /api/validate-promo?code=XXX
// Validates a promo code against the Supabase `promocodes` table.
// Returns: { ok: true, discount_percent: 10 }
//       or { ok: false, error: '...' }

const https = require('https');

function supabaseGet(hostname, path, key) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname, path, method: 'GET',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
      },
      r => {
        let raw = '';
        r.on('data', c => raw += c);
        r.on('end', () => resolve({ status: r.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  const allowedOrigins = [
    'https://laba.zemlerob.com.ua',
    'https://admin.laba.zemlerob.com.ua',
    'http://localhost:3000',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  const code = ((req.query && req.query.code) || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ ok: false, error: 'Вкажіть промокод' });

  const host = new URL(url).hostname;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Query the promocodes table: code matches, is_active, valid_from <= today <= valid_to
  const qs = new URLSearchParams({
    code: `eq.${code}`,
    is_active: 'eq.true',
    valid_from: `lte.${today}`,
    valid_to:   `gte.${today}`,
    select: 'code,discount_percent,valid_from,valid_to,max_uses,used_count',
    limit: '1',
  });

  try {
    const result = await supabaseGet(host, `/rest/v1/promocodes?${qs}`, key);

    if (result.status >= 300) {
      console.error('[validate-promo] Supabase error:', result.status, result.body);
      return res.status(500).json({ ok: false, error: `Supabase ${result.status}` });
    }

    let rows;
    try { rows = JSON.parse(result.body); } catch { rows = []; }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(200).json({ ok: false, error: 'Промокод не знайдено або вже недійсний' });
    }

    const promo = rows[0];

    // Check usage limit
    if (promo.max_uses !== null && promo.max_uses !== undefined) {
      const used = Number(promo.used_count) || 0;
      if (used >= Number(promo.max_uses)) {
        return res.status(200).json({ ok: false, error: 'Промокод вичерпано' });
      }
    }

    return res.status(200).json({
      ok: true,
      discount_percent: Number(promo.discount_percent),
    });
  } catch (err) {
    console.error('[validate-promo] exception:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
