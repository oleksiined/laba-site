const https = require('https');
const { requireAdmin, applyCors } = require('./_auth');

const COLUMNS = 'position_id,version,lab_id,price,valid_from,valid_to,note,available,prep_included,days_min,days_max';

function sbReq(host, path, key, method, body) {
  return new Promise((resolve, reject) => {
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
      headers['Prefer'] = 'return=minimal';
    }
    const r = https.request({ hostname: host, path, method, headers }, resp => {
      let raw = '';
      resp.on('data', c => (raw += c));
      resp.on('end', () => resolve({ status: resp.statusCode, body: raw }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function clean(item) {
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const bool = v => (v === null || v === undefined || v === '' ? null : v === true || v === 'true');
  const row = {
    position_id: String(item.position_id || '').slice(0, 64),
    version: num(item.version),
    lab_id: String(item.lab_id || '').slice(0, 32),
    price: num(item.price),
    valid_from: String(item.valid_from || '').slice(0, 10),
    valid_to: item.valid_to ? String(item.valid_to).slice(0, 10) : null,
    note: String(item.note || '').slice(0, 500),
    available: bool(item.available),
    prep_included: bool(item.prep_included),
    days_min: num(item.days_min),
    days_max: num(item.days_max),
  };
  if (!row.position_id || !row.lab_id || !row.valid_from) return null;
  if (row.price === null || Number.isNaN(row.price) || row.price < 0) return null;
  return row;
}

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });
  const host = new URL(url).hostname;

  try {
    if (req.method === 'GET') {
      const r = await sbReq(
        host,
        `/rest/v1/lab_price_offers?select=${COLUMNS}&order=position_id,valid_from.desc&limit=5000`,
        key,
        'GET',
      );
      if (r.status >= 300) return res.status(500).json({ ok: false, error: `Supabase ${r.status}` });
      return res.status(200).json({ ok: true, offers: JSON.parse(r.body) });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const list = Array.isArray(body && body.offers) ? body.offers : body && body.offer ? [body.offer] : [];
      if (!list.length || list.length > 500) return res.status(400).json({ ok: false, error: 'Invalid payload' });
      const rows = list.map(clean);
      if (rows.some(r => !r)) return res.status(400).json({ ok: false, error: 'Invalid offer' });
      const r = await sbReq(host, '/rest/v1/lab_price_offers', key, 'POST', JSON.stringify(rows));
      if (r.status >= 300) return res.status(500).json({ ok: false, error: `Supabase ${r.status}: ${r.body}` });
      return res.status(200).json({ ok: true, saved: rows.length });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
