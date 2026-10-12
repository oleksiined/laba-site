-- ============================================================
-- LABA Catalog — Supabase schema
-- Виконайте в Supabase → SQL Editor
-- ============================================================

-- 1. Матеріали (ґрунт, вода, рослина, добрива, насіння, зерно)
create table if not exists materials (
  material_id   text primary key,        -- MAT-01
  material_code text unique,             -- SOIL
  name          text not null,           -- Ґрунт
  short_name    text,                    -- Ґрунт
  sort_order    int  default 99,
  status        text default 'active'    -- active | inactive | draft
);

-- 2. Послуги (окремі дослідження — «картки» каталогу)
create table if not exists services (
  service_id          text primary key,  -- 01-1-001
  material_id         text references materials(material_id),
  service_code        text,              -- SOIL-PH-EXCH
  group_name          text,              -- Кислотність
  name                text not null,     -- pH обмінний (pH KCl)
  short_name          text,
  symbol              text,              -- pH KCl
  short_description   text,
  price               numeric,
  currency            text default 'UAH',
  turnaround_days     int,               -- строк виконання
  status              text default 'active',
  sort_order          int  default 99,
  orderable_standalone boolean default true
);

-- 3. Пакети (готові набори послуг для клієнта)
create table if not exists packages (
  package_id        text primary key,    -- 01-2-001
  material_id       text references materials(material_id),
  package_group     text,                -- Тестовий
  name              text not null,
  short_description text,
  price             numeric,
  currency          text default 'UAH',
  turnaround_days   int,
  status            text default 'active',
  sort_order        int  default 99,
  slug              text
);

-- 4. Склад пакетів (які послуги входять)
create table if not exists package_items (
  package_id    text not null references packages(package_id) on delete cascade,
  service_id    text not null references services(service_id) on delete cascade,
  display_order int  default 0,
  required      boolean default true,
  primary key (package_id, service_id)
);

-- ── Індекси для швидкого читання ────────────────────────────
create index if not exists services_material_idx  on services(material_id, status);
create index if not exists services_group_idx     on services(group_name);
create index if not exists packages_material_idx  on packages(material_id, status);
create index if not exists package_items_pkg_idx  on package_items(package_id);

-- ── Row Level Security (публічне читання) ───────────────────
alter table materials      enable row level security;
alter table services       enable row level security;
alter table packages       enable row level security;
alter table package_items  enable row level security;

-- Анонімні можуть читати все зі статусом active
create policy "public read materials"
  on materials for select using (status = 'active');

create policy "public read services"
  on services for select using (status = 'active');

create policy "public read packages"
  on packages for select using (status = 'active');

create policy "public read package_items"
  on package_items for select using (true);

-- ── Базове наповнення матеріалів ────────────────────────────
insert into materials (material_id, material_code, name, short_name, sort_order) values
  ('MAT-01', 'SOIL',       'Ґрунт',   'Ґрунт',   1),
  ('MAT-02', 'FERT',       'Добрива', 'Добрива', 2),
  ('MAT-03', 'SEEDS',      'Насіння', 'Насіння', 3),
  ('MAT-04', 'GRAIN',      'Зерно',   'Зерно',   4),
  ('MAT-05', 'WATER',      'Вода',    'Вода',    5),
  ('MAT-06', 'PLANT',      'Рослина', 'Рослина', 6)
on conflict (material_id) do nothing;
