-- ============================================================================
-- L1-4 — Los hilos que nunca se usaron también caducan.
--
-- EL AGUJERO, y existe HOY. La purga de M-12 (`20260817210000`) borra la
-- conversación entera a los 30 días de inactividad si el par nunca llegó a
-- comprar, y para decidirlo mira `c.last_message_at`. Pero esa columna nace
-- NULA y solo la rellenan las dos funciones de envío: el hilo lo crea
-- `open_conversation` (o el trigger de `bookings`) ANTES de que nadie escriba.
-- O sea que el alumno que abre el chat desde la ficha de un tutor, se lo
-- piensa y cierra la pestaña deja una fila con `last_message_at is null`, y el
-- `where c.last_message_at is not null` de la purga la descarta. **Ese hilo no
-- se purga jamás.**
--
-- Y no es una fila inocua: la conversación ES el par (alumno, tutor) con su
-- fecha — quién quiso hablar con quién y cuándo. Se queda en la bandeja de los
-- dos para siempre y contradice el plazo de 30 días que las páginas legales
-- publican como retención del chat (DD-06 / decisión 22).
--
-- EL ARREGLO. Una línea: el reloj arranca en la última actividad y, si nunca
-- la hubo, en la creación del hilo.
--
--     coalesce(c.last_message_at, c.created_at) < now() - interval '30 days'
--
-- ⚠️ NO TOCAR el `not public.pair_has_booking(...)`: es lo que exime de la
-- purga a las conversaciones de un par que sí compró, y es la decisión (b) de
-- M-12 —el registro de lo que se prometió antes de pagar, que el §21 de los
-- Términos hace relevante en una disputa. Un hilo vacío de un par que compró
-- (el que abre el trigger de `bookings`) sigue sin borrarse, y así debe ser.
--
-- ⚠️ Y no se toca `created_at` por `updated_at`, aunque hoy den casi lo mismo:
-- `updated_at` lo mueve cualquier `update` de la fila —incluido el bloqueo por
-- moderación—, así que un admin bloqueando un hilo abandonado le regalaría 30
-- días más de vida. `created_at` no miente.
--
-- Se reemplaza la función entera porque es la única forma de tocarla: la
-- migración original ya está aplicada y no se edita (regla de oro 5). El cron
-- (`purge-expired-messages`, 04:00 diario, programado en `20260716180000`) no
-- se toca: sigue llamando a la misma función con el mismo nombre.
-- ============================================================================

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
  'US-1703 + M-12 + L1-4: purga del chat a 30 días. Mensajes de reserva por `expires_at`; conversaciones sin compra por `coalesce(last_message_at, created_at)` — el coalesce es lo que hace caducar también los hilos que se abrieron y nunca se usaron.';

-- Los grants no los cambia un `create or replace`, pero se re-declaran igual:
-- un `authenticated` que pueda vaciar mensajes ajenos es la lección de US-605,
-- y el día que alguien copie este bloque como plantilla se lo lleva puesto.
revoke execute on function public.purge_expired_messages() from public;
revoke execute on function public.purge_expired_messages() from anon;
revoke execute on function public.purge_expired_messages() from authenticated;
grant  execute on function public.purge_expired_messages() to service_role;
