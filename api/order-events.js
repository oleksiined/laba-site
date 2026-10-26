// Vercel Serverless Function — GET /api/order-events?order_id=<uuid>
// Returns audit log events for one order from order_events + event_types tables.

const https = require('https');

function httpsReq(hostname, path, key) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'GET',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
    }, r => {
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
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  const params = new URL(req.url || '/', 'http://x').searchParams;
  const order_num = req.query?.order_num || params.get('order_num');
  if (!order_num) return res.status(400).json({ ok: false, error: 'order_num required' });

  const host = new URL(url).hostname;

  try {
    const [eventsRes, typesRes] = await Promise.allSettled([
      httpsReq(host,
        `/rest/v1/order_events?order_num=eq.${encodeURIComponent(order_num)}&order=created_at.asc&limit=200`,
        key),
      httpsReq(host, '/rest/v1/event_types?select=event_type,label,icon,color', key),
    ]);

    if (eventsRes.status !== 'fulfilled' || eventsRes.value.status >= 300) {
      const err = eventsRes.status === 'rejected'
        ? eventsRes.reason.message
        : `Supabase ${eventsRes.value.status}: ${eventsRes.value.body}`;
      return res.status(500).json({ ok: false, error: err });
    }

    const events = JSON.parse(eventsRes.value.body);

    // Build event_type → {label, icon, color} map
    const typeMap = {};
    if (typesRes.status === 'fulfilled' && typesRes.value.status < 300) {
      try {
        JSON.parse(typesRes.value.body).forEach(t => {
          typeMap[t.event_type] = { label: t.label, icon: t.icon, color: t.color };
        });
      } catch (_) {}
    }

    // Enrich events with type metadata
    const enriched = events.map(e => ({
      ...e,
      type_label: (typeMap[e.event_type] || {}).label || e.event_type || '',
      type_icon:  (typeMap[e.event_type] || {}).icon  || null,
      type_color: (typeMap[e.event_type] || {}).color || null,
    }));

    return res.status(200).json({ ok: true, events: enriched });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
