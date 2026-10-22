// Vercel Serverless Function — POST /api/save-invoice
// Accepts { orderNum, pdfBase64 } → uploads PDF to Supabase Storage → saves URL in orders table
// Bucket "invoices" must exist in Supabase Storage (public or with signed URLs)

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  const { orderNum, pdfBase64 } = req.body || {};
  if (!orderNum || !pdfBase64) {
    return res.status(400).json({ ok: false, error: 'Missing orderNum or pdfBase64' });
  }

  const pdfBuffer = Buffer.from(pdfBase64, 'base64');
  const bucket    = 'invoices';
  const fileName  = `${orderNum}.pdf`;

  // ── 1. Upload PDF to Supabase Storage ─────────────────────────────────────
  try {
    const uploadResult = await new Promise((resolve, reject) => {
      const u = new URL(`${url}/storage/v1/object/${bucket}/${fileName}`);
      const opts = {
        hostname: u.hostname,
        path:     u.pathname,
        method:   'POST',
        headers: {
          'apikey':          key,
          'Authorization':   `Bearer ${key}`,
          'Content-Type':    'application/pdf',
          'Content-Length':  pdfBuffer.length,
          'x-upsert':        'true',   // overwrite if file already exists
        },
      };
      const r2 = https.request(opts, r => {
        let raw = '';
        r.on('data', c => raw += c);
        r.on('end', () => resolve({ status: r.statusCode, body: raw }));
      });
      r2.on('error', reject);
      r2.write(pdfBuffer);
      r2.end();
    });

    if (uploadResult.status >= 300) {
      console.error('Storage upload error:', uploadResult.status, uploadResult.body);
      return res.status(500).json({ ok: false, error: `Storage ${uploadResult.status}: ${uploadResult.body}` });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Upload error: ' + err.message });
  }

  // ── 2. Build public URL ────────────────────────────────────────────────────
  const invoiceUrl = `${url}/storage/v1/object/public/${bucket}/${fileName}`;

  // ── 3. Save URL to orders table ────────────────────────────────────────────
  try {
    const encodedNum = encodeURIComponent(orderNum);
    const body       = JSON.stringify({ invoice_url: invoiceUrl });
    const updateResult = await new Promise((resolve, reject) => {
      const u = new URL(`${url}/rest/v1/orders?order_num=eq.${encodedNum}`);
      const opts = {
        hostname: u.hostname,
        path:     u.pathname + u.search,
        method:   'PATCH',
        headers: {
          'apikey':          key,
          'Authorization':   `Bearer ${key}`,
          'Content-Type':    'application/json',
          'Content-Length':  Buffer.byteLength(body),
          'Prefer':          'return=minimal',
        },
      };
      const r3 = https.request(opts, r => {
        let raw = '';
        r.on('data', c => raw += c);
        r.on('end', () => resolve({ status: r.statusCode, body: raw }));
      });
      r3.on('error', reject);
      r3.write(body);
      r3.end();
    });

    if (updateResult.status >= 300) {
      // Upload succeeded; log but don't fail the response
      console.warn('Order update failed:', updateResult.status, updateResult.body);
    }
  } catch (err) {
    // Non-fatal — PDF is already uploaded
    console.warn('Order update error:', err.message);
  }

  return res.status(200).json({ ok: true, url: invoiceUrl });
};
