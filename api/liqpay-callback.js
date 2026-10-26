// Vercel Serverless Function — POST /api/liqpay-callback
// LiqPay calls this after payment (server_url in payment params)
// Verifies signature, updates order payment_status in Supabase

const crypto = require('crypto');
const https  = require('https');

const LIQPAY_PRIVATE_KEY = process.env.LIQPAY_PRIVATE_KEY || '';

function httpsReq(hostname, path, key, method, body) {
  return new Promise((resolve, reject) => {
    const headers = {
      'apikey':        key,
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
    };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
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

// Parse raw body from LiqPay (application/x-www-form-urlencoded)
function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try {
        // Try JSON first (in case Content-Type is application/json)
        resolve(JSON.parse(raw));
      } catch (_) {
        // Parse URL-encoded
        const params = {};
        new URLSearchParams(raw).forEach((v, k) => { params[k] = v; });
        resolve(params);
      }
    });
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(200).end();

  // Vercel may have already parsed body, or we parse it ourselves
  const body = (req.body && (req.body.data || req.body.signature))
    ? req.body
    : await parseBody(req);

  const { data, signature } = body || {};
  if (!data || !signature) return res.status(200).end();

  // Verify signature
  const expectedSig = crypto
    .createHash('sha1')
    .update(LIQPAY_PRIVATE_KEY + data + LIQPAY_PRIVATE_KEY)
    .digest('base64');

  if (expectedSig !== signature) {
    console.warn('[liqpay-callback] Invalid signature');
    return res.status(200).end(); // Always 200 to LiqPay
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch (e) {
    console.warn('[liqpay-callback] Cannot parse data:', e.message);
    return res.status(200).end();
  }

  const { order_id, status, amount, currency, payment_id, err_code, err_description } = parsed;
  console.log(`[liqpay-callback] order=${order_id} status=${status} amount=${amount} ${currency}`);

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supaUrl || !supaKey || !order_id) return res.status(200).end();

  const host = new URL(supaUrl).hostname;

  // Map LiqPay status to our payment_status
  // success / sandbox → paid
  // failure / error   → failed
  // wait_accept / processing → pending
  const paymentStatus = (status === 'success' || status === 'sandbox') ? 'paid'
                      : (status === 'failure' || status === 'error')   ? 'failed'
                      : 'pending';

  const updatePayload = JSON.stringify({
    payment_status:    paymentStatus,
    liqpay_payment_id: String(payment_id || ''),
    liqpay_status:     status,
  });

  // PATCH orders where order_num = order_id
  const updateRes = await httpsReq(
    host,
    `/rest/v1/orders?order_num=eq.${encodeURIComponent(order_id)}`,
    supaKey,
    'PATCH',
    updatePayload,
  ).catch(e => { console.warn('[liqpay-callback] Supabase update error:', e.message); return null; });

  if (updateRes) {
    console.log(`[liqpay-callback] Supabase update ${updateRes.status} for order ${order_id} → ${paymentStatus}`);
  }

  return res.status(200).end();
};
