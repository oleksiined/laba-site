// Vercel Serverless Function — POST /api/sample-transition   (admin only)
// Atomically moves samples of one order through receive / accept.
// The state machine and row locking live in the DB function
// public.apply_sample_transition; this handler validates input, calls it and
// writes the order event.
//
// Body: { id: <order uuid>, action: 'receive'|'accept', indices: [int],
//         lab?: string, ttn?: string, comment?: string }

const https = require('https');
const { requireAdmin, applyCors } = require('./_auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAB_RE = /^[a-z0-9_-]{1,24}$/i;

function httpsReq(host, path, key, method, body) {
  return new Promise((resolve, reject) => {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
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

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase not configured' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }
  body = body || {};

  const { id, action } = body;
  const indices = Array.isArray(body.indices) ? body.indices : null;
  if (!UUID_RE.test(String(id || ''))) return res.status(400).json({ ok: false, error: 'Invalid order id' });
  if (action !== 'receive' && action !== 'accept') return res.status(400).json({ ok: false, error: 'Invalid action' });
  if (!indices || !indices.length || indices.length > 500 || !indices.every(n => Number.isInteger(n) && n >= 0 && n < 10000)) {
    return res.status(400).json({ ok: false, error: 'Invalid indices' });
  }
  // Only one lab exists for now: default to SAT LAB when accepting without an explicit choice
  const lab = body.lab ? String(body.lab) : (action === 'accept' ? 'sat' : '');
  if (lab && !LAB_RE.test(lab)) return res.status(400).json({ ok: false, error: 'Invalid lab' });
  const ttn = body.ttn ? String(body.ttn).slice(0, 200) : '';
  const comment = body.comment ? String(body.comment).slice(0, 1000) : '';

  const host = new URL(url).hostname;
  try {
    const rpc = await httpsReq(
      host,
      '/rest/v1/rpc/apply_sample_transition_v2',
      key,
      'POST',
      JSON.stringify({ p_order_id: id, p_action: action, p_indices: indices, p_lab: lab || null, p_ttn: ttn || null }),
    );
    if (rpc.status >= 300) {
      return res.status(500).json({ ok: false, error: `Supabase ${rpc.status}: ${rpc.body}` });
    }
    const out = JSON.parse(rpc.body);
    if (!out || !out.ok) {
      return res.status(409).json({ ok: false, error: (out && out.error) || 'Transition failed' });
    }

    const names = out.names || [];
    const statusChanged = out.new_status !== out.old_status;
    let event;
    if (action === 'receive') {
      event = {
        event_type: 'sample_received',
        description: `Отримано зразки: ${names.join(', ')}`,
        new_values: { received: names, ...(statusChanged ? { status: out.new_status } : {}) },
      };
    } else {
      event = {
        event_type: 'sample_accepted',
        description:
          `Прийнято зразки: ${names.join(', ')}` +
          (ttn ? ` (ТТН: ${ttn})` : '') +
          (comment ? `. ${comment}` : '') +
          (statusChanged ? ' → статус замовлення: У роботі' : ''),
        new_values: {
          accepted: names,
          lab,
          ttn: ttn || undefined,
          comment: comment || undefined,
          ...(statusChanged ? { order_status: out.new_status } : {}),
        },
      };
    }
    try {
      await httpsReq(
        host,
        '/rest/v1/order_events',
        key,
        'POST',
        JSON.stringify({
          order_num: out.order_num,
          entity_type: 'sample',
          entity_id: out.order_num,
          event_type: event.event_type,
          actor_type: 'employee',
          description: event.description,
          old_values: null,
          new_values: event.new_values,
        }),
      );
    } catch (e) {
      console.warn('sample-transition event log failed (non-fatal):', e.message);
    }

    return res.status(200).json({ ok: true, applied: out.applied, status: out.new_status });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
