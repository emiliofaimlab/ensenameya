-- ============================================================================
-- Enséñame Ya — US-1103 (SCR-AD12): tiers de tutor y split de comisión.
-- RN-06: cada tutor pertenece a EXACTAMENTE un tier, que define su % de split.
-- RN-07: el admin edita el split y crea tiers nuevos.
-- S-08:  los cambios NO son retroactivos.
--
-- S-08 sale gratis y no hay que hacer nada para respetarlo: `bookings` y
-- `payments` ya congelan `tier_split_pct` en `create_booking` (EP-06 Fase 1).
-- Editar un tier no puede tocar reservas pasadas porque ninguna lo consulta:
-- leen su propio snapshot. Lo único que cambia aquí es de dónde sale el número
-- al CREAR la reserva — hasta hoy era un `75.00` hardcodeado (C-09).
--
-- C-09 sigue sin respuesta del cliente, pero ya no bloquea: los valores
-- 75/85/90 entran como **seed** (configuración), no acoplados al código
-- (regla de oro 8). Cuando el cliente responda, se editan por el panel.
-- ============================================================================

-- Idempotente a propósito: se reaplicó en dev para corregir `create_booking`
-- sin dejar de ser correcta en un ambiente limpio (prod).
create table if not exists public.tutor_tiers (
  id          uuid         primary key default gen_random_uuid(),
  name        text         not null,
  split_pct   numeric(5,2) not null check (split_pct >= 0 and split_pct <= 100),  -- % para el tutor
  is_default  boolean      not null default false,   -- el que se asigna al aprobar
  description text,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);

-- Como mucho un tier por defecto: si hubiera dos, `review_tutor` elegiría uno
-- al azar y el split del tutor sería una lotería. Índice parcial → la BD lo
-- impide en vez de confiar en la UI.
create unique index if not exists tutor_tiers_one_default_idx
  on public.tutor_tiers (is_default) where is_default;

drop trigger if exists tutor_tiers_set_updated_at on public.tutor_tiers;
create trigger tutor_tiers_set_updated_at
  before update on public.tutor_tiers
  for each row execute function public.set_updated_at();

-- ── Seed: los valores por defecto de C-09 ────────────────────────────────────
-- Solo si la tabla está vacía: re-ejecutar no duplica ni pisa lo que el admin
-- haya editado por el panel.
insert into public.tutor_tiers (name, split_pct, is_default, description)
select * from (values
  ('Tier 1', 75.00, true,  'Tier inicial: se asigna al aprobar a un tutor.'),
  ('Tier 2', 85.00, false, 'Tutores con trayectoria en la plataforma.'),
  ('Tier 3', 90.00, false, 'Tutores destacados.')
) as seed(name, split_pct, is_default, description)
where not exists (select 1 from public.tutor_tiers);

-- ── tutor_profiles.tier_id (diferido en EP-03, aterriza aquí) ───────────────
-- `on delete restrict`: un tier con tutores no se borra por accidente.
alter table public.tutor_profiles
  add column if not exists tier_id uuid references public.tutor_tiers (id) on delete restrict;

create index if not exists tutor_profiles_tier_id_idx on public.tutor_profiles (tier_id);

-- Los tutores ya aprobados se quedan sin tier al añadir la columna → se les
-- pone el default, que es el split (75) con el que ya venían reservando.
update public.tutor_profiles
   set tier_id = (select id from public.tutor_tiers where is_default)
 where tier_id is null;

-- ── RLS (Doc 1 §1.4.3): admin escribe; el tutor lee SU tier ─────────────────
alter table public.tutor_tiers enable row level security;

drop policy if exists "tutor_tiers_select_admin" on public.tutor_tiers;
create policy "tutor_tiers_select_admin"
  on public.tutor_tiers for select
  using ( public.has_role('admin') );

-- El tutor lee solo el suyo (para ver su % en ingresos, US-1001).
drop policy if exists "tutor_tiers_select_own" on public.tutor_tiers;
create policy "tutor_tiers_select_own"
  on public.tutor_tiers for select
  using (
    exists (
      select 1 from public.tutor_profiles tp
      where tp.profile_id = (select auth.uid()) and tp.tier_id = tutor_tiers.id
    )
  );

drop policy if exists "tutor_tiers_insert_admin" on public.tutor_tiers;
create policy "tutor_tiers_insert_admin"
  on public.tutor_tiers for insert
  with check ( public.has_role('admin') );

drop policy if exists "tutor_tiers_update_admin" on public.tutor_tiers;
create policy "tutor_tiers_update_admin"
  on public.tutor_tiers for update
  using ( public.has_role('admin') )
  with check ( public.has_role('admin') );

