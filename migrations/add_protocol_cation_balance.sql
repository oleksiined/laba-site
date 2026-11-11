-- Migration: add protocol_cation_balance table
-- Run once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS protocol_cation_balance (
  cec_val     INTEGER PRIMARY KEY,  -- rounded CEC value (meq/100g)
  ca_from     INTEGER NOT NULL,
  ca_to       INTEGER NOT NULL,
  mg_from     INTEGER NOT NULL,
  mg_to       INTEGER NOT NULL,
  synced_at   TIMESTAMPTZ
);

-- Enable RLS (read-only for anon)
ALTER TABLE protocol_cation_balance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON protocol_cation_balance FOR SELECT USING (true);
