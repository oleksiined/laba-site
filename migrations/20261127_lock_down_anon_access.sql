drop policy if exists "anon write" on public.lab_price_offers;
drop policy if exists "public read" on public.lab_price_offers;

revoke execute on function public.increment_promo_used_count(text) from public, anon, authenticated;
grant execute on function public.increment_promo_used_count(text) to service_role;
