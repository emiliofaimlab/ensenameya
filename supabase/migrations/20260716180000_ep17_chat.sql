-- ============================================================================
-- Enséñame Ya — EP-17: chat 1:1 de la reserva. US-1701 + US-1703 (RN-41).
--
-- Sin dependencias nuevas: Supabase Realtime sobre `messages` (ya en el stack).
-- El chat de Daily NO se usa (efímero, no persiste ni se descarga).
--
-- RN-41: hilo 1:1 por reserva, habilitado 2 días antes de la 1ª sesión,
-- retención 30 días (`expires_at` + purga pg_cron), RLS por participantes.
--
-- LECTURA: por RLS (participantes) → así Realtime entrega a cada quien solo lo
-- suyo. ESCRITURA: por RPC `send_message` (participante + ventana) — un `insert`
-- directo no puede validar la ventana con mensajes claros. El INSERT que hace la
-- RPC igualmente lo difunde Realtime a los suscriptores.
-- ============================================================================

create table public.messages (
  id         uuid        primary key default gen_random_uuid(),
  booking_id uuid        not null references public.bookings (id) on delete cascade,
  sender_id  uuid        not null references public.profiles (id) on delete cascade,
  body       text        not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),                          -- UTC (RN-02)
  expires_at timestamptz not null default now() + interval '30 days'      -- retención (RN-41)
);

create index messages_booking_idx  on public.messages (booking_id, created_at);
create index messages_expires_idx  on public.messages (expires_at);

-- ── RLS: solo los participantes de la reserva ───────────────────────────────
alter table public.messages enable row level security;

create policy "messages_select_participant"
  on public.messages for select
  using (
    exists (
      select 1 from public.bookings b
      where b.id = messages.booking_id
        and (select auth.uid()) in (b.student_id, b.tutor_id)
    )
  );

-- Sin política de INSERT/UPDATE/DELETE: la escritura la hace `send_message`
-- (participante + ventana). La purga corre como service_role.
grant select on public.messages to authenticated;

-- ── US-1701: enviar mensaje (participante + ventana de 2 días antes) ─────────
create or replace function public.send_message(
  p_booking_id uuid,
  p_body       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_bk     record;
  v_first  timestamptz;
  v_msg    uuid;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'el mensaje no puede estar vacío' using errcode = 'check_violation';
  end if;

  -- Participante de la reserva (alumno o tutor).
  select id, student_id, tutor_id, status into v_bk
  from public.bookings
  where id = p_booking_id and v_uid in (student_id, tutor_id);
  if v_bk.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- Ventana: desde 2 días antes de la 1ª sesión (RN-41). Reservas sin sesiones
  -- (aún sin confirmar) no tienen chat todavía.
  select min(start_at) into v_first from public.sessions where booking_id = p_booking_id;
  if v_first is null then
    raise exception 'el chat se habilita al confirmarse la reserva' using errcode = 'check_violation';
  end if;
  if now() < v_first - interval '2 days' then
    raise exception 'el chat se abre 2 días antes de tu primera clase' using errcode = 'check_violation';
  end if;

  insert into public.messages (booking_id, sender_id, body)
  values (p_booking_id, v_uid, btrim(p_body))
  returning id into v_msg;

  return v_msg;
end;
$$;

grant execute on function public.send_message(uuid, text) to authenticated;

-- ── Realtime: difunde los INSERT de messages a los suscriptores ─────────────
-- Cada cliente recibe solo lo que su RLS de SELECT permite (su reserva).
alter publication supabase_realtime add table public.messages;

-- ── US-1703: purga diaria de mensajes vencidos (pg_cron) ────────────────────
create or replace function public.purge_expired_messages()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  with gone as (
    delete from public.messages where expires_at < now() returning id
  )
  select count(*) into v_deleted from gone;
  return jsonb_build_object('messages_purged', v_deleted);
end;
$$;

-- Gotcha US-605: EXECUTE es PUBLIC. Solo el cron/service_role purga.
revoke execute on function public.purge_expired_messages() from public;
revoke execute on function public.purge_expired_messages() from anon;
revoke execute on function public.purge_expired_messages() from authenticated;
grant  execute on function public.purge_expired_messages() to service_role;

select cron.unschedule('purge-expired-messages') where exists (select 1 from cron.job where jobname = 'purge-expired-messages');
select cron.schedule('purge-expired-messages', '0 4 * * *', $cron$ select public.purge_expired_messages(); $cron$);
