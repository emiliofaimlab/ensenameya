-- ============================================================================
-- N-23 — «me escribieron y no me enteré»: marca de lectura del chat.
--
-- EL PROBLEMA. El Realtime del chat vive DENTRO del hilo abierto
-- (`chat-thread.tsx`, canal `messages:<booking_id>`). Si no tienes el hilo
-- delante, no llega nada: la burbuja flotante no se entera de un mensaje nuevo
-- y su "contador" es en realidad `conversations.length` —cuántas conversaciones
-- tienes, no cuántos mensajes te faltan por leer—, un número que no cambia
-- aunque te escriban diez veces. La lista tampoco se reordena sin recargar.
--
-- Para contar "sin leer" hace falta un dato que hoy no existe en ningún sitio:
-- hasta dónde ha leído CADA participante.
--
-- ── Decisión 1 · tabla propia, no una columna en `messages` ─────────────────
-- `messages.read_at` sería lo primero que uno escribe y está mal: la fila es
-- UNA y los lectores son DOS. Con una sola marca, el que abre el hilo "lee" el
-- mensaje también en nombre del otro. Tampoco vale colgarlo de `bookings`: el
-- estado no es de la reserva, es del par (reserva ↔ persona). Por eso una tabla
-- con PK compuesta, que además hace el upsert trivial (`on conflict` sobre la
-- PK) y evita duplicados por diseño en vez de por trigger.
--
-- Se guarda un INSTANTE y no el id del último mensaje leído a propósito: el
-- hilo se purga a los 30 días (RN-41) y una FK al mensaje se llevaría la marca
-- por delante en cascada — justo cuando el contador debe quedarse en cero. Un
-- timestamptz sobrevive a la purga y compara igual de bien (`created_at >`).
-- ============================================================================

create table public.message_reads (
  -- Sin FK a `messages`: ver arriba (la purga se llevaría la marca).
  booking_id   uuid        not null references public.bookings (id) on delete cascade,
  user_id      uuid        not null references public.profiles (id) on delete cascade,

  -- UTC (RN-02). Lo pone el servidor, nunca el navegador: ver decisión 2.
  last_read_at timestamptz not null default now(),

  primary key (booking_id, user_id)
);

comment on table public.message_reads is
  'N-23: hasta cuándo ha leído cada participante el hilo de una reserva. Una fila por (reserva, persona); la escribe solo `mark_messages_read`.';

-- Sin índice extra: el de la PK (booking_id, user_id) es justo el que usan las
-- dos consultas —el upsert y el `left join` de `unread_message_counts`—, que
-- siempre llevan las dos columnas. Un índice por `user_id` solo sería útil para
-- "todas las marcas de esta persona", que nadie pide.

-- Sin `updated_at` ni su trigger, a diferencia del resto de tablas: `last_read_at`
-- ES la columna de auditoría de esta tabla. Una segunda marca de tiempo con el
-- mismo valor solo sería una manera de que algún día discrepen.

-- ── RLS: default-deny; cada quien ve SOLO su propia marca ───────────────────
alter table public.message_reads enable row level security;

-- Ojo con la tentación de "es participante de la reserva" aquí: dejaría que el
-- tutor leyera la marca del alumno, o sea, saber si te leyó y cuándo. Eso es un
-- acuse de lectura, y nadie lo ha decidido (ni el Figma lo pinta). La política
-- es de PROPIEDAD, más estrecha: tu marca es tuya. La pertenencia a la reserva
-- se comprueba al ESCRIBIR, dentro de la RPC.
create policy "message_reads_select_own"
  on public.message_reads for select
  using ( (select auth.uid()) = user_id );

-- Sin política de insert/update/delete a propósito: el único camino de
-- escritura es `mark_messages_read` (SECURITY DEFINER). Mismo patrón que
-- `messages`, donde escribe solo `send_message` (`20260716180000`).

-- ── Grants (auto-expose OFF) ────────────────────────────────────────────────
-- `select` para que `unread_message_counts` —que es SECURITY INVOKER y corre
-- con los privilegios de quien llama— pueda hacer su join. La política de
-- arriba es la que acota qué filas.
grant select on public.message_reads to authenticated;

-- Regla de oro 9: `service_role` se salta la RLS pero NO los grants. Hoy
-- ningún job toca esta tabla —la purga del chat (`purge_expired_messages`)
-- borra `messages`, no las marcas— así que no lleva grant. El día que un job la
-- toque, su `grant ... to service_role` va EN LA MISMA migración o revienta en
-- tiempo de ejecución, no en el build.

-- Las marcas huérfanas (mensajes purgados, marca viva) no se limpian: son tres
-- columnas sin contenido personal y el `on delete cascade` de `bookings` se las
-- lleva cuando la reserva desaparece. Contar sobre un hilo vacío da cero igual.

