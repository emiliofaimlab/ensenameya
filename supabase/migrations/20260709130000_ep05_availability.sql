-- ============================================================================
-- Enséñame Ya — EP-05 (S2): Disponibilidad del tutor (S-03, Doc 1 §1.4.8/1.4.9).
--   · US-501 availability_rules      → plantilla semanal recurrente.
--   · US-502 availability_exceptions → block/open puntuales que la sobrescriben.
-- Horas en `time` interpretadas en el timezone del tutor (Doc 1 §1.3, RN-02): la
-- BD guarda la hora de pared; el cálculo de slots (US-601) la combina con la tz
-- del tutor → instantes UTC. availability_* NO es dinero → escritura directa del
-- tutor bajo RLS (regla 2 aplica a payments/bookings).
-- RLS: lectura pública si el tutor está `approved` (mostrar horarios); el tutor
-- gestiona los suyos; admin lee todo. Espeja el patrón de EP-03/EP-04.
-- ============================================================================

create type public.availability_exception_type as enum ('block', 'open');

-- ── availability_rules: plantilla semanal recurrente ──────────────────────────
create table public.availability_rules (
  id         uuid        primary key default gen_random_uuid(),
  tutor_id   uuid        not null references public.profiles (id) on delete cascade,
  weekday    smallint    not null check (weekday between 0 and 6),   -- 0=domingo
  start_time time        not null,
  end_time   time        not null check (end_time > start_time),
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index availability_rules_tutor_id_idx on public.availability_rules (tutor_id);

create trigger availability_rules_set_updated_at
  before update on public.availability_rules
  for each row execute function public.set_updated_at();

-- ── availability_exceptions: block/open puntuales (sobrescriben la regla) ──────
create table public.availability_exceptions (
  id         uuid        primary key default gen_random_uuid(),
  tutor_id   uuid        not null references public.profiles (id) on delete cascade,
  date       date        not null,
  type       public.availability_exception_type not null,           -- block | open
  start_time time,                                                  -- rango parcial opcional…
  end_time   time,                                                  -- …ambos o ninguno
  reason     text,
  created_at timestamptz not null default now(),
  -- Rango o día completo, nunca a medias ni invertido.
  check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index availability_exceptions_tutor_date_idx
  on public.availability_exceptions (tutor_id, date);

-- ============================================================================
-- RLS — default-deny (regla 1).
-- ============================================================================
alter table public.availability_rules      enable row level security;
alter table public.availability_exceptions enable row level security;

-- availability_rules
create policy "availability_rules_select_public"
  on public.availability_rules for select
  using (
    is_active
    and exists (
      select 1 from public.tutor_profiles tp
      where tp.profile_id = availability_rules.tutor_id
        and tp.approval_status = 'approved'
    )
  );
create policy "availability_rules_select_own"
  on public.availability_rules for select
  using ( (select auth.uid()) = tutor_id );
create policy "availability_rules_select_admin"
  on public.availability_rules for select
  using ( public.has_role('admin') );
create policy "availability_rules_insert_own"
  on public.availability_rules for insert to authenticated
  with check ( (select auth.uid()) = tutor_id );
create policy "availability_rules_update_own"
  on public.availability_rules for update to authenticated
  using ( (select auth.uid()) = tutor_id )
  with check ( (select auth.uid()) = tutor_id );
create policy "availability_rules_delete_own"
  on public.availability_rules for delete to authenticated
  using ( (select auth.uid()) = tutor_id );

-- availability_exceptions (misma política que las reglas)
create policy "availability_exceptions_select_public"
  on public.availability_exceptions for select
  using (
    exists (
      select 1 from public.tutor_profiles tp
      where tp.profile_id = availability_exceptions.tutor_id
        and tp.approval_status = 'approved'
    )
  );
create policy "availability_exceptions_select_own"
  on public.availability_exceptions for select
  using ( (select auth.uid()) = tutor_id );
create policy "availability_exceptions_select_admin"
  on public.availability_exceptions for select
  using ( public.has_role('admin') );
create policy "availability_exceptions_insert_own"
  on public.availability_exceptions for insert to authenticated
  with check ( (select auth.uid()) = tutor_id );
create policy "availability_exceptions_update_own"
  on public.availability_exceptions for update to authenticated
  using ( (select auth.uid()) = tutor_id )
  with check ( (select auth.uid()) = tutor_id );
create policy "availability_exceptions_delete_own"
  on public.availability_exceptions for delete to authenticated
  using ( (select auth.uid()) = tutor_id );

-- ── Grants de la Data API (auto-expose OFF). Lectura pública → anon; escritura
-- del tutor → authenticated (acotada por RLS). ───────────────────────────────
grant select, insert, update, delete on public.availability_rules      to authenticated;
grant select, insert, update, delete on public.availability_exceptions to authenticated;
grant select on public.availability_rules      to anon;
grant select on public.availability_exceptions to anon;
