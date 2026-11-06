#!/usr/bin/env node
/**
 * LABA — Import interpretation rules: Google Sheets → Supabase
 *
 * Setup:
 *   npm install @supabase/supabase-js dotenv
 *
 * .env (в корені проєкту):
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   SPREADSHEET_ID=1cZrNUMYqTMdOMpcNNXilf0Yfkl9fwZjyaYf47sNIfJM
 *
 * Запуск:
 *   node import-interpretation-rules.js
 *   node import-interpretation-rules.js --table scales   ← тільки одна таблиця
 *   node import-interpretation-rules.js --dry-run        ← перевірка без запису
 *
 * Вимога до таблиці Google Sheets:
 *   Доступ: "Усі, у кого є посилання" → Переглядач
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ─── Supabase ────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SPREADSHEET_ID = process.env.SPREADSHEET_ID
  || '1cZrNUMYqTMdOMpcNNXilf0Yfkl9fwZjyaYf47sNIfJM';

const DRY_RUN    = process.argv.includes('--dry-run');
const DEBUG_COLS = process.argv.includes('--debug-cols');
const ONLY_TABLE = (() => {
  const i = process.argv.indexOf('--table');
  return i !== -1 ? process.argv[i + 1] : null;
})();

// ─── Утиліти ─────────────────────────────────────────────────

/**
 * Нормалізує назву колонки:
 * "rule_id ID формули" → "rule_id"   (ASCII field name — берем тільки перше слово)
 * "Ключ результату"   → "Ключ результату"  (кирилиця — залишаємо повністю)
 */
function cleanLabel(raw) {
  if (!raw) return '';
  const s = raw.trim();
  const first = s.split(' ')[0];
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(first) ? first : s;
}

