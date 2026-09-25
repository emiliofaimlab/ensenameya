-- ════════════════════════════════════════════════════════════════════════════
-- Google Calendar por API (reunión del 25-sep).
--
-- El feed suscribible (EY-188, `20260826210000`) ya mete las clases en Google,
-- pero Google relee los calendarios suscritos cuando él quiere (8-24 h). Con
-- esto el usuario conecta su cuenta y el evento se crea, se mueve o se anula
-- en el momento en que cambia la sesión.
--
-- Tres piezas:
--   1. `google_calendar_connections` — un refresh token por usuario, CIFRADO
--      por la app (`lib/google-calendar.ts`). La BD nunca lo ve en claro.
--   2. `google_calendar_eventos()` — qué debe decir el calendario de cada quien
--      para unas sesiones. Mismo criterio de estado que `calendar_feed`.
--   3. Un trigger en `sessions` y `bookings` que avisa por `pg_net` a
--      `/api/calendario/google/sync` (mismo vault que `disparar_correos_pendientes`).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Conexiones ───────────────────────────────────────────────────────────
create table public.google_calendar_connections (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  refresh_token text not null,
  google_email  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.google_calendar_connections is
  'Cuenta de Google Calendar conectada por el usuario. El trigger de sessions/bookings solo avisa a la app si alguno de los dos participantes tiene fila aquí.';
comment on column public.google_calendar_connections.refresh_token is
  'Refresh token de Google, CIFRADO con AES-256-GCM por la app (clave derivada de GOOGLE_CLIENT_SECRET). Rotar ese secreto deja estas filas inservibles: el usuario reconecta. Sin grant de lectura a authenticated, a propósito.';

alter table public.google_calendar_connections enable row level security;
-- ⚠️ Faltaba aquí el `revoke all … from anon, authenticated`: lo pone `20260925190000`.

-- El dueño ve SI está conectado y con qué correo, nunca el token: el grant es
-- por columnas, así que `select *` desde el navegador falla en vez de filtrarlo.
create policy "google_calendar_connections: el dueño ve la suya"
  on public.google_calendar_connections for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select (user_id, google_email, created_at)
  on public.google_calendar_connections to authenticated;

-- Escribir (conectar, desconectar, olvidar un token revocado) es cosa de los
-- Route Handlers con service_role. Regla de oro 9.
grant select, insert, update, delete
  on public.google_calendar_connections to service_role;

-- ── 2) Qué debe decir el calendario ─────────────────────────────────────────
-- Una fila por (sesión, participante CONECTADO). `p_sesiones` null = todas las
-- futuras de `p_user` (lo que se vuelca al conectar).
create or replace function public.google_calendar_eventos(
  p_sesiones uuid[],
  p_user     uuid default null
)
returns table (
  session_id    uuid,
  booking_id    uuid,
  user_id       uuid,
  soy_tutor     boolean,
  refresh_token text,
  start_at      timestamptz,
  end_at        timestamptz,
  estado        text,
  titulo        text,
  con           text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.booking_id,
         g.user_id,
         g.user_id = s.tutor_id,
         g.refresh_token,
         s.start_at,
         s.end_at,
         -- Mismo criterio que `calendar_feed`. `pending_payment` también es
         -- «no debe existir»: una reserva sin pagar no ocupa la agenda.
         case
           when s.status = 'cancelled'
             or b.status in ('cancelled', 'refunded', 'pending_payment') then 'cancelada'
           when b.status = 'pending_acceptance'                           then 'tentativa'
           else 'confirmada'
         end,
         pr.title,
         -- ⚠️ Enmascarado: esto viaja a un tercero, igual que el feed.
         public.mask_person_name(
           case when g.user_id = s.tutor_id then stu.full_name else tut.full_name end
         )
    from public.sessions s
    join public.bookings b  on b.id  = s.booking_id
    join public.products pr on pr.id = b.product_id
    join public.google_calendar_connections g
      on g.user_id in (s.student_id, s.tutor_id)
    left join public.profiles tut on tut.id = s.tutor_id
    left join public.profiles stu on stu.id = s.student_id
   where (p_user is null or g.user_id = p_user)
     and (
       s.id = any(p_sesiones)
       or (p_sesiones is null and p_user is not null and s.start_at > now())
     )
   -- Techo de seguridad del volcado inicial, no de producto.
   limit 500;
$$;

comment on function public.google_calendar_eventos(uuid[], uuid) is
  'Estado que debe tener cada evento de Google Calendar para unas sesiones, por participante conectado. Solo service_role: devuelve el refresh token (cifrado).';

revoke execute on function public.google_calendar_eventos(uuid[], uuid) from public;
revoke execute on function public.google_calendar_eventos(uuid[], uuid) from anon;
revoke execute on function public.google_calendar_eventos(uuid[], uuid) from authenticated;
grant  execute on function public.google_calendar_eventos(uuid[], uuid) to service_role;

-- ── 3) El aviso ─────────────────────────────────────────────────────────────
-- `pg_net` encola la petición y la manda DESPUÉS del commit, así que el
-- endpoint ya lee la sesión nueva.
create or replace function public.avisar_google_calendar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids    uuid[];
  v_url    text;
  v_secret text;
  v_bypass text;
  v_cab    jsonb;
begin
  if tg_table_name = 'sessions' then
    v_ids := array[new.id];
  else
    select array_agg(s.id) into v_ids
      from public.sessions s where s.booking_id = new.id;
  end if;

  -- Sin nadie conectado no se llama a nadie: es el caso de casi todas las filas.
  select array_agg(s.id) into v_ids
    from public.sessions s
   where s.id = any(v_ids)
     and exists (select 1 from public.google_calendar_connections g
                  where g.user_id in (s.student_id, s.tutor_id));
  if v_ids is null then
    return null;
  end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'ey_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ey_cron_secret';
  select decrypted_secret into v_bypass from vault.decrypted_secrets where name = 'ey_vercel_bypass';
  if v_url is null or v_secret is null then
    raise warning 'avisar_google_calendar: falta ey_site_url o ey_cron_secret en el vault';
    return null;
  end if;

  v_cab := jsonb_build_object('Authorization', 'Bearer ' || v_secret,
                              'Content-Type',  'application/json');
  if v_bypass is not null then
    v_cab := v_cab || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;

  perform net.http_post(
    url     := v_url || '/api/calendario/google/sync',
    body    := jsonb_build_object('sesiones', v_ids),
    headers := v_cab,
    timeout_milliseconds := 30000
  );
  return null;
exception when others then
  -- ⚠️ Un calendario de terceros JAMÁS tumba una reserva, un pago o un
  -- reagendado: el fallo se queda en el log de Postgres y la sesión sigue.
  raise warning 'avisar_google_calendar: %', sqlerrm;
  return null;
end;
$$;

revoke execute on function public.avisar_google_calendar() from public;
revoke execute on function public.avisar_google_calendar() from anon;
revoke execute on function public.avisar_google_calendar() from authenticated;

create trigger sessions_google_calendar
  after insert or update of start_at, end_at, status on public.sessions
  for each row execute function public.avisar_google_calendar();

create trigger bookings_google_calendar
  after update of status on public.bookings
  for each row
  when (old.status is distinct from new.status)
  execute function public.avisar_google_calendar();
