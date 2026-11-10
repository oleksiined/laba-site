-- Додає дві колонки до таблиці promocodes:
-- max_uses  — максимальна кількість використань (NULL = необмежено)
-- used_count — лічильник фактичних використань

ALTER TABLE promocodes
  ADD COLUMN IF NOT EXISTS max_uses   integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS used_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN promocodes.max_uses   IS 'Максимум використань. NULL = необмежено.';
COMMENT ON COLUMN promocodes.used_count IS 'Скільки разів промокод вже було використано.';
