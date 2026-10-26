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

// ─── Invoice email ────────────────────────────────────────────────────────────

function buildInvoiceHtml(o) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = o.date || `${pad(now.getDate())}.${pad(now.getMonth()+1)}.${now.getFullYear()}`;

  // Invoice number: LABA-YYYY-XXXX (derived from orderNum)
  const invoiceNum = o.orderNum
    ? 'LABA-' + o.orderNum.replace(/^LAB-/,'')
    : `LABA-${now.getFullYear()}-0001`;

  // Valid until: +7 days
  const validDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const validStr = `${pad(validDate.getDate())}.${pad(validDate.getMonth()+1)}.${validDate.getFullYear()}`;

  // Client name
  const buyerName = o.client?.company || o.client?.name || '—';
  const buyerEdrpou = o.client?.edrpou ? `Код за ЄДРПОУ: ${o.client.edrpou}<br>` : '';
  const buyerAddr = o.client?.legalAddress || '';

  // Build services table rows from samples grouped by package
  const pkgMap = {};
  (o.samples || []).forEach(s => {
    const key = s.packageId || s.packageCode || s.packageName || 'Пакет';
    const name = s.packageName || s.packageCode || key;
    const mat  = s.material || '';
    const mapKey = `${name}|${mat}`;
    if (!pkgMap[mapKey]) pkgMap[mapKey] = { name, mat, qty: 0, price: 0 };
    pkgMap[mapKey].qty += 1;
    if (s.totalPrice || s.basePrice) pkgMap[mapKey].price = s.totalPrice || s.basePrice || 0;
  });

  // Fallback: use items array if samples has no package info
  const useItems = Object.keys(pkgMap).length === 0 || Object.keys(pkgMap).every(k => k.startsWith('|'));
  let rowsHtml = '';
  let rowIdx = 1;

  if (!useItems && Object.keys(pkgMap).length > 0) {
    rowsHtml = Object.entries(pkgMap).map(([, p]) => {
      const unitPrice = p.qty > 0 ? (p.price / p.qty) : 0;
      const total = p.price;
      return `<tr>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111;text-align:center">${rowIdx++}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#555">01-2-00${rowIdx-1}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111">${p.name}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#555">${p.mat}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111;text-align:center">${p.qty}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111;text-align:right;white-space:nowrap">${fmtPrice(unitPrice).replace(' грн','')}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#111;text-align:right;white-space:nowrap">${fmtPrice(total).replace(' грн','')}</td>
      </tr>`;
    }).join('');
  } else {
    rowsHtml = (o.items || []).map(item => {
      const unitP = item.qty > 0 ? (item.subtotal || item.price || 0) / item.qty : (item.price || 0);
      return `<tr>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111;text-align:center">${rowIdx++}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#555">01-2-00${rowIdx-1}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111" colspan="2">${item.name}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111;text-align:center">${item.qty || 1}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111;text-align:right;white-space:nowrap">${fmtPrice(unitP).replace(' грн','')}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#111;text-align:right;white-space:nowrap">${fmtPrice(item.subtotal || item.price || 0).replace(' грн','')}</td>
      </tr>`;
    }).join('');
  }

  const discountRow = (o.discount > 0) ? `
    <tr>
      <td colspan="6" style="padding:6px 10px;border:1px solid #e5e7eb;font-size:13px;color:#666;text-align:right">Знижка${o.promo ? ' (' + o.promo + ')' : ''}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:13px;color:#c00;text-align:right;white-space:nowrap">−${fmtPrice(o.discount).replace(' грн','')}</td>
    </tr>` : '';

  const paymentPurpose = `Оплата за лабораторні дослідження за рахунком ${invoiceNum}, замовлення ${o.orderNum}.`;

  return `<!DOCTYPE html>
<html lang="uk">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 16px">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:680px;border:1px solid #e5e7eb">

  <!-- Header -->
  <tr>
    <td style="padding:24px 32px;border-bottom:2px solid #CCFF00">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:middle">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 893 318" width="140" height="50" role="img" aria-label="LABA"><g fill="#202321"><path d="M20 20H64V176H155V220H20Z"/><g transform="translate(14 0)"><path fill-rule="evenodd" d="M158 220L238 20H302L382 220H329L313 177H227L211 220ZM244 133H296L270 63Z"/><path fill-rule="evenodd" d="M397 20H554C597 20 619 40 619 73C619 94 609 109 590 118C614 126 626 143 626 166C626 202 603 220 558 220H397ZM442 59V98H548C566 98 574 92 574 79C574 66 566 59 548 59ZM442 138V181H552C572 181 581 174 581 160C581 145 572 138 552 138Z"/><path fill-rule="evenodd" d="M635 220L715 20H779L859 220H806L790 177H704L688 220ZM721 133H773L747 63Z"/></g><path d="M43.351656311815674 264.82509124341794V268.8455966344413Q41.528403867049285 267.84047028668544 39.69346390661131 267.33790711280756Q37.85852394617335 266.8353439389296 35.98852143872064 266.8353439389296Q31.80439082829521 266.8353439389296 29.490262725322488 269.4884099963781Q27.17613462234976 272.14147605382664 27.17613462234976 276.9333574791742Q27.17613462234976 281.7252389045218 29.490262725322488 284.37830496197034Q31.80439082829521 287.0313710194188 35.98852143872064 287.0313710194188Q37.85852394617335 287.0313710194188 39.69346390661131 286.5288078455409Q41.528403867049285 286.026244671663 43.351656311815674 285.02111832390716V288.99487365224417Q41.55177889839244 289.8363747805979 39.623338812581835 290.25712534477475Q37.694898726771235 290.6778759089516 35.52102081185747 290.6778759089516Q29.60713788203828 290.6778759089516 26.124258211907616 286.96124592538933Q22.641378541776948 283.2446159418271 22.641378541776948 276.9333574791742Q22.641378541776948 270.5285988911487 26.159320758922355 266.8587189702728Q29.67726297606776 263.18883904939685 35.80152118797537 263.18883904939685Q37.78839885214387 263.18883904939685 39.68177639093974 263.5979020979021Q41.575153929735606 264.00696514640737 43.351656311815674 264.82509124341794ZM73.22494636837266 275.83473100604573V277.93848382693005H53.44966985206029Q53.730170228178196 282.37973978213023 56.12611094085197 284.70555540077453Q58.52205165352576 287.0313710194188 62.79968238932382 287.0313710194188Q65.27743571169866 287.0313710194188 67.60325133034297 286.42362020449673Q69.92906694898727 285.8158693895746 72.21982002061684 284.6003677597303V288.6676232134399Q69.9056919176441 289.6493745298526 67.4746886579556 290.1636252194021Q65.04368539826707 290.6778759089516 62.54255704454908 290.6778759089516Q56.27804864458251 290.6778759089516 52.61985623937815 287.0313710194188Q48.96166383417379 283.38486612988606 48.96166383417379 277.1671077926058Q48.96166383417379 270.7389741732371 52.43285598863288 266.963906611317Q55.90404814309197 263.18883904939685 61.79455604156799 263.18883904939685Q67.07731312512189 263.18883904939685 70.15112974674727 266.5899061098264Q73.22494636837266 269.99097317025604 73.22494636837266 275.83473100604573ZM68.92394060123144 274.57247931351515Q68.87719053854512 271.0428495806982 66.94875045273452 268.9390967598139Q65.02031036692391 266.8353439389296 61.841306104254315 266.8353439389296Q58.24155127740785 266.8353439389296 56.07936087816566 268.86897166578444Q53.91717047892347 270.9025993926392 53.589920040119246 274.5958543448583ZM84.4449614130889 286.0729947343493V299.9577633521857H80.12058061460452V263.8199648956621H84.4449614130889V267.7937202239991Q85.80071323099212 265.4562170896832 87.86940350486168 264.32252806954Q89.93809377873123 263.18883904939685 92.81322263393976 263.18883904939685Q97.58172902794416 263.18883904939685 100.56204552419692 266.97559412698854Q103.54236202044967 270.7623492045803 103.54236202044967 276.9333574791742Q103.54236202044967 283.10436575376815 100.56204552419692 286.8911208313599Q97.58172902794416 290.6778759089516 92.81322263393976 290.6778759089516Q89.93809377873123 290.6778759089516 87.86940350486168 289.5441868888084Q85.80071323099212 288.4104978686652 84.4449614130889 286.0729947343493ZM99.07773103390633 276.9333574791742Q99.07773103390633 272.18822611651296 97.12591591675258 269.4884099963781Q95.1741007995988 266.7885938762433 91.76134622349761 266.7885938762433Q88.34859164739642 266.7885938762433 86.39677653024266 269.4884099963781Q84.4449614130889 272.18822611651296 84.4449614130889 276.9333574791742Q84.4449614130889 281.6784888418355 86.39677653024266 284.37830496197034Q88.34859164739642 287.07812108210516 91.76134622349761 287.07812108210516Q95.1741007995988 287.07812108210516 97.12591591675258 284.37830496197034Q99.07773103390633 281.6784888418355 99.07773103390633 276.9333574791742ZM114.80912712785222 277.93848382693005V286.56387039255566H120.93338533975984Q123.87863928899785 286.56387039255566 125.42139135764633 285.4535564037556Q126.96414342629481 284.34324241495557 126.96414342629481 282.23948959407124Q126.96414342629481 280.135736773187 125.42139135764633 279.03711030005854Q123.87863928899785 277.93848382693005 120.93338533975984 277.93848382693005ZM114.80912712785222 267.25609450310645V274.5023542194857H120.46588471289665Q122.89688797258518 274.5023542194857 124.43964004123366 273.53229041874465Q125.98239210988214 272.56222661800354 125.98239210988214 270.8324742986098Q125.98239210988214 269.102721979216 124.43964004123366 268.17940824116124Q122.89688797258518 267.25609450310645 120.46588471289665 267.25609450310645ZM110.508121360711 263.8199648956621H120.74638508901457Q125.35126626361685 263.8199648956621 127.82901958599169 265.50296715236954Q130.30677290836653 267.18596940907696 130.30677290836653 270.2948485777171Q130.30677290836653 272.70247680606246 129.04452121583594 274.1166662023236Q127.78226952330537 275.5308555985847 125.30451620093054 275.88148106873206Q128.27314518151172 276.4424818209679 129.90939737553282 278.21898420304797Q131.54564956955394 279.995486585128 131.54564956955394 282.66024015824814Q131.54564956955394 286.166494859722 128.8458334494191 288.083247429861Q126.14601732928426 290.0 121.14376062184826 290.0H110.508121360711ZM138.8854094113058 263.8199648956621H143.18641517844705V290.0H138.8854094113058ZM138.8854094113058 253.62845123004485H143.18641517844705V259.07483353300086H138.8854094113058ZM171.0260775081492 264.82509124341794V268.8455966344413Q169.20282506338282 267.84047028668544 167.36788510294485 267.33790711280756Q165.5329451425069 266.8353439389296 163.66294263505418 266.8353439389296Q159.47881202462872 266.8353439389296 157.164683921656 269.4884099963781Q154.8505558186833 272.14147605382664 154.8505558186833 276.9333574791742Q154.8505558186833 281.7252389045218 157.164683921656 284.37830496197034Q159.47881202462872 287.0313710194188 163.66294263505418 287.0313710194188Q165.5329451425069 287.0313710194188 167.36788510294485 286.5288078455409Q169.20282506338282 286.026244671663 171.0260775081492 285.02111832390716V288.99487365224417Q169.22620009472598 289.8363747805979 167.29776000891536 290.25712534477475Q165.36931992310477 290.6778759089516 163.19544200819098 290.6778759089516Q157.2815590783718 290.6778759089516 153.79867940824113 286.96124592538933Q150.31579973811048 283.2446159418271 150.31579973811048 276.9333574791742Q150.31579973811048 270.5285988911487 153.8337419552559 266.8587189702728Q157.3516841724013 263.18883904939685 163.4759423843089 263.18883904939685Q165.4628200484774 263.18883904939685 167.35619758727324 263.5979020979021Q169.24957512606912 264.00696514640737 171.0260775081492 264.82509124341794Z"/></g></svg>
          </td>
          <td style="text-align:right;vertical-align:top">
            <div style="font-size:18px;font-weight:700;color:#111">РАХУНОК НА ОПЛАТУ</div>
            <div style="font-size:13px;color:#555;margin-top:4px">${invoiceNum} · ${dateStr}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Meta row -->
  <tr>
    <td style="padding:16px 32px;background:#f9fafb;border-bottom:1px solid #e5e7eb">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:12px;color:#888">ЗАМОВЛЕННЯ</td>
          <td style="font-size:12px;color:#888">ДАТА</td>
          <td style="font-size:12px;color:#888">ДІЙСНИЙ ДО</td>
        </tr>
        <tr>
          <td style="font-size:14px;font-weight:600;color:#111;padding-top:4px">${o.orderNum}</td>
          <td style="font-size:14px;font-weight:600;color:#111;padding-top:4px">${dateStr}</td>
          <td style="font-size:14px;font-weight:600;color:#111;padding-top:4px">${validStr}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Parties -->
  <tr>
    <td style="padding:20px 32px;border-bottom:1px solid #e5e7eb">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="50%" style="vertical-align:top;padding-right:16px">
            <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:.8px;margin-bottom:8px">ПОСТАЧАЛЬНИК</div>
            <div style="font-size:13px;font-weight:700;color:#111;line-height:1.5">ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «ЗЕМЛЕРОБ ХАБ»</div>
            <div style="font-size:12px;color:#555;line-height:1.7;margin-top:4px">
              Код за ЄДРПОУ: 45801119<br>
              п/р UA63 305299 00000 26001031616283<br>
              у банку ПАТ КБ «ПРИВАТБАНК», МФО 305299<br>
              вул. Б. Вишневецького, 36/1, м. Черкаси, 18000
            </div>
          </td>
          <td width="50%" style="vertical-align:top;padding-left:16px;border-left:1px solid #e5e7eb">
            <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:.8px;margin-bottom:8px">ПЛАТНИК</div>
            <div style="font-size:13px;font-weight:700;color:#111;line-height:1.5">${buyerName}</div>
            <div style="font-size:12px;color:#555;line-height:1.7;margin-top:4px">
              ${buyerEdrpou}
              ${o.client?.phone ? 'Тел: ' + o.client.phone + '<br>' : ''}
              ${o.client?.email ? 'Email: ' + o.client.email + '<br>' : ''}
              ${buyerAddr ? buyerAddr + '<br>' : ''}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Services table -->
  <tr>
    <td style="padding:20px 32px">
      <div style="font-size:12px;font-weight:700;color:#888;letter-spacing:.8px;margin-bottom:12px">ПОСЛУГИ ЗА ЗАМОВЛЕННЯМ</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 10px;border:1px solid #e5e7eb;font-size:11px;color:#666;font-weight:600;text-align:center;width:32px">№</th>
            <th style="padding:8px 10px;border:1px solid #e5e7eb;font-size:11px;color:#666;font-weight:600;text-align:left;width:80px">Код послуги</th>
            <th style="padding:8px 10px;border:1px solid #e5e7eb;font-size:11px;color:#666;font-weight:600;text-align:left">Пакет / дослідження</th>
            <th style="padding:8px 10px;border:1px solid #e5e7eb;font-size:11px;color:#666;font-weight:600;text-align:left;width:80px">Матеріал</th>
            <th style="padding:8px 10px;border:1px solid #e5e7eb;font-size:11px;color:#666;font-weight:600;text-align:center;width:60px">К-сть зразків</th>
            <th style="padding:8px 10px;border:1px solid #e5e7eb;font-size:11px;color:#666;font-weight:600;text-align:right;width:90px">Ціна, грн</th>
            <th style="padding:8px 10px;border:1px solid #e5e7eb;font-size:11px;color:#666;font-weight:600;text-align:right;width:90px">Сума, грн</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          ${discountRow}
        </tbody>
        <tfoot>
          <tr style="background:#f9fafb">
            <td colspan="6" style="padding:10px 10px;border:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#111;text-align:right">Сума після знижки</td>
            <td style="padding:10px 10px;border:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#111;text-align:right;white-space:nowrap">${fmtPrice(o.total).replace(' грн','')} грн</td>
          </tr>
        </tfoot>
      </table>
    </td>
  </tr>

  <!-- Payment details -->
  <tr>
    <td style="padding:0 32px 24px">
      <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;border:1px solid #e5e7eb">
        <div style="font-size:12px;font-weight:700;color:#888;letter-spacing:.8px;margin-bottom:8px">ДЕТАЛІ ОПЛАТИ</div>
        <div style="font-size:13px;color:#555;line-height:1.7">
          <strong style="color:#111">Призначення платежу:</strong> ${paymentPurpose}<br>
          <strong style="color:#111">Отримувач:</strong> ТОВ «ЗЕМЛЕРОБ ХАБ»<br>
          <strong style="color:#111">IBAN:</strong> UA63 305299 00000 26001031616283<br>
          <strong style="color:#111">Банк:</strong> ПАТ КБ «ПРИВАТБАНК», МФО 305299
        </div>
        <div style="margin-top:10px;font-size:12px;color:#999">
          Примітка. Рахунок дійсний протягом 7 календарних днів з дати виставлення.
        </div>
      </div>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:16px 32px;background:#f3f4f6;border-top:1px solid #e5e7eb">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:12px;color:#888">
            📞 <a href="tel:+380670000000" style="color:#555">+380 67 000 00 00</a> &nbsp;|&nbsp;
            🌐 <a href="https://laba.zemlerob.com.ua" style="color:#555">laba.zemlerob.com.ua</a>
          </td>
          <td style="text-align:right;font-size:11px;color:#aaa">LABA by Zemlerob · Рахунок сформовано автоматично</td>
        </tr>
      </table>
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
    order_num:        order.orderNum,
    name:             order.client?.name    || null,
    phone:            order.client?.phone   || null,
    email:            order.client?.email   || null,
    company:          order.client?.company || null,
    payer_type:       order.client?.payerType     || null,
    edrpou:           order.client?.edrpou        || null,
    ipn:              order.client?.ipn           || null,
    legal_address:    order.client?.legalAddress  || null,
    rnokpp:           order.client?.rnokpp        || null,
    send_docs:        order.client?.sendDocs      ?? null,
    accounting_email: order.client?.accountingEmail || null,
    items:            order.items    || [],
    samples:          order.samples  || [],
    delivery:         order.delivery || null,
    payment:          order.payment  || null,
    promo:            order.promo    || null,
    discount:         order.discount || 0,
    total:            order.total    || 0,
    notes:            order.notes    || null,
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
        'Prefer': 'return=representation',
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
  try {
    const rows = JSON.parse(res.body);
    return Array.isArray(rows) && rows[0] ? rows[0].id : null;
  } catch(_) { return null; }
}

async function logOrderEvent(orderNum, eventType, description, newValues) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !orderNum) return;
  const payload = JSON.stringify({
    order_num:   orderNum,
    entity_type: 'order',
    entity_id:   orderNum,
    event_type:  eventType,
    actor_type:  'system',
    description: description || null,
    new_values:  newValues   || null,
  });
  try {
    await new Promise((resolve, reject) => {
      const u = new URL(`${url}/rest/v1/order_events`);
      const req = require('https').request({
        hostname: u.hostname, path: u.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'apikey': key, 'Authorization': `Bearer ${key}`,
          'Prefer': 'return=minimal',
        },
      }, r => { r.resume(); r.on('end', resolve); });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  } catch(e) {
    console.warn('logOrderEvent error (non-fatal):', e.message);
  }
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

  const notifErrors = [];
  let supabaseOk = false;

  // 1. Save to Supabase — CRITICAL: must succeed for the order to exist
  let savedOrderId = null;
  try {
    savedOrderId = await saveOrderToSupabase(order);
    supabaseOk = true;
  } catch (err) {
    console.error('Supabase error:', err.message);
    return res.status(500).json({ ok: false, orderNum: order.orderNum, error: 'Supabase: ' + err.message });
  }

  // 1a. Log order_created event (non-critical)
  await logOrderEvent(
    order.orderNum,
    'order_created',
    `Замовлення ${order.orderNum} створено клієнтом`,
    { total: order.total, client: order.client?.name || null }
  );

  // 2. Notifications — non-critical; failures are logged but don't affect HTTP status

  // 2a. Telegram
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID not set');
    const text = buildTelegramText(order);
    await tgRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
  } catch (err) {
    console.warn('Telegram error (non-fatal):', err.message);
    notifErrors.push({ channel: 'telegram', message: err.message });
  }

  // 2b. Email to client
  const clientEmail = order.client?.email;
  if (clientEmail && process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    // Confirmation email
    try {
      await transporter.sendMail({
        from:    `"LABA Agro" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to:      clientEmail,
        subject: `Замовлення ${order.orderNum} прийнято — LABA`,
        html:    buildClientEmailHtml(order),
      });
    } catch (err) {
      console.warn('Confirmation email error (non-fatal):', err.message);
      notifErrors.push({ channel: 'email', message: err.message });
    }

    // Invoice email
    const invoiceNum = order.orderNum
      ? 'LABA-' + order.orderNum.replace(/^LAB-/, '')
      : 'LABA-рахунок';
    try {
      await transporter.sendMail({
        from:    `"LABA Agro" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to:      clientEmail,
        subject: `Рахунок ${invoiceNum} — LABA`,
        html:    buildInvoiceHtml(order),
      });
    } catch (err) {
      console.warn('Invoice email error (non-fatal):', err.message);
      notifErrors.push({ channel: 'invoice_email', message: err.message });
    }
  }

  // 2c. Team email
  const teamEmail = process.env.TEAM_EMAIL;
  if (teamEmail && process.env.SMTP_HOST) {
    try {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      const textBody = buildTelegramText(order).replace(/[*_`]/g, '');
      await transporter.sendMail({
        from:    `"LABA Site" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to:      teamEmail,
        subject: `Нове замовлення ${order.orderNum} — LABA`,
        text:    textBody,
      });
    } catch (err) {
      console.warn('Team email error (non-fatal):', err.message);
      notifErrors.push({ channel: 'team_email', message: err.message });
    }
  }

  // Order saved — always 200; notification failures are informational only
  return res.status(200).json({
    ok: true,
    orderNum: order.orderNum,
    ...(notifErrors.length ? { partialErrors: notifErrors } : {}),
  });
};
