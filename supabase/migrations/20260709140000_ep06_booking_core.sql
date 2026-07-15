-- ============================================================================
-- Enséñame Ya — EP-06/07 Fase 1 (S2): modelo de datos del dinero.
-- Tablas: bookings, sessions, payments (Doc 1 §1.4.10/1.4.11/1.4.12).
-- Máquinas: M4 booking_status (con delta `pending_acceptance`, RN-38), M5
-- session_status, M6 payment_status (Doc 2 §2.7/2.8/2.9).
--
-- REGLA DE ORO 2/7 — el dinero es server-side. El cliente **solo lee** lo suyo:
-- NO hay grant de INSERT/UPDATE/DELETE para `authenticated` sobre estas tablas.
-- La creación de la reserva (snapshot financiero) y toda transición de estado
-- llegan por **funciones controladas `SECURITY DEFINER`** (RPCs), historia por
-- historia: create_booking/confirm_payment (US-602/701/702), accept/reject
-- (US-606), cancel/refund (US-604), autocancel (US-605). El webhook HTTP real
-- (Edge Function + firma RN-34) se difiere al proveedor real (C-01); con PSP
-- simulado el "webhook" es una RPC idempotente. Esto también cierra US-1402.
--
-- Difuido a su historia: `payment_methods` (US-607), `payment_routing_rules`
-- (US-701), `payouts`/`payout_items` (EP-10, S3), `reviews` (EP-09, S3).
-- ============================================================================

-- ── Enums de las máquinas de estado ───────────────────────────────────────────
create type public.booking_status as enum (
  'pending_payment', 'pending_acceptance', 'confirmed',
  'in_progress', 'completed', 'cancelled', 'refunded'
);
create type public.session_status as enum (
  'scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'
);
create type public.payment_status as enum (
  'pending', 'authorized', 'paid', 'failed', 'partially_refunded', 'refunded'
);

-- ── bookings: la reserva (M4). Snapshots financieros congelados al crearla. ───
create table public.bookings (
  id                   uuid        primary key default gen_random_uuid(),
  student_id           uuid        not null references public.profiles (id)  on delete cascade,
  product_id           uuid        not null references public.products (id)  on delete restrict,
  tutor_id             uuid        not null references public.profiles (id)  on delete cascade, -- denormalizado (RLS/consultas)
  status               public.booking_status not null default 'pending_payment',
  pricing_model        public.pricing_model  not null,                        -- snapshot
  num_sessions         integer     not null check (num_sessions >= 1),        -- 1 o N (RN-12)
  session_duration_min integer     not null check (session_duration_min >= 30),
  currency             char(3)     not null,
  subtotal_amount      bigint      not null,                                  -- unidades menores
  total_amount         bigint      not null,
  tier_split_pct       numeric(5,2) not null,                                 -- snapshot del split (S-08)
  cancellation_policy  jsonb,                                                 -- snapshot de la política efectiva (RN-37)
  payer_country        char(2),                                              -- snapshot para ruteo (RN-15)
  payee_country        char(2),
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index bookings_student_id_idx on public.bookings (student_id);
create index bookings_tutor_id_idx   on public.bookings (tutor_id);
create index bookings_product_id_idx on public.bookings (product_id);
create index bookings_status_idx     on public.bookings (status);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ── sessions: la clase agendada (M5). Se crean al confirmar la reserva. ───────
create table public.sessions (
  id               uuid        primary key default gen_random_uuid(),
  booking_id       uuid        not null references public.bookings (id) on delete cascade,
  tutor_id         uuid        not null references public.profiles (id) on delete cascade,   -- denormalizado
  student_id       uuid        not null references public.profiles (id) on delete cascade,
  sequence_no      integer,                                                  -- 1..N dentro del paquete
  start_at         timestamptz not null,                                     -- UTC (RN-02)
  end_at           timestamptz not null check (end_at >= start_at + interval '30 minutes'),
  status           public.session_status not null default 'scheduled',
  daily_room_name  text,                                                     -- Daily → EP-08 (S3)
  daily_room_url   text,
  access_opens_at  timestamptz,                                              -- ventana de acceso (S-07, RN-18)
  access_closes_at timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index sessions_booking_id_idx on public.sessions (booking_id);
create index sessions_start_at_idx   on public.sessions (start_at);
create index sessions_status_idx     on public.sessions (status);
create index sessions_tutor_id_idx   on public.sessions (tutor_id);
create index sessions_student_id_idx on public.sessions (student_id);

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

-- ── payments: el cobro 1:1 con la reserva (M6, S-04). Solo muta server-side. ──
create table public.payments (
  id                  uuid        primary key default gen_random_uuid(),
  booking_id          uuid        not null unique references public.bookings (id) on delete cascade,
  status              public.payment_status not null default 'pending',
  currency            char(3)     not null,                                  -- moneda de cobro
  gross_amount        bigint      not null,                                  -- cobrado al alumno
  platform_fee_amount bigint      not null,                                  -- comisión (RN-08/13)
  tutor_net_amount    bigint      not null,                                  -- neto del tutor
  tier_split_pct      numeric(5,2) not null,                                 -- snapshot
  payer_country       char(2),
  payee_country       char(2),
  provider            text,                                                  -- resuelto (DP-01); no enum (S-16)
  provider_payment_id text,                                                  -- referencia externa
  provider_metadata   jsonb,
  settlement_currency char(3),                                               -- si difiere (DP-07)
  fx_rate             numeric,
  refunded_amount     bigint      not null default 0,                        -- acumulado (DP-03)
  paid_at             timestamptz,
  failed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index payments_status_idx      on public.payments (status);
create index payments_provider_idx    on public.payments (provider);
create index payments_provider_pid_idx on public.payments (provider_payment_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RLS — default-deny (regla 1). SOLO lectura de lo propio para el cliente; toda
-- escritura llega por RPC SECURITY DEFINER (bypassa RLS como owner). Sin grant
-- de INSERT/UPDATE/DELETE, el cliente no puede escribir aunque exista sesión.
-- ============================================================================
alter table public.bookings enable row level security;
alter table public.sessions enable row level security;
alter table public.payments enable row level security;

-- bookings: alumno lee las suyas; tutor las de sus productos; admin todo.
create policy "bookings_select_student"
  on public.bookings for select
  using ( (select auth.uid()) = student_id );
create policy "bookings_select_tutor"
  on public.bookings for select
  using ( (select auth.uid()) = tutor_id );
create policy "bookings_select_admin"
  on public.bookings for select
  using ( public.has_role('admin') );

-- sessions: solo participantes (alumno/tutor de la sesión); admin todo.
create policy "sessions_select_participant"
  on public.sessions for select
  using (
    (select auth.uid()) = student_id
    or (select auth.uid()) = tutor_id
  );
create policy "sessions_select_admin"
  on public.sessions for select
  using ( public.has_role('admin') );

-- payments: el alumno lee el de su reserva; el tutor los de sus reservas; admin.
create policy "payments_select_student"
  on public.payments for select
  using (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and b.student_id = (select auth.uid())
    )
  );
create policy "payments_select_tutor"
  on public.payments for select
  using (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and b.tutor_id = (select auth.uid())
    )
  );
create policy "payments_select_admin"
  on public.payments for select
  using ( public.has_role('admin') );

-- ── Grants: SOLO SELECT para authenticated (privadas → sin anon). La escritura
-- NO se otorga: la ejecutan las RPCs SECURITY DEFINER (S-15). ─────────────────
grant select on public.bookings to authenticated;
grant select on public.sessions to authenticated;
grant select on public.payments to authenticated;
