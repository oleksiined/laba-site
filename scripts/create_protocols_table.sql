-- ============================================================
-- LABA — Таблиця протоколів аналізу
-- ============================================================
-- Виконати в Supabase SQL Editor

CREATE TABLE IF NOT EXISTS protocols (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_num      text        UNIQUE,                          -- напр. PROT-2026-001-01
  order_id          text        NOT NULL,                        -- напр. L260044
  sample_id         text,                                        -- напр. L260044-01 (NULL = весь замовлення)
  file_name         text        NOT NULL,
  storage_bucket    text        NOT NULL DEFAULT 'laba-documents',
  storage_path      text        NOT NULL,                        -- protocols/L260044-01_v1.pdf
  version           int         NOT NULL DEFAULT 1,
  status            text        NOT NULL DEFAULT 'draft',        -- draft | published | revoked
  analysis_date     date,                                        -- дата проведення аналізу
  issued_at         timestamptz,                                 -- дата видачі клієнту
  visible_to_client boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  protocols IS 'PDF-протоколи лабораторних аналізів — окремо від фінансових документів.';
COMMENT ON COLUMN protocols.protocol_num   IS 'Унікальний номер протоколу, напр. PROT-2026-001-01.';
COMMENT ON COLUMN protocols.order_id       IS 'Номер замовлення (напр. L260044).';
COMMENT ON COLUMN protocols.sample_id      IS 'Код зразка (напр. L260044-01). NULL якщо протокол на все замовлення.';
COMMENT ON COLUMN protocols.version        IS '1 = перший випуск; 2+ = перевидання після виправлень.';
COMMENT ON COLUMN protocols.status         IS 'draft = чернетка; published = виданий клієнту; revoked = відкликаний.';
COMMENT ON COLUMN protocols.analysis_date  IS 'Дата проведення аналізу (з даних лабораторії).';
COMMENT ON COLUMN protocols.issued_at      IS 'Дата і час коли протокол став видимим клієнту.';
COMMENT ON COLUMN protocols.visible_to_client IS 'TRUE — клієнт бачить у кабінеті; встановлюється при published.';

-- Індекси для частих запитів
CREATE INDEX IF NOT EXISTS protocols_order_id_idx   ON protocols (order_id);
CREATE INDEX IF NOT EXISTS protocols_sample_id_idx  ON protocols (sample_id);
CREATE INDEX IF NOT EXISTS protocols_status_idx     ON protocols (status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_protocols_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS protocols_updated_at ON protocols;
CREATE TRIGGER protocols_updated_at
  BEFORE UPDATE ON protocols
  FOR EACH ROW EXECUTE FUNCTION update_protocols_updated_at();

-- RLS: читання тільки через service key (адмін) або для client_visible
ALTER TABLE protocols ENABLE ROW LEVEL SECURITY;

-- Адміністратори (service key) — повний доступ
CREATE POLICY "Service role full access" ON protocols
  FOR ALL USING (auth.role() = 'service_role');
