-- ============================================================================
-- Enséñame Ya — EP-03 Descubrimiento: catálogo público (SOLO LECTURA).
-- Tablas: categories, tutor_profiles, products, product_categories.
-- Refs: Doc 1 §1.4 (diccionario), Doc 3 (RLS), RN-09/RN-20/RN-24.
--
-- Alcance de ESTE slice: abrir la LECTURA pública del catálogo (descubrimiento).
-- La ESCRITURA llega feature por feature en migraciones posteriores:
--   · CRUD de productos            → EP-04 (S2)
--   · onboarding + edición perfil  → US-202 (S1)
--   · aprobación de tutor / KYC    → US-1101 (S3)
-- Sin políticas de insert/update/delete = default-deny las bloquea a propósito.
--
-- ponytail: se difieren columnas/tablas que el descubrimiento NO pinta hoy y que
-- pertenecen a otro feature — se añaden cuando ese feature las necesite:
--   tutor_profiles.tier_id / payout_country / default_cancellation_policy
--   tabla tutor_tiers            → US-1103 (S3)
--   availability_rules/exceptions → EP-05 (S2)
-- ============================================================================

-- ── Enums del catálogo (Doc 1 §1.3) ───────────────────────────────────────────
create type public.tutor_approval_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.identity_verification_status as enum ('not_submitted', 'pending', 'approved', 'rejected');
create type public.pricing_model as enum ('per_session', 'per_hour', 'per_package');
create type public.product_status as enum ('draft', 'active', 'paused', 'archived');

-- ── categories: datos de referencia públicos; sólo admin escribe (S-13 planas). ─
create table public.categories (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null unique,             -- URLs de descubrimiento
  description text,
  is_active   boolean     not null default true,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ── tutor_profiles: perfil PÚBLICO del tutor (1:1 con profiles). ──────────────
create table public.tutor_profiles (
  profile_id                   uuid primary key references public.profiles (id) on delete cascade,
  headline                     text,
  bio                          text,
  approval_status              public.tutor_approval_status        not null default 'pending',  -- RN-04
  identity_verification_status public.identity_verification_status not null default 'not_submitted',
  rating_avg                   numeric(3,2),                        -- lo agrega el trigger de reviews (EP-09, S3)
  rating_count                 integer     not null default 0,
  approved_at                  timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create index tutor_profiles_approval_status_idx on public.tutor_profiles (approval_status);

create trigger tutor_profiles_set_updated_at
  before update on public.tutor_profiles
  for each row execute function public.set_updated_at();

-- ── products: la "tutoría" que se descubre (y luego se reserva). ──────────────
create table public.products (
  id                   uuid        primary key default gen_random_uuid(),
  tutor_id             uuid        not null references public.profiles (id) on delete cascade,
  title                text        not null,
  slug                 text,
  description          text,
  outcome              text,                                          -- propuesta de valor
  pricing_model        public.pricing_model  not null,               -- RN-10
  price_amount         bigint      not null check (price_amount >= 0),-- unidades menores
  currency             char(3)     not null,                          -- ISO-4217
  session_duration_min integer     check (session_duration_min >= 30),-- RN-03
  package_num_sessions integer     check (package_num_sessions >= 1), -- solo per_package
  status               public.product_status not null default 'draft',
  cancellation_policy  jsonb,                                         -- override de la del tutor (RN-11)
  -- Búsqueda por texto (RN-20): título + descripción, config 'spanish'.
  search_vector        tsvector generated always as (
                         to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(description, ''))
                       ) stored,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index products_tutor_id_idx on public.products (tutor_id);
create index products_status_idx   on public.products (status);
create index products_search_idx   on public.products using gin (search_vector);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ── product_categories: puente N–M Producto↔Categoría (RN-09). ───────────────
create table public.product_categories (
  product_id  uuid not null references public.products (id)   on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (product_id, category_id)
);

create index product_categories_category_id_idx on public.product_categories (category_id);

-- ============================================================================
-- RLS — default-deny (regla de oro 1). Este slice abre SOLO lectura.
-- ============================================================================
alter table public.categories        enable row level security;
alter table public.tutor_profiles     enable row level security;
alter table public.products           enable row level security;
alter table public.product_categories enable row level security;

-- categories: pública si is_active; admin ve todas.
create policy "categories_select_public"
  on public.categories for select
  using ( is_active );
create policy "categories_select_admin"
  on public.categories for select
  using ( public.has_role('admin') );

-- tutor_profiles: pública solo si approved; el tutor ve la suya; admin todo.
create policy "tutor_profiles_select_public"
  on public.tutor_profiles for select
  using ( approval_status = 'approved' );
create policy "tutor_profiles_select_own"
  on public.tutor_profiles for select
  using ( (select auth.uid()) = profile_id );
create policy "tutor_profiles_select_admin"
  on public.tutor_profiles for select
  using ( public.has_role('admin') );

-- products: pública si active + tutor aprobado (RN-24); el tutor ve los suyos; admin todo.
create policy "products_select_public"
  on public.products for select
  using (
    status = 'active'
    and exists (
      select 1
      from public.tutor_profiles tp
      where tp.profile_id = products.tutor_id
        and tp.approval_status = 'approved'
    )
  );
create policy "products_select_own"
  on public.products for select
  using ( (select auth.uid()) = tutor_id );
create policy "products_select_admin"
  on public.products for select
  using ( public.has_role('admin') );

-- product_categories: visible si su producto es visible públicamente; admin todo.
create policy "product_categories_select_public"
  on public.product_categories for select
  using (
    exists (
      select 1
      from public.products p
      join public.tutor_profiles tp on tp.profile_id = p.tutor_id
      where p.id = product_categories.product_id
        and p.status = 'active'
        and tp.approval_status = 'approved'
    )
  );
create policy "product_categories_select_admin"
  on public.product_categories for select
  using ( public.has_role('admin') );

-- ============================================================================
-- Grants de la Data API (auto-expose OFF, ver 20260703120000). Catálogo público
-- → anon + authenticated. SOLO select en este slice; la escritura llega con su
-- feature (EP-04 / US-202 / US-1101), con sus propios grants + políticas.
-- ============================================================================
grant select on public.categories        to anon, authenticated;
grant select on public.tutor_profiles     to anon, authenticated;
grant select on public.products           to anon, authenticated;
grant select on public.product_categories to anon, authenticated;

-- ── Datos de referencia: categorías base (REALES → van también a prod). ───────
insert into public.categories (name, slug, sort_order) values
  ('Matemáticas',             'matematicas',            10),
  ('Idiomas',                 'idiomas',                20),
  ('Programación',            'programacion',           30),
  ('Ciencias',                'ciencias',               40),
  ('Música',                  'musica',                 50),
  ('Arte y Diseño',           'arte-y-diseno',          60),
  ('Negocios',                'negocios',               70),
  ('Preparación de exámenes', 'preparacion-examenes',   80)
on conflict (slug) do nothing;
