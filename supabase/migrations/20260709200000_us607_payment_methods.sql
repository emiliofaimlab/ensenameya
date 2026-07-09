-- ============================================================================
-- Enséñame Ya — US-607 (S2): card-on-file (RN-43).
-- Guarda una referencia tokenizada del método de pago. **El PAN nunca se
-- almacena** (no existe columna para él): solo el `provider_token` que devuelve
-- el PSP y datos de display (marca, últimos 4). Con PSP simulado (C-01) el token
-- es un stub. Es PII del usuario, no movimiento de dinero → el dueño hace CRUD
-- bajo RLS (S-15 aplica a payments/payouts, no aquí).
-- ============================================================================

create table public.payment_methods (
  id             uuid        primary key default gen_random_uuid(),
  profile_id     uuid        not null references public.profiles (id) on delete cascade,
  provider       text        not null,                 -- resuelto por el router (DP-01)
  provider_token text        not null,                 -- token reutilizable del PSP (RN-43)
  brand          text,                                 -- Visa, Mastercard, … (display)
  last4          char(4),                              -- solo display; NO es el PAN
  created_at     timestamptz not null default now()
);

create index payment_methods_profile_id_idx on public.payment_methods (profile_id);

alter table public.payment_methods enable row level security;

create policy "payment_methods_select_own"
  on public.payment_methods for select
  using ( (select auth.uid()) = profile_id );
create policy "payment_methods_insert_own"
  on public.payment_methods for insert to authenticated
  with check ( (select auth.uid()) = profile_id );
create policy "payment_methods_delete_own"
  on public.payment_methods for delete to authenticated
  using ( (select auth.uid()) = profile_id );

grant select, insert, delete on public.payment_methods to authenticated;
