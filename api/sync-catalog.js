// api/sync-catalog.js
// Синхронізує каталог з Google Sheets → Supabase
// Назви колонок = Google Sheets (не маппінг, передаємо як є)
// Виклики: GET /api/sync-catalog?secret=XXX  або Vercel Cron
'use strict';
const https = require('https');

const GS_ID = '1xn9CNpcReL0QyC8-bRxQEZ0JyVA2JsNJrx51DMjUL4g';
const GS_PUB_ID = '2PACX-1vRbHG3iOUp6zr4eRsePrcvkEvxKMynoS3zTpocb3_8RE8PM1IED2gT9LUmsojORbelT6ixv3gttqY2W';

// GID-и листів (отримати: Файл → Поширити → Опублікувати у Вебі → окремий лист → URL)
// Визначити gid: відкрити лист у таблиці, в URL буде #gid=XXXXXXXX
const GS_GIDS = [1137445460, 0, 19007006, 423697960, 1515954684, 2059362348, 1799615401];

// ─── CSV parser (RFC 4180) ────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let i = 0, n = text.length;
  while (i < n) {
    const row = [];
    while (i < n) {
      if (text[i] === '"') {
        i++; let cell = '';
        while (i < n) {
          if (text[i] === '"' && text[i+1] === '"') { cell += '"'; i += 2; }
          else if (text[i] === '"') { i++; break; }
          else { cell += text[i++]; }
        }
        row.push(cell);
      } else {
        let cell = '';
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') cell += text[i++];
        row.push(cell);
      }
      if (i < n && text[i] === ',') i++;
      else break;
    }
    if (i < n && text[i] === '\r') i++;
    if (i < n && text[i] === '\n') i++;
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

// ─── fetch CSV через export (надійніше за gviz) ───────────────────────────────
function httpGet(url, redirects) {
  redirects = redirects === undefined ? 5 : redirects;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpGet(res.headers.location, redirects - 1));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

// Detect sheet type from header columns
function detectSheet(cols) {
  // result_parameter_id перевіряємо ДО chip_id (бо Result Parameters також має chip_id колонку)
  if (cols.includes('result_parameter_id'))      return 'Result Parameters';
  if (cols.includes('chip_id'))                  return 'Service Chips';
  if (cols.includes('package_id') && cols.includes('service_id') && !cols.includes('indicators_count')) return 'Package Items';
  if (cols.includes('package_id'))               return 'Packages';
  if (cols.includes('method_id') && !cols.includes('service_type')) return 'Methods';
  if (cols.includes('service_id') || cols.includes('service_type')) return 'Services';
  if (cols.includes('material_id'))              return 'Materials';
  return null; // README або невідомий
}

function gsFetch(gid) {
  return new Promise((resolve, reject) => {
    // published CSV з gid=NUMBER — не потребує auth
    const url = `https://docs.google.com/spreadsheets/d/e/${GS_PUB_ID}/pub?output=csv&gid=${gid}`;
    Promise.resolve(httpGet(url)).then(res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try {
          // Перевіряємо HTTP статус
          if (res.statusCode !== 200) {
            reject(new Error(`CSV for gid=${gid} returned HTTP ${res.statusCode}`));
            return;
          }
          const raw = Buffer.concat(chunks).toString('utf8');
          // Знімаємо BOM (﻿) бо trimStart() його не видаляє
          const rawTrimmed = raw.replace(/^﻿/, '').trimStart();
          // HTML (редирект на логін)
          if (rawTrimmed.startsWith('<') || rawTrimmed.includes('<!DOCTYPE') || rawTrimmed.includes('<html')) {
            reject(new Error(`CSV for gid=${gid} returned HTML (sheet not public?)`));
            return;
          }
          // gviz error format
          if (rawTrimmed.startsWith('google.visualization') || rawTrimmed.startsWith('{"version"') ||
              (rawTrimmed.startsWith('{') && rawTrimmed.includes('"status"'))) {
            reject(new Error(`CSV for gid=${gid} returned gviz error: ${rawTrimmed.substring(0, 120)}`));
            return;
          }
          const cleanStr = v => {
            if (typeof v !== 'string') return v;
            return v
              .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
              .replace(/­/g, '')
              .replace(/​/g, '')
              .replace(/‌/g, '')
              .replace(/‍/g, '')
              .replace(/﻿/g, '')
              .trim();
          };
          const allRows = parseCsv(raw);
          if (allRows.length < 2) { resolve({ sheet: null, cols: [], rows: [] }); return; }
          // Рядок 0 = англ. назви колонок (для коду), рядок 1 = укр. описи (пропускаємо)
          const cols = allRows[0].map(c => c.trim());
          const sheet = detectSheet(cols);
          if (!sheet) { resolve({ sheet: null, cols, rows: [] }); return; } // README або невідомий — пропускаємо
          const dataRows = allRows.slice(2); // slice(2): пропускаємо рядок 1 (укр. описи)
          const result = dataRows.map(row => {
            const obj = {};
            cols.forEach((col, i) => {
              const val = row[i] !== undefined ? cleanStr(row[i]) : null;
              obj[col] = val === '' ? null : val;
            });
            return obj;
          }).filter(r => Object.values(r).some(v => v !== null));
          resolve({ sheet, cols, rows: result });
        } catch (e) {
          reject(new Error(`Parse error for sheet "${sheetName}": ${e.message}`));
        }
      });
      res.on('error', reject);
    }).catch(reject);
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
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === '') return false;
  }
  return defaultVal;
}

