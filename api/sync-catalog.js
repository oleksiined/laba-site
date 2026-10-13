// api/sync-catalog.js
// Синхронізує каталог з Google Sheets → Supabase
// Виклики: GET /api/sync-catalog?secret=XXX  або Vercel Cron
'use strict';
const https = require('https');

const GS_ID = '1S15HjJ3374uHPmH6ciu1y3xB6dkLq5DKI3j5rF7nK-4';

// ─── gviz fetch ───────────────────────────────────────────────────────────────
function gsFetch(sheetName) {
  return new Promise((resolve, reject) => {
    const url = `https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
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
          resolve(result);
        } catch (e) {
          reject(new Error(`Parse error for sheet "${sheetName}": ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ─── Supabase upsert ──────────────────────────────────────────────────────────
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
async function upsert(table, rows) {
  if (!rows.length) return;
  const size = 500;
  for (let i = 0; i < rows.length; i += size) {
    await sbRequest('POST', `${table}?on_conflict=`, rows.slice(i, i + size));
  }
}

// ─── Головна функція синку ────────────────────────────────────────────────────
async function syncCatalog() {
  const [services, packages, pkgItems] = await Promise.all([
    gsFetch('Services'),
    gsFetch('Packages'),
    gsFetch('Package Items'),
  ]);

  const now = new Date().toISOString();

  // ── Services ──
  const svcRows = services
    .filter(r => r.service_id)
    .map(r => ({
      service_id:     r.service_id,
      name:           r.name || null,
      description:    r.description || null,
      group_name:     r.group_name || null,
      material_id:    r.material_id || null,
      price:          r.price != null ? Number(r.price) : null,
      unit:           r.unit || null,
      client_visible: r.client_visible !== false && r.client_visible !== 'false',
      status:         r.status || 'active',
      synced_at:      now,
    }));

  // ── Packages ──
  const pkgRows = packages
    .filter(r => r.package_id)
    .map(r => ({
      package_id:       r.package_id,
      slug:             r.slug || null,
      name:             r.name || null,
      material_id:      r.material_id || null,
      price:            r.price != null ? Number(r.price) : null,
      turnaround_value: r.turnaround_value ? Number(r.turnaround_value) : null,
      turnaround_unit:  r.turnaround_unit || 'days',
      status:           r.status || 'active',
      synced_at:        now,
    }));

  // ── Package Items ──
  const itemRows = pkgItems
    .filter(r => r.package_id && r.service_id)
    .map(r => ({ package_id: r.package_id, service_id: r.service_id }));

  // DELETE старих package_items і вставляємо нові
  // (простіше ніж diff — таблиця невелика)
  if (itemRows.length) {
    await sbRequest('DELETE', 'catalog_package_items?package_id=neq.PLACEHOLDER', null)
      .catch(() => {}); // ignore if empty
    // Видаляємо ВСІ — потім вставимо нові
    await sbRequest('DELETE', 'catalog_package_items?service_id=neq.__none__', null).catch(() => {});
  }

  await Promise.all([
    upsert('catalog_services', svcRows),
    upsert('catalog_packages', pkgRows),
  ]);

  if (itemRows.length) {
    await upsert('catalog_package_items', itemRows);
  }

  return {
    services: svcRows.length,
    packages: pkgRows.length,
    packageItems: itemRows.length,
    syncedAt: now,
  };
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Перевірка секрету (якщо задано) або Vercel Cron header
  const secret = process.env.SYNC_SECRET;
  const cronHeader = req.headers['x-vercel-cron'];
  const querySecret = (req.url || '').match(/[?&]secret=([^&]+)/)?.[1];

  if (secret && !cronHeader && querySecret !== secret) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    const result = await syncCatalog();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    console.error('Sync error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
