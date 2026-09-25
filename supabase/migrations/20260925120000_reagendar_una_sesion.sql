-- ============================================================================
-- Enséñame Ya — Reagendar una sesión: uno propone otra hora, el otro acepta
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- El §14 de los Términos («Reprogramación») promete que alumno y tutor pueden
-- pedir otra hora con 24 h de antelación, y que la otra parte puede no aceptar.
-- Hasta hoy ninguna migración movía `sessions.start_at` (ver
-- `docs/BACKLOG.md`, «Se promete REPROGRAMAR y el código no sabe hacerlo»): la
-- única salida era cancelar y volver a reservar, que con menos de 24 h cuesta
-- el 50 % (RN-37).
--
-- ── EL FLUJO ───────────────────────────────────────────────────────────────
--   proponer_reagenda(sesión, hora)  → fila `pending` + aviso a la otra parte
--   responder_reagenda(id, true)     → mueve la sesión + aviso a quien propuso
--   responder_reagenda(id, false)    → `rejected`, la sesión no se toca
-- Proponer otra vez sobre tu propia propuesta la sustituye (`withdrawn`); con
-- una del otro pendiente hay que responder primero. Una pendiente por sesión
-- (índice parcial).
--
-- ── LO QUE NO SE TOCA, Y POR QUÉ ───────────────────────────────────────────
-- · El DINERO: reagendar no cambia importe, pago ni payout. `completed_at` y
--   el payout cuelgan del cierre de la sesión, que ya lee la hora nueva.
-- · La SALA: `sessions_set_access_window` se dispara con `update of start_at`
--   y Daily reaplica `exp` en cada entrada (`src/lib/daily.ts`, `ensureRoom`).
-- · El FEED de calendario: su SEQUENCE sale de `updated_at`, que sube solo.
-- · Los RECORDATORIOS sí: su clave de idempotencia es por sesión, sin la hora
--   (`20260911210000`). Si ya se encolaron para la hora vieja, la nueva no
--   tendría los suyos. Al aceptar se les cambia la clave (y los pendientes se
--   marcan `failed`, que la campana ya esconde): los barridos vuelven a
--   encolarlos para la hora buena.
--
-- ── EL TECHO CONOCIDO ──────────────────────────────────────────────────────
-- La hora nueva se valida contra `get_available_slots`, que descuenta TODAS
-- las sesiones del tutor, incluida la que se mueve. Así que no se puede correr
-- una clase a un hueco que se pisa con ella misma (mover 30 min con paso de
-- 30). Arreglarlo es darle a `get_available_slots` una sesión a ignorar; no se
-- hace hasta que alguien lo pida. El solape real con OTRAS clases lo frena
-- además `sessions_sin_solape_por_tutor` (`20260831180000`) en el update.
-- ============================================================================

