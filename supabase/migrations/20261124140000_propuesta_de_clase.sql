-- ============================================================================
-- Enséñame Ya — Clasificados · fase 1: la PROPUESTA DE CLASE en el chat
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Un tutor acuerda «miércoles a las 2» por chat y no tiene cómo convertirlo en
-- una reserva: el alumno tiene que ir a su perfil, buscar la oferta y volver a
-- elegir la hora. Con esto el tutor elige UNA de sus ofertas y UN hueco de su
-- agenda, y el alumno recibe en el hilo una tarjeta con «Pagar» que abre el
-- checkout de siempre con todo ya elegido (`Clasificados-EnsenameYa-v1.pdf`,
-- fase 1; es la pieza que reutilizará la fase 2, los clasificados).
--
-- ── CERO CÓDIGO DE DINERO NUEVO ────────────────────────────────────────────
-- La propuesta NO guarda precio ni crea la reserva. «Pagar» lleva a
-- `/reservar/<oferta>/checkout?slots=<hora>`, que llama a `create_booking` y
-- cobra como cualquier compra: el importe sigue saliendo de la oferta en el
-- servidor (regla de oro 2). Lo único que cambia del camino del dinero es el
-- estado final: una oferta de aceptación manual pagada a partir de una
-- propuesta queda `confirmed` en vez de `pending_acceptance` — la propuso el
-- propio tutor, no hay nada que aceptar. Lo hace el trigger de §5, que NO
-- puede abortar nunca: corre dentro de `confirm_payment`, con el cobro hecho.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `class_proposals` tiene PK propia (`id`), no compuesta por sus FK: así
--   PostgREST no la toma por tabla puente y no vuelve ambiguos los embeds
--   (regla de oro 10).
-- · La propuesta viaja como un MENSAJE con `proposal_id`: llega por Realtime,
--   cuenta como no leído y dispara NTF-21 (`notify_new_message`) sin tocarlo.
--   NO gasta el cupo de 5 mensajes previos del tutor (§4).
-- · Solo ofertas 1:1 de UNA sesión, públicas, sin academia: paquetes,
--   grupales y academias quedan fuera de la fase 1.
-- · `send_conversation_message` se reescribe desde su versión viva (idéntica a
--   `20261009110000:102-198`, comprobado contra dev por hash el 24-nov) con un
--   único cambio, marcado «P ·».
-- ============================================================================

