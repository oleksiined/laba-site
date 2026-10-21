-- Migration: documents storage registry
-- Run this in Supabase SQL Editor (https://supabase.com → SQL Editor)
-- -----------------------------------------------------------------------

-- 1. Таблиця документів
CREATE TABLE IF NOT EXISTS documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type    text NOT NULL CHECK (document_type IN ('invoice','act','contract','protocol','other')),
  order_id         text,                        -- FK до orders.order_num (nullable)
  company_id       uuid,                        -- FK до companies якщо є (nullable)
  sample_id        text,                        -- ID зразка (nullable)
  file_name        text NOT NULL,
  storage_bucket   text NOT NULL,
  storage_path     text NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','approved','published','void')),
  visible_to_client boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz
);

-- 2. Зв'язувальна таблиця для актів, що охоплюють кілька замовлень
CREATE TABLE IF NOT EXISTS document_orders (
  document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  order_id     text NOT NULL,
  PRIMARY KEY (document_id, order_id)
);

-- 3. Індекси
CREATE INDEX IF NOT EXISTS documents_order_id_idx    ON documents(order_id);
CREATE INDEX IF NOT EXISTS documents_company_id_idx  ON documents(company_id);
CREATE INDEX IF NOT EXISTS documents_sample_id_idx   ON documents(sample_id);
CREATE INDEX IF NOT EXISTS documents_type_status_idx ON documents(document_type, status);
CREATE INDEX IF NOT EXISTS documents_visible_idx     ON documents(visible_to_client) WHERE visible_to_client = true;

-- 4. RLS — лише service role може писати; анонім нічого не бачить
ALTER TABLE documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_orders  ENABLE ROW LEVEL SECURITY;

-- Service role обходить RLS автоматично (Supabase default)
-- Якщо захочеш дати клієнту доступ через JWT — додасиш окрему policy пізніше

-- -----------------------------------------------------------------------
-- Supabase Storage buckets — створи вручну в Storage → New bucket:
--
--  laba-documents   (Private)   orders/{order_num}/invoice_{num}.pdf
--                               orders/{order_num}/act_{num}.pdf
--                               orders/{order_num}/protocol_{S01}.pdf
--
--  laba-contracts   (Private)   companies/{company-uuid}/contract_2026_v1.pdf
--
--  laba-internal    (Private)   drafts/, templates/, misc/
--
-- Після створення бакетів додай Storage Policy для service role:
--   Policy name: service_role_full_access
--   Roles: service_role
--   Operations: SELECT, INSERT, UPDATE, DELETE
-- -----------------------------------------------------------------------
