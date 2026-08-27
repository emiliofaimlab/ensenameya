-- ============================================================================
-- Correcciones de la revisión del Lote 1 (Doc 20 §20.4). Tres cosas que la
-- pasada adversarial encontró sobre las migraciones de hoy y que no se arreglan
-- editándolas: `20260820120000` y `20260820130000` ya están aplicadas en dev y
-- una migración aplicada no se toca (regla de oro 5).
--
-- 1 · FUGA · `pair_booking_stats` nació con `grant execute … to authenticated`.
--     Es SECURITY DEFINER, recibe el par POR PARÁMETRO y no mira `auth.uid()`
--     en ningún sitio — su comentario lo dice con todas las letras. Con el
--     grant puesto, PostgREST la publica como `POST /rest/v1/rpc/…` y cualquier
--     autenticado puede preguntar por DOS uuid que elija él: cuántas mentorías
--     y cuántas clases hay entre un alumno y un tutor cualesquiera. El grant
--     además no hacía falta para nada: sus dos únicos consumidores
--     —`my_conversations()` y `pair_has_booking()`— son SECURITY DEFINER y la
--     llaman como su dueña, a la que los grants de rol no le aplican. Es el
--     mismo razonamiento que la propia migración escribió para explicar por qué
--     NO le daba grant a `service_role`; solo que no lo aplicó hacia el otro
--     lado.
--
--     ⚠️ `pair_has_booking` conserva su `grant … to authenticated`, que viene de
--     M-12 (`20260817210000:369`) y filtra el mismo par en versión booleana.
--     No se toca AQUÍ a propósito: cerrarlo es un cambio de comportamiento
--     preexistente y merece su propia ficha, no ir de polizón en una
--     corrección. Queda anotado como pendiente.
--
-- 2 · MODERACIÓN · la purga borraba también los hilos bloqueados.
-- 3 · ORDEN · la purga se fiaba de un backfill que corre DESPUÉS que ella.
--     Los dos, razonados en línea dentro del `where`.
--
-- El cron (`purge-expired-messages`, 04:00 diario) no se toca: mismo nombre,
-- misma función.
-- ============================================================================

-- ── 1 · Cerrar la RPC ────────────────────────────────────────────────────────
revoke execute on function public.pair_booking_stats(uuid, uuid) from authenticated;

comment on function public.pair_booking_stats(uuid, uuid) is
  'MN-08: qué hay detrás del par (alumno, tutor) — si llegó a comprar, cuántas mentorías distintas y cuántas clases. ÚNICO sitio donde vive la lista de estados de "este par compró": `pair_has_booking` lee de aquí. NO tiene grant a ningún rol de la API: se llama solo desde funciones SECURITY DEFINER, que corren como su dueña. Dárselo a `authenticated` la publicaría por PostgREST con el par a elección del llamante.';

-- ── 2 y 3 · La purga, con las dos guardas ────────────────────────────────────
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
  dropped as (
    delete from storage.objects
    where bucket_id = 'chat-attachments'
      and name in (select attachment_path from gone where attachment_path is not null)
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

comment on function public.purge_expired_messages() is
  'US-1703 + M-12 + L1-4: purga del chat a 30 días. Mensajes de reserva por `expires_at`; conversaciones sin compra por `coalesce(last_message_at, created_at)`, salvo que estén bloqueadas (el bloqueo no sobrevive al borrado) o tengan mensajes de los últimos 30 días (independencia del backfill de `last_message_at`).';

-- Re-declarados igual que en `20260820120000`: un `create or replace` no toca
-- los grants, pero el día que alguien copie este bloque como plantilla se lo
-- lleva puesto.
revoke execute on function public.purge_expired_messages() from public;
revoke execute on function public.purge_expired_messages() from anon;
revoke execute on function public.purge_expired_messages() from authenticated;
grant  execute on function public.purge_expired_messages() to service_role;