-- Sin política de DELETE a propósito: el AC pide crear y editar, no borrar
-- (default-deny se encarga). Un tier con tutores lo frena además el FK.
grant select, insert, update on public.tutor_tiers to authenticated;

-- El tutor NO se auto-asigna tier: `tier_id` queda fuera de sus column-grants
-- (US-1403). Lo mueve el admin por `assign_tutor_tier` o `review_tutor`.

-- ── create_booking: el split sale del tier, ya no de un literal ─────────────

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
  v_split    numeric(5,2);          -- US-1103: lo resuelve el tier del tutor (RN-06)
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

  -- US-1103 (RN-06): el split lo define el tier del tutor. Sin tier asignado
  -- cae al default; si tampoco hay default se PARA en vez de inventar un número
  -- — es dinero, no un valor cosmético.
  select tt.split_pct into v_split
    from public.tutor_profiles tp
    join public.tutor_tiers tt on tt.id = tp.tier_id
   where tp.profile_id = v_prod.tutor_id;

  if v_split is null then
    select split_pct into v_split from public.tutor_tiers where is_default;
  end if;

  if v_split is null then
    raise exception 'el tutor no tiene tier asignado y no hay tier por defecto'
      using errcode = 'check_violation';
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

-- ── Asignar tier a un tutor (RN-06) ────────────────────────────────────────
create or replace function public.assign_tutor_tier(
  p_tutor_id uuid,
  p_tier_id  uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin asigna tiers' using errcode = 'insufficient_privilege';
  end if;

  select name into v_name from public.tutor_tiers where id = p_tier_id;
  if v_name is null then
    raise exception 'tier no encontrado' using errcode = 'check_violation';
  end if;

  update public.tutor_profiles set tier_id = p_tier_id where profile_id = p_tutor_id;
  if not found then
    raise exception 'perfil de tutor no encontrado' using errcode = 'check_violation';
  end if;

  -- S-08: no se tocan reservas existentes; su split ya está congelado.
  return v_name;
end;
$$;

grant execute on function public.assign_tutor_tier(uuid, uuid) to authenticated;

-- ── review_tutor: al aprobar, asignar el tier por defecto ───────────────────
-- Doc 1 §1.4.4: "tier_id — Tier asignado (al aprobar)". Sin esto, un tutor
-- recién aprobado se quedaría sin tier y su primera reserva dependería del
-- fallback. Se le pone el default salvo que ya tuviera uno (no se pisa una
-- asignación manual del admin).
create or replace function public.review_tutor(
  p_tutor_id uuid,
  p_approve  boolean,
  p_reason   text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity public.identity_verification_status;
  v_new      public.tutor_approval_status;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin aprueba tutores'
      using errcode = 'insufficient_privilege';
  end if;

  select identity_verification_status into v_identity
    from public.tutor_profiles
   where profile_id = p_tutor_id;

  if v_identity is null then
    raise exception 'perfil de tutor no encontrado' using errcode = 'check_violation';
  end if;

  if p_approve then
    -- RN-29: no se aprueba a un tutor cuya identidad no está aprobada.
    if v_identity <> 'approved' then
      raise exception 'RN-29: la identidad debe estar aprobada (está: %)', v_identity
        using errcode = 'check_violation';
    end if;

    update public.tutor_profiles
       set approval_status = 'approved',
           approved_at     = now(),
           approval_notes  = null,
           -- US-1103 / RN-06: tier al aprobar; respeta el ya asignado.
           tier_id         = coalesce(tier_id, (select id from public.tutor_tiers where is_default))
     where profile_id = p_tutor_id
     returning approval_status into v_new;

    -- El rol `tutor` se otorga al aprobar (S-15: la escritura de roles nunca es
    -- del cliente). Idempotente: re-aprobar no duplica (PK user_id+role).
    insert into public.user_roles (user_id, role)
    values (p_tutor_id, 'tutor')
    on conflict do nothing;
  else
    update public.tutor_profiles
       set approval_status = 'rejected',
           approval_notes  = p_reason,
           approved_at     = null
     where profile_id = p_tutor_id
     returning approval_status into v_new;

    -- Rechazar/suspender a un tutor ya aprobado le retira el rol: sus productos
    -- dejan de ser publicables (RN-23) y salen del catálogo público (RN-24).
    delete from public.user_roles
     where user_id = p_tutor_id and role = 'tutor';
  end if;

  -- NTF-03 (stub, EP-12): avisar al tutor del resultado del review.
  return v_new::text;
end;
$$;
