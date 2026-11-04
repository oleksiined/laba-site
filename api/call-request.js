// Vercel Serverless Function — POST /api/call-request
// Saves "Замовити дзвінок" form data to Supabase as an order

const https = require('https');

function httpsReq(hostname, path, key, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
      headers['Prefer'] = 'return=representation';
    }
    const req = https.request({ hostname, path, method: method || 'GET', headers }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, body: raw }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Генерує наступний порядковий номер CR260001, CR260002, ...
async function nextCallRequestNum(host, key) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const prefix = `CR${yy}`;
  try {
    const r = await httpsReq(
      host,
      `/rest/v1/orders?order_num=like.${encodeURIComponent(prefix + '%')}&select=order_num&order=order_num.desc&limit=1`,
      key
    );
    if (r.status < 300) {
      const rows = JSON.parse(r.body);
      if (rows && rows.length) {
        const last = rows[0].order_num; // e.g. "CR260007"
        const seq = parseInt(last.slice(prefix.length), 10);
        if (!isNaN(seq)) return `${prefix}${String(seq + 1).padStart(4, '0')}`;
      }
    }
  } catch (_) { /* fallback below */ }
  return `${prefix}0001`;
}

module.exports = async function handler(req, res) {
  const allowedOrigins = [
    'https://laba.zemlerob.com.ua',
    'http://localhost:3000',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { name, phone, comment, source } = body || {};
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  // Generate sequential order num: CR{yy}{0001, 0002, ...}
  const host = new URL(url).hostname;

  const orderNum = await nextCallRequestNum(host, key);
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(2);
  const date = `${dd}.${mm}.20${yy}`;

  const payload = {
    order_num:  orderNum,
    name:       name,
    phone:      phone,
    email:      null,
    company:    null,
    payer_type: 'private',
    items:      [],
    samples:    [],
    delivery:   null,
    payment:    null,
    promo:      null,
    discount:   0,
    total:      0,
    notes:      `📞 Запит дзвінка\nДжерело: ${source||'Сайт LABA'}${comment ? '\nКоментар: '+comment : ''}`,
  };

  try {
    const result = await httpsReq(host, '/rest/v1/orders', key, 'POST', payload);
    if (result.status >= 300) {
      console.error('Supabase error:', result.status, result.body);
      return res.status(500).json({ ok: false, error: `Supabase ${result.status}` });
    }
    return res.status(200).json({ ok: true, orderNum });
  } catch (err) {
    console.error('call-request error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
