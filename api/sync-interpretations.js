// api/sync-interpretations.js
// Синхронізує базу інтерпретацій (нова табличка) → Supabase
// Таблиці: protocol_spec, protocol_level_bands, protocol_texture_cec
//
// Виклик: GET /api/sync-interpretations   (без secret — відкритий)
//
// ПІДГОТОВКА: нова Google Sheets має бути опублікована:
//   Файл → Поділитися → Опублікувати у вебі → Увесь документ → CSV → Опублікувати
//   Скопіювати Published ID з URL і підставити в GS_PUB_ID нижче.
//
// GID-и листів — дивитися в URL таблиці: ...#gid=XXXXXXX
// або: Файл → Поділитися → Опублікувати у вебі → конкретний аркуш → CSV → посилання

'use strict';
const https = require('https');

// ── Нова таблиця інтерпретацій ───────────────────────────────────────────────
// Spreadsheet ID: 1w3gmtnIs2OX9FOGMa840kYTK-upvdHMT1BimO83zorw
// Published ID: отримати після публікації (Файл → Поділитися → Опублікувати у вебі)
const GS_PUB_ID = process.env.INTERP_GS_PUB_ID || '__REPLACE_WITH_PUBLISHED_ID__';

// GID-и потрібних аркушів — перевірити в URL Google Sheets (#gid=...)
// Поточні значення — PLACEHOLDER, треба замінити після відкриття таблиці
const GS_GIDS = {
  spec:    process.env.INTERP_GID_SPEC    || null,  // Специфікація протоколу
  bands:   process.env.INTERP_GID_BANDS   || null,  // Шкали рівнів
  texture: process.env.INTERP_GID_TEXTURE || null,  // Текстура за CEC
  cation:  process.env.INTERP_GID_CATION  || null,  // Баланс катіонів (Ca/Mg за CEC) — опційно
};

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

function cleanStr(v) {
  if (typeof v !== 'string') return v;
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/­/g, '').replace(/​/g, '').replace(/‌/g, '')
    .replace(/‍/g, '').replace(/﻿/g, '')
    .trim();
}

// Перетворює "так" / "ні" / true / false → boolean
function toBool(v, defaultVal) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'так' || s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'ні' || s === 'false' || s === '0' || s === 'no') return false;
  }
  return defaultVal !== undefined ? defaultVal : null;
}

// Перетворює "1,5" або "1.5" → number; порожнє → null
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(',', '.').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ─── HTTP GET з редиректами ───────────────────────────────────────────────────
function httpGet(url, redirects) {
  redirects = redirects === undefined ? 5 : redirects;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpGet(res.headers.location, redirects - 1));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

