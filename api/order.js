// Vercel Serverless Function — POST /api/order
// Receives order from laba.zemlerob.com.ua
// 1. Sends Telegram message to LABA team
// 2. Sends confirmation email to client

const https = require('https');
const nodemailer = require('nodemailer');

// ─── helpers ────────────────────────────────────────────────────────────────

function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return reject(new Error('TELEGRAM_BOT_TOKEN not set'));
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function fmtPrice(n) {
  return Number(n || 0).toLocaleString('uk-UA') + ' грн';
}

function buildTelegramText(o) {
  const lines = [];
  lines.push(`🧪 *Нове замовлення ${o.orderNum}*`);
  lines.push(`📅 ${o.date}`);
  lines.push('');

  // Client
  lines.push('👤 *Клієнт*');
  lines.push(`Ім'я: ${o.client?.name || '—'}`);
  lines.push(`Телефон: ${o.client?.phone || '—'}`);
  lines.push(`Email: ${o.client?.email || '—'}`);
  if (o.client?.company) lines.push(`Компанія: ${o.client.company}`);
  lines.push('');

  // Items
  if (o.items?.length) {
    lines.push('🧬 *Замовлення*');
    o.items.forEach(item => {
      const qty = item.qty > 1 ? ` × ${item.qty}` : '';
      lines.push(`• ${item.name}${qty} — ${fmtPrice(item.subtotal)}`);
    });
    lines.push('');
  }

  // Promo
  if (o.discount > 0) {
    lines.push(`🏷 Знижка (${o.promo || ''}): −${fmtPrice(o.discount)}`);
  }

  // Total
  lines.push(`💰 *До сплати: ${fmtPrice(o.total)}*`);
  lines.push('');

  // Delivery
  if (o.delivery?.type) {
    const deliveryLabels = { courier: 'Кур\'єр', pickup: 'Самовивіз', nova_poshta: 'Нова Пошта' };
    lines.push(`🚚 Доставка: ${deliveryLabels[o.delivery.type] || o.delivery.type}`);
    if (o.delivery.address) lines.push(`Адреса: ${o.delivery.address}`);
    if (o.delivery.city)    lines.push(`Місто: ${o.delivery.city}`);
  }

  // Payment
  if (o.payment) {
    const payLabels = { invoice: 'Рахунок (безготівково)', cash: 'Готівка' };
    lines.push(`💳 Оплата: ${payLabels[o.payment] || o.payment}`);
  }

  // Samples
  if (o.samples?.length) {
    lines.push('');
    lines.push(`🔬 Зразків: ${o.samples.length}`);
    const shown = o.samples.slice(0, 5);
    shown.forEach(s => {
      const label = [s.crop, s.field, s.depth].filter(Boolean).join(', ');
      lines.push(`  ${s.label || ('Зразок ' + (s.index || ''))}${label ? ': ' + label : ''}`);
    });
    if (o.samples.length > 5) lines.push(`  … та ще ${o.samples.length - 5}`);
  }

  // Notes
  if (o.notes) {
    lines.push('');
    lines.push(`📝 Примітки: ${o.notes}`);
  }

  return lines.join('\n');
}

