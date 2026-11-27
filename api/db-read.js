const https = require('https');
const { requireAdmin, applyCors } = require('./_auth');

const TABLES = new Set([
  'samples',
  'sample_results',
  'sampling_orders',
  'protocol_spec',
  'protocol_level_bands',
  'protocol_texture_cec',
  'protocol_cation_balance',
  'catalog_methods',
  'catalog_package_items',
]);

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  const rawQuery = (req.url || '').split('?')[1] || '';
  const parts = rawQuery.split('&');
  const tPart = parts.find(p => p.startsWith('t='));
  const table = tPart ? decodeURIComponent(tPart.slice(2)) : '';
  if (!TABLES.has(table)) return res.status(400).json({ ok: false, error: 'Table not allowed' });
  const qs = parts.filter(p => !p.startsWith('t=')).join('&');

  const host = new URL(url).hostname;
  const path = `/rest/v1/${table}${qs ? '?' + qs : ''}`;

  try {
    const result = await new Promise((resolve, reject) => {
      const r = https.request(
        { hostname: host, path, method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } },
        resp => {
          let raw = '';
          resp.on('data', c => (raw += c));
          resp.on('end', () => resolve({ status: resp.statusCode, body: raw }));
        },
      );
      r.on('error', reject);
      r.end();
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(result.status < 300 ? 200 : 502).send(result.body);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
