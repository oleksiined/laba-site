// api/sync-catalog.js
// Синхронізує каталог з Google Sheets → Supabase
// Назви колонок = Google Sheets (не маппінг, передаємо як є)
// Виклики: GET /api/sync-catalog?secret=XXX  або Vercel Cron
'use strict';
const https = require('https');

const GS_ID = '1S15HjJ3374uHPmH6ciu1y3xB6dkLq5DKI3j5rF7nK-4';

// ─── gviz fetch ───────────────────────────────────────────────────────────────
function gsFetch(sheetName) {
  return new Promise((resolve, reject) => {
    const url = `https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, ''));
          const cols = json.table.cols.map(c => c.label || c.id);
          const rows = (json.table.rows || []).slice(1); // рядок 0 = опис колонок укр.
          const result = rows.map(row => {
            const obj = {};
            cols.forEach((col, i) => {
              const cell = row.c && row.c[i];
              obj[col] = (cell && cell.v !== null && cell.v !== undefined) ? cell.v : null;
            });
            return obj;
          }).filter(r => Object.values(r).some(v => v !== null));
          resolve({ cols, rows: result });
        } catch (e) {
          reject(new Error(`Parse error for sheet "${sheetName}": ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ─── Supabase request ─────────────────────────────────────────────────────────
function sbRequest(method, path, body) {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set');

  const host = new URL(url).hostname;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path: `/rest/v1/${path}`,
      method,
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Supabase ${method} ${path}: ${res.statusCode} ${data}`));
        } else {
          try { resolve(data ? JSON.parse(data) : null); }
          catch { resolve(null); }
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Upsert батчами по 500 рядків
async function upsert(table, conflictCol, rows) {
  if (!rows.length) return;
  const size = 500;
  for (let i = 0; i < rows.length; i += size) {
    await sbRequest('POST', `${table}?on_conflict=${conflictCol}`, rows.slice(i, i + size));
  }
}

// bool helper: 'true'/true/1 → true, інше → false
function toBool(v, defaultVal = false) {
  if (v === true || v === 1 || v === 'true' || v === '1') return true;
  if (v === false || v === 0 || v === 'false' || v === '0') return false;
  return defaultVal;
}

// ─── Головна функція синку ────────────────────────────────────────────────────
async function syncCatalog(debug = false) {
  const [svcRaw, pkgRaw, itemRaw] = await Promise.all([
    gsFetch('Services'),
    gsFetch('Packages'),
    gsFetch('Package Items'),
  ]);

  const services = svcRaw.rows;
  const packages = pkgRaw.rows;
  const pkgItems = itemRaw.rows;

  const now = new Date().toISOString();

  // ── Services ──
  const svcRows = services
    .filter(r => r.service_id)
    .map(r => ({
      service_id:           r.service_id,
      material_id:          r.material_id          || null,
      service_code:         r.service_code         || null,
      shp_code:             r.shp_code             || null,
      group_name:           r.group_name           || null,
      name:                 r.name                 || null,
      short_name:           r.short_name           || null,
      symbol:               r.symbol               || null,
      short_description:    r.short_description    || null,
      price:                r.price != null        ? Number(r.price) : null,
      currency:             r.currency             || 'UAH',
      turnaround_value:     r.turnaround_value     ? Number(r.turnaround_value) : null,
      turnaround_unit:      r.turnaround_unit      || 'days',
      status:               r.status               || 'active',
      slug:                 r.slug                 || null,
      sort_order:           r.sort_order != null   ? Number(r.sort_order) : null,
      orderable_standalone: toBool(r.orderable_standalone, true),
      billing_unit:         r.billing_unit         || null,
      vat_included:         toBool(r.vat_included, false),
      min_samples_count:    r.min_samples_count    ? Number(r.min_samples_count) : null,
      synced_at:            now,
    }));

  // ── Packages ──
  const pkgRows = packages
    .filter(r => r.package_id)
    .map(r => ({
      package_id:       r.package_id,
      material_id:      r.material_id      || null,
      package_group:    r.package_group    || null,
      name:             r.name             || null,
      short_description: r.short_description || null,
      price:            r.price != null    ? Number(r.price) : null,
      currency:         r.currency         || 'UAH',
      turnaround_value: r.turnaround_value ? Number(r.turnaround_value) : null,
      turnaround_unit:  r.turnaround_unit  || 'days',
      status:           r.status           || 'active',
      slug:             r.slug             || null,
      sort_order:       r.sort_order != null ? Number(r.sort_order) : null,
      is_seasonal:      toBool(r.is_seasonal, false),
      billing_unit:     r.billing_unit     || null,
      vat_included:     toBool(r.vat_included, false),
      synced_at:        now,
    }));

  // ── Package Items ──
  const itemRows = pkgItems
    .filter(r => r.package_id && r.service_id)
    .map(r => ({
      package_id:    r.package_id,
      service_id:    r.service_id,
      method_id:     r.method_id     || null,
      display_order: r.display_order ? Number(r.display_order) : null,
      required:      toBool(r.required, true),
    }));

  if (debug) {
    return {
      debug: true,
      services_sheet: {
        cols: svcRaw.cols,
        total_rows: services.length,
        first_row: services[0] || null,
        filtered: svcRows.length,
      },
      packages_sheet: {
        cols: pkgRaw.cols,
        total_rows: packages.length,
        first_row: packages[0] || null,
        filtered: pkgRows.length,
      },
      items_sheet: {
        cols: itemRaw.cols,
        total_rows: pkgItems.length,
        first_row: pkgItems[0] || null,
        filtered: itemRows.length,
      },
    };
  }

  // DELETE всіх package_items і вставляємо нові (таблиця мала)
  if (itemRows.length) {
    await sbRequest('DELETE', 'catalog_package_items?service_id=neq.__none__', null).catch(() => {});
  }

  await Promise.all([
    upsert('catalog_services',  'service_id',  svcRows),
    upsert('catalog_packages',  'package_id',  pkgRows),
  ]);

  if (itemRows.length) {
    await upsert('catalog_package_items', 'package_id,service_id', itemRows);
  }

  return {
    services:     svcRows.length,
    packages:     pkgRows.length,
    packageItems: itemRows.length,
    syncedAt:     now,
  };
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret     = process.env.SYNC_SECRET;
  const cronHeader = req.headers['x-vercel-cron'];
  const querySecret = (req.url || '').match(/[?&]secret=([^&]+)/)?.[1];
  const isDebug    = (req.url || '').includes('debug=1');

  if (secret && !cronHeader && querySecret !== secret) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    const result = await syncCatalog(isDebug);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    console.error('Sync error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
