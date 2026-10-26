// Vercel Serverless Function — GET /api/documents-list
// Returns documents from `documents` table filtered by type and optional name search
// Query params:
//   type  — document_type filter (e.g. 'contract')
//   q     — name search substring (case-insensitive, matches file_name)

const https = require('https');

function httpsReq(opts) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    r.on('error', reject);
    r.end();
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
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supaUrl || !supaKey) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  const { type, q } = req.query || {};

  // Build filter params
  const params = new URLSearchParams();
  params.set('select', 'id,document_type,file_name,storage_bucket,storage_path,status,created_at,order_id');
  params.set('order', 'created_at.desc');
  params.set('limit', '50');

  if (type) params.set('document_type', `eq.${type}`);
  if (q)    params.set('file_name', `ilike.*${q}*`);

  const host = new URL(supaUrl).hostname;
  const docsRes = await httpsReq({
    hostname: host,
    path:     `/rest/v1/documents?${params.toString()}`,
    method:   'GET',
    headers: {
      'apikey':        supaKey,
      'Authorization': `Bearer ${supaKey}`,
      'Accept':        'application/json',
    },
  });

  if (docsRes.status >= 300) {
    return res.status(500).json({ ok: false, error: `Supabase ${docsRes.status}: ${docsRes.body}` });
  }

  let documents = [];
  try { documents = JSON.parse(docsRes.body); } catch (_) {}

  return res.status(200).json({ ok: true, documents });
};
