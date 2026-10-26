// Vercel Serverless Function — PATCH /api/order-update
// Updates order fields in Supabase, then logs an event to order_events.
//
// Body: { id, ...fields, _event?: { event_type, description, old_values, new_values, entity_type, entity_id, actor_type } }
// _event is optional — if absent, no event is logged.

const https = require('https');

function httpsReq(hostname, path, key, method = 'PATCH', body = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'apikey':        key,
      'Authorization': `Bearer ${key}`,
      'Accept':        'application/json',
      'Prefer':        'return=minimal',
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

async function logEvent(host, key, orderNum, event) {
  if (!event || !orderNum) return;
  const payload = JSON.stringify({
    order_num:   orderNum,
    entity_type: event.entity_type  || 'order',
    entity_id:   event.entity_id    || orderNum,
    event_type:  event.event_type,
    actor_type:  event.actor_type   || 'employee',
    description: event.description  || null,
    old_values:  event.old_values   || null,
    new_values:  event.new_values   || null,
  });
  try {
    await httpsReq(host, '/rest/v1/order_events', key, 'POST', payload);
  } catch (e) {
    console.warn('logEvent error (non-fatal):', e.message);
  }
}

module.exports = async function handler(req, res) {
  const allowedOrigins = [
    'https://admin.laba.zemlerob.com.ua',
    'http://localhost:3000',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { id, _event, ...fields } = body || {};
  if (!id) return res.status(400).json({ error: 'Missing order id' });

  // Only allow updating specific fields for safety
  const allowed = ['status', 'samples', 'payment', 'company', 'name', 'edrpou', 'phone', 'email', 'payer_type', 'notes'];
  const update = {};
  for (const k of allowed) {
    if (k in fields) update[k] = fields[k];
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: 'No fields to update' });

  const host = new URL(url).hostname;
  const payload = JSON.stringify(update);

  try {
    const result = await httpsReq(
      host,
      `/rest/v1/orders?id=eq.${encodeURIComponent(id)}`,
      key, 'PATCH', payload,
    );

    if (result.status >= 300) {
      return res.status(500).json({ ok: false, error: `Supabase ${result.status}: ${result.body}` });
    }

    // Log event server-side — non-fatal
    await logEvent(host, key, id, _event);

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
