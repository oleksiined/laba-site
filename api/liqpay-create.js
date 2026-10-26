// Vercel Serverless Function — POST /api/liqpay-create
// Builds a signed LiqPay payment request (server-side, private key never exposed)
// Returns { data, signature } for the client to POST to LiqPay checkout

const crypto = require('crypto');

const LIQPAY_PUBLIC_KEY  = process.env.LIQPAY_PUBLIC_KEY  || 'i53885016915';
const LIQPAY_PRIVATE_KEY = process.env.LIQPAY_PRIVATE_KEY || '';

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
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { orderNum, amount, description } = req.body || {};
  if (!orderNum || !amount) {
    return res.status(400).json({ ok: false, error: 'Missing orderNum or amount' });
  }
  if (!LIQPAY_PRIVATE_KEY) {
    return res.status(500).json({ ok: false, error: 'LiqPay not configured' });
  }

  const params = {
    version:     3,
    public_key:  LIQPAY_PUBLIC_KEY,
    action:      'pay',
    amount:      String(amount),
    currency:    'UAH',
    description: description || `Оплата замовлення ${orderNum}`,
    order_id:    orderNum,
    result_url:  `https://laba.zemlerob.com.ua/?paid=${orderNum}`,
    server_url:  'https://laba.zemlerob.com.ua/api/liqpay-callback',
    language:    'uk',
  };

  const data      = Buffer.from(JSON.stringify(params)).toString('base64');
  const signature = crypto
    .createHash('sha1')
    .update(LIQPAY_PRIVATE_KEY + data + LIQPAY_PRIVATE_KEY)
    .digest('base64');

  return res.status(200).json({ ok: true, data, signature });
};
