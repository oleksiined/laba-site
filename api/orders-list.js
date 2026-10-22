// Vercel Serverless Function — GET /api/orders-list
// Returns orders from Supabase for the admin panel.
// Also fetches invoice documents and merges invoice_url into each order.

const https = require('https');

function httpsGet(hostname, path, key) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname,
      path,
      method: 'GET',
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
      httpsGet(host, '/rest/v1/orders?order=created_at.desc&limit=200', key),
      httpsGet(host, '/rest/v1/documents?document_type=eq.invoice&status=eq.ready&select=order_id,storage_bucket,storage_path', key),
    ]);

    if (ordersResult.status !== 'fulfilled' || ordersResult.value.status >= 300) {
      const err = ordersResult.status === 'rejected'
        ? ordersResult.reason.message
        : `Supabase ${ordersResult.value.status}: ${ordersResult.value.body}`;
      return res.status(500).json({ ok: false, error: err });
    }

    const orders = JSON.parse(ordersResult.value.body);

    // Build a map: order_id → public URL
    const invoiceMap = {};
    if (docsResult.status === 'fulfilled' && docsResult.value.status < 300) {
      try {
        const docs = JSON.parse(docsResult.value.body);
        docs.forEach(d => {
          if (d.order_id && d.storage_bucket && d.storage_path) {
            invoiceMap[d.order_id] = `${url}/storage/v1/object/public/${d.storage_bucket}/${d.storage_path}`;
          }
        });
      } catch (_) { /* non-fatal */ }
    }

    // Merge invoice_url into each order
    const enriched = orders.map(o => {
      const num = o.order_num || o.id;
      return { ...o, invoice_url: invoiceMap[num] || o.invoice_url || null };
    });

    return res.status(200).json({ ok: true, orders: enriched });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
