// Vercel Serverless Function — POST /api/send-confirmation-email
// Sends a branded order-confirmation email to the client via Resend API.
//
// Required env vars:
//   RESEND_API_KEY  — API key from resend.com
//   FROM_EMAIL      — sender address, e.g. laba@zemlerob.com.ua
//   SITE_URL        — base URL, e.g. https://laba.zemlerob.com.ua
//
// Optional env vars:
//   SUPPORT_PHONE_TEL     — tel: href value, e.g. +380671819967
//   SUPPORT_PHONE_DISPLAY — displayed phone, e.g. +380 67 181 99 67
//   SUPPORT_HOURS         — e.g. Пн–Пт 9:00–18:00
//   SAMPLING_GUIDE_URL    — link to sampling instructions page

'use strict';
const fs   = require('fs');
const path = require('path');

// ─── Static assets (bundled with this function) ───────────────────────────────
const ASSETS_DIR    = path.join(__dirname, 'assets');
const TEMPLATE_PATH = path.join(ASSETS_DIR, 'email-confirmation.html');

let _templateHtml = null;
function getTemplate() {
  if (!_templateHtml) _templateHtml = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return _templateHtml;
}

// ─── Template substitution (Mustache-style {{var}}) ──────────────────────────
function renderTemplate(html, vars) {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : ''
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(val) {
  const n = Number(val) || 0;
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Build template variables from order object ───────────────────────────────
function buildVars(order) {
  const site = (process.env.SITE_URL || 'https://laba.zemlerob.com.ua').replace(/\/$/, '');

  const phoneTel     = process.env.SUPPORT_PHONE_TEL     || '+380671819967';
  const phoneDisplay = process.env.SUPPORT_PHONE_DISPLAY || '+380 67 181 99 67';
  const hours        = process.env.SUPPORT_HOURS         || 'Пн–Пт 9:00–18:00';

  const orderNum  = order.orderNum || '';
  const orderPage = `${site}/?order=${encodeURIComponent(orderNum)}`;

  // ── Date ──────────────────────────────────────────────────────────────────
  const invoiceDate = new Date().toLocaleDateString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  // ── Payment status ────────────────────────────────────────────────────────
  const isPaid = order.payment === 'paid' || order.payment === 'оплачено';
  const paymentStatusText  = isPaid ? 'Оплачено' : 'Очікує оплати';
  const paymentStatusColor = isPaid ? '#36733F'  : '#916000';
  const totalLabel         = isPaid ? 'Разом оплачено' : 'Разом до сплати';

  // ── Total ─────────────────────────────────────────────────────────────────
  const totalAmount = fmtMoney(order.total) + ' грн';

  // ── Delivery block HTML ───────────────────────────────────────────────────
  const del = order.delivery || {};
  const deliveryTypeLabel =
    del.type === 'nova_poshta' ? 'Нова Пошта'  :
    del.type === 'ukr_poshta'  ? 'Укрпошта'    :
    del.type === 'pickup'      ? 'Самовивіз'    :
    del.type                   ? esc(del.type)  : 'Доставка';

  let deliveryBlockHtml;
  if (del.type === 'pickup') {
    deliveryBlockHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="border-left:3px solid #B6FF00;padding-left:12px;">
  <tr><td style="font-size:12px;line-height:19px;color:#737A80;padding-bottom:1px;">Отримання</td></tr>
  <tr><td style="font-size:13px;line-height:20px;font-weight:700;">Самовивіз</td></tr>
  ${del.address ? `<tr><td style="font-size:12px;line-height:18px;color:#60686F;">${esc(del.address)}</td></tr>` : ''}
</table>`.trim();
  } else {
    const city    = del.city    || del.cityName    || '';
    const branch  = del.branch  || del.warehouseAddress || del.branchNumber || '';
    const recip   = del.recipient
      ? (del.recipient.name || '') + (del.recipient.phone ? ' · ' + del.recipient.phone : '')
      : '';
    const addressLine = city && branch ? `${esc(city)}, ${esc(branch)}`
      : city || branch ? esc(city || branch)
      : 'Уточніть адресу у менеджера';
    const lines = [addressLine, esc(recip)].filter(Boolean);
    deliveryBlockHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="border-left:3px solid #B6FF00;padding-left:12px;">
  <tr><td style="font-size:12px;line-height:19px;color:#737A80;padding-bottom:1px;">Доставка</td></tr>
  <tr><td style="font-size:13px;line-height:20px;font-weight:700;">${deliveryTypeLabel}</td></tr>
  ${lines.map(l => `<tr><td style="font-size:12px;line-height:18px;color:#60686F;">${l}</td></tr>`).join('\n  ')}
</table>`.trim();
  }

  // ── Items table rows HTML ─────────────────────────────────────────────────
  const items = Array.isArray(order.items) ? order.items : [];

  const MATERIAL_MAP = { soil:'Ґрунт', water:'Вода', fertilizer:'Добриво', seeds:'Насіння', grain:'Зерно', plants:'Рослини', plant:'Рослини', fertilizers:'Добриво' };

  // INDIVIDUAL_CODES — virtual package codes that should be expanded into
  // sub-services using order.samples[].additionals
  const INDIVIDUAL_CODES = new Set(['soil_individual', 'soil_individual_no_prep']);

  // Build expanded rows: for individual packages, replace the single item row
  // with separate rows for each unique additional indicator from samples.
  function expandItem(item) {
    const code = item.code || item.packageId || '';
    if (!INDIVIDUAL_CODES.has(code)) return [item];

    const samples = Array.isArray(order.samples) ? order.samples : [];
    const relatedSamples = samples.filter(s => s.packageId === code);

    // Count occurrences of each additional indicator
    const addCounts = {};
    relatedSamples.forEach(s => {
      (s.additionals || []).forEach(addName => {
        addCounts[addName] = (addCounts[addName] || 0) + 1;
      });
    });

    const additionalNames = Object.keys(addCounts);
    if (additionalNames.length === 0) return [item]; // nothing to expand, keep as-is

    const expanded = [];

    // First row: Пробопідготовка (the base prep service included in soil_individual)
    // soil_individual has price 150 which IS the Пробопідготовка price per sample
    if (code === 'soil_individual') {
      const prepQty   = relatedSamples.length || Number(item.qty) || 1;
      const prepPrice = Number(item.price) || 0;
      const prepSum   = prepPrice * prepQty;
      expanded.push({ _name: 'Пробопідготовка', _qty: prepQty, _price: prepPrice, _sum: prepSum, _sub: false });
    }

    // Subsequent rows: each unique additional indicator
    additionalNames.forEach(addName => {
      const qty = addCounts[addName];
      // Price is unknown here (not stored per-additional in items), show 0 / empty
      expanded.push({ _name: addName, _qty: qty, _price: null, _sum: null, _sub: true });
    });

    return expanded;
  }

  // Count total display rows for the counter
  const expandedRows = items.flatMap(expandItem);
  const itemsCount = expandedRows.length;

  function renderRow(row) {
    if (row._name !== undefined) {
      // Expanded synthetic row
      const name  = esc(row._name);
      const qty   = row._qty;
      const price = row._price !== null ? fmtMoney(row._price) : '—';
      const sum   = row._sum   !== null ? fmtMoney(row._sum)   : '—';
      const nameStyle = row._sub
        ? 'padding:7px 3px 7px 14px;border-bottom:1px solid #F0F2F3;font-size:12px;line-height:18px;color:#60686F;'
        : 'padding:7px 3px;border-bottom:1px solid #F0F2F3;font-size:13px;line-height:18px;';
      return `<tr>
  <td style="${nameStyle}">${row._sub ? '↳&nbsp;' : ''}${name}</td>
  <td align="center" style="padding:7px 3px;border-bottom:1px solid #F0F2F3;font-size:13px;">${qty}</td>
  <td align="right" style="padding:7px 3px;border-bottom:1px solid #F0F2F3;font-size:13px;white-space:nowrap;">${price}</td>
  <td align="right" style="padding:7px 3px;border-bottom:1px solid #F0F2F3;font-size:13px;font-weight:700;white-space:nowrap;">${sum}</td>
</tr>`;
    }
    // Regular item row
    const name    = esc(row.name || row.code || 'Дослідження');
    const matKey  = (row.material_id || row.material || '').toLowerCase();
    const matName = MATERIAL_MAP[matKey] || row.material || '';
    const qty     = Number(row.qty) || 1;
    const price   = Number(row.price) || 0;
    const sum     = price * qty;
    return `<tr>
  <td style="padding:7px 3px;border-bottom:1px solid #F0F2F3;font-size:13px;line-height:18px;">${name}${matName ? `<br><span style="color:#737A80;font-size:11px;">${esc(matName)}</span>` : ''}</td>
  <td align="center" style="padding:7px 3px;border-bottom:1px solid #F0F2F3;font-size:13px;">${qty}</td>
  <td align="right" style="padding:7px 3px;border-bottom:1px solid #F0F2F3;font-size:13px;white-space:nowrap;">${fmtMoney(price)}</td>
  <td align="right" style="padding:7px 3px;border-bottom:1px solid #F0F2F3;font-size:13px;font-weight:700;white-space:nowrap;">${fmtMoney(sum)}</td>
</tr>`;
  }

  const itemsTableHtml = expandedRows.map(renderRow).join('\n');

  // ── Next steps ────────────────────────────────────────────────────────────
  const samplingGuideUrl = `${site}/#sampling/soil`;
  const nextStepsHtml = `<p style="margin:0 0 8px;">Відбирайте зразки згідно з <a href="${samplingGuideUrl}" style="color:#202326;font-weight:700;">інструкцією з відбору</a> та надсилайте на нашу адресу Новою Поштою.</p><p style="margin:0;">Результати аналізів будуть готові протягом 5–7 робочих днів після отримання зразків лабораторією.</p>`;

  // ── Plain-text summary (kept for plain-text email part) ───────────────────
  const serviceName = items.map(i => i.name).filter(Boolean).join(', ') || 'Лабораторний аналіз';

  return {
    order_number:          orderNum,
    invoice_date:          invoiceDate,
    payment_status_text:   paymentStatusText,
    payment_status_color:  paymentStatusColor,
    total_label:           totalLabel,
    total_amount:          totalAmount,
    delivery_block_html:   deliveryBlockHtml,
    items_count:           itemsCount,
    items_table_html:      itemsTableHtml,
    next_steps_html:       nextStepsHtml,
    tracking_url:          orderPage,
    support_phone_tel:     phoneTel,
    support_phone_display: phoneDisplay,
    support_hours:         hours,
    // kept for plain-text fallback
    service_name:          serviceName,
    sampling_guide_url:    samplingGuideUrl,
  };
}

// ─── Plain-text fallback ──────────────────────────────────────────────────────
function buildPlainText(order, vars) {
  const firstName = (order.client?.name || '').split(' ')[0] || 'Вам';
  return [
    `LABA — Замовлення ${vars.order_number} оформлено`,
    '',
    `Дякуємо, ${firstName}!`,
    `Ваше замовлення № ${vars.order_number} від ${vars.invoice_date} успішно оформлено.`,
    '',
    `Послуга: ${vars.service_name}`,
    `Зразків: ${vars.samples_count}`,
    `Сума: ${vars.total_amount}`,
    '',
    `Доставка: ${vars.delivery_method}${vars.delivery_details ? ' — ' + vars.delivery_details : ''}`,
    '',
    `Деталі замовлення: ${vars.tracking_url}`,
    `Інструкція з відбору: ${vars.sampling_guide_url}`,
    '',
    `Підтримка: ${vars.support_phone_display} (${vars.support_hours})`,
    '',
    '— Команда LABA',
  ].join('\n');
}

// ─── Main send function ───────────────────────────────────────────────────────
async function sendConfirmationEmail(order) {
  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'laba@zemlerob.com.ua';
  const toEmail   = order.client?.email;

  if (!apiKey)   throw new Error('RESEND_API_KEY not configured');
  if (!toEmail)  throw new Error('No client email in order');

  const vars    = buildVars(order);
  const html    = renderTemplate(getTemplate(), vars);
  const text    = buildPlainText(order, vars);
  const subject = `LABA: замовлення № ${vars.order_number} оформлено`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    `LABA Агро <${fromEmail}>`,
      to:      [toEmail],
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Resend API error ${response.status}: ${err}`);
  }

  return await response.json();
}

// ─── Vercel HTTP handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const allowedOrigins = [
    'https://laba.zemlerob.com.ua',
    'https://admin.laba.zemlerob.com.ua',
    'http://localhost:3000',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let order;
  try { order = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok: false, error: 'Invalid JSON' }); }

  try {
    await sendConfirmationEmail(order);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[send-confirmation-email] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// Export for use in order.js
module.exports.sendConfirmationEmail = sendConfirmationEmail;
