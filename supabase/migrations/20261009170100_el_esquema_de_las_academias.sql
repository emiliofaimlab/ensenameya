-- ============================================================================
-- Enséñame Ya — el esquema de las academias (Academias Fase 1 · Fase C §10.1)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/REQUERIMIENTOS.md` §3.1, dentro de la Fase C de
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md`. La academia deja de ser una vitrina
-- (`20260915180000`, «no cobra, no recibe payouts»): ahora tiene
-- administrador, comisión, lista de alumnos y ofertas propias, y cobra.
-- SOLO ESQUEMA: las funciones de dinero (create_booking_line,
-- build_payout_for_academy, cancel_booking…) van en las siguientes.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · 🔴 LAS COLUMNAS DEL ACUERDO NO SON PÚBLICAS. `academies` tenía grant de
--   lectura de TABLA para anon/authenticated y una política que deja leer toda
--   academia activa: la comisión, las notas del acuerdo, la cuota, el país de
--   cobro, el dueño y los cambios pendientes habrían salido por
--   /rest/v1/academies a cualquiera. Se pasa a grant POR COLUMNA, solo las de
--   la cara pública. `academies_public` sigue igual (solo usa esas). Lo
--   privado lo leen el admin de EY y el dueño por RPC o service_role (A2/A3).
--
-- · `citext` NO está instalado (`20260912110000:79`): el correo de
--   `academy_members` es `text` con la normalización declarada en un check,
--   como `gifts`. REQUERIMIENTOS pedía citext; el efecto es el mismo.
--
-- · Regla 10: `academy_members` y `availability_requests` llevan PK `id`, y
--   PostgREST solo toma como puente una tabla cuyas FK están en su clave
--   compuesta (ver `docs/INVENTARIO-FASE-C.md`): no vuelven ambiguo
--   `profiles ↔ academies`. Lo que SÍ hay que nombrar al embeber: las DOS FK
--   de `availability_requests` a `profiles` (tutor_id y decided_by).
--
-- · `products_guarda_academia` (trigger): `products` tiene grant de escritura
--   completo para authenticated (`20260709120000:78`). Sin el guard, un tutor
--   independiente se colgaba de cualquier academia poniendo su `academy_id`
--   —y su dinero iría a esa academia— y un tutor de academia vendía por su
--   cuenta (RA-03). ⚠️ Solo vigila la COHERENCIA tutor ↔ academia, no quién
--   edita: que la oferta la gestione la academia y no su tutor (RA-05) se
--   resuelve en el portal (A3).
--
-- · ⚠️ ANTES DE LLEVARLO A PROD: el guard rechaza que un tutor con
--   `tutor_profiles.academy_id` cree mentorías independientes. Los tutores
--   colgados de la vitrina del 15-sep (en dev: Camila, Andrés, Mateo, Sofía,
--   Tomás) ya no podrán. Mirar en prod cuántos hay.
--
-- · Las ofertas privadas (RA-07) se esconden aquí: `products_select_public`
--   pasa a exigir visibility = 'public', y una política nueva deja leer las
--   privadas a la lista activa y al dueño. El tutor (products_select_own), el
--   admin y quien ya reservó (products_select_booked) siguen como estaban.
-- ============================================================================


-- ── 1 · academies: el acuerdo y la cara pública ─────────────────────────────
alter table public.academies
  add column if not exists owner_id uuid
    constraint academies_owner_id_fkey references public.profiles (id) on delete set null,
  add column if not exists commission_pct numeric(5,2)
    check (commission_pct is null or commission_pct between 0 and 100),
  add column if not exists fixed_fee_amount bigint check (fixed_fee_amount is null or fixed_fee_amount >= 0),
  add column if not exists fixed_fee_currency char(3) check (fixed_fee_currency is null or fixed_fee_currency ~ '^[A-Z]{3}$'),
  add column if not exists fixed_fee_period text,
  add column if not exists included_free_classes text,
  add column if not exists agreement_starts_on date,
  add column if not exists agreement_notes text,
  add column if not exists payout_country char(2) check (payout_country is null or payout_country ~ '^[A-Z]{2}$'),
  add column if not exists cover_path text,
  add column if not exists policies_url text,
  add column if not exists pending_changes jsonb,
  add column if not exists allow_public_offers boolean not null default true;

