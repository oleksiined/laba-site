-- Migration: add payer fields to orders table
-- Run this in Supabase SQL Editor (https://supabase.com → SQL Editor)

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payer_type       text,
  ADD COLUMN IF NOT EXISTS edrpou           text,
  ADD COLUMN IF NOT EXISTS ipn              text,
  ADD COLUMN IF NOT EXISTS legal_address    text,
  ADD COLUMN IF NOT EXISTS rnokpp           text,
  ADD COLUMN IF NOT EXISTS send_docs        boolean,
  ADD COLUMN IF NOT EXISTS accounting_email text;
