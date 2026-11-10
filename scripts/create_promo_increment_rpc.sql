-- Атомарний інкремент used_count для промокоду
CREATE OR REPLACE FUNCTION increment_promo_used_count(promo_code text)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE promocodes
  SET used_count = used_count + 1
  WHERE code = promo_code;
$$;
