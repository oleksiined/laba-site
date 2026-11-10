// Vercel Serverless Function — POST /api/save-protocol
// 1. Uploads Protocol PDF to Supabase Storage (bucket "laba-documents", path protocols/)
// 2. Inserts/upserts record in `protocols` table
// Body: { orderNum, sampleId?, pdfBase64, protocolNum?, analysisDate?, version? }

'use strict';
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

  const { orderNum, sampleId, pdfBase64, protocolNum, analysisDate, version } = req.body || {};
  if (!orderNum || !pdfBase64) {
    return res.status(400).json({ ok: false, error: 'Missing orderNum or pdfBase64' });
  }

  const pdfBuffer   = Buffer.from(pdfBase64, 'base64');
  const ver         = version || 1;
  const bucket      = 'laba-documents';
  const fileKey     = sampleId || orderNum;
  const storagePath = `protocols/${fileKey}_v${ver}.pdf`;
  const safeDate    = analysisDate ? '_' + analysisDate.replace(/\./g, '-') : '';
  const fileName    = `Протокол_LABA_${fileKey}${safeDate}.pdf`;
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

  console.log(`[save-protocol] upload ${uploadRes.status} → ${storagePath}`);
  if (uploadRes.status >= 300) {
    return res.status(500).json({ ok: false, error: `Storage upload ${uploadRes.status}: ${uploadRes.body}` });
  }

  // ── 2. Upsert into `protocols` table ──────────────────────────────────────
  const docPayload = JSON.stringify({
    ...(protocolNum ? { protocol_num: protocolNum } : {}),
    order_id:          orderNum,
    ...(sampleId       ? { sample_id: sampleId }             : {}),
    file_name:         fileName,
    storage_bucket:    bucket,
    storage_path:      storagePath,
    version:           ver,
    status:            'draft',
    visible_to_client: false,
    ...(analysisDate   ? { analysis_date: analysisDate }     : {}),
  });

  const docRes = await httpsReq({
    hostname: host,
    path:     '/rest/v1/protocols',
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
    console.warn('[save-protocol] protocols insert failed:', docRes.status, docRes.body);
    return res.status(500).json({ ok: false, error: `DB insert ${docRes.status}: ${docRes.body}` });
  }

  let protocolId = null;
  try {
    const parsed = JSON.parse(docRes.body);
    protocolId = Array.isArray(parsed) ? parsed[0]?.id : parsed?.id;
  } catch (_) {}

  console.log(`[save-protocol] saved id=${protocolId} order=${orderNum} sample=${sampleId || '—'}`);
  return res.status(200).json({ ok: true, protocolId, bucket, path: storagePath });
};
