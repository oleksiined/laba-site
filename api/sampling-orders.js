const https = require('https');
const { requireAdmin, applyCors } = require('./_auth');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const orderNumber = body && typeof body.order_number === 'string' ? body.order_number : '';
  const status = body && typeof body.status === 'string' ? body.status : '';
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(orderNumber) || !/^[a-z_]{2,24}$/.test(status)) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const payload = JSON.stringify({ status });
  const host = new URL(url).hostname;
  try {
    const result = await new Promise((resolve, reject) => {
      const r = https.request(
        {
          hostname: host,
          path: `/rest/v1/sampling_orders?order_number=eq.${encodeURIComponent(orderNumber)}`,
          method: 'PATCH',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            Prefer: 'return=minimal',
          },
        },
        resp => {
          let raw = '';
          resp.on('data', c => (raw += c));
          resp.on('end', () => resolve({ status: resp.statusCode, body: raw }));
        },
      );
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
    if (result.status >= 300) return res.status(500).json({ ok: false, error: `Supabase ${result.status}` });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