-- ── 1 · La propuesta ─────────────────────────────────────────────────────────
create table if not exists public.class_proposals (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.conversations (id) on delete cascade,
  tutor_id        uuid        not null references public.profiles (id) on delete cascade,
  student_id      uuid        not null references public.profiles (id) on delete cascade,
  product_id      uuid        not null references public.products (id) on delete cascade,
  start_at        timestamptz not null,
  status          text        not null default 'pending'
                  check (status in ('pending', 'paid', 'withdrawn')),
  booking_id      uuid        references public.bookings (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.class_proposals is
  'Clasificados fase 1: un tutor propone en el chat una de sus ofertas 1:1 y un hueco de su agenda. La escriben solo proponer_clase y el trigger bookings_propuesta_pagada (security definer); el par solo la lee. No guarda precio: sale de la oferta al pagar.';
comment on column public.class_proposals.start_at is
  'Inicio propuesto, UTC. Es un slot_start de get_available_slots en el momento de proponer; NO retiene el hueco.';
comment on column public.class_proposals.status is
  'pending → paid (el alumno pagó esa oferta a esa hora) | withdrawn (el tutor la sustituyó por otra).';
comment on column public.class_proposals.booking_id is
  'La reserva que la pagó. Null mientras está pendiente o si se retiró.';

-- Una viva por hilo: proponer otra retira la anterior.
create unique index if not exists class_proposals_una_viva
  on public.class_proposals (conversation_id) where status = 'pending';
-- La búsqueda del trigger y del checkout: alumno + oferta + hora.
create index if not exists class_proposals_alumno_idx
  on public.class_proposals (student_id, product_id, start_at) where status = 'pending';

drop trigger if exists class_proposals_set_updated_at on public.class_proposals;
create trigger class_proposals_set_updated_at
  before update on public.class_proposals
  for each row execute function public.set_updated_at();

alter table public.class_proposals enable row level security;

drop policy if exists "class_proposals_select_par" on public.class_proposals;
create policy "class_proposals_select_par"
  on public.class_proposals for select
  using ( (select auth.uid()) in (student_id, tutor_id) );

drop policy if exists "class_proposals_select_admin" on public.class_proposals;
create policy "class_proposals_select_admin"
  on public.class_proposals for select
  using ( public.has_role('admin') );

-- Sin políticas de escritura a propósito. Grants (auto-expose OFF, regla 9).
grant select on public.class_proposals to authenticated;
grant select on public.class_proposals to service_role;

-- ── 2 · El mensaje que la lleva ──────────────────────────────────────────────
alter table public.messages
  add column if not exists proposal_id uuid
    references public.class_proposals (id) on delete set null;

comment on column public.messages.proposal_id is
  'Clasificados fase 1: este mensaje ES una propuesta de clase; el chat pinta su tarjeta. El body es el texto de respaldo. No cuenta para el tope de mensajes previos.';

create index if not exists messages_proposal_idx
  on public.messages (proposal_id) where proposal_id is not null;

-- ── 3 · Proponer ─────────────────────────────────────────────────────────────
drop function if exists public.proponer_clase(uuid, uuid, timestamptz);
create function public.proponer_clase(
  p_conversation_id uuid,
  p_product_id      uuid,
  p_start           timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c   record;
  v_p   record;
  v_n   int;
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  -- El hilo, BLOQUEADO: serializa dos propuestas a la vez y el tope de abajo.
  select c.id, c.student_id, c.tutor_id, c.kind, c.blocked_at
    into v_c
    from public.conversations c
   where c.id = p_conversation_id
     for update;

  -- Misma respuesta para «no existe» y «no eres el tutor de este hilo».
  if v_c.id is null or v_c.kind <> 'pair' or v_c.student_id is null
     or v_c.tutor_id is distinct from v_uid then
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;
  if v_c.blocked_at is not null then
    raise exception 'esta conversación está bloqueada por moderación' using errcode = 'check_violation';
  end if;

  -- La oferta: tuya, activa, pública, 1:1 de una sesión, sin academia.
  select p.id, p.title
    into v_p
    from public.products p
    join public.tutor_profiles tp
      on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
   where p.id = p_product_id
     and p.tutor_id = v_uid
     and p.status = 'active'
     and p.visibility = 'public'
     and p.pricing_model in ('per_session', 'per_hour')
     and p.academy_id is null
     and p.group_template_id is null;
  if v_p.id is null then
    raise exception 'esa mentoría no se puede proponer: tiene que ser tuya, estar activa y ser de una sola sesión'
      using errcode = 'check_violation';
  end if;

  -- El horario: la MISMA llamada con la que create_booking_line lo valida al pagar.
  if not exists (
    select 1 from public.get_available_slots(p_product_id, current_date, current_date + 30) g
     where g.slot_start = p_start
  ) then
    raise exception 'ese horario ya no está libre en tu agenda; elige otro' using errcode = 'check_violation';
  end if;

  select count(*) into v_n
    from public.class_proposals
   where conversation_id = v_c.id and created_at > now() - interval '24 hours';
  if v_n >= 5 then
    raise exception 'ya enviaste 5 propuestas en este chat hoy; espera la respuesta del alumno'
      using errcode = 'check_violation';
  end if;

  -- Si el alumno está pagando la viva ahora mismo, no se le cambia debajo.
  if exists (
    select 1
      from public.class_proposals cp
      join public.bookings b
        on b.student_id = cp.student_id and b.product_id = cp.product_id
       and b.status = 'pending_payment'
      join public.sessions s on s.booking_id = b.id and s.start_at = cp.start_at
     where cp.conversation_id = v_c.id and cp.status = 'pending'
  ) then
    raise exception 'el alumno está pagando tu propuesta en este momento; espera unos minutos'
      using errcode = 'check_violation';
  end if;

  update public.class_proposals
     set status = 'withdrawn'
   where conversation_id = v_c.id and status = 'pending';

  insert into public.class_proposals (conversation_id, tutor_id, student_id, product_id, start_at)
  values (v_c.id, v_uid, v_c.student_id, v_p.id, p_start)
  returning id into v_id;

  -- `expires_at` y `booking_id` NULL explícitos: messages_caducidad_por_reserva.
  insert into public.messages (conversation_id, booking_id, sender_id, body, expires_at, proposal_id)
  values (v_c.id, null, v_uid,
          'Te propuse una clase: «' || v_p.title || '». Revisa el horario y págala desde aquí.',
          null, v_id);

  update public.conversations set last_message_at = now() where id = v_c.id;

  return v_id;
end;
$$;

comment on function public.proponer_clase(uuid, uuid, timestamptz) is
  'Clasificados fase 1 · el tutor del hilo de par propone una oferta suya (1:1, una sesión, pública, sin academia) a una hora libre de get_available_slots (30 días). Retira la propuesta viva anterior salvo que el alumno la esté pagando. Tope: 5 por hilo en 24 h. Deja un mensaje con proposal_id.';

revoke execute on function public.proponer_clase(uuid, uuid, timestamptz) from public, anon;
grant  execute on function public.proponer_clase(uuid, uuid, timestamptz) to authenticated;

-- ── 4 · El tope de 5 previo no cuenta las propuestas ─────────────────────────
CREATE OR REPLACE FUNCTION public.send_conversation_message(p_conversation_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid := (select auth.uid());
  v_c        record;
  v_body     text := btrim(coalesce(p_body, ''));
  v_msg      uuid;
  v_comprado boolean;
  v_mios     int;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if v_body = '' then
    raise exception 'el mensaje no puede estar vacío' using errcode = 'check_violation';
  end if;

  select id, student_id, tutor_id, blocked_at, kind into v_c
    from public.conversations
   where id = p_conversation_id
     and public.puede_ver_conversacion(id);   -- G · par o miembro del grupo
  if v_c.id is null then
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;

  if v_c.blocked_at is not null then
    raise exception 'esta conversación está bloqueada por moderación'
      using errcode = 'check_violation';
  end if;

  if v_c.kind = 'pair' then
  if not public.pair_can_chat(v_c.student_id, v_c.tutor_id) then
    raise exception 'para escribir aquí hace falta una mentoría reservada entre los dos'
      using errcode = 'check_violation';
  end if;

  v_comprado := public.pair_has_booking(v_c.student_id, v_c.tutor_id);

  if not v_comprado then
    select count(*) into v_mios
      from public.messages m
     where m.conversation_id = v_c.id
       and m.sender_id = v_uid
       and m.booking_id is null
       and m.proposal_id is null;   -- P · una propuesta no gasta cupo

    if v_mios >= public.pre_booking_message_cap() then
      if v_uid = v_c.student_id then
        raise exception 'has usado tus % mensajes antes de reservar; reserva una mentoría para seguir hablando con este tutor',
          public.pre_booking_message_cap() using errcode = 'check_violation';
      else
        raise exception 'has usado tus % mensajes antes de la reserva; podrás seguir escribiendo cuando el alumno reserve',
          public.pre_booking_message_cap() using errcode = 'check_violation';
      end if;
    end if;
  end if;
  end if;  -- G · fin de las reglas de par

  insert into public.messages (conversation_id, booking_id, sender_id, body, expires_at)
  values (v_c.id, null, v_uid, v_body, null)
  returning id into v_msg;

  update public.conversations set last_message_at = now() where id = v_c.id;

  return v_msg;
end;
$function$;

revoke execute on function public.send_conversation_message(uuid, text) from public;
revoke execute on function public.send_conversation_message(uuid, text) from anon;
grant  execute on function public.send_conversation_message(uuid, text) to authenticated;

-- ── 5 · Pagar una propuesta confirma la reserva ──────────────────────────────
-- 🔴 Corre DENTRO de confirm_payment (20260912110000:1359), con el dinero ya
-- cobrado: un error aquí revertiría el webhook. Por eso sale enseguida si no
-- aplica, hace UNA sentencia atómica (un proponer_clase concurrente no puede
-- dejar la reserva confirmada sin propuesta) y se traga cualquier fallo.
create or replace function public.propuesta_pagada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean := false;
begin
  if old.status is distinct from 'pending_payment'
     or new.status not in ('pending_acceptance', 'confirmed')
     or new.pricing_model not in ('per_session', 'per_hour') then
    return new;
  end if;

  begin
    update public.class_proposals cp
       set status = 'paid', booking_id = new.id
     where cp.status = 'pending'
       and cp.student_id = new.student_id
       and cp.product_id = new.product_id
       and exists (
         select 1 from public.sessions s
          where s.booking_id = new.id
            and s.start_at = cp.start_at
            and s.status <> 'cancelled');
    v_ok := found;
  exception when others then
    raise warning 'propuesta_pagada(%): %', new.id, sqlerrm;
    return new;
  end;

  if v_ok and new.status = 'pending_acceptance' then
    new.status := 'confirmed';
  end if;

  return new;
end;
$$;

comment on function public.propuesta_pagada() is
  'Clasificados fase 1 · al cobrarse una reserva 1:1 que coincide con una propuesta viva (alumno + oferta + hora), la marca paid y, si la oferta es de aceptación manual, deja la reserva confirmed: la propuso el tutor. Nunca aborta: corre dentro de confirm_payment.';

revoke execute on function public.propuesta_pagada() from public, anon, authenticated;

drop trigger if exists bookings_propuesta_pagada on public.bookings;
create trigger bookings_propuesta_pagada
  before update of status on public.bookings
  for each row execute function public.propuesta_pagada();
