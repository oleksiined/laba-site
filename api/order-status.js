// Vercel Serverless Function — GET /api/order-status?num=L260025
// Public endpoint: returns order status without sensitive client data.
// Searches by order_num only (case-insensitive).

const https = require('https');

function sbGet(supabaseUrl, key, path) {
  return new Promise((resolve, reject) => {
    const u = new URL(supabaseUrl);
    const req = https.request({
      hostname: u.hostname,
      path,
      method: 'GET',
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Accept':        'application/json',
      },
    }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.end();
  });
}

const STATUS_LABEL = {
  new:       'Замовлення прийнято',
  waiting:   'Очікуємо зразки',
  work:      'Дослідження тривають',
  done:      'Результати готові',
  closed:    'Завершено',
  cancelled: 'Скасовано',
};

const SAMPLE_STATUS_LABEL = {
  new:       'Очікується',
  received:  'Отримано',
  accepted:  'Прийнято',
  work:      'У роботі',
  done:      'Готовий',
  rejected:  'Відхилено',
  cancelled: 'Скасовано',
};

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const num = (req.query.num || '').trim().toUpperCase();
  if (!num) return res.status(400).json({ ok: false, error: 'Missing num parameter' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  const SELECT = 'order_num,status,created_at,samples,expected_at';
  let orderData = null;

  // Search by order_num (case-insensitive)
  try {
    const r = await sbGet(supabaseUrl, serviceKey,
      `/rest/v1/orders?select=${SELECT}&order_num=ilike.${encodeURIComponent(num)}&limit=1`
    );
    if (r.status === 200) {
      const rows = JSON.parse(r.body);
      if (rows.length > 0) orderData = rows[0];
    } else {
      console.error('Supabase error:', r.status, r.body);
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }

  if (!orderData) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  const samplesArr = Array.isArray(orderData.samples) ? orderData.samples : [];

  // Build public samples list — no sensitive data
  const samplesInfo = samplesArr.map((s, i) => ({
    idx:         i + 1,
    num:         s.num || `${orderData.order_num}-${String(i + 1).padStart(2, '0')}`,
    name:        s.label || s.name || `Зразок ${i + 1}`,
    material:    s.material || s.crop || '',
    status:      s.st || 'new',
    statusLabel: SAMPLE_STATUS_LABEL[s.st || 'new'] || (s.st || 'new'),
  }));

  return res.status(200).json({
    ok:            true,
    order_num:     orderData.order_num,
    status:        orderData.status || 'new',
    statusLabel:   STATUS_LABEL[orderData.status] || orderData.status,
    created_at:    orderData.created_at || null,
    expected_at:   orderData.expected_at || null,
    samples_count: samplesArr.length,
    samples:       samplesInfo,
  });
};