comment on table public.academies is
  'Academias (docs/REQUERIMIENTOS.md). Desde 20261009170100 cobran: tienen administrador (owner_id), comisión, lista de alumnos (academy_members) y ofertas propias (products.academy_id). Las columnas del acuerdo NO son públicas: grant por columna.';
comment on column public.academies.owner_id is
  'RA-02 · el administrador de la academia: entra a /academia y es el BENEFICIARIO de sus payouts (payouts.tutor_id). NULL hasta que acepta la invitación.';
comment on column public.academies.commission_pct is
  'RA-21/22 · % que se QUEDA LA ACADEMIA de cada clase de pago, misma semántica que tutor_tiers.split_pct (se congela en bookings.tier_split_pct). NULL = sin acuerdo: solo puede publicar ofertas gratuitas. Cambiarlo solo afecta a reservas nuevas.';
comment on column public.academies.fixed_fee_amount is 'RA-21 · cuota fija pactada, en unidades mínimas. INFORMATIVA: se factura fuera de la plataforma.';
comment on column public.academies.fixed_fee_period is 'RA-21 · periodicidad de la cuota fija, texto libre (no hay valores pactados todavía).';
comment on column public.academies.included_free_classes is 'RA-21 · clases gratuitas incluidas en el acuerdo, texto libre.';
comment on column public.academies.agreement_notes is 'RA-21 · lo que se pactó. Solo lo ve el admin de EY.';
comment on column public.academies.payout_country is
  'RA-09/11 · país donde cobra la academia (ISO-3166-1 alpha-2). Se congela como payee_country en sus reservas y decide sus rieles de payout (docs/DICTADO-PAGOS.md).';
comment on column public.academies.pending_changes is
  'RA-06 · cambios del perfil público propuestos por la academia y pendientes de aprobación de EY. Mientras tanto se pinta la versión vigente (las columnas de la fila).';
comment on column public.academies.allow_public_offers is 'Permiso de EY: false = la academia solo puede publicar ofertas privadas.';
comment on column public.academies.status is
  'draft = no visible; active = visible y reservable; suspended = invisible y sin reservas nuevas, las existentes siguen (RA-20).';

-- La cara pública, columna a columna.
revoke select on public.academies from anon, authenticated;
grant select (id, slug, name, tagline, description, logo_path, cover_path, brand_color,
              website, policies_url, status, created_at, updated_at)
  on public.academies to anon, authenticated;


-- ── 2 · academy_members: la lista y las invitaciones ────────────────────────
create table if not exists public.academy_members (
  id          uuid        primary key default gen_random_uuid(),
  academy_id  uuid        not null
    constraint academy_members_academy_id_fkey references public.academies (id) on delete cascade,
  email       text        not null check (email = lower(btrim(email)) and email like '%_@_%'),
  profile_id  uuid
    constraint academy_members_profile_id_fkey references public.profiles (id) on delete set null,
  role        text        not null check (role in ('admin', 'tutor', 'student')),
  status      text        not null default 'invited' check (status in ('invited', 'active', 'removed')),
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz,
  token       text        not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint academy_members_unico unique (academy_id, email, role)
);

comment on table public.academy_members is
  'Lista de alumnos de una academia e invitaciones (admin, tutor, alumno) en una sola tabla. Una fila por (academia, correo, rol). Se escribe por RPC (A2/A3).';
comment on column public.academy_members.email is 'Correo invitado, en minúsculas y sin espacios (citext no está instalado). Es la llave con la que la invitación encuentra a su dueño al registrarse.';
comment on column public.academy_members.profile_id is 'La cuenta que aceptó. NULL mientras la invitación está pendiente.';
comment on column public.academy_members.status is 'invited = pendiente; active = en la lista (RA-07: ve las ofertas privadas); removed = fuera, se conserva el rastro.';
comment on column public.academy_members.token is 'Secreto del enlace de invitación. Sin grant de columna para authenticated: ni el dueño de la academia lo lee.';

create index if not exists academy_members_profile_idx on public.academy_members (profile_id) where profile_id is not null;

drop trigger if exists academy_members_set_updated_at on public.academy_members;
create trigger academy_members_set_updated_at
  before update on public.academy_members
  for each row execute function public.set_updated_at();


-- ── Helpers de pertenencia (SECURITY DEFINER: las políticas los llaman) ─────
create or replace function public.es_admin_de_academia(p_academy uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.academies a
                  where a.id = p_academy and a.owner_id = (select auth.uid()))
