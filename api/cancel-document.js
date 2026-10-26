// Vercel Serverless Function — POST /api/cancel-document
// Sets document status to 'cancelled' for a given order_id + document_type

const https = require('https');

function httpsReq(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    r.on('error', reject);
    if (body) r.write(body);
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supaUrl || !supaKey) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  const { orderId, docType } = req.body || {};
  if (!orderId || !docType) {
    return res.status(400).json({ ok: false, error: 'Missing orderId or docType' });
  }

  const host = new URL(supaUrl).hostname;

  // ── Find document ──────────────────────────────────────────────────────────
  const findRes = await httpsReq({
    hostname: host,
    path:     `/rest/v1/documents?order_id=eq.${encodeURIComponent(orderId)}&document_type=eq.${encodeURIComponent(docType)}&select=id,status&limit=1`,
    method:   'GET',
    headers: {
      'apikey':        supaKey,
      'Authorization': `Bearer ${supaKey}`,
      'Accept':        'application/json',
    },
  });

  let docs = [];
  try { docs = JSON.parse(findRes.body); } catch (_) {}
  if (!docs.length) {
    return res.status(404).json({ ok: false, error: 'Document not found' });
  }

  const docId = docs[0].id;

  // ── Patch status ───────────────────────────────────────────────────────────
  const payload = JSON.stringify({ status: 'void' });
  const patchRes = await httpsReq({
    hostname: host,
    path:     `/rest/v1/documents?id=eq.${docId}`,
    method:   'PATCH',
    headers: {
      'apikey':          supaKey,
      'Authorization':   `Bearer ${supaKey}`,
      'Content-Type':    'application/json',
      'Content-Length':  Buffer.byteLength(payload),
      'Prefer':          'return=minimal',
    },
  }, payload);

  if (patchRes.status >= 300) {
    return res.status(500).json({ ok: false, error: `Supabase PATCH ${patchRes.status}: ${patchRes.body}` });
  }

  return res.status(200).json({ ok: true, docId });
};
