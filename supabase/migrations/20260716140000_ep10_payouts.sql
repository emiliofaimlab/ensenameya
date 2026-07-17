-- ============================================================================
-- Enséñame Ya — EP-10: payouts a tutores (M7). US-1001..1004.
--
-- Proveedor de payout SIMULADO, como el PSP y Daily: la orquestación (devengo,
-- retención, lote, hold/release, retiro) se construye y prueba entera; el
-- `provider.payout()` real es una Edge Function con las credenciales.
--
-- DINERO → todo server-side (S-15/RN-26): `payouts`/`payout_items` sin grants de
-- escritura de cliente. El lote y el procesador corren por cron (service_role);
-- hold/release/retry son RPC de admin; el retiro self-service es RPC del tutor.
--
-- Retención (DP-02): default operable **7 días** (real 15/30 → se pasa como
-- parámetro, no acoplado). Agregación (DP-06): **lote por (tutor, moneda)** — la
-- tabla puente soporta 1:1 o lote sin migración.
-- S-29: un pago reembolsado antes de liquidar no entra (se filtra por estado);
-- el clawback tras `paid` es manual del admin (no automatizado, MVP).
-- ============================================================================

create type public.payout_status as enum (
  'pending', 'scheduled', 'processing', 'paid', 'failed', 'on_hold'
);

create table public.payouts (
  id                 uuid          primary key default gen_random_uuid(),
  tutor_id           uuid          not null references public.profiles (id) on delete cascade,
  status             public.payout_status not null default 'pending',
  currency           char(3)       not null,
  amount             bigint        not null,                 -- suma de payout_items (neto del tutor)
  provider           text,                                   -- resuelto por payee_country (DP-01)
  provider_payout_id text,
  provider_metadata  jsonb,
  retention_until    timestamptz,                            -- fin de retención (DP-02)
  scheduled_for      timestamptz,
  paid_at            timestamptz,
  failed_at          timestamptz,
  failure_reason     text,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now()
);

create index payouts_tutor_id_idx      on public.payouts (tutor_id);
create index payouts_status_idx        on public.payouts (status);
create index payouts_scheduled_for_idx on public.payouts (scheduled_for);

create table public.payout_items (
  id         uuid        primary key default gen_random_uuid(),
  payout_id  uuid        not null references public.payouts (id)  on delete cascade,
  payment_id uuid        not null unique references public.payments (id) on delete restrict, -- un pago ≤ 1 payout
  amount     bigint      not null,                            -- neto del tutor incluido
  created_at timestamptz not null default now()
);

create index payout_items_payout_id_idx on public.payout_items (payout_id);

create trigger payouts_set_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

-- ── RLS: el tutor lee lo suyo; admin todo; escritura solo server-side ───────
alter table public.payouts       enable row level security;
alter table public.payout_items  enable row level security;

create policy "payouts_select_own"
  on public.payouts for select
  using ( (select auth.uid()) = tutor_id );
create policy "payouts_select_admin"
  on public.payouts for select
  using ( public.has_role('admin') );

-- items: visibles si el payout es tuyo (o admin).
create policy "payout_items_select_own"
  on public.payout_items for select
  using (
    exists (
      select 1 from public.payouts p
      where p.id = payout_items.payout_id and p.tutor_id = (select auth.uid())
    )
  );
create policy "payout_items_select_admin"
  on public.payout_items for select
  using ( public.has_role('admin') );

-- Solo SELECT para el cliente; la escritura la hacen las RPC (S-15).
grant select on public.payouts      to authenticated;
grant select on public.payout_items to authenticated;

-- ── Núcleo compartido: agrupa los pagos liquidables de un tutor en un payout ─
-- "Liquidable" = pago 'paid' (no reembolsado), de una reserva completada, cuya
-- retención ya venció, y que aún no está en ningún payout_item. Devuelve el id
-- del payout creado (o null si no había nada). `p_ignore_retention` lo usa el
-- retiro self-service para permitir adelantar (aun así respeta la retención por
-- defecto salvo que se pida lo contrario).
create or replace function public.build_payout_for_tutor(
  p_tutor_id       uuid,
  p_retention_days int,
  p_status         public.payout_status default 'scheduled'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_retention_days);
  v_rec    record;
  v_payout uuid;
begin
  -- Se agrupa por MONEDA: sumar monedas distintas no tiene sentido (RN-13).
  for v_rec in
    select p.currency, sum(p.tutor_net_amount) as total, array_agg(p.id) as payment_ids
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where b.tutor_id = p_tutor_id
      and p.status = 'paid'                       -- reembolsados fuera (S-29)
      and b.status = 'completed'
      and b.completed_at <= v_cutoff              -- retención vencida (DP-02)
      and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
    group by p.currency
  loop
    insert into public.payouts (tutor_id, status, currency, amount, retention_until, scheduled_for)
    values (p_tutor_id, p_status, v_rec.currency, v_rec.total, v_cutoff, now())
    returning id into v_payout;

    insert into public.payout_items (payout_id, payment_id, amount)
    select v_payout, pid, p.tutor_net_amount
    from unnest(v_rec.payment_ids) as pid
    join public.payments p on p.id = pid;
  end loop;

  -- Con varias monedas se crea un payout por cada una; se devuelve el último.
  return v_payout;