$$;

create or replace function public.es_alumno_de_academia(p_academy uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.academy_members m
                  where m.academy_id = p_academy and m.role = 'student'
                    and m.status = 'active' and m.profile_id = (select auth.uid()))
$$;

comment on function public.es_admin_de_academia(uuid) is 'RA-02 · ¿el usuario actual es el administrador (owner_id) de esta academia?';
comment on function public.es_alumno_de_academia(uuid) is 'RA-07 · ¿el usuario actual está ACTIVO en la lista de alumnos de esta academia?';

revoke execute on function public.es_admin_de_academia(uuid) from public, anon;
revoke execute on function public.es_alumno_de_academia(uuid) from public, anon;
grant  execute on function public.es_admin_de_academia(uuid) to authenticated, service_role;
grant  execute on function public.es_alumno_de_academia(uuid) to authenticated, service_role;

alter table public.academy_members enable row level security;

drop policy if exists "academy_members_select_propio" on public.academy_members;
create policy "academy_members_select_propio"
  on public.academy_members for select to authenticated
  using ( profile_id = (select auth.uid()) );

drop policy if exists "academy_members_select_academia" on public.academy_members;
create policy "academy_members_select_academia"
  on public.academy_members for select to authenticated
  using ( public.es_admin_de_academia(academy_id) );

drop policy if exists "academy_members_select_admin" on public.academy_members;
create policy "academy_members_select_admin"
  on public.academy_members for select to authenticated
  using ( public.has_role('admin') );

grant select (id, academy_id, email, profile_id, role, status, invited_at, accepted_at, created_at, updated_at)
  on public.academy_members to authenticated;
grant select, insert, update, delete on public.academy_members to service_role;


