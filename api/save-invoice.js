// Vercel Serverless Function — POST /api/save-invoice
// 1. Uploads Invoice PDF to Supabase Storage (bucket "laba-documents", path invoices/)
// 2. Inserts record in `documents` table (document_type = 'invoice')
// 3. Inserts record in `document_orders` table (link doc ↔ order)

const https = require('https');

function httpsReq(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
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

  const { orderNum, pdfBase64, invDate } = req.body || {};
  if (!orderNum || !pdfBase64) {
    return res.status(400).json({ ok: false, error: 'Missing orderNum or pdfBase64' });
  }

  const pdfBuffer   = Buffer.from(pdfBase64, 'base64');
  const bucket      = 'laba-documents';
  const storagePath = `invoices/${orderNum}.pdf`;
  const fileName    = `Рахунок_LABA_${orderNum}${invDate ? '_' + invDate.replace(/\./g, '-') : ''}.pdf`;
  const host        = new URL(supaUrl).hostname;

  // ── 1. Upload PDF to Supabase Storage ─────────────────────────────────────
  const uploadRes = await httpsReq({
    hostname: host,
    path:     `/storage/v1/object/${bucket}/${storagePath}`,
    method:   'POST',
    headers: {
      'apikey':         supaKey,
      'Authorization':  `Bearer ${supaKey}`,
      'Content-Type':   'application/pdf',
      'Content-Length': pdfBuffer.length,
      'x-upsert':       'true',
    },
  }, pdfBuffer);

  console.log(`[save-invoice] upload ${uploadRes.status} → bucket=${bucket} path=${storagePath}`);
  if (uploadRes.status >= 300) {
    return res.status(500).json({ ok: false, error: `Storage upload ${uploadRes.status}: ${uploadRes.body}` });
  }

  // ── 2. Upsert into `documents` table ──────────────────────────────────────
  const docPayload = JSON.stringify({
    document_type:     'invoice',
    order_id:          orderNum,
    file_name:         fileName,
    storage_bucket:    bucket,
    storage_path:      storagePath,
    version:           1,
    status:            'published',
    visible_to_client: true,
  });

  const docRes = await httpsReq({
    hostname: host,
    path:     '/rest/v1/documents',
    method:   'POST',
    headers: {
      'apikey':          supaKey,
      'Authorization':   `Bearer ${supaKey}`,
      'Content-Type':    'application/json',
      'Content-Length':  Buffer.byteLength(docPayload),
      'Prefer':          'return=representation,resolution=merge-duplicates',
    },
  }, docPayload);

  if (docRes.status >= 300) {
    console.warn('documents insert failed:', docRes.status, docRes.body);
    return res.status(200).json({ ok: true, warn: 'documents insert failed', bucket, path: storagePath });
  }

  let docId = null;
  try {
    const parsed = JSON.parse(docRes.body);
    docId = Array.isArray(parsed) ? parsed[0]?.id : parsed?.id;
  } catch (_) {}

  // ── 3. Insert into `document_orders` (link) ───────────────────────────────
  if (docId) {
    const linkPayload = JSON.stringify({ document_id: docId, order_id: orderNum });
    await httpsReq({
      hostname: host,
      path:     '/rest/v1/document_orders',
      method:   'POST',
      headers: {
        'apikey':          supaKey,
        'Authorization':   `Bearer ${supaKey}`,
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(linkPayload),
        'Prefer':          'return=minimal,resolution=merge-duplicates',
      },
    }, linkPayload).catch(e => console.warn('document_orders insert error:', e.message));
  }

  return res.status(200).json({ ok: true, docId, bucket, path: storagePath });
};
