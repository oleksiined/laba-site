-- Migration: add missing columns to catalog_result_parameters
-- Run in Supabase → SQL Editor

ALTER TABLE catalog_result_parameters
  ADD COLUMN IF NOT EXISTS calculation_no     text,
  ADD COLUMN IF NOT EXISTS chip_id            text,
  ADD COLUMN IF NOT EXISTS data_type          text,
  ADD COLUMN IF NOT EXISTS protocol_name      text,
  ADD COLUMN IF NOT EXISTS protocol_section_id text,
  ADD COLUMN IF NOT EXISTS protocol_sort_order integer,
  ADD COLUMN IF NOT EXISTS decimal_places     integer;
