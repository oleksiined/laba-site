const https = require('https');
const { requireAdmin, applyCors } = require('./_auth');

const BUCKET = 'blog';
const EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const filename = body && typeof body.filename === 'string' ? body.filename : '';
  const ext = filename.split('.').pop().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(filename) || !EXT.has(ext)) {
    return res.status(400).json({ ok: false, error: 'Invalid filename' });
  }

  const host = new URL(url).hostname;
  try {
    const result = await new Promise((resolve, reject) => {
      const r = https.request(
        {
          hostname: host,
          path: `/storage/v1/object/upload/sign/${BUCKET}/${encodeURIComponent(filename)}`,
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Content-Length': 2,
            'x-upsert': 'true',
          },
        },
        resp => {
          let raw = '';
          resp.on('data', c => (raw += c));
          resp.on('end', () => resolve({ status: resp.statusCode, body: raw }));
        },
      );
      r.on('error', reject);
      r.write('{}');
      r.end();
    });
    if (result.status >= 300) return res.status(500).json({ ok: false, error: `Storage ${result.status}` });
    const signed = JSON.parse(result.body);
    const rel = signed.url || '';
    if (!rel) return res.status(500).json({ ok: false, error: 'No signed url' });
    return res.status(200).json({
      ok: true,
      uploadUrl: `${url.replace(/\/$/, '')}/storage/v1${rel.startsWith('/') ? rel : '/' + rel}`,
      publicUrl: `${url.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(filename)}`,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
