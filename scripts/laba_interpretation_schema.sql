-- ============================================================
-- LABA — Правила інтерпретації: Supabase SQL Schema
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. РОЗДІЛИ ПРОТОКОЛУ (protocol_sections)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE protocol_sections (
  protocol_section_id   text        PRIMARY KEY,
  material_id           text        NOT NULL DEFAULT 'MAT-01',
  protocol_section_name text        NOT NULL,
  sort_order            integer     NOT NULL,
  client_visible        boolean     NOT NULL DEFAULT true,
  description           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  protocol_sections IS 'Розділи протоколу аналізу — заголовки груп результатів.';
COMMENT ON COLUMN protocol_sections.protocol_section_id IS 'Стабільний ID; не змінювати при перейменуванні.';
COMMENT ON COLUMN protocol_sections.client_visible IS 'FALSE — внутрішній розділ, не показувати клієнту.';
COMMENT ON COLUMN protocol_sections.sort_order IS 'Порядок у протоколі; крок 10 для резерву.';


-- ─────────────────────────────────────────────────────────────
-- 2. МЕТОДИКИ (interpretation_methods)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE interpretation_methods (
  result_code        text        PRIMARY KEY,
  laba_service_code  text,
  method_extraction  text,
  result_name        text        NOT NULL,
  unit               text,
  standard_code      text,
  partner_code       text,
  status             text        NOT NULL DEFAULT 'draft',
  review_note        text,
  source_url         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  interpretation_methods IS 'Перелік параметрів аналізу: ключі, методи, одиниці.';
COMMENT ON COLUMN interpretation_methods.result_code IS 'Ключ результату (напр. phosphorus, phWater, om). Використовується у всіх інших таблицях.';
COMMENT ON COLUMN interpretation_methods.status IS 'draft | review | active';


-- ─────────────────────────────────────────────────────────────
-- 3. ШКАЛИ КАТЕГОРІЙ (interpretation_scales)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE interpretation_scales (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  result_code        text        NOT NULL REFERENCES interpretation_methods(result_code),
  method_extraction  text,
  unit               text,
  category_code      text        NOT NULL,  -- VL | L | M | H | VH
  category_name      text        NOT NULL,
  range_min          numeric,
  range_max          numeric,
  min_inclusive      boolean     DEFAULT true,
  max_inclusive      boolean     DEFAULT true,
  version_source     text,
  status             text        NOT NULL DEFAULT 'draft',
  conditions_notes   text,
  source_url         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  interpretation_scales IS 'Шкали категорій (VL/L/M/H/VH) для кожного параметра аналізу.';
COMMENT ON COLUMN interpretation_scales.category_code IS 'VL = Дуже низький, L = Низький, M = Середній, H = Високий, VH = Дуже високий.';
COMMENT ON COLUMN interpretation_scales.range_min IS 'NULL = відкритий лівий кінець (напр. >200).';
COMMENT ON COLUMN interpretation_scales.range_max IS 'NULL = відкритий правий кінець.';
COMMENT ON COLUMN interpretation_scales.status IS 'draft | review | active. Лише active виводиться у протокол.';

CREATE INDEX interpretation_scales_result_code_idx ON interpretation_scales (result_code, status);


-- ─────────────────────────────────────────────────────────────
-- 4. ВІДПОВІДІ (interpretation_responses)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE interpretation_responses (
  response_code      text        PRIMARY KEY,
  result_code        text        NOT NULL REFERENCES interpretation_methods(result_code),
  method_extraction  text,
  condition_rule     text        NOT NULL,  -- напр. "category = VL"
  short_text         text,
  detail_text        text,
  next_step          text,
  required_data      text,
  response_type      text,
  status             text        NOT NULL DEFAULT 'draft',
  source_url         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  interpretation_responses IS 'Текстові відповіді для протоколу: короткий текст і деталі за категорією.';
COMMENT ON COLUMN interpretation_responses.detail_text IS 'Підтримує плейсхолдери: {value}, {unit}, {category}.';
COMMENT ON COLUMN interpretation_responses.condition_rule IS 'Умова застосування: "category = VL", "value > 7.4" тощо.';


-- ─────────────────────────────────────────────────────────────
-- 5. РОЗРАХУНКОВІ ПРАВИЛА (interpretation_calculations)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE interpretation_calculations (
  rule_id               text        PRIMARY KEY,
  service_id            text,
  method_id             text,
  input_parameter_id    text,
  input_code            text        NOT NULL,
  output_parameter_id   text,
  output_code           text        NOT NULL,
  operation             text        NOT NULL,  -- multiply | divide | add | subtract
  factor                numeric,
  output_unit           text,
  rounding_policy       text        NOT NULL DEFAULT 'full_precision',
  status                text        NOT NULL DEFAULT 'draft',
  description           text,
  source                text,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  interpretation_calculations IS 'Розрахункові правила між параметрами (напр. OM = SOC × 1.724).';
COMMENT ON COLUMN interpretation_calculations.rule_id IS 'Напр. CALC-SOC-OM-001.';
COMMENT ON COLUMN interpretation_calculations.operation IS 'multiply | divide | add | subtract.';
COMMENT ON COLUMN interpretation_calculations.rounding_policy IS 'full_precision | round_2 | round_1 тощо.';


-- ─────────────────────────────────────────────────────────────
-- 6. ОПТИМАЛЬНІ ДІАПАЗОНИ ПРОТОКОЛУ (protocol_optimal_ranges)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE protocol_optimal_ranges (
  result_code          text        PRIMARY KEY,
  result_parameter_id  text,
  result_name          text,
  optimal_min          numeric,
  optimal_max          numeric,
  unit                 text,
  selection_logic      text,
  source               text,
  status               text        NOT NULL DEFAULT 'selected',
  note                 text,
  lookup_sheet         text,
  cec_input            text,
  lookup_field         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  protocol_optimal_ranges IS 'Оптимальні діапазони для колонки протоколу — деякі фіксовані, деякі залежать від CEC.';
COMMENT ON COLUMN protocol_optimal_ranges.cec_input IS 'Якщо NOT NULL — діапазон динамічний, береться з таблиці cec_balance за значенням CEC зразка.';


-- ─────────────────────────────────────────────────────────────
-- 7. ВИВІЛЬНЕННЯ N З OM (interpretation_n_release)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE interpretation_n_release (
  rule_band_id         text        PRIMARY KEY,
  input_code           text        NOT NULL DEFAULT 'om',
  om_min_pct           numeric,
  om_max_pct           numeric,
  min_inclusive        boolean     DEFAULT true,
  max_inclusive        boolean     DEFAULT true,
  texture_code         text        NOT NULL,
  texture_ua           text,
  texture_source       text,
  n_level_code         text,
  n_level_name         text,
  n_min_lb_acre        numeric,
  n_max_lb_acre        numeric,
  n_min_kg_ha          numeric,
  n_max_kg_ha          numeric,
  conversion_factor    numeric,
  calculation_status   text        NOT NULL DEFAULT 'draft_reference',
  source_range         text,
  source_title         text,
  limitations          text,
  method_id            text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  interpretation_n_release IS 'Оцінка потенційного вивільнення N із OM за текстурою ґрунту (lb/acre → кг/га).';
COMMENT ON COLUMN interpretation_n_release.texture_code IS 'Код текстури: clay_loam, silt_loam, sandy_loam тощо. Пріоритет — результат гранулометрії; fallback — CEC-текстура.';


-- ─────────────────────────────────────────────────────────────
-- 8. ТЕКСТУРА ЗА CEC (interpretation_cec_texture)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE interpretation_cec_texture (
  rule_id              text        PRIMARY KEY,
  input_code           text        NOT NULL DEFAULT 'cec',
  soil_type_source     text,
  soil_type_ua         text,
  texture_code         text        NOT NULL,
  cec_min              numeric,
  cec_max              numeric,
  min_inclusive        boolean,
  max_inclusive        boolean,
  cec_unit             text        NOT NULL DEFAULT 'meq/100g',
  n_om_lookup_supported boolean   DEFAULT false,
  status               text        NOT NULL DEFAULT 'draft_laba_boundaries',
  interpretation_note  text,
  source               text,
  result_parameter_id  text,
  method_id            text,
  output_code          text,
  original_cec_range   text,
  laba_interval        text,
  boundary_policy      text,
  source_warning       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  interpretation_cec_texture IS 'Розрахунковий (орієнтовний) текстурний клас за значенням CEC. Не підміняє лабораторний гранулометричний аналіз.';


-- ─────────────────────────────────────────────────────────────
-- 9. ЦІЛЬОВИЙ БАЛАНС КАТІОНІВ (interpretation_cec_balance)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE interpretation_cec_balance (
  target_id                      text        PRIMARY KEY,
  reference_id                   text,
  service_id                     text,
  method_id                      text,
  cec_value                      numeric     NOT NULL,
  cec_unit                       text        NOT NULL DEFAULT 'meq/100g',
  k_high_ppm                     numeric,
  k_normal_ppm                   numeric,
  mg_ppm                         numeric,
  ca_ppm                         numeric,
  k_high_base_saturation_range   text,
  k_normal_base_saturation_range text,
  mg_base_saturation_range       text,
  ca_base_saturation_range       text,
  source_unit                    text        DEFAULT 'ppm',
  review_status                  text        NOT NULL DEFAULT 'source_unverified',
  review_note                    text,
  source_description             text,
  source_conversion_note         text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  interpretation_cec_balance IS 'Цільові значення K/Mg/Ca (ppm) за рівнем CEC зразка. НЕ конвертувати ppm → lbs/acre автоматично без перевірки.';


-- ─────────────────────────────────────────────────────────────
-- 10. ВПЛИВ pH НА ҐРУНТ (interpretation_ph_effects)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE interpretation_ph_effects (
  rule_id                      text        PRIMARY KEY,
  result_code                  text        NOT NULL DEFAULT 'phWater',
  method_id                    text,
  ph_band_id                   text,
  ph_anchor_min                numeric,
  ph_anchor_max                numeric,
  ph_zone                      text,
  theme_code                   text,
  theme_name                   text,
  source_statement_ua          text,
  protocol_page2_text          text,
  automatic_lime_dose_allowed  boolean     NOT NULL DEFAULT false,
  rule_status                  text        NOT NULL DEFAULT 'qualitative_reference',
  source                       text,
  caution                      text,
  display_order                integer,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  interpretation_ph_effects IS 'Якісна схема впливу pH(H₂O) на потребу у вапнуванні та доступність поживних речовин.';
COMMENT ON COLUMN interpretation_ph_effects.automatic_lime_dose_allowed IS 'FALSE = не розраховувати дозу вапна автоматично.';


-- ─────────────────────────────────────────────────────────────
-- 11. КОНТРОЛЬНІ ПРИКЛАДИ (interpretation_test_cases)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE interpretation_test_cases (
  test_id               text        PRIMARY KEY,
  result_code           text        NOT NULL REFERENCES interpretation_methods(result_code),
  method_extraction     text,
  unit                  text,
  test_value            numeric     NOT NULL,
  operator              text        NOT NULL DEFAULT 'EQ',  -- EQ | GT | LT | GTE | LTE
  expected_category     text,
  expected_response     text,
  description           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  interpretation_test_cases IS 'Контрольні приклади для автотестування логіки інтерпретації.';


-- ─────────────────────────────────────────────────────────────
-- АВТООНОВЛЕННЯ updated_at
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protocol_sections_updated_at
  BEFORE UPDATE ON protocol_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interpretation_methods_updated_at
  BEFORE UPDATE ON interpretation_methods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interpretation_scales_updated_at
  BEFORE UPDATE ON interpretation_scales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interpretation_responses_updated_at
  BEFORE UPDATE ON interpretation_responses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interpretation_calculations_updated_at
  BEFORE UPDATE ON interpretation_calculations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_protocol_optimal_ranges_updated_at
  BEFORE UPDATE ON protocol_optimal_ranges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interpretation_n_release_updated_at
  BEFORE UPDATE ON interpretation_n_release
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interpretation_cec_texture_updated_at
  BEFORE UPDATE ON interpretation_cec_texture
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interpretation_cec_balance_updated_at
  BEFORE UPDATE ON interpretation_cec_balance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interpretation_ph_effects_updated_at
  BEFORE UPDATE ON interpretation_ph_effects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interpretation_test_cases_updated_at
  BEFORE UPDATE ON interpretation_test_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- (таблиці редагуються тільки через service_role / адмінку)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE protocol_sections            ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretation_methods       ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretation_scales        ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretation_responses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretation_calculations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_optimal_ranges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretation_n_release     ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretation_cec_texture   ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretation_cec_balance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretation_ph_effects    ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretation_test_cases    ENABLE ROW LEVEL SECURITY;

-- Публічне читання активних правил (для генерації протоколу на клієнті)
CREATE POLICY "public_read_active" ON interpretation_scales
  FOR SELECT USING (status = 'active');

CREATE POLICY "public_read_active" ON interpretation_responses
  FOR SELECT USING (status = 'active');

CREATE POLICY "public_read_active" ON interpretation_calculations
  FOR SELECT USING (status = 'active');

CREATE POLICY "public_read_active" ON protocol_optimal_ranges
  FOR SELECT USING (status = 'selected');

-- Розділи протоколу — читають всі, бачать тільки client_visible
CREATE POLICY "public_read_client_visible" ON protocol_sections
  FOR SELECT USING (client_visible = true);

-- Решта таблиць — тільки service_role (адмінка, імпорт)
-- (service_role обходить RLS за замовчуванням у Supabase)