/** Завантажує лист як масив рядків. При порожніх заголовках пробує headers=2 */
async function fetchSheet(sheetName, headerRow = 1) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&headers=${headerRow}`;
  const res  = await fetch(url);
  const text = await res.text();

  // Google повертає /*O_o*/\ngoogle.visualization.Query.setResponse({...})
  const json = JSON.parse(text.replace(/^[^{]+/, '').replace(/\);?\s*$/, ''));

  const rawCols = json.table ? json.table.cols.map(c => (c.label || '').trim()) : [];
  const allEmpty = rawCols.every(c => c === '');

  // Якщо всі заголовки порожні — пробуємо рядок 2
  if (allEmpty && headerRow === 1) {
    return fetchSheet(sheetName, 2);
  }

  const cols = rawCols.map(cleanLabel);

  if (DEBUG_COLS) {
    console.log(`    [headers=${headerRow}] Колонки (${cols.length}): ${cols.map(c => `"${c}"`).join(', ')}`);
  }

  if (!json.table || !json.table.rows || json.table.rows.length === 0) {
    console.log(`    ⚠ Лист "${sheetName}" порожній або не знайдений`);
    if (cols.length) console.log(`    Колонки: ${cols.slice(0, 6).map(c => `"${c}"`).join(', ')}`);
    return [];
  }

  const rows = json.table.rows.map(r =>
    Object.fromEntries(cols.map((c, i) => [c, r.c[i]?.v ?? null]))
  );

  return rows;
}

/** Конвертує статуси з українських → англійські */
function mapStatus(ua) {
  const map = {
    'Чернетка':              'draft',
    'На перевірку':          'review',
    'Активний':              'active',
    'За даними користувача': 'draft',
    'Довідка':               'reference',
    'Довідка — метод уточнити': 'reference',
    'selected':              'selected',
    'active':                'active',
    'draft':                 'draft',
  };
  return map[ua] ?? ua ?? 'draft';
}

/** Парсить число або null */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

/** Парсить boolean */
function bool(v) {
  if (v === true || v === 'TRUE' || v === 1) return true;
  if (v === false || v === 'FALSE' || v === 0) return false;
  return null;
}

/** Upsert з логуванням */
async function upsert(table, rows, conflictColumn = null) {
  if (!rows.length) { console.log(`  ⚠ ${table}: порожньо, пропущено`); return; }

  if (DRY_RUN) {
    console.log(`  🔍 ${table}: ${rows.length} рядків (dry-run, не записано)`);
    console.log('    Приклад:', JSON.stringify(rows[0], null, 2).split('\n').slice(0,8).join('\n'));
    return;
  }

  const opts = conflictColumn
    ? { onConflict: conflictColumn }
    : { onConflict: Object.keys(rows[0])[0] };

  const { error } = await supabase.from(table).upsert(rows, opts);
  if (error) {
    console.error(`  ✗ ${table}: ${error.message}`);
  } else {
    console.log(`  ✓ ${table}: ${rows.length} рядків збережено`);
  }
}

/** Truncate + insert (для таблиць без природного PK — scales) */
async function truncateInsert(table, rows) {
  if (!rows.length) { console.log(`  ⚠ ${table}: порожньо, пропущено`); return; }

  if (DRY_RUN) {
    console.log(`  🔍 ${table}: ${rows.length} рядків (dry-run, не записано)`);
    console.log('    Приклад:', JSON.stringify(rows[0], null, 2).split('\n').slice(0,8).join('\n'));
    return;
  }

  // Delete all existing rows first
  const { error: delErr } = await supabase.from(table).delete().neq('id', 0);
  if (delErr) console.warn(`  ⚠ ${table}: очистка: ${delErr.message}`);

  const { error } = await supabase.from(table).insert(rows);
  if (error) {
    console.error(`  ✗ ${table}: ${error.message}`);
  } else {
    console.log(`  ✓ ${table}: ${rows.length} рядків збережено`);
  }
}


// ─── Імпортери ────────────────────────────────────────────────

async function importProtocolSections() {
  console.log('\n📋 protocol_sections (лист: "Data source – backend test")');
  const rows = await fetchSheet('Data source – backend test');
  // Пропускаємо рядок-підказку (рядок 1 з описами колонок)
  const data = rows
    .filter(r => r['protocol_section_id'] && !r['protocol_section_id'].includes('Стабільний'))
    .map(r => ({
      protocol_section_id:   r['protocol_section_id'],
      material_id:           r['material_id'] || 'MAT-01',
      protocol_section_name: r['protocol_section_name'],
      sort_order:            num(r['sort_order']) ?? 0,
      client_visible:        bool(r['client_visible']) ?? true,
      description:           r['description'],
    }));
  await upsert('protocol_sections', data, 'protocol_section_id');
}

async function importMethods() {
  console.log('\n🔬 interpretation_methods (лист: "Методики")');
  const rows = await fetchSheet('Методики');
  const data = rows
    .filter(r => r['Ключ результату'])
    .map(r => ({
      result_code:       r['Ключ результату'],
      laba_service_code: r['Код дослідження LABA'],
      method_extraction: r['Метод / витяжка'],
      result_name:       r['Назва результату'],
      unit:              r['Одиниця'],
      standard_code:     r['Код методики'],
      partner_code:      r['Назва або код у партнера'],
      status:            mapStatus(r['Стан']),
      review_note:       r['Що перевірити'],
      source_url:        r['Джерело'],
    }));
  await upsert('interpretation_methods', data, 'result_code');
}

async function importScales() {
  console.log('\n📊 interpretation_scales (лист: "Шкали")');
  const rows = await fetchSheet('Шкали');
  const data = rows
    .filter(r => r['Ключ результату'] && r['Код категорії'])
    .map(r => ({
      result_code:       r['Ключ результату'],
      method_extraction: r['Метод / витяжка'],
      unit:              r['Одиниця'],
      category_code:     r['Код категорії'],
      category_name:     r['Категорія'],
      range_min:         num(r['Від']),
      range_max:         num(r['До']),
      min_inclusive:     bool(r['Від включно']) ?? true,
      max_inclusive:     bool(r['До включно']) ?? true,
      version_source:    r['Версія / джерело'],
      status:            mapStatus(r['Стан']),
      conditions_notes:  r['Умови й обмеження'],
      source_url:        r['Джерело'],
    }));
  await truncateInsert('interpretation_scales', data);
}

async function importResponses() {
  console.log('\n💬 interpretation_responses (лист: "Відповіді")');
  const rows = await fetchSheet('Відповіді');
  const data = rows
    .filter(r => r['Код відповіді'])
    .map(r => ({
      response_code:     r['Код відповіді'],
      result_code:       r['Ключ результату'],
      method_extraction: r['Метод / витяжка'],
      condition_rule:    r['Умова'],
      short_text:        r['Коротко для протоколу'],
      detail_text:       r['Деталі для протоколу'],
      next_step:         r['Наступний крок'],
      required_data:     r['Необхідні дані'],
      response_type:     r['Тип'],
      status:            mapStatus(r['Стан']),
      source_url:        r['Джерело'],
    }));
  await upsert('interpretation_responses', data, 'response_code');
}

async function importCalculations() {
  console.log('\n🧮 interpretation_calculations (лист: "Розрахунки")');
  const rows = await fetchSheet('Розрахунки');
  const data = rows
    .filter(r => r['rule_id'] && !r['rule_id'].includes('ID'))
    .map(r => ({
      rule_id:              r['rule_id'],
      service_id:           r['service_id'],
      method_id:            r['method_id'],
      input_parameter_id:   r['input_result_parameter_id'],
      input_code:           r['input_code'],
      output_parameter_id:  r['output_result_parameter_id'],
      output_code:          r['output_code'],
      operation:            r['operation'],
      factor:               num(r['factor']),
      output_unit:          r['output_unit'],
      rounding_policy:      r['rounding_policy'] || 'full_precision',
      status:               r['status'] || 'active',
      description:          r['description'],
      source:               r['source'],
      note:                 r['note'],
    }));
  await upsert('interpretation_calculations', data, 'rule_id');
}

async function importOptimalRanges() {
  console.log('\n🎯 protocol_optimal_ranges (лист: "Оптимальні діапазони протоколу")');
  const rows = await fetchSheet('Оптимальні діапазони протоколу');
  const data = rows
    .filter(r => r['result_code'] && !r['result_code'].includes('Ключ'))
    .map(r => ({
      result_code:         r['result_code'],
      result_parameter_id: r['result_parameter_id'],
      result_name:         r['result_name'],
      optimal_min:         num(r['optimal_min']),
      optimal_max:         num(r['optimal_max']),
      unit:                r['unit'],
      selection_logic:     r['selection_logic'],
      source:              r['source'],
      status:              r['status'] || 'selected',
      note:                r['note'],
      lookup_sheet:        r['lookup_sheet'],
      cec_input:           r['cec_input'],
      lookup_field:        r['lookup_field'],
    }));
  await upsert('protocol_optimal_ranges', data, 'result_code');
}

async function importNRelease() {
  console.log('\n🌱 interpretation_n_release (лист: "Вивільнення N з OM")');
  const rows = await fetchSheet('Вивільнення N з OM');
  const data = rows
    .filter(r => r['rule_band_id'] && !r['rule_band_id'].includes('ID'))
    .map(r => ({
      rule_band_id:        r['rule_band_id'],
      input_code:          r['input_code'] || 'om',
      om_min_pct:          num(r['om_min_pct']),
      om_max_pct:          num(r['om_max_pct']),
      min_inclusive:       bool(r['min_inclusive']) ?? true,
      max_inclusive:       bool(r['max_inclusive']) ?? true,
      texture_code:        r['texture_code'],
      texture_ua:          r['texture_ua'],
      texture_source:      r['texture_source'],
      n_level_code:        r['n_level_code'],
      n_level_name:        r['n_level_name'],
      n_min_lb_acre:       num(r['n_min_lb_acre']),
      n_max_lb_acre:       num(r['n_max_lb_acre']),
      n_min_kg_ha:         num(r['n_min_kg_ha']),
      n_max_kg_ha:         num(r['n_max_kg_ha']),
      conversion_factor:   num(r['conversion_factor']),
      calculation_status:  r['calculation_status'] || 'draft_reference',
      source_range:        r['source_range'],
      source_title:        r['source_title'],
      limitations:         r['limitations'],
      method_id:           r['method_id'],
      notes:               r['notes'],
    }));
  await upsert('interpretation_n_release', data, 'rule_band_id');
}

async function importCecTexture() {
  console.log('\n🏔 interpretation_cec_texture (лист: "Текстура за CEC")');
  const rows = await fetchSheet('Текстура за CEC');
  const data = rows
    .filter(r => r['rule_id'] && !r['rule_id'].includes('Ідентифікатор'))
    .map(r => ({
      rule_id:             r['rule_id'],
      input_code:          r['input_code'] || 'cec',
      soil_type_source:    r['soil_type_source'],
      soil_type_ua:        r['soil_type_ua'],
      texture_code:        r['texture_code'],
      cec_min:             num(r['cec_min']),
      cec_max:             num(r['cec_max']),
      min_inclusive:       bool(r['min_inclusive']),
      max_inclusive:       bool(r['max_inclusive']),
      cec_unit:            r['cec_unit'] || 'meq/100g',
      n_om_lookup_supported: bool(r['n_om_lookup_supported']) ?? false,
      status:              r['status'] || 'draft_laba_boundaries',
      interpretation_note: r['interpretation_note'],
      source:              r['source'],
      result_parameter_id: r['result_parameter_id'],
      method_id:           r['method_id'],
      output_code:         r['output_code'],
      original_cec_range:  r['original_cec_range'],
      laba_interval:       r['laba_interval'],
      boundary_policy:     r['boundary_policy'],
      source_warning:      r['source_warning'],
    }));
  await upsert('interpretation_cec_texture', data, 'rule_id');
}

async function importCecBalance() {
  console.log('\n⚖️  interpretation_cec_balance (лист: "CEC — цільовий баланс катіонів")');
  const rows = await fetchSheet('CEC — цільовий баланс катіонів');
  const data = rows
    .filter(r => r['target_id'] && !r['target_id'].includes('Унікальний'))
    .map(r => ({
      target_id:                      r['target_id'],
      reference_id:                   r['reference_id'],
      service_id:                     r['service_id'],
      method_id:                      r['method_id'],
      cec_value:                      num(r['cec_value']),
      cec_unit:                       r['cec_unit'] || 'meq/100g',
      k_high_ppm:                     num(r['k_high_ppm']),
      k_normal_ppm:                   num(r['k_normal_ppm']),
      mg_ppm:                         num(r['mg_ppm']),
      ca_ppm:                         num(r['ca_ppm']),
      k_high_base_saturation_range:   r['k_high_base_saturation_range'],
      k_normal_base_saturation_range: r['k_normal_base_saturation_range'],
      mg_base_saturation_range:       r['mg_base_saturation_range'],
      ca_base_saturation_range:       r['ca_base_saturation_range'],
      source_unit:                    r['source_unit'] || 'ppm',
      review_status:                  r['review_status'] || 'source_unverified',
      review_note:                    r['review_note'],
      source_description:             r['source_description'],
      source_conversion_note:         r['source_conversion_note'],
    }));
  await upsert('interpretation_cec_balance', data, 'target_id');
}

async function importPhEffects() {
  console.log('\n⚗️  interpretation_ph_effects (лист: "Вплив pH на ґрунт")');
  const rows = await fetchSheet('Вплив pH на ґрунт');
  const data = rows
    .filter(r => r['rule_id'] && !r['rule_id'].includes('ID правила'))
    .map(r => ({
      rule_id:                     r['rule_id'],
      result_code:                 r['result_code'] || 'phWater',
      method_id:                   r['method_id'],
      ph_band_id:                  r['ph_band_id'],
      ph_anchor_min:               num(r['ph_anchor_min']),
      ph_anchor_max:               num(r['ph_anchor_max']),
      ph_zone:                     r['ph_zone'],
      theme_code:                  r['theme_code'],
      theme_name:                  r['theme_name'],
      source_statement_ua:         r['source_statement_ua'],
      protocol_page2_text:         r['protocol_page2_text'],
      automatic_lime_dose_allowed: bool(r['automatic_lime_dose_allowed']) ?? false,
      rule_status:                 r['rule_status'] || 'qualitative_reference',
      source:                      r['source'],
      caution:                     r['caution'],
      display_order:               num(r['display_order']),
    }));
  await upsert('interpretation_ph_effects', data, 'rule_id');
}

async function importTestCases() {
  console.log('\n🧪 interpretation_test_cases (лист: "Контрольні приклади")');
  const rows = await fetchSheet('Контрольні приклади');
  const data = rows
    .filter(r => r['Код тесту'] && !r['Код тесту'].includes('Код'))
    .map(r => ({
      test_id:           r['Код тесту'],
      result_code:       r['Ключ результату'],
      method_extraction: r['Метод / витяжка'],
      unit:              r['Одиниця'],
      test_value:        r['Значення'] !== null ? num(r['Значення']) : null,
      operator:          r['Оператор'] || 'EQ',
      expected_category: r['Очікувана категорія'],
      expected_response: r['Очікувана відповідь'],
      description:       r['Що перевіряємо'],
    }));
  await upsert('interpretation_test_cases', data, 'test_id');
}


// ─── Головна функція ─────────────────────────────────────────

const IMPORTERS = {
  sections:    importProtocolSections,
  methods:     importMethods,
  scales:      importScales,
  responses:   importResponses,
  calcs:       importCalculations,
  ranges:      importOptimalRanges,
  n_release:   importNRelease,
  cec_texture: importCecTexture,
  cec_balance: importCecBalance,
  ph_effects:  importPhEffects,
  test_cases:  importTestCases,
};

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(' LABA — Import: Google Sheets → Supabase');
  console.log(DRY_RUN ? ' MODE: DRY RUN (нічого не записується)' : ' MODE: WRITE');
  console.log('═══════════════════════════════════════════════');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗ Відсутні env змінні SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const toRun = ONLY_TABLE
    ? { [ONLY_TABLE]: IMPORTERS[ONLY_TABLE] }
    : IMPORTERS;

  if (ONLY_TABLE && !IMPORTERS[ONLY_TABLE]) {
    console.error(`✗ Невідома таблиця: ${ONLY_TABLE}`);
    console.error('  Доступні:', Object.keys(IMPORTERS).join(', '));
    process.exit(1);
  }

  // Порядок важливий: methods перед scales і responses (FK)
  const order = ['sections','methods','scales','responses','calcs',
                 'ranges','n_release','cec_texture','cec_balance','ph_effects','test_cases'];

  for (const key of order) {
    if (toRun[key]) {
      try { await toRun[key](); }
      catch (e) { console.error(`  ✗ ${key} помилка:`, e.message); }
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(' Готово.');
  console.log('═══════════════════════════════════════════════\n');
}

main().catch(console.error);
