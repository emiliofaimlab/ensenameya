-- ============================================================================
-- Enséñame Ya — Migración inicial (slice base de infraestructura)
-- Fija el PATRÓN del backend: enums + tablas núcleo de identidad + RLS
-- default-deny + triggers de auditoría + helper de roles.
--
-- Refs: Doc 0 (RN-01 timezone, RN-19 RLS), Doc 1 (modelo de datos / convención
-- de auditoría §1.2), Doc 3 (matriz de permisos / RLS).
-- Aplica de paso el hallazgo H-7 (user_roles con PK explícita).
-- El esquema completo (productos, reservas, pagos, payouts, etc.) se agrega
-- en migraciones posteriores, feature por feature, sobre este mismo patrón.
-- ============================================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────
-- Roles de aplicación (Doc 0: Alumno / Tutor / Admin). Un usuario puede tener
-- varios roles (tabla puente user_roles).
create type public.app_role as enum ('alumno', 'tutor', 'admin');

-- ── Utilidad: refrescar updated_at (convención de auditoría, Doc 1 §1.2) ───────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles: extiende 1:1 a auth.users (S-17). timezone obligatorio (RN-01). ─
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text,
  timezone      text        not null default 'UTC',   -- RN-01 / RN-02 (UTC + hora local)
  referral_code text,                                  -- S-18 (atribución Referral Factory)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── user_roles: puente usuario ↔ rol. PK compuesta (H-7). ─────────────────────
create table public.user_roles (
  user_id    uuid           not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz    not null default now(),
  primary key (user_id, role)                          -- H-7: PK explícita (no solo UNIQUE)
);

-- ── Helper de roles (SECURITY DEFINER para evitar recursión en RLS) ───────────
-- Responde "¿el usuario actual tiene este rol?" desde dentro de políticas,
-- sin que la política de user_roles se evalúe a sí misma de forma recursiva.
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = _role
  );
$$;

-- ============================================================================
-- RLS — default-deny (Doc 3).
-- Activar RLS sin políticas = nadie ve nada. Abrimos sólo lo necesario.
-- ============================================================================
alter table public.profiles   enable row level security;
alter table public.user_roles enable row level security;

-- profiles: cada quien lee/edita SU perfil; el admin lee todos.
create policy "profiles_select_own"
  on public.profiles for select
  using ( (select auth.uid()) = id );

create policy "profiles_select_admin"
  on public.profiles for select
  using ( public.has_role('admin') );

create policy "profiles_update_own"
  on public.profiles for update
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );
-- (Sin política de INSERT: el perfil lo crea el trigger handle_new_user.)

-- user_roles: cada quien lee SUS roles; el admin lee todos.
-- La ESCRITURA de roles queda FUERA del cliente (la hará un admin / service_role
-- vía función controlada — alineado con S-15). Por eso no hay políticas de
-- insert/update/delete: default-deny las bloquea.
create policy "user_roles_select_own"
  on public.user_roles for select
  using ( (select auth.uid()) = user_id );

create policy "user_roles_select_admin"
  on public.user_roles for select
  using ( public.has_role('admin') );

-- ============================================================================
-- Alta automática de perfil + rol al registrarse (patrón estándar Supabase).
-- Corre como SECURITY DEFINER porque escribe a raíz de un INSERT en auth.users.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, timezone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC')
  );

  -- Todo registro nace como 'alumno'. El rol 'tutor' se otorga tras la
  -- aprobación manual del admin (Doc 2: M1/M2).
  insert into public.user_roles (user_id, role)
  values (new.id, 'alumno');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
