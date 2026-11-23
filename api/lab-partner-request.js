// Vercel Serverless Function — POST /api/lab-partner-request
// Saves "Для лабораторій" partner inquiry to Supabase as an order

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

async function nextLabPartnerNum(host, key) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const prefix = `LP${yy}`;
  try {
    const r = await httpsReq(
      host,
      `/rest/v1/orders?order_num=like.${encodeURIComponent(prefix + '%')}&select=order_num&order=order_num.desc&limit=1`,
      key
    );
    if (r.status < 300) {
      const rows = JSON.parse(r.body);
      const validRows = rows.filter(row => {
        const num = row.order_num || '';
        return num.startsWith(prefix) && num.length === prefix.length + 4 && /^\d{4}$/.test(num.slice(prefix.length));
      });
      if (validRows.length) {
        const last = validRows[0].order_num;
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

  const { laboratory, contact_name, phone, email, materials, details } = body || {};
  if (!laboratory || !contact_name || !phone) {
    return res.status(400).json({ error: 'laboratory, contact_name and phone required' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  const host = new URL(url).hostname;
  const orderNum = await nextLabPartnerNum(host, key);

  const materialsStr = Array.isArray(materials) ? materials.join(', ') : (materials || '');
  const notes = [
    '🔬 Заявка від лабораторії',
    `Лабораторія: ${laboratory}`,
    `Контактна особа: ${contact_name}`,
    materialsStr ? `Матеріали: ${materialsStr}` : null,
    details ? `Деталі: ${details}` : null,
  ].filter(Boolean).join('\n');

  const payload = {
    order_num:  orderNum,
    name:       contact_name,
    phone:      phone,
    email:      email || null,
    company:    laboratory,
    payer_type: 'business',
    items:      [],
    samples:    [],
    delivery:   null,
    payment:    null,
    promo:      null,
    discount:   0,
    total:      0,
    notes,
  };

  try {
    const result = await httpsReq(host, '/rest/v1/orders', key, 'POST', payload);
    if (result.status >= 300) {
      console.error('Supabase error:', result.status, result.body);
      return res.status(500).json({ ok: false, error: `Supabase ${result.status}` });
    }
    return res.status(200).json({ ok: true, orderNum });
  } catch (err) {
    console.error('lab-partner-request error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
