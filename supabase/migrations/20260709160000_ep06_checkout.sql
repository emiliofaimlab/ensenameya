-- ============================================================================
-- Enséñame Ya — EP-06/07 Fase 3 (S2): checkout con PSP simulado.
--   · US-602 pagar reserva · US-701 ruteo por geografía · US-702 split por tier.
-- Todo el dinero es server-side: dos RPC SECURITY DEFINER (el cliente no tiene
-- grant de escritura sobre bookings/payments/sessions).
--   · create_booking  → valida slots (S-41), congela snapshots (total/split/
--     provider), crea booking(pending_payment)+payment(pending)+sessions(hold).
--   · confirm_payment → "webhook" simulado idempotente: paid → pending_acceptance
--     (o failed → cancelled + libera el hold). NTF-04 stub (EP-12).
-- ============================================================================

-- ── payment_routing_rules (Doc 1 §1.4.17, RN-16 → habilita DP-01) ─────────────
create table public.payment_routing_rules (
  id              uuid        primary key default gen_random_uuid(),
  payer_country   char(2),                                  -- NULL = comodín
  payee_country   char(2)     not null,                     -- país del tutor (RN-15)
  charge_provider text        not null,
  payout_provider text        not null,
  priority        integer     not null default 100,         -- menor = precede
  is_active       boolean     not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index payment_routing_rules_lookup_idx
  on public.payment_routing_rules (payee_country, payer_country, priority);

create trigger payment_routing_rules_set_updated_at
  before update on public.payment_routing_rules
  for each row execute function public.set_updated_at();

alter table public.payment_routing_rules enable row level security;
-- Solo admin (config); el runtime la lee dentro de las RPC (owner). Sin grant a
-- authenticated/anon hasta que exista la UI admin (EP-11, S3).
create policy "payment_routing_rules_admin_all"
  on public.payment_routing_rules for all
  using ( public.has_role('admin') )
  with check ( public.has_role('admin') );

-- Corredor demo (C-13 default: 1 corredor, PSP simulado). payee = país del tutor.
insert into public.payment_routing_rules (payee_country, payer_country, charge_provider, payout_provider, notes)
values ('VE', null, 'simulated', 'simulated', 'MVP — PSP simulado (C-01/C-13 default)');

-- S-41 a nivel BD: un tutor no puede tener dos sesiones activas en el mismo inicio.
-- Cierra la carrera entre validación y creación en create_booking.
create unique index sessions_no_double_booking_idx
  on public.sessions (tutor_id, start_at)
  where status not in ('cancelled', 'no_show');

-- ── create_booking: crea la reserva (snapshot financiero) + hold de slots ─────
create or replace function public.create_booking(
  p_product_id uuid,
  p_slots      timestamptz[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student  uuid := (select auth.uid());
  v_prod     record;
  v_required int;
  v_total    bigint;
  v_split    numeric(5,2) := 75.00;   -- ponytail: tier por defecto (C-09) hasta US-1103
  v_net      bigint;
  v_fee      bigint;
  v_payee    char(2) := 'VE';         -- ponytail: payout_country del tutor llega en S3/C-13
  v_provider text;
  v_avail    int;
  v_booking  uuid;
  v_slot     timestamptz;
  v_seq      int := 0;
begin
  if v_student is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select p.id, p.tutor_id, p.pricing_model, p.price_amount, p.currency,
         p.session_duration_min, p.package_num_sessions
    into v_prod
  from public.products p
  join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  where p.id = p_product_id and p.status = 'active';
  if v_prod.id is null then
    raise exception 'producto no reservable' using errcode = 'check_violation';
  end if;

  v_required := case when v_prod.pricing_model = 'per_package'
                     then coalesce(v_prod.package_num_sessions, 1) else 1 end;
  if coalesce(array_length(p_slots, 1), 0) <> v_required then
    raise exception 'debes elegir % horario(s)', v_required using errcode = 'check_violation';
  end if;

  -- Cada slot pedido debe seguir disponible (reglas − excepciones − ocupados, S-41).
  select count(*) into v_avail
  from unnest(p_slots) as s(slot)
  where exists (
    select 1 from public.get_available_slots(p_product_id, current_date, current_date + 30) g
    where g.slot_start = s.slot
  );
  if v_avail <> v_required then
    raise exception 'algún horario ya no está disponible' using errcode = 'check_violation';
  end if;

  -- Montos (unidades menores) según modelo (RN-10).
  v_total := case
    when v_prod.pricing_model = 'per_hour'
      then round(v_prod.price_amount * v_prod.session_duration_min / 60.0)
    else v_prod.price_amount   -- per_session (1) o per_package (precio del paquete = total)
  end;
  v_net := round(v_total * v_split / 100.0);
  v_fee := v_total - v_net;

  -- US-701: ruteo por geografía; sin regla activa → bloqueada (RN-33).
  select charge_provider into v_provider
  from public.payment_routing_rules
  where is_active and payee_country = v_payee and payer_country is null
  order by priority
  limit 1;
  if v_provider is null then
    raise exception 'sin ruta de pago disponible para el destino' using errcode = 'check_violation';
  end if;

  insert into public.bookings (
    student_id, product_id, tutor_id, status, pricing_model, num_sessions,
    session_duration_min, currency, subtotal_amount, total_amount, tier_split_pct, payee_country
  ) values (
    v_student, v_prod.id, v_prod.tutor_id, 'pending_payment', v_prod.pricing_model, v_required,
    v_prod.session_duration_min, v_prod.currency, v_total, v_total, v_split, v_payee
  ) returning id into v_booking;

  -- US-702: split congelado en el pago (server-side).
  insert into public.payments (
    booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount,
    tier_split_pct, payee_country, provider
  ) values (
    v_booking, 'pending', v_prod.currency, v_total, v_fee, v_net, v_split, v_payee, v_provider
  );

  -- Sessions = hold del slot (S-41). El índice único cierra la carrera.
  foreach v_slot in array p_slots loop
    v_seq := v_seq + 1;
    insert into public.sessions (booking_id, tutor_id, student_id, sequence_no, start_at, end_at, status)
    values (v_booking, v_prod.tutor_id, v_student, v_seq, v_slot,
            v_slot + make_interval(mins => v_prod.session_duration_min), 'scheduled');
  end loop;

  return v_booking;
exception
  when unique_violation then
    raise exception 'ese horario acaba de ser tomado' using errcode = 'check_violation';
end;
$$;

grant execute on function public.create_booking(uuid, timestamptz[]) to authenticated;

-- ── confirm_payment: "webhook" simulado idempotente (M6 → M4) ─────────────────
create or replace function public.confirm_payment(
  p_booking_id uuid,
  p_success    boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_status public.payment_status;
  v_new        public.booking_status;
begin
  -- El dueño de la reserva dispara el pago simulado (en real: webhook del PSP).
  if not exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.student_id = (select auth.uid())
  ) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  select status into v_pay_status from public.payments where booking_id = p_booking_id;

  -- Idempotencia (US-703 parcial): un pago ya resuelto no se reprocesa.
  if v_pay_status in ('paid', 'refunded', 'partially_refunded') then
    select status into v_new from public.bookings where id = p_booking_id;
    return v_new::text;
  end if;

  if p_success then
    update public.payments set status = 'paid', paid_at = now() where booking_id = p_booking_id;
    update public.bookings set status = 'pending_acceptance'
      where id = p_booking_id and status = 'pending_payment'
      returning status into v_new;
    -- NTF-04 (stub → EP-12): avisar al tutor que tiene una reserva por aceptar.
  else
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = p_booking_id
      returning status into v_new;
    -- Libera el hold del slot.
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled';
  end if;

  return v_new::text;
end;
$$;

grant execute on function public.confirm_payment(uuid, boolean) to authenticated;
