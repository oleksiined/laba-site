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
    // Fetch orders, invoice documents, and catalog in parallel
    const [ordersResult, docsResult, svcResult, pkgResult] = await Promise.allSettled([
      httpsReq(host, '/rest/v1/orders?order=created_at.desc&limit=200', key),
      httpsReq(host, '/rest/v1/documents?document_type=eq.invoice&status=eq.published&select=order_id,storage_bucket,storage_path', key),
      httpsReq(host, '/rest/v1/catalog_services?select=service_id,service_code,name&status=eq.active', key),
      httpsReq(host, '/rest/v1/catalog_packages?select=package_id,package_code,name&status=eq.active', key),
    ]);

    if (ordersResult.status !== 'fulfilled' || ordersResult.value.status >= 300) {
      const err = ordersResult.status === 'rejected'
        ? ordersResult.reason.message
        : `Supabase ${ordersResult.value.status}: ${ordersResult.value.body}`;
      return res.status(500).json({ ok: false, error: err });
    }

    const orders = JSON.parse(ordersResult.value.body);

    // Build catalog map: service_code / package_code / id → name
    // Also build reverse map: name → service_code (for additionals lookup)
    const catalogMap = {};
    const nameToCode = {}; // name → service_code
    if (svcResult.status === 'fulfilled' && svcResult.value.status < 300) {
      try {
        JSON.parse(svcResult.value.body).forEach(s => {
          if (s.service_code) catalogMap[s.service_code] = s.name;
          if (s.service_id)   catalogMap[s.service_id]   = s.name;
          if (s.name && s.service_code) nameToCode[s.name] = s.service_code;
        });
      } catch (_) {}
    }
    if (pkgResult.status === 'fulfilled' && pkgResult.value.status < 300) {
      try {
        JSON.parse(pkgResult.value.body).forEach(p => {
          if (p.package_code) catalogMap[p.package_code] = p.name;
          if (p.package_id)   catalogMap[p.package_id]   = p.name;
        });
      } catch (_) {}
    }

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

    // Merge invoice_url into each order + enrich items/samples with names from catalog
    const enriched = orders.map(o => {
      const num = o.order_num || o.id;

      // Enrich items: add serviceName from catalog map
      let items = o.items;
      if (Array.isArray(items)) {
        items = items.map(it => ({
          ...it,
          serviceName: (it.name && catalogMap[it.name]) || it.serviceName || null,
        }));
      }

      // Enrich samples: add packageName from catalog map if missing
      // Also enrich additionals: convert string names to [{code, name}] objects
      let samples = o.samples;
      if (Array.isArray(samples)) {
        samples = samples.map(s => {
          const enriched = { ...s };
          if (!enriched.packageName && enriched.packageId && catalogMap[enriched.packageId]) {
            enriched.packageName = catalogMap[enriched.packageId];
          }
          // Enrich additionals with codes from catalog
          if (Array.isArray(enriched.additionals)) {
            enriched.additionalsDetails = enriched.additionals.map(name => ({
              name,
              code: nameToCode[name] || null,
            }));
          }
          return enriched;
        });
      }

      return { ...o, items, samples, invoice_url: invoiceMap[num] || null };
    });

    return res.status(200).json({ ok: true, orders: enriched });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