create table if not exists public.session_reschedules (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  proposed_by  text not null check (proposed_by in ('student', 'tutor')),
  old_start_at timestamptz not null,
  new_start_at timestamptz not null,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  responded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.session_reschedules is
  '§14 de los Términos: propuestas de mover una sesión a otra hora. Las escriben solo proponer_reagenda y responder_reagenda (security definer); el cliente solo lee las suyas.';
comment on column public.session_reschedules.proposed_by is
  'Quién propone, por PAPEL y no por id: la sesión ya sabe quién es el alumno y quién el tutor.';
comment on column public.session_reschedules.old_start_at is
  'La hora que tenía la sesión al proponer (UTC). Rastro: sessions.start_at ya no la guarda tras aceptar.';
comment on column public.session_reschedules.status is
  'pending → accepted | rejected (responde la otra parte) · withdrawn (quien propuso la sustituyó por otra).';

create unique index if not exists session_reschedules_una_pendiente
  on public.session_reschedules (session_id)
  where status = 'pending';

drop trigger if exists session_reschedules_set_updated_at on public.session_reschedules;
create trigger session_reschedules_set_updated_at
  before update on public.session_reschedules
  for each row execute function public.set_updated_at();

alter table public.session_reschedules enable row level security;

drop policy if exists "session_reschedules_select_parte" on public.session_reschedules;
create policy "session_reschedules_select_parte"
  on public.session_reschedules for select
  using (
    exists (
      select 1 from public.sessions s
       where s.id = session_id
         and (select auth.uid()) in (s.student_id, s.tutor_id)
    )
  );

drop policy if exists "session_reschedules_select_admin" on public.session_reschedules;
create policy "session_reschedules_select_admin"
  on public.session_reschedules for select
  using ( public.has_role('admin') );

grant select on public.session_reschedules to authenticated;
grant select on public.session_reschedules to service_role;

-- ── proponer ────────────────────────────────────────────────────────────────

drop function if exists public.proponer_reagenda(uuid, timestamptz);
create function public.proponer_reagenda(p_session_id uuid, p_new_start timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_s    record;
  v_rol  text;
  v_dia  date := (p_new_start at time zone 'UTC')::date;
  v_id   uuid;
begin
  select se.id, se.booking_id, se.student_id, se.tutor_id, se.start_at, se.status,
         b.product_id, b.status as booking_status
    into v_s
    from public.sessions se
    join public.bookings b on b.id = se.booking_id
   where se.id = p_session_id
     for update of se;

  if not found then
    raise exception 'No encontramos esa sesión.' using errcode = 'no_data_found';
  end if;

  v_rol := case v_uid when v_s.student_id then 'student' when v_s.tutor_id then 'tutor' end;
  if v_rol is null then
    raise exception 'No participas en esta sesión.' using errcode = 'insufficient_privilege';
  end if;

  if v_s.status <> 'scheduled' or v_s.booking_status not in ('confirmed', 'in_progress') then
    raise exception 'Esta sesión ya no se puede reagendar.';
  end if;

  -- §14: con al menos 24 h de antelación respecto de la hora PROGRAMADA.
  if v_s.start_at < now() + interval '24 hours' then
    raise exception 'Solo se puede reagendar con al menos 24 horas de anticipación.';
  end if;

  if p_new_start = v_s.start_at then
    raise exception 'Esa ya es la hora de la sesión.';
  end if;

  -- La disponibilidad la decide la misma función que alimenta la reserva: un
  -- día a cada lado porque sus fechas son de pared del tutor, no UTC.
  if not exists (
    select 1
      from public.get_available_slots(v_s.product_id, v_dia - 1, v_dia + 1) g
     where g.slot_start = p_new_start
  ) then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
  end if;

  if exists (
    select 1 from public.session_reschedules r
     where r.session_id = p_session_id and r.status = 'pending' and r.proposed_by <> v_rol
  ) then
    raise exception 'Hay una propuesta de la otra parte esperando tu respuesta.';
  end if;

  update public.session_reschedules
     set status = 'withdrawn', responded_at = now()
   where session_id = p_session_id and status = 'pending';

  insert into public.session_reschedules (session_id, proposed_by, old_start_at, new_start_at)
  values (p_session_id, v_rol, v_s.start_at, p_new_start)
  returning id into v_id;

  perform public.enqueue_notification(
    case v_rol when 'student' then v_s.tutor_id else v_s.student_id end,
    'NTF-RSC', 'email', 'reschedule_requested',
    jsonb_build_object(
      'booking_id', v_s.booking_id,
      'session_id', v_s.id,
      'antes',      public.iso_utc(v_s.start_at),
      'propuesta',  public.iso_utc(p_new_start),
      'para',       case v_rol when 'student' then 'tutor' else 'student' end
    ),
    'RSC:' || v_id || ':requested'
  );

  return v_id;
end;
$$;

comment on function public.proponer_reagenda(uuid, timestamptz) is
  '§14 · El alumno o el tutor de la sesión propone moverla a p_new_start, que tiene que ser un hueco de get_available_slots. Exige 24 h de antelación sobre la hora actual de la sesión. Sustituye la propuesta pendiente propia; falla si hay una del otro. Avisa a la otra parte (reschedule_requested).';

revoke execute on function public.proponer_reagenda(uuid, timestamptz) from public;
grant  execute on function public.proponer_reagenda(uuid, timestamptz) to authenticated;

-- ── responder ───────────────────────────────────────────────────────────────

drop function if exists public.responder_reagenda(uuid, boolean);
create function public.responder_reagenda(p_id uuid, p_acepta boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_r   record;
  v_s   record;
  v_rol text;
  v_estado text := case when p_acepta then 'accepted' else 'rejected' end;
begin
  select * into v_r from public.session_reschedules where id = p_id for update;
  if not found or v_r.status <> 'pending' then
    raise exception 'Esa propuesta ya no está pendiente.';
  end if;

  select se.id, se.booking_id, se.student_id, se.tutor_id, se.start_at, se.end_at, se.status
    into v_s
    from public.sessions se
   where se.id = v_r.session_id
     for update;

  v_rol := case v_uid when v_s.student_id then 'student' when v_s.tutor_id then 'tutor' end;
  -- Responde la OTRA parte: quien propuso no se acepta a sí mismo.
  if v_rol is null or v_rol = v_r.proposed_by then
    raise exception 'Esta propuesta no te toca responderla.' using errcode = 'insufficient_privilege';
  end if;

  if p_acepta then
    if v_s.status <> 'scheduled' or v_s.start_at <> v_r.old_start_at
       or v_s.start_at <= now() or v_r.new_start_at <= now() then
      raise exception 'La sesión cambió o la hora propuesta ya pasó. Pide una propuesta nueva.';
    end if;

    -- La duración se conserva; el solape con otras clases lo frena la
    -- exclusión `sessions_sin_solape_por_tutor`.
    update public.sessions
       set start_at = v_r.new_start_at,
           end_at   = v_r.new_start_at + (v_s.end_at - v_s.start_at)
     where id = v_s.id;

    -- Recordatorios de la hora vieja: fuera de su clave, y los que no salieron,
    -- a `failed`. Ver la cabecera.
    update public.notifications
       set idempotency_key = idempotency_key || ':movida:' || p_id,
           status = case when status = 'pending' then 'failed'::public.notification_status
                         else status end
     where idempotency_key in (
       'NTF-11:session:' || v_s.id || ':student', 'NTF-11:session:' || v_s.id || ':tutor',
       'NTF-08:session:' || v_s.id || ':student', 'NTF-08:session:' || v_s.id || ':tutor'
     );
  end if;

  update public.session_reschedules
     set status = v_estado, responded_at = now()
   where id = p_id;

  perform public.enqueue_notification(
    case v_r.proposed_by when 'student' then v_s.student_id else v_s.tutor_id end,
    'NTF-RSC', 'email',
    case when p_acepta then 'reschedule_accepted' else 'reschedule_rejected' end,
    jsonb_build_object(
      'booking_id', v_s.booking_id,
      'session_id', v_s.id,
      'antes',      public.iso_utc(v_r.old_start_at),
      'propuesta',  public.iso_utc(v_r.new_start_at),
      'para',       v_r.proposed_by
    ),
    'RSC:' || p_id || ':' || v_estado
  );
end;
$$;

comment on function public.responder_reagenda(uuid, boolean) is
  '§14 · La parte que NO propuso acepta (mueve sessions.start_at/end_at conservando la duración y reencola los recordatorios) o rechaza (la sesión no se toca). Avisa a quien propuso.';

revoke execute on function public.responder_reagenda(uuid, boolean) from public;
grant  execute on function public.responder_reagenda(uuid, boolean) to authenticated;