-- ── 3 · availability_requests: el tutor pide, la academia decide (RA-14) ────
create table if not exists public.availability_requests (
  id          uuid        primary key default gen_random_uuid(),
  tutor_id    uuid        not null
    constraint availability_requests_tutor_id_fkey references public.profiles (id) on delete cascade,
  academy_id  uuid        not null
    constraint availability_requests_academy_id_fkey references public.academies (id) on delete cascade,
  date        date        not null,
  start_time  time,
  end_time    time,
  reason      text,
  status      text        not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by  uuid
    constraint availability_requests_decided_by_fkey references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Día completo o rango, como availability_exceptions (20260709130000:44).
  constraint availability_requests_rango check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

comment on table public.availability_requests is
  'RA-14 · el tutor de academia PIDE un día libre o un bloqueo; la academia lo acepta (se crea la excepción) o lo rechaza. ⚠️ Dos FK a profiles (tutor_id, decided_by): al embeber, nombrar la FK.';

create index if not exists availability_requests_academia_idx on public.availability_requests (academy_id, status);

drop trigger if exists availability_requests_set_updated_at on public.availability_requests;
create trigger availability_requests_set_updated_at
  before update on public.availability_requests
  for each row execute function public.set_updated_at();

alter table public.availability_requests enable row level security;

drop policy if exists "availability_requests_select_tutor" on public.availability_requests;
create policy "availability_requests_select_tutor"
  on public.availability_requests for select to authenticated
  using ( tutor_id = (select auth.uid()) );

drop policy if exists "availability_requests_select_academia" on public.availability_requests;
create policy "availability_requests_select_academia"
  on public.availability_requests for select to authenticated
  using ( public.es_admin_de_academia(academy_id) );

drop policy if exists "availability_requests_select_admin" on public.availability_requests;
create policy "availability_requests_select_admin"
  on public.availability_requests for select to authenticated
  using ( public.has_role('admin') );

grant select on public.availability_requests to authenticated;
grant select, insert, update on public.availability_requests to service_role;


-- ── 4 · products: ofertas de academia (RA-23) ───────────────────────────────
alter table public.products
  add column if not exists academy_id uuid
    constraint products_academy_id_fkey references public.academies (id) on delete restrict,
  add column if not exists visibility text not null default 'public',
  add column if not exists assignment_mode text not null default 'booking';

alter table public.products drop constraint if exists products_ajustes_de_academia;
alter table public.products add constraint products_ajustes_de_academia check (
  visibility in ('public', 'private')
  and assignment_mode in ('booking', 'assigned')
  -- Privada o asignada solo tiene sentido dentro de una academia. Entre los
  -- tres ajustes no hay más restricciones (RA-23).
  and (visibility = 'public' or academy_id is not null)
  and (assignment_mode = 'booking' or academy_id is not null)
);

comment on column public.products.academy_id is
  'RA-03/09 · la academia dueña de la oferta. NULL = oferta de un tutor independiente. Su dinero va a la academia (bookings.academy_id congela este valor).';
comment on column public.products.visibility is 'RA-07/23 · public = catálogo y página de la academia; private = solo la lista activa de la academia.';
comment on column public.products.assignment_mode is 'RA-23/24 · booking = la reserva el alumno; assigned = la academia asigna un horario fijo a alumnos de su lista.';

create index if not exists products_academy_idx on public.products (academy_id) where academy_id is not null;

create or replace function public.products_guarda_academia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia uuid;
begin
  select tp.academy_id into v_academia
    from public.tutor_profiles tp where tp.profile_id = new.tutor_id;

  -- Una oferta de academia solo la da un tutor DE ESA academia.
  if new.academy_id is not null and new.academy_id is distinct from v_academia then
    raise exception 'esta oferta solo la puede dar un tutor de su academia'
      using errcode = 'check_violation';
  end if;

  -- RA-03: un tutor de academia no vende por su cuenta.
  if new.academy_id is null and v_academia is not null then
    raise exception 'un tutor de academia no puede publicar mentorías propias: hace falta otra cuenta'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.products_guarda_academia() is
  'RA-03 · coherencia tutor ↔ academia de una oferta. Existe porque products tiene grant de escritura completo para authenticated. Solo salta al crear la oferta o al cambiarle tutor o academia.';

drop trigger if exists products_guarda_academia on public.products;
create trigger products_guarda_academia
  before insert or update of academy_id, tutor_id on public.products
  for each row execute function public.products_guarda_academia();

-- Ofertas privadas fuera de la lectura pública; dentro para su lista y su dueño.
drop policy if exists "products_select_public" on public.products;
create policy "products_select_public"
  on public.products for select
  using (
    status = 'active'
    and visibility = 'public'
    and exists (select 1 from public.tutor_profiles tp
                 where tp.profile_id = products.tutor_id
                   and tp.approval_status = 'approved')
  );

drop policy if exists "products_select_academia" on public.products;
create policy "products_select_academia"
  on public.products for select
  to authenticated
  using (
    academy_id is not null
    and (public.es_alumno_de_academia(academy_id) or public.es_admin_de_academia(academy_id))
  );

comment on policy "products_select_academia" on public.products is
  'RA-07 · la oferta (privada o no) de una academia la leen su lista activa y su administrador. Las públicas además por products_select_public; el tutor por products_select_own; el admin de EY por products_select_admin.';


-- ── 5 · bookings: lo que se congela de la academia ──────────────────────────
alter table public.bookings
  add column if not exists academy_id uuid
    constraint bookings_academy_id_fkey references public.academies (id) on delete restrict,
  add column if not exists needs_reassignment boolean not null default false,
  add column if not exists mandatory boolean not null default false;

comment on column public.bookings.academy_id is
  'RA-09/10 · la academia de la oferta, CONGELADA al reservar. No nulo = el dinero es de la academia: no entra en el saldo ni en los payouts del tutor.';
comment on column public.bookings.needs_reassignment is 'RA-17 · el tutor salió de la academia: «Sin tutor: reasignar». La academia la reasigna, la reagenda o la cancela.';
comment on column public.bookings.mandatory is 'RA-24/25 · clase asignada por la academia: el ALUMNO no la cancela ni la reagenda, y expire_stale_bookings no la caduca.';

create index if not exists bookings_academy_idx on public.bookings (academy_id) where academy_id is not null;


-- ── 6 · payouts: a qué academia corresponde ─────────────────────────────────
alter table public.payouts
  add column if not exists academy_id uuid
    constraint payouts_academy_id_fkey references public.academies (id) on delete restrict;

comment on column public.payouts.academy_id is
  'RA-10/11 · payout de una academia. NULL = payout de un tutor. Con valor, tutor_id es el administrador de la academia (owner_id) y no quien dio las clases.';
comment on column public.payouts.tutor_id is
  'El BENEFICIARIO del payout: el tutor, o el administrador (owner_id) de la academia cuando academy_id no es nulo. Todo lo que resuelve la cuenta de destino por esta columna funciona igual para los dos.';