// Завантажує CSV аркуша за gid
function fetchSheet(gid) {
  return new Promise((resolve, reject) => {
    const url = `https://docs.google.com/spreadsheets/d/e/${GS_PUB_ID}/pub?output=csv&gid=${gid}`;
    Promise.resolve(httpGet(url)).then(res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`Sheet gid=${gid}: HTTP ${res.statusCode}`)); return;
          }
          const raw = Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
          if (raw.trimStart().startsWith('<')) {
            reject(new Error(`Sheet gid=${gid}: повернув HTML (аркуш не опублікований?)`)); return;
          }
          const allRows = parseCsv(raw);
          if (allRows.length < 2) { resolve([]); return; }
          // Рядок 0 = назви колонок (англ/укр), рядок 1 = описи/відступаємо
          const cols = allRows[0].map(c => cleanStr(c));
          // Перевіряємо чи є рядок 1 описовим (не дані)
          // В нових аркушах немає окремого рядка описів — slice(1)
          const dataRows = allRows.slice(1);
          const result = dataRows.map(row => {
            const obj = {};
            cols.forEach((col, i) => {
              const val = row[i] !== undefined ? cleanStr(row[i]) : null;
              obj[col] = val === '' ? null : val;
            });
            return obj;
          }).filter(r => Object.values(r).some(v => v !== null && v !== ''));
          resolve(result);
        } catch (e) {
          reject(new Error(`Parse error gid=${gid}: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).catch(reject);
  });
}

// ─── Supabase REST ────────────────────────────────────────────────────────────
function sbRequest(method, path, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
  const host = new URL(url).hostname;
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path:     `/rest/v1/${path}`,
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
        if (res.statusCode >= 400) reject(new Error(`Supabase ${method} ${path}: ${res.statusCode} ${data}`));
        else { try { resolve(data ? JSON.parse(data) : null); } catch { resolve(null); } }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function upsert(table, conflictCol, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    await sbRequest('POST', `${table}?on_conflict=${conflictCol}`, rows.slice(i, i + 500));
  }
}

// ─── Основна функція синхронізації ───────────────────────────────────────────
async function syncInterpretations() {
  if (GS_PUB_ID === '__REPLACE_WITH_PUBLISHED_ID__') {
    throw new Error('GS_PUB_ID не задано. Опублікуй таблицю Google Sheets і встанови INTERP_GS_PUB_ID в Vercel env або задай GID-и через env vars.');
  }

  // cation — optional sheet; skip if GID not set
  const requiredGids = ['spec', 'bands', 'texture'];
  const missingGids = requiredGids.filter(k => !GS_GIDS[k]);
  if (missingGids.length) {
    throw new Error(`GID-и не задані для аркушів: ${missingGids.join(', ')}. Встанови env vars INTERP_GID_SPEC, INTERP_GID_BANDS, INTERP_GID_TEXTURE.`);
  }

  const now = new Date().toISOString();

  // Завантажуємо аркуші паралельно (cation — опційно)
  const [specRows, bandRows, textureRows, cationRowsRaw] = await Promise.all([
    fetchSheet(GS_GIDS.spec),
    fetchSheet(GS_GIDS.bands),
    fetchSheet(GS_GIDS.texture),
    GS_GIDS.cation ? fetchSheet(GS_GIDS.cation).catch(() => []) : Promise.resolve(null),
  ]);

  // ── Специфікація протоколу ──────────────────────────────────────────────────
  // Колонки: service_id, result_parameter_id, method_id, Назва в протоколі,
  //          Од. вим., Розділ протоколу, Порядок розділу, Порядок у розділі,
  //          Знаки після коми, Колонка в шаблоні лабораторії, Тип результату,
  //          Хто дає значення, Формула / правило, Група вибору, Шкала рівнів,
  //          Оптимум від, Оптимум до, Верхня межа включно, Статус
  const spec = specRows
    .filter(r => r['result_parameter_id'])
    .map(r => ({
      result_parameter_id: r['result_parameter_id'],
      service_id:          r['service_id']                     || null,
      method_id:           r['method_id']                      || null,
      display_name:        r['Назва в протоколі']              || null,
      unit:                r['Од. вим.']                       || null,
      section_name:        r['Розділ протоколу']               || null,
      section_order:       r['Порядок розділу']  != null ? Number(r['Порядок розділу'])  : null,
      item_order:          r['Порядок у розділі'] != null ? Number(r['Порядок у розділі']) : null,
      decimal_places:      r['Знаки після коми'] != null && r['Знаки після коми'] !== ''
                             ? Number(r['Знаки після коми']) : null,
      lab_column:          r['Колонка в шаблоні лабораторії'] || null,
      result_type:         r['Тип результату']                 || null,
      value_source:        r['Хто дає значення']              || null,
      formula:             r['Формула / правило']             || null,
      selection_group:     r['Група вибору']                  || null,
      scale_id:            r['Шкала рівнів']                  || null,
      optimum_from:        toNum(r['Оптимум від']),
      optimum_to:          toNum(r['Оптимум до']),
      upper_inclusive:     toBool(r['Верхня межа включно'], null),
      status:              r['Статус']                         || null,
      synced_at:           now,
    }));

  // ── Шкали рівнів ────────────────────────────────────────────────────────────
  // Колонки: band_id, result_parameter_id, Порядок, Код рівня, Назва рівня,
  //          Від, До, Від включно, До включно, Статус, Застосовується якщо
  const bands = bandRows
    .filter(r => r['band_id'])
    .map(r => ({
      band_id:              r['band_id'],
      result_parameter_id:  r['result_parameter_id'] || null,
      band_order:           r['Порядок'] != null ? Number(r['Порядок']) : null,
      level_code:           r['Код рівня']            || null,
      level_name:           r['Назва рівня']          || null,
      from_val:             toNum(r['Від']),
      to_val:               toNum(r['До']),
      from_inclusive:       toBool(r['Від включно'], true),
      to_inclusive:         toBool(r['До включно'], false),
      apply_if:             r['Застосовується, якщо'] || r['Застосовується якщо'] || null,
      status:               r['Статус']               || null,
      synced_at:            now,
    }));

  // ── Текстура за CEC ─────────────────────────────────────────────────────────
  // Колонки: class_id, CEC від, CEC до, Від включно, До включно,
  //          Текстурний клас у протоколі, Статус
  const texture = textureRows
    .filter(r => r['class_id'])
    .map(r => ({
      class_id:       r['class_id'],
      band_order:     null, // порядок визначається за from_val
      texture_class:  r['Текстурний клас у протоколі'] || null,
      from_val:       toNum(r['CEC від']),
      to_val:         toNum(r['CEC до']),
      from_inclusive: toBool(r['Від включно'], true),
      to_inclusive:   toBool(r['До включно'], false),
      status:         r['Статус'] || null,
      synced_at:      now,
    }));

  // ── Баланс катіонів за CEC ───────────────────────────────────────────────────
  // Колонки: cec_val, Ca від, Ca до, Mg від, Mg до (рядок "Правило" — пропускаємо)
  const cation = cationRowsRaw
    ? cationRowsRaw
        .filter(r => {
          const v = r['cec_val'] || r['CEC'] || r['ЄКО'] || Object.values(r)[0];
          return v != null && !isNaN(Number(String(v).trim()));
        })
        .map(r => {
          // Намагаємось знайти колонки за різними можливими назвами
          const cecVal = Number(String(r['cec_val'] || r['CEC'] || r['ЄКО'] || Object.values(r)[0]).trim());
          const vals = Object.values(r).map(v => toNum(v)).filter(v => v !== null);
          // Порядок колонок: cec_val, ca_from, ca_to, mg_from, mg_to
          const caFrom = toNum(r['Ca від'] || r['ca_from'] || r['Ca_від'] || r['ca від']);
          const caTo   = toNum(r['Ca до']  || r['ca_to']  || r['Ca_до']  || r['ca до']);
          const mgFrom = toNum(r['Mg від'] || r['mg_from'] || r['Mg_від'] || r['mg від']);
          const mgTo   = toNum(r['Mg до']  || r['mg_to']  || r['Mg_до']  || r['mg до']);
          return { cec_val: cecVal, ca_from: caFrom, ca_to: caTo, mg_from: mgFrom, mg_to: mgTo, synced_at: now };
        })
        .filter(r => !isNaN(r.cec_val) && r.ca_from != null && r.ca_to != null && r.mg_from != null && r.mg_to != null)
    : [];

  // Захист від wipe
  if (spec.length === 0 && bands.length === 0 && texture.length === 0) {
    throw new Error('Синк скасовано: усі три аркуші порожні. Перевір публікацію таблиці і GID-и.');
  }

  // Повна заміна (DELETE + INSERT) — дзеркало Sheet
  await Promise.all([
    spec.length    ? sbRequest('DELETE', 'protocol_spec?result_parameter_id=neq.__none__',          null).catch(() => {}) : Promise.resolve(),
    bands.length   ? sbRequest('DELETE', 'protocol_level_bands?band_id=neq.__none__',               null).catch(() => {}) : Promise.resolve(),
    texture.length ? sbRequest('DELETE', 'protocol_texture_cec?class_id=neq.__none__',              null).catch(() => {}) : Promise.resolve(),
    cation.length  ? sbRequest('DELETE', 'protocol_cation_balance?cec_val=gte.0',                   null).catch(() => {}) : Promise.resolve(),
  ]);

  await Promise.all([
    spec.length    ? upsert('protocol_spec',              'result_parameter_id', spec)    : Promise.resolve(),
    bands.length   ? upsert('protocol_level_bands',       'band_id',             bands)   : Promise.resolve(),
    texture.length ? upsert('protocol_texture_cec',       'class_id',            texture) : Promise.resolve(),
    cation.length  ? upsert('protocol_cation_balance',    'cec_val',             cation)  : Promise.resolve(),
  ]);

  return {
    spec:    spec.length,
    bands:   bands.length,
    texture: texture.length,
    cation:  cation.length,
    syncedAt: now,
  };
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    const result = await syncInterpretations();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    console.error('sync-interpretations error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
