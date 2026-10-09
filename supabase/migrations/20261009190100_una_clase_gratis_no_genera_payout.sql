-- ============================================================================
-- Enséñame Ya — una clase gratis de academia no genera orden de pago
--
-- Arreglo de `20261009190000`, encontrado en su propia prueba del criterio 5
-- de `docs/REQUERIMIENTOS.md` §3.3 («una oferta a 0 … no genera orden de
-- pago»). `build_payout_for_academy` recogía también los pagos de importe 0
-- de las ofertas gratuitas (RA-08): el payout de la academia salía con un
-- item de 0 al lado del bueno, y una academia con solo clases gratis habría
-- recibido una orden de pago de 0. Ahora el builder y la selección del lote
-- piden `gross_amount > 0`. Esos pagos se quedan sin payout_item, que es lo
-- correcto: no hay nada que pagar.
--
-- El builder del TUTOR no se toca: un tutor independiente no publica ofertas
-- a 0 (el checkout sin tarjeta de 20260921120000 es un crédito que cubre un
-- precio, no un precio 0).
-- ============================================================================

create or replace function public.build_payout_for_academy(
  p_academy        uuid,
  p_retention_days integer,
  p_status         public.payout_status default 'scheduled'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_retention_days);
  v_owner  uuid;
  v_rec    record;
  v_payout uuid;
begin
  select a.owner_id into v_owner from public.academies a where a.id = p_academy;
  if v_owner is null then
    return null;   -- sin administrador no hay beneficiario; el dinero espera
  end if;

  -- Misma agrupación que el builder del tutor: un payout por moneda, caja y
  -- país, para que cada orden sea pagable por un solo riel.
  for v_rec in
    select p.currency,
           coalesce(p.funding_provider, p.provider) as funding_provider,
           p.payee_country                          as payee_country,
           sum(public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)) as total,
           sum(public.parte_del_tutor(p.platform_funded_amount, p.gross_amount, p.refunded_amount)) as falta,
           array_agg(p.id)                          as payment_ids
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where b.academy_id = p_academy
       and p.gross_amount > 0                      -- RA-08: una gratis no genera orden de pago
       and (p.status = 'paid'
            or (p.status = 'partially_refunded' and b.pricing_model = 'group'))
       and b.status = 'completed'
       and b.completed_at <= v_cutoff              -- retención vencida (DP-02), igual que los tutores
       and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
     group by p.currency, coalesce(p.funding_provider, p.provider), p.payee_country
  loop
    insert into public.payouts (tutor_id, academy_id, status, currency, amount,
                                funding_provider, payee_country,
                                platform_funded_amount,
                                retention_until, scheduled_for)
    values (v_owner, p_academy, p_status, v_rec.currency, v_rec.total,
            v_rec.funding_provider, v_rec.payee_country,
            coalesce(v_rec.falta, 0), v_cutoff, now())
    returning id into v_payout;

    insert into public.payout_items (payout_id, payment_id, amount)
    select v_payout, pid, public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)
      from unnest(v_rec.payment_ids) as pid
      join public.payments p on p.id = pid;
  end loop;

  return v_payout;
end;
$$;

create or replace function public.run_payout_batch(p_retention_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tutor     uuid;
  v_academia  uuid;
  v_made      int := 0;
  v_made_ac   int := 0;
  v_tutores   uuid[];
  v_academias uuid[];
  v_hay_cred  boolean := to_regclass('public.credits') is not null;
begin
  -- Tutores con algo que cobrar. 🔴 ARREGLO: la MISMA regla que
  -- build_payout_for_tutor (paid, o grupal prorrateada) y sin lo de academia.
  select coalesce(array_agg(distinct b.tutor_id), '{}'::uuid[])
    into v_tutores
    from public.payments p
    join public.bookings b on b.id = p.booking_id
   where (p.status = 'paid'
          or (p.status = 'partially_refunded' and b.pricing_model = 'group'))
     and b.academy_id is null
     and b.status = 'completed'
     and b.completed_at <= now() - make_interval(days => p_retention_days)
     and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id);

  -- Recompensas en dinero pendientes (sin cambios).
  if v_hay_cred then
    select v_tutores || coalesce(array_agg(distinct c.beneficiary_id), '{}'::uuid[])
      into v_tutores
      from public.credits c
     where c.beneficiary_id is not null
       and c.destino = 'payout'
       and c.status  = 'active'
       and c.amount  > c.consumed_amount
       and not exists (select 1 from public.payout_adjustments pa where pa.credit_id = c.id);
  end if;

  for v_tutor in select distinct u.tutor_id from unnest(v_tutores) as u(tutor_id) order by 1
  loop
    if public.build_payout_for_tutor(v_tutor, p_retention_days, 'scheduled') is not null then
      v_made := v_made + 1;
    end if;
  end loop;

  -- A · academias con dinero y con administrador a quien pagar.
  select coalesce(array_agg(distinct b.academy_id), '{}'::uuid[])
    into v_academias
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    join public.academies a on a.id = b.academy_id
   where a.owner_id is not null
     and p.gross_amount > 0                        -- RA-08
     and (p.status = 'paid'
          or (p.status = 'partially_refunded' and b.pricing_model = 'group'))
     and b.status = 'completed'
     and b.completed_at <= now() - make_interval(days => p_retention_days)
     and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id);

  foreach v_academia in array v_academias loop
    if public.build_payout_for_academy(v_academia, p_retention_days, 'scheduled') is not null then
      v_made_ac := v_made_ac + 1;
    end if;
  end loop;

  return jsonb_build_object('tutors_paid_out', v_made, 'academies_paid_out', v_made_ac);
end;
$$;
