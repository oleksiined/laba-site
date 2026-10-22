// Vercel Serverless Function — GET /api/orders-list
// Returns orders from Supabase for the admin panel.
// Also fetches invoice documents and merges invoice_url into each order.

const https = require('https');

function httpsReq(hostname, path, key, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'apikey':        key,
      'Authorization': `Bearer ${key}`,
      'Accept':        'application/json',
    };
    if (body) {
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request({ hostname, path, method, headers }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, body: raw }));
    });
    req.on('error', reject);
    if (body) req.write(body);
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

  try {
    // Fetch orders and invoice documents in parallel
    const [ordersResult, docsResult] = await Promise.allSettled([
      httpsReq(host, '/rest/v1/orders?order=created_at.desc&limit=200', key),
      httpsReq(host, '/rest/v1/documents?document_type=eq.invoice&status=eq.published&select=order_id,storage_bucket,storage_path', key),
    ]);

    if (ordersResult.status !== 'fulfilled' || ordersResult.value.status >= 300) {
      const err = ordersResult.status === 'rejected'
        ? ordersResult.reason.message
        : `Supabase ${ordersResult.value.status}: ${ordersResult.value.body}`;
      return res.status(500).json({ ok: false, error: err });
    }

    const orders = JSON.parse(ordersResult.value.body);

    // Build signed URLs for invoices (private buckets)
    const invoiceMap = {};
    if (docsResult.status === 'fulfilled' && docsResult.value.status < 300) {
      try {
        const docs = JSON.parse(docsResult.value.body);
        const validDocs = docs.filter(d => d.order_id && d.storage_bucket && d.storage_path);

        // Generate signed URLs individually (more reliable than batch)
        await Promise.allSettled(validDocs.map(async d => {
          try {
            const signBody = JSON.stringify({ expiresIn: 604800 });
            const signRes = await httpsReq(
              host,
              `/storage/v1/object/sign/${d.storage_bucket}/${d.storage_path}`,
              key,
              'POST',
              signBody,
            );
            if (signRes.status < 300) {
              const parsed = JSON.parse(signRes.body);
              const signedURL = parsed.signedURL || parsed.signedUrl || parsed.signed_url || '';
              console.log(`[orders-list] sign OK for ${d.storage_path}: ${signedURL.substring(0, 80)}`);
              if (signedURL) {
                const base = url.replace(/\/$/, '');
                if (signedURL.startsWith('http')) {
                  invoiceMap[d.order_id] = signedURL;
                } else if (signedURL.startsWith('/storage/v1')) {
                  invoiceMap[d.order_id] = `${base}${signedURL}`;
                } else {
                  // Supabase returns /object/sign/... without /storage/v1 prefix
                  const rel = signedURL.startsWith('/') ? signedURL : `/${signedURL}`;
                  invoiceMap[d.order_id] = `${base}/storage/v1${rel}`;
                }
              }
            } else {
              console.warn(`sign URL failed for ${d.storage_path}: ${signRes.status} ${signRes.body}`);
            }
          } catch (e) {
            console.warn(`sign URL error for ${d.storage_path}:`, e.message);
          }
        }));
      } catch (_) { /* non-fatal — orders still returned */ }
    }

    // Merge invoice_url into each order
    const enriched = orders.map(o => {
      const num = o.order_num || o.id;
      return { ...o, invoice_url: invoiceMap[num] || null };
    });

    return res.status(200).json({ ok: true, orders: enriched });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
