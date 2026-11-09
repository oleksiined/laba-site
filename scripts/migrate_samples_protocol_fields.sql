-- Migration: add protocol fields to samples table
-- Run in Supabase SQL Editor

ALTER TABLE samples
  ADD COLUMN IF NOT EXISTS crop_planned    text,
  ADD COLUMN IF NOT EXISTS crop_previous   text,
  ADD COLUMN IF NOT EXISTS target_yield    text,
  ADD COLUMN IF NOT EXISTS lab_sample_id   text;

COMMENT ON COLUMN samples.crop_planned   IS 'Планова культура (з етикетки)';
COMMENT ON COLUMN samples.crop_previous  IS 'Культура-попередник (з етикетки)';
COMMENT ON COLUMN samples.target_yield   IS 'Планова врожайність (з етикетки)';
COMMENT ON COLUMN samples.lab_sample_id  IS 'Лабораторний ID зразка (присвоюється лабораторією)';
