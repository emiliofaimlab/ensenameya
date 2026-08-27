-- ============================================================================
-- Enséñame Ya — La purga del chat vuelve a funcionar: los ficheros se encolan
--
-- 🔴 ESTA MIGRACIÓN ARREGLA UN FALLO QUE ESTABA ROMPIENDO UNA PROMESA PUBLICADA.
--
-- `purge_expired_messages()` —el cron de pg_cron que aplica la retención de 30
-- días del chat, la que `/privacy` §5 promete por escrito— hacía
--
--     delete from storage.objects where bucket_id = 'chat-attachments' ...
--
-- y Supabase lo prohíbe:
--
--     Direct deletion from storage tables is not allowed. Use the Storage API
--     instead.                                                          (42501)
--     hint: This prevents accidental data loss from orphaned objects.
--
-- ── POR QUÉ ES PEOR DE LO QUE PARECE ────────────────────────────────────────
-- El `delete` de ficheros y el de mensajes viven en la MISMA sentencia (un CTE
-- encadenado), así que al saltar el 42501 **se deshace todo**: no se borra el
-- fichero, pero tampoco el mensaje. O sea que la retención de 30 días no se
-- estaba cumpliendo — ni la de los adjuntos ni la del texto.
--
-- ⚠️ Y no es «a partir del día que caduque el primer adjunto». La guarda saltó
-- el 26-ago en `anonymize_account` sobre una cuenta recién creada **que no
-- tenía ni un fichero**: un `delete` de CERO filas ya la dispara. Es una guarda
-- de sentencia, no de fila. Con eso, la purga llevaba fallando en cada pasada
-- desde que la guarda existe, en silencio, porque es un cron y nadie la mira.
--
-- ── EL ARREGLO, Y POR QUÉ NO ES EL MISMO QUE EL DE EY-192 ───────────────────
-- En `anonymize_account` bastó con que el SQL devolviera las rutas y el Route
-- Handler las barriera: allí hay un llamante HTTP con `service_role`.
--
-- Aquí NO lo hay. Esta función la invoca **pg_cron dentro de Postgres**
-- (`20260716180000:125`, `'0 4 * * *'`), así que no existe nadie a quien
-- devolverle nada. Por eso la variante es una COLA: la función apunta las rutas
-- en `storage_purge_queue` y un job HTTP la drena con la Storage API.
--
-- Efecto inmediato y lo que importa: **los mensajes vuelven a borrarse a los 30
-- días**. El fichero tarda, como mucho, hasta el siguiente barrido.
--
-- ── LO QUE LA COLA REGALA, Y NO ES POCO ─────────────────────────────────────
-- Reintentos. El borrado directo no los tenía: si fallaba, el fichero quedaba
-- huérfano y nadie se enteraba. Con la fila viva hasta que el `remove()` va
-- bien, un fallo de red se reintenta solo al día siguiente.
-- ============================================================================


-- ── La cola ─────────────────────────────────────────────────────────────────
-- Default-deny y SIN políticas: no la lee nadie por PostgREST, ni el dueño del
-- fichero ni el admin. Solo la tocan la función de purga (SECURITY DEFINER,
-- corre como su dueña) y el job, que va con `service_role`.
--
-- ⚠️ Regla de oro 9: `service_role` se salta la RLS pero NO los grants de
-- tabla, y este proyecto tiene «auto-expose new tables» en OFF. Sin el grant de
-- abajo el job comería `permission denied` EN EJECUCIÓN — ni en el build ni en
-- el typecheck. Ha mordido cuatro veces ya.
create table if not exists public.storage_purge_queue (
  id           uuid        primary key default gen_random_uuid(),
  bucket_id    text        not null,
  path         text        not null,
  enqueued_at  timestamptz not null default now(),
  attempts     integer     not null default 0,
  last_error   text,
  -- La misma ruta no se encola dos veces: si un barrido la dejó a medias, se
  -- reintenta la fila que ya existe en vez de acumular duplicados.
  unique (bucket_id, path)
);

alter table public.storage_purge_queue enable row level security;

grant select, insert, update, delete on public.storage_purge_queue to service_role;

comment on table public.storage_purge_queue is
  'Ficheros de Storage pendientes de borrar. Existe porque Supabase prohíbe `delete from storage.objects` desde SQL (42501) y hay funciones —como purge_expired_messages— que corren en pg_cron, sin llamante HTTP a quien devolverle las rutas. La drena /api/cron/recordings-purge con la Storage API. La fila vive hasta que el borrado va bien, así que da reintentos gratis.';

-- Lo que el job pide: lo más antiguo primero, y sin ahogarse en una ruta que
-- falla siempre.
create index if not exists storage_purge_queue_pendientes_idx
  on public.storage_purge_queue (attempts, enqueued_at);