-- ── N-23 · marcar leído ─────────────────────────────────────────────────────
-- Decisión 2 · POR QUÉ UNA RPC Y NO UN UPSERT DESDE EL CLIENTE.
-- Dos razones, y la primera es la que manda:
--   1. El reloj. Con un upsert directo el navegador elegiría `last_read_at`, y
--      un reloj adelantado —cosa común— marcaría como leídos mensajes que
--      todavía no han llegado: el contador se quedaría mudo para siempre en esa
--      conversación. Aquí la hora la pone `now()`, que es la del servidor y la
--      misma con la que se sella `messages.created_at` (RN-01/02).
--   2. La pertenencia. Sin comprobarla, cualquiera podría sembrar marcas de
--      reservas ajenas: no filtra nada (la RLS de `messages` sigue en su sitio),
--      pero es basura que ensucia la tabla y confunde al que la lea.
create or replace function public.mark_messages_read(p_booking_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_ok   boolean;
  v_when timestamptz;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  -- Participante de la reserva (alumno o tutor). Sin filtro de estado, al
  -- contrario que `tutor_students`: marcar como leído un hilo de una reserva
  -- cancelada es exactamente lo que debe pasar cuando alguien lo abre para
  -- releerlo antes de que la purga se lo lleve.
  select true into v_ok
    from public.bookings
   where id = p_booking_id
     and v_uid in (student_id, tutor_id);

  if not coalesce(v_ok, false) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  insert into public.message_reads (booking_id, user_id, last_read_at)
  values (p_booking_id, v_uid, now())
  on conflict (booking_id, user_id) do update
    -- `greatest` y no `excluded.last_read_at` a secas: dos pestañas abiertas (o
    -- una petición que se demora) pueden llegar desordenadas, y una marca vieja
    -- pisando a una nueva resucitaría el contador de mensajes ya leídos. La
    -- marca solo avanza.
    --
    -- La fila existente se referencia por el NOMBRE de la tabla, sin esquema:
    -- en `on conflict do update` ese nombre es el alias del destino, y como
    -- alias no depende del `search_path` (que aquí está vacío a propósito).
    set last_read_at = greatest(excluded.last_read_at, message_reads.last_read_at)
  returning last_read_at into v_when;

  return v_when;
end;
$$;

comment on function public.mark_messages_read(uuid) is
  'N-23: adelanta la marca de lectura del hilo de una reserva hasta ahora. La hora la pone el servidor; el llamante solo dice qué reserva.';

-- `execute` es PUBLIC por defecto en Postgres: primero se revoca y luego se
-- concede, o el `grant` no cierra nada (misma lección que `expire_stale_bookings`
-- en US-605).
revoke execute on function public.mark_messages_read(uuid) from public;
revoke execute on function public.mark_messages_read(uuid) from anon;
grant  execute on function public.mark_messages_read(uuid) to authenticated;

-- ── N-23 · cuántos sin leer, por conversación ───────────────────────────────
-- Decisión 3 · POR QUÉ UNA FUNCIÓN AGREGADA Y NO CONTAR EN EL NAVEGADOR.
-- La alternativa era traerse los mensajes de las 20 reservas de la bandeja y
-- contar en JavaScript: kilobytes de conversación —con adjuntos y todo— para
-- pintar un número de dos cifras, y cada vez que se abre la burbuja. Aquí baja
-- una fila por conversación.
--
-- Decisión 4 · SECURITY **INVOKER** (el default), al revés que `tutor_students`.
-- Aquí no hace falta saltarse nada: los datos son del propio llamante y la RLS
-- de `messages` (participante) y la de `message_reads` (propia) ya recortan
-- exactamente lo que debe ver. Un DEFINER obligaría a reimplementar a mano el
-- "soy participante" y a acertar — el agujero clásico. Regla: DEFINER solo
-- cuando la RLS impide de verdad leer lo que hace falta.
create or replace function public.unread_message_counts()
returns table (
  booking_id      uuid,
  unread          integer,
  last_message_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    m.booking_id,
    (count(*) filter (
      where m.sender_id <> (select auth.uid())          -- lo mío no me lo cuento
        and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    ))::integer,                                         -- count() da bigint
    -- Para ordenar la bandeja por actividad, no por fecha de reserva: quien te
    -- acaba de escribir sube arriba. Incluye los mensajes propios a propósito
    -- (una conversación en la que acabas de escribir también está "viva").
    max(m.created_at)
  from public.messages m
  left join public.message_reads r
    on  r.booking_id = m.booking_id
    and r.user_id    = (select auth.uid())
  group by m.booking_id;
$$;

comment on function public.unread_message_counts() is
  'N-23: por cada conversación del usuario, cuántos mensajes ajenos hay después de su marca de lectura y cuándo fue el último. SECURITY INVOKER: la RLS de messages ya acota a sus reservas.';

-- Nota para quien la lea desde el frontend: devuelve TODA reserva con mensajes,
-- incluidas las canceladas o reembolsadas. Es a propósito —la función informa,
-- no decide qué conversación merece salir en pantalla—, así que el total de la
-- burbuja se suma sobre las conversaciones que la bandeja lista, no sobre todas
-- las filas de aquí; si no, saldría una insignia que no se puede abrir ni
-- apagar.

revoke execute on function public.unread_message_counts() from public;
revoke execute on function public.unread_message_counts() from anon;
grant  execute on function public.unread_message_counts() to authenticated;

-- Realtime: `messages` ya está en la publicación desde EP-17 y es de ahí de
-- donde la burbuja se entera de los mensajes nuevos. `message_reads` NO se
-- añade: la marca la escribe uno mismo, así que no hay nada que notificar.
