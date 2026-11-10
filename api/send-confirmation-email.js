// Vercel Serverless Function — POST /api/send-confirmation-email
// Sends a branded order-confirmation email to the client via SendPulse SMTP.
//
// Required env vars:
//   SENDPULSE_SMTP_HOST   — usually smtp.sendpulse.com
//   SENDPULSE_SMTP_USER   — SendPulse SMTP username (from SMTP panel)
//   SENDPULSE_SMTP_PASS   — SendPulse SMTP password
//   FROM_EMAIL            — sender address, e.g. order@laba.zemlerob.com.ua
//   SITE_URL              — base URL, e.g. https://laba.zemlerob.com.ua
//
// Optional env vars:
//   SUPPORT_PHONE_TEL     — tel: href value, e.g. +380671819967
//   SUPPORT_PHONE_DISPLAY — displayed phone, e.g. +380 67 181 99 67
//   SUPPORT_HOURS         — e.g. Пн–Пт 9:00–18:00
//   SAMPLING_GUIDE_URL    — link to sampling instructions page

'use strict';
const fs           = require('fs');
const path         = require('path');
const nodemailer   = require('nodemailer');

// ─── Static assets (bundled with this function) ───────────────────────────────
const ASSETS_DIR  = path.join(__dirname, 'assets');
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

// ─── Build template variables from order object ───────────────────────────────
function buildVars(order) {
  const site = (process.env.SITE_URL || 'https://laba.zemlerob.com.ua').replace(/\/$/, '');

  // Service name: join all ordered item names
  const serviceName = (order.items || []).map(i => i.name).filter(Boolean).join(', ')
    || 'Лабораторний аналіз';

  // Count samples (sum of samples array or items quantities)
  const samplesCount = Array.isArray(order.samples) && order.samples.length > 0
    ? order.samples.length
    : (order.items || []).reduce((s, i) => s + (Number(i.samples) || Number(i.qty) || 1), 0);

  // Count packages (number of items lines)
  const packagesCount = (order.items || []).length || 1;

  // Formatted total
  const totalAmount = Number(order.total || 0).toLocaleString('uk-UA') + ' грн';

  // Invoice date (today, Ukraine locale)
  const invoiceDate = new Date().toLocaleDateString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  // Delivery
  const del = order.delivery || {};
  const deliveryMethod = del.type === 'nova_poshta' ? 'Нова Пошта'
    : del.type === 'ukr_poshta'  ? 'Укрпошта'
    : del.type === 'pickup'      ? 'Самовивіз'
    : del.type || 'Доставка';

  const deliveryDetails = del.address || del.branch || del.warehouseAddress
    || [del.city, del.street].filter(Boolean).join(', ')
    || '';

  // Support contacts
  const phoneTel     = process.env.SUPPORT_PHONE_TEL     || '+380671819967';
  const phoneDisplay = process.env.SUPPORT_PHONE_DISPLAY || '+380 67 181 99 67';
  const hours        = process.env.SUPPORT_HOURS         || 'Пн–Пт 9:00–18:00';

  // Links
  const orderPage         = `${site}/#order=${encodeURIComponent(order.orderNum || '')}`;
  const samplingGuideUrl  = process.env.SAMPLING_GUIDE_URL || `${site}/#guide`;

  return {
    order_number:         order.orderNum  || '',
    service_name:         serviceName,
    samples_count:        samplesCount,
    packages_count:       packagesCount,
    total_amount:         totalAmount,
    invoice_date:         invoiceDate,
    invoice_url:          orderPage,
    labels_url:           orderPage,
    sampling_guide_url:   samplingGuideUrl,
    tracking_url:         orderPage,
    delivery_method:      deliveryMethod,
    delivery_details:     deliveryDetails,
    support_phone_tel:    phoneTel,
    support_phone_display: phoneDisplay,
    support_hours:        hours,
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

// ─── Main send function (exported for use in order.js) ───────────────────────
async function sendConfirmationEmail(order) {
  const smtpHost = process.env.SENDPULSE_SMTP_HOST;
  const smtpUser = process.env.SENDPULSE_SMTP_USER;
  const smtpPass = process.env.SENDPULSE_SMTP_PASS;
  const fromEmail = process.env.FROM_EMAIL || smtpUser;
  const toEmail   = order.client?.email;

  if (!smtpHost || !smtpUser || !smtpPass) throw new Error('SendPulse SMTP not configured');
  if (!toEmail)                             throw new Error('No client email in order');

  const vars    = buildVars(order);
  const html    = renderTemplate(getTemplate(), vars);
  const text    = buildPlainText(order, vars);
  const subject = `LABA: замовлення № ${vars.order_number} оформлено`;

  const transporter = nodemailer.createTransport({
    host:   smtpHost,
    port:   465,
    secure: true,
    auth:   { user: smtpUser, pass: smtpPass },
  });

  await transporter.sendMail({
    from:    `"LABA Агро" <${fromEmail}>`,
    to:      toEmail,
    subject,
    text,
    html,
    attachments: [
      {
        filename:    'laba-logo.png',
        path:        path.join(ASSETS_DIR, 'laba-logo.png'),
        cid:         'laba-logo',
        contentType: 'image/png',
      },
      {
        filename:    'laba-mascot.png',
        path:        path.join(ASSETS_DIR, 'laba-mascot.png'),
        cid:         'laba-mascot',
        contentType: 'image/png',
      },
    ],
  });
}

// ─── Vercel HTTP handler (optional — can be called directly too) ──────────────
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