function buildClientEmailHtml(o) {
  const itemsHtml = (o.items || []).map(item => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#333">${item.name}${item.qty > 1 ? ` × ${item.qty}` : ''}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:right;white-space:nowrap">${fmtPrice(item.subtotal)}</td>
    </tr>
  `).join('');

  const discountRow = o.discount > 0 ? `
    <tr>
      <td style="padding:8px 0;font-size:14px;color:#666">Знижка${o.promo ? ' (' + o.promo + ')' : ''}</td>
      <td style="padding:8px 0;font-size:14px;color:#666;text-align:right">−${fmtPrice(o.discount)}</td>
    </tr>
  ` : '';

  return `<!DOCTYPE html>
<html lang="uk">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 16px">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:580px">

  <!-- Header -->
  <tr>
    <td style="background:#CCFF00;padding:28px 32px;text-align:center">
      <div style="font-size:24px;font-weight:800;color:#111;letter-spacing:-0.5px">LABA</div>
      <div style="font-size:13px;color:#333;margin-top:4px">Агрохімічна лабораторія</div>
    </td>
  </tr>

  <!-- Body -->
  <tr><td style="padding:32px 32px 0">

    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">
      Ваше замовлення прийнято ✅
    </h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555">
      Дякуємо, ${o.client?.name?.split(' ')[0] || 'вам'}! Ми отримали ваше замовлення
      <strong style="color:#111">${o.orderNum}</strong> від ${o.date}.
      Наш менеджер зв'яжеться з вами найближчим часом.
    </p>

    <!-- Order table -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee">
      ${itemsHtml}
      ${discountRow}
      <tr>
        <td style="padding:16px 0 0;font-size:16px;font-weight:700;color:#111">До сплати</td>
        <td style="padding:16px 0 0;font-size:16px;font-weight:700;color:#111;text-align:right">${fmtPrice(o.total)}</td>
      </tr>
    </table>

    <!-- Invoice hint -->
    <div style="margin:24px 0;padding:16px;background:#f8f9fa;border-radius:8px;font-size:13px;color:#666">
      📄 Рахунок-фактура надіслано окремим листом або доступний для завантаження в особистому кабінеті.
    </div>

    <!-- Contact -->
    <p style="font-size:14px;color:#555;margin:0 0 8px">
      Маєте питання? Зв'яжіться з нами:
    </p>
    <p style="font-size:14px;color:#333;margin:0 0 32px">
      📞 <a href="tel:+380670000000" style="color:#111;font-weight:600">+380 67 000 00 00</a><br>
      🌐 <a href="https://laba.zemlerob.com.ua" style="color:#111">laba.zemlerob.com.ua</a>
    </p>

  </td></tr>

  <!-- Footer -->
  <tr>
    <td style="padding:20px 32px;background:#f8f9fa;border-top:1px solid #eee;text-align:center">
      <p style="margin:0;font-size:12px;color:#999">
        ТОВ «ЗЕМЛЕРОБ ХАБ» · ЄДРПОУ 45801119<br>
        вул. Б. Вишневецького, 36/1, м. Черкаси, 18000
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Supabase helper ─────────────────────────────────────────────────────────

async function saveOrderToSupabase(order) {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY not set');

  const payload = JSON.stringify({
    order_num:   order.orderNum,
    name:        order.client?.name  || null,
    phone:       order.client?.phone || null,
    email:       order.client?.email || null,
    company:     order.client?.company || null,
    items:       order.items   || [],
    samples:     order.samples || [],
    delivery:    order.delivery || null,
    payment:     order.payment  || null,
    promo:       order.promo    || null,
    discount:    order.discount || 0,
    total:       order.total    || 0,
    notes:       order.notes    || null,
  });

  const res = await new Promise((resolve, reject) => {
    const u = new URL(`${url}/rest/v1/orders`);
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=minimal',
      },
    };
    const req = https.request(opts, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  if (res.status >= 300) throw new Error(`Supabase ${res.status}: ${res.body}`);
  return true;
}

// ─── main handler ────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS — allow requests from the LABA site
  const allowedOrigins = [
    'https://laba.zemlerob.com.ua',
    'http://localhost:3000',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let order;
  try {
    order = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (!order?.orderNum) {
    return res.status(400).json({ error: 'Missing orderNum' });
  }

  const errors = [];

  // 1. Telegram
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID not set');
    const text = buildTelegramText(order);
    await tgRequest('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('Telegram error:', err.message);
    errors.push({ channel: 'telegram', message: err.message });
  }

  // 2. Email to client
  const clientEmail = order.client?.email;
  if (clientEmail) {
    try {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: `"LABA Agro" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to:   clientEmail,
        subject: `Замовлення ${order.orderNum} прийнято — LABA`,
        html:    buildClientEmailHtml(order),
      });
    } catch (err) {
      console.error('Email error:', err.message);
      errors.push({ channel: 'email', message: err.message });
    }
  }

  // 3. Optional: email to LABA team
  const teamEmail = process.env.TEAM_EMAIL;
  if (teamEmail) {
    try {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const textBody = buildTelegramText(order).replace(/[*_`]/g, '');
      await transporter.sendMail({
        from:    `"LABA Site" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to:      teamEmail,
        subject: `Нове замовлення ${order.orderNum} — LABA`,
        text:    textBody,
      });
    } catch (err) {
      console.error('Team email error:', err.message);
      errors.push({ channel: 'team_email', message: err.message });
    }
  }

  // 4. Save to Supabase
  try {
    await saveOrderToSupabase(order);
  } catch (err) {
    console.error('Supabase error:', err.message);
    errors.push({ channel: 'supabase', message: err.message });
  }

  // Return result
  if (errors.length === 0) {
    return res.status(200).json({ ok: true, orderNum: order.orderNum });
  }

  // Partial success is still OK from the client's perspective
  // (order is logged server-side; channels that failed are noted)
  const allFailed = errors.length >= 2 || (errors.length === 1 && !clientEmail && !teamEmail);
  const status = allFailed ? 500 : 200;
  return res.status(status).json({ ok: !allFailed, orderNum: order.orderNum, errors });
};
