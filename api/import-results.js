// Vercel Serverless Function — POST /api/import-results
// Receives parsed Excel rows and upserts into sample_results table.
// Each row: { sample_id, lab_sample_id, results: { "key": "value", ... } }
// Stores as one row per sample in sample_results (upsert on sample_id).

const https = require('https');

function supabaseRequest(hostname, path, key, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname, path, method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
      },
      r => {
        let raw = '';
        r.on('data', c => raw += c);
        r.on('end', () => resolve({ status: r.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    if(payload) req.write(payload);
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
  if(allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if(!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  const host = new URL(url).hostname;

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch(e) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }

  const { rows } = body;
  if(!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ ok: false, error: 'No rows provided' });
  }

  // Build upsert payload
  const upsertRows = rows.map(r => ({
    sample_id: (r.sample_id || '').toString().trim(),
    lab_sample_id: (r.lab_sample_id || '').toString().trim() || null,
    results: r.results || {},
    imported_at: new Date().toISOString(),
  })).filter(r => r.sample_id);

  if(!upsertRows.length) return res.status(400).json({ ok: false, error: 'No valid rows' });

  try {
    const result = await supabaseRequest(
      host,
      '/rest/v1/sample_results?on_conflict=sample_id',
      key,
      'POST',
      upsertRows
    );

    if(result.status >= 300) {
      console.error('[import-results] Supabase error:', result.status, result.body);
      return res.status(500).json({ ok: false, error: `Supabase ${result.status}: ${result.body}` });
    }

    return res.status(200).json({ ok: true, saved: upsertRows.length });
  } catch(err) {
    console.error('[import-results] exception:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