-- ── La purga, sin el `delete` prohibido ─────────────────────────────────────
-- El resto del cuerpo es byte a byte el de `20260826200000` —incluida la guarda
-- (c) de los reportes sin atender, que es de esa misma migración—: se extrajo y
-- se le cambió SOLO el CTE `dropped`, para no meter deriva en una función que
-- ya ha pasado por seis manos.
create or replace function public.purge_expired_messages()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted  int;
  v_objects  int;
  v_consultas int;
begin
  -- 1 · MENSAJES DE RESERVA: 30 días desde CADA mensaje. Sin cambios (AB-01
  --     sigue abierto). Los nulos —lo pre-compra— quedan fuera solos.
  with gone as (
    delete from public.messages where expires_at < now()
    returning attachment_path
  ),
  -- ⚠️ ENCOLAR, NO BORRAR. Ver la cabecera: `delete from storage.objects`
  --    está prohibido y tumba la transacción entera, con lo que los MENSAJES
  --    tampoco se borraban. Aquí solo se apunta la ruta; el fichero lo retira
  --    después el job HTTP con la Storage API, que es el único camino que
  --    Supabase admite. `on conflict do nothing` porque la misma ruta puede
  --    reencolarse si un barrido anterior la dejó a medias.
  dropped as (
    insert into public.storage_purge_queue (bucket_id, path)
    select 'chat-attachments', g.attachment_path
      from gone g
     where g.attachment_path is not null
    on conflict (bucket_id, path) do nothing
    returning 1
  )
  select
    (select count(*) from gone),
    (select count(*) from dropped)
  into v_deleted, v_objects;

  -- 2 · CONSULTAS QUE NO LLEGARON A NADA: la conversación entera, de una
  --     pieza, a los 30 días sin actividad y solo si el par NUNCA compró.
  --     El `coalesce` es L1-4: sin él, un hilo abierto y nunca usado
  --     (`last_message_at is null`) era inmortal.
  with idas as (
    delete from public.conversations c
     where coalesce(c.last_message_at, c.created_at) < now() - interval '30 days'
       and not public.pair_has_booking(c.student_id, c.tutor_id)
       -- (a) Un hilo bajo moderación no es un hilo abandonado. `blocked_at` y
       --     `blocked_reason` viven SOLO en esta fila —`set_conversation_blocked`
       --     hace un `update` y no copia nada a ninguna auditoría—, así que
       --     borrarla desbloquea al par en silencio: `conversations_pair_unique`
       --     era lo único que impedía duplicar el hilo, y `open_conversation`
       --     devolvería uno nuevo, sin bloqueo y con los contadores anti-spam de
       --     `send_conversation_message` (5 seguidos / 20 totales, que cuentan
       --     `messages` del hilo) a cero. Bloquear a alguien que no ha comprado
       --     tenía, por construcción, fecha de caducidad.
       and c.blocked_at is null
       -- (b) Cinturón: el `coalesce` de arriba se fía de que `last_message_at`
       --     esté al día, y no siempre lo estuvo — el sembrado de M-12 creó las
       --     filas sin rellenarla (lo repara `20260820140000`). Mientras esa
       --     reparación no haya corrido, un hilo CON mensajes reales y
       --     `last_message_at is null` heredaría un `created_at` viejo y se
       --     borraría con sus mensajes por cascada. Esta condición mira los
       --     mensajes de verdad, así que la purga es correcta ANTES y DESPUÉS
       --     del backfill y deja de depender del orden de las migraciones.
       --     Solo puede impedir borrados, nunca provocarlos.
       and not exists (
         select 1
           from public.messages m
          where m.conversation_id = c.id
            and m.created_at >= now() - interval '30 days'
       )
       -- (c) EY-189 · Un hilo con un reporte SIN ATENDER tampoco es un hilo
       --     abandonado: es el siguiente de la cola del admin. Sin esta línea la
       --     bandeja pierde casos sola y nadie se entera — la cascada borra el
       --     reporte y no queda ni el hueco. Se limita a los pendientes a
       --     propósito: cerrado el reporte, la retención de 30 días vuelve a
       --     mandar. Como (a) y (b), solo puede impedir borrados.
       and not exists (
         select 1
           from public.conversation_reports r
          where r.conversation_id = c.id
            and r.handled_at is null
       )
    returning 1
  )
  select count(*) into v_consultas from idas;

  return jsonb_build_object(
    'estado',              'activa',
    'retencion_dias',      30,
    'messages_purged',     v_deleted,
    'attachments_purged',  v_objects,
    -- Consultas previas a la compra que caducaron enteras (M-12). Desde L1-4
    -- también cuenta las que nunca tuvieron un mensaje.
    'consultas_purgadas',  v_consultas
  );
end;
$$;