end;
$$;

-- ── US-1002: lote semanal (crea payouts 'scheduled' de lo liquidable) ───────
create or replace function public.run_payout_batch(p_retention_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tutor uuid;
  v_made  int := 0;
begin
  for v_tutor in
    select distinct b.tutor_id
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where p.status = 'paid' and b.status = 'completed'
      and b.completed_at <= now() - make_interval(days => p_retention_days)
      and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
  loop
    if public.build_payout_for_tutor(v_tutor, p_retention_days, 'scheduled') is not null then
      v_made := v_made + 1;
    end if;
  end loop;
  return jsonb_build_object('tutors_paid_out', v_made);
end;
$$;

-- ── US-1002: procesador — ejecuta los 'scheduled' contra el proveedor ───────
-- Simulado: "paga" al instante. Con proveedor real, aquí una Edge Function
-- llama provider.payout() y el webhook confirma processing→paid.
create or replace function public.process_scheduled_payouts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid int;
begin
  with done as (
    update public.payouts
       set status = 'paid',
           provider = 'simulated',
           provider_payout_id = 'sim-payout-' || replace(id::text, '-', ''),
           paid_at = now()
     where status = 'scheduled'
       and scheduled_for <= now()
    returning id
  )
  select count(*) into v_paid from done;
  return jsonb_build_object('payouts_paid', v_paid);
end;
$$;

-- ── US-1004: retiro self-service del tutor (RN-40) ──────────────────────────
-- El tutor adelanta la liquidación de su saldo disponible (post-retención) sin
-- esperar al lote. Crea el payout 'scheduled'; el procesador lo paga.
create or replace function public.request_withdrawal(p_retention_days int default 7)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_payout uuid;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if not public.has_role('tutor') then
    raise exception 'solo un tutor puede retirar' using errcode = 'insufficient_privilege';
  end if;

  v_payout := public.build_payout_for_tutor(v_uid, p_retention_days, 'scheduled');
  if v_payout is null then
    raise exception 'no tienes saldo disponible para retirar' using errcode = 'check_violation';
  end if;
  return v_payout;
end;
$$;

grant execute on function public.request_withdrawal(int) to authenticated;

-- ── US-1003: gestión de payouts por el admin (M7) ───────────────────────────
create or replace function public.manage_payout(
  p_payout_id uuid,
  p_action    text                -- 'hold' | 'release' | 'retry'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.payout_status;
  v_new    public.payout_status;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin gestiona payouts' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.payouts where id = p_payout_id;
  if v_status is null then
    raise exception 'payout no encontrado' using errcode = 'no_data_found';
  end if;

  v_new := case
    -- Retener: desde pending/scheduled/failed (M7).
    when p_action = 'hold'    and v_status in ('pending','scheduled','failed') then 'on_hold'
    -- Liberar: on_hold → scheduled.
    when p_action = 'release' and v_status = 'on_hold' then 'scheduled'
    -- Reintentar: failed → scheduled.
    when p_action = 'retry'   and v_status = 'failed'  then 'scheduled'
    else null
  end;

  if v_new is null then
    raise exception 'acción "%" no válida desde el estado %', p_action, v_status
      using errcode = 'check_violation';
  end if;

  update public.payouts
     set status = v_new,
         scheduled_for = case when v_new = 'scheduled' then now() else scheduled_for end
   where id = p_payout_id;

  return v_new::text;
end;
$$;

grant execute on function public.manage_payout(uuid, text) to authenticated;

-- ── Grants de las funciones de cron (gotcha US-605: EXECUTE es PUBLIC) ───────
revoke execute on function public.run_payout_batch(int)          from public;
revoke execute on function public.process_scheduled_payouts()    from public;
revoke execute on function public.build_payout_for_tutor(uuid, int, public.payout_status) from public;
grant  execute on function public.run_payout_batch(int)          to service_role;
grant  execute on function public.process_scheduled_payouts()    to service_role;

-- Lote semanal (lunes 03:00 UTC) + procesador cada 10 min.
select cron.unschedule('run-payout-batch')       where exists (select 1 from cron.job where jobname = 'run-payout-batch');
select cron.unschedule('process-payouts')        where exists (select 1 from cron.job where jobname = 'process-payouts');
select cron.schedule('run-payout-batch', '0 3 * * 1', $cron$ select public.run_payout_batch(); $cron$);
select cron.schedule('process-payouts',  '*/10 * * * *', $cron$ select public.process_scheduled_payouts(); $cron$);