// ─── Головна функція синку ────────────────────────────────────────────────────
async function syncCatalog(debug = false) {
  // Завантажуємо всі GID-и паралельно, потім розкладаємо по типах по заголовку
  const allFetched = await Promise.all(GS_GIDS.map(gid => gsFetch(gid)));

  const empty = { sheet: null, cols: [], rows: [] };
  const bySheet = {};
  for (const f of allFetched) {
    if (f.sheet) bySheet[f.sheet] = f;
  }

  const svcRaw      = bySheet['Services']          || empty;
  const pkgRaw      = bySheet['Packages']          || empty;
  const itemRaw     = bySheet['Package Items']     || empty;
  const methRaw     = bySheet['Methods']           || empty;
  const matRaw      = bySheet['Materials']         || empty;
  const resParRaw   = bySheet['Result Parameters'] || empty;
  const svcChipsRaw = bySheet['Service Chips']     || empty;
  // Ці листи не в таблиці, залишаємо порожніми
  const svcRelRaw   = empty;
  const sFormRaw    = empty;
  const sFormFldRaw = empty;

  const services       = svcRaw.rows;
  const packages       = pkgRaw.rows;
  const pkgItems       = itemRaw.rows;
  const methods        = methRaw.rows;
  const materials      = matRaw.rows;
  const resultParams   = resParRaw.rows;
  const serviceRelations = [];
  const sampleForms      = [];
  const sampleFormFields = [];
  const serviceChips     = svcChipsRaw.rows;

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
      chips:                r.chips                || null,
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
      search_keywords:      r.search_keywords      || null,
      report_example_url:   r.report_example_url   || null,
      synced_at:            now,
    }));

  // ── Packages ──
  const pkgRows = packages
    .filter(r => r.package_id)
    .map(r => ({
      package_id:       r.package_id,
      package_code:     r.package_code     || null,
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
      search_keywords:      r.search_keywords      || null,
      report_example_url:   r.report_example_url   || null,
      result_deliverables:  r.result_deliverables  || null,
      synced_at:            now,
    }));

  // ── Methods ── (дедублікуємо по method_id — Sheet може мати дублі)
  const _methSeen = new Set();
  const methRows = methods
    .filter(r => { if (!r.method_id || _methSeen.has(r.method_id)) return false; _methSeen.add(r.method_id); return true; })
    .map(r => ({
      method_id:               r.method_id,
      service_id:              r.service_id              || null,
      method_name:             r.method_name             || null,
      method_full_name:        r.method_full_name        || null,
      laboratory:              r.laboratory              || null,
      standard_code:           r.standard_code           || null,
      standard_full:           r.standard_full           || null,
      method_description:      r.method_description      || null,
      selection_note:          r.selection_note          || null,
      is_default:              toBool(r.is_default, false),
      measurement_range:       r.measurement_range       || null,
      accuracy:                r.accuracy                || null,
      result_form:             r.result_form             || null,
      price:                   r.price != null           ? Number(r.price) : null,
      currency:                r.currency                || 'UAH',
      turnaround_value:        r.turnaround_value        ? Number(r.turnaround_value) : null,
      turnaround_unit:         r.turnaround_unit         || 'days',
      status:                  r.status                  || 'active',
      sort_order:              r.sort_order != null      ? Number(r.sort_order) : null,
      min_sample_quantity:     r.min_sample_quantity     ? Number(r.min_sample_quantity) : null,
      sample_quantity_unit:    r.sample_quantity_unit    || null,
      min_samples_count:       r.min_samples_count       ? Number(r.min_samples_count) : null,
      storage_conditions:      r.storage_conditions      || null,
      max_delivery_hours:      r.max_delivery_hours      ? Number(r.max_delivery_hours) : null,
      sampling_instruction_url: r.sampling_instruction_url || null,
      container_type:          r.container_type          || null,
      sample_requirements:     r.sample_requirements     || null,
      client_preparation:      r.client_preparation      || null,
      synced_at:               now,
    }));

  // ── Package Items ──
  // Deduplicate by (package_id, service_id) — keep last occurrence per key
  // to avoid "ON CONFLICT DO UPDATE command cannot affect a row a second time"
  const itemMap = new Map();
  pkgItems
    .filter(r => r.package_id && r.service_id)
    .forEach(r => {
      const key = `${r.package_id}::${r.service_id}`;
      itemMap.set(key, {
        package_id:    r.package_id,
        service_id:    r.service_id,
        method_id:     r.method_id     || null,
        display_order: r.display_order ? Number(r.display_order) : null,
        required:      toBool(r.required, true),
      });
    });
  const itemRows = [...itemMap.values()];

  // ── Materials ──
  const matRows = materials
    .filter(r => r.material_id)
    .map(r => ({
      material_id:              r.material_id,
      name:                     r.name                     || null,
      name_uk:                  r.name                     || null,
      internal_key:             r.material_code ? r.material_code.toLowerCase() : null,
      material_code:            r.material_code            || null,
      short_name:               r.short_name               || null,
      description:              r.description              || null,
      status:                   r.status                   || 'active',
      sort_order:               r.sort_order != null       ? Number(r.sort_order) : null,
      min_sample_quantity:      r.min_sample_quantity      ? Number(r.min_sample_quantity) : null,
      sample_quantity_unit:     r.sample_quantity_unit     || null,
      min_samples_count:        r.min_samples_count        ? Number(r.min_samples_count) : null,
      storage_conditions:       r.storage_conditions       || null,
      max_delivery_hours:       r.max_delivery_hours       ? Number(r.max_delivery_hours) : null,
      sampling_instruction_url: r.sampling_instruction_url || null,
      sample_form_id:           r.sample_form_id           || null,
      container_type:           r.container_type           || null,
      sample_requirements:      r.sample_requirements      || null,
      client_preparation:       r.client_preparation       || null,
      synced_at:                now,
    }));

  if (debug) {
    return {
      debug: true,
      gids_detected: Object.fromEntries(
        allFetched.map((f, i) => [GS_GIDS[i], f.sheet || '(skipped)']),
      ),
      materials_sheet:         { cols: matRaw.cols,    rows: materials.length,    filtered: matRows.length },
      services_sheet:          { cols: svcRaw.cols,    rows: services.length,     filtered: svcRows.length },
      packages_sheet:          { cols: pkgRaw.cols,    rows: packages.length,     filtered: pkgRows.length },
      items_sheet:             { cols: itemRaw.cols,   rows: pkgItems.length,     filtered: itemRows.length },
      methods_sheet:           { cols: methRaw.cols,   rows: methods.length,      filtered: methRows.length },
      result_parameters_sheet: { cols: resParRaw.cols, rows: resultParams.length },
      service_chips_sheet:     { cols: svcChipsRaw.cols, rows: serviceChips.length },
    };
  }

  // ── Result Parameters ──
  const resParRows = resultParams
    .filter(r => r.result_parameter_id)
    .map(r => ({
      result_parameter_id: r.result_parameter_id,
      method_id:           r.method_id    || null,
      service_id:          r.service_id   || null,
      name:                r.name         || null,
      code:                r.code         || null,
      symbol:              r.symbol       || null,
      result_type:         r.result_type  || null,
      unit:                r.unit         || null,
      display_order:       r.display_order ? Number(r.display_order) : null,
      client_visible:      toBool(r.client_visible, true),
      required:            toBool(r.required, true),
      synced_at:           now,
    }));

  // ── Service Relations ──
  const svcRelRows = serviceRelations
    .filter(r => r.source_id && r.target_id)
    .map(r => ({
      source_type:      r.source_type      || null,
      source_id:        r.source_id,
      target_type:      r.target_type      || null,
      target_id:        r.target_id,
      target_method_id: r.target_method_id || null,
      relation_type:    r.relation_type    || null,
      sort_order:       r.sort_order != null ? Number(r.sort_order) : null,
      status:           r.status           || 'active',
      synced_at:        now,
    }));

  // ── Sample Forms ──
  const sFormRows = sampleForms
    .filter(r => r.form_id)
    .map(r => ({
      form_id:     r.form_id,
      name:        r.name        || null,
      description: r.description || null,
      status:      r.status      || 'active',
      synced_at:   now,
    }));

  // ── Sample Form Fields ──
  const sFormFldRows = sampleFormFields
    .filter(r => r.form_id && r.field_key)
    .map(r => ({
      form_id:      r.form_id,
      field_key:    r.field_key,
      label:        r.label       || null,
      field_type:   r.field_type  || null,
      required:     toBool(r.required, true),
      options:      r.options     || null,
      placeholder:  r.placeholder || null,
      help_text:    r.help_text   || null,
      unit:         r.unit        || null,
      min_value:    r.min_value != null ? Number(r.min_value) : null,
      max_value:    r.max_value != null ? Number(r.max_value) : null,
      sort_order:   r.sort_order != null ? Number(r.sort_order) : null,
      status:       r.status      || 'active',
      synced_at:    now,
    }));

  // ── Service Chips ──
  const svcChipRows = serviceChips
    .filter(r => r.service_id && r.label)
    .map(r => ({
      service_id:    r.service_id,
      label:         r.label,
      tooltip_title: r.tooltip_title || null,
      sort_order:    r.sort_order != null ? Number(r.sort_order) : null,
      synced_at:     now,
    }));

  // Захист від wipe: перевіряємо кількість ВАЛІДНИХ рядків після фільтрації
  // (HTML парситься як CSV і дає rows, але жоден не має service_id — тому перевіряємо filtered, не raw)
  const totalFiltered = svcRows.length + pkgRows.length + methRows.length + matRows.length;
  if (totalFiltered === 0) {
    throw new Error(
      `Синк скасовано: після фільтрації отримано 0 валідних рядків ` +
      `(services=${services.length}, packages=${packages.length}, methods=${methods.length}, materials=${materials.length}). ` +
      `Перевірте що таблиця опублікована (Файл → Поширити → Опублікувати у Вебі) і GID-и правильні. Дані в БД не змінені.`
    );
  }

  // DELETE всіх таблиць і вставляємо нові (повна заміна — дзеркало Sheet)
  await Promise.all([
    sbRequest('DELETE', 'catalog_materials?material_id=neq.__none__',                      null).catch(() => {}),
    sbRequest('DELETE', 'catalog_services?service_id=neq.__none__',                        null).catch(() => {}),
    sbRequest('DELETE', 'catalog_packages?package_id=neq.__none__',                        null).catch(() => {}),
    sbRequest('DELETE', 'catalog_package_items?service_id=neq.__none__',                   null).catch(() => {}),
    sbRequest('DELETE', 'catalog_methods?method_id=neq.__none__',                          null).catch(() => {}),
    sbRequest('DELETE', 'catalog_result_parameters?result_parameter_id=neq.__none__',      null).catch(() => {}),
    sbRequest('DELETE', 'catalog_service_relations?source_id=neq.__none__',                null).catch(() => {}),
    sbRequest('DELETE', 'catalog_sample_forms?form_id=neq.__none__',                       null).catch(() => {}),
    sbRequest('DELETE', 'catalog_sample_form_fields?form_id=neq.__none__',                 null).catch(() => {}),
    sbRequest('DELETE', 'catalog_service_chips?service_id=neq.__none__',                   null).catch(() => {}),
  ]);

  await Promise.all([
    upsert('catalog_materials',         'material_id',         matRows),
    upsert('catalog_services',          'service_id',          svcRows),
    upsert('catalog_packages',          'package_id',          pkgRows),
    upsert('catalog_methods',           'method_id',           methRows),
    upsert('catalog_result_parameters', 'result_parameter_id', resParRows),
    upsert('catalog_sample_forms',      'form_id',             sFormRows),
  ]);

  if (itemRows.length) {
    await upsert('catalog_package_items', 'package_id,service_id', itemRows);
  }
  if (svcRelRows.length) {
    await upsert('catalog_service_relations', 'source_id,target_id,relation_type', svcRelRows);
  }
  if (sFormFldRows.length) {
    await upsert('catalog_sample_form_fields', 'form_id,field_key', sFormFldRows);
  }
  if (svcChipRows.length) {
    await upsert('catalog_service_chips', 'service_id,label', svcChipRows);
  }

  return {
    materials:          matRows.length,
    services:           svcRows.length,
    packages:           pkgRows.length,
    packageItems:       itemRows.length,
    methods:            methRows.length,
    resultParameters:   resParRows.length,
    serviceRelations:   svcRelRows.length,
    sampleForms:        sFormRows.length,
    sampleFormFields:   sFormFldRows.length,
    serviceChips:       svcChipRows.length,
    syncedAt:           now,
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
