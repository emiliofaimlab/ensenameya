-- ============================================================================
-- L1-4 (segunda mitad) — `conversations.last_message_at` nunca se rellenó
-- para lo que ya existía.
--
-- LO QUE APARECIÓ AL ARREGLAR LA PURGA. M-12 (`20260817210000`) creó
-- `conversations` y la rellenó dos veces: una fila por cada par con reservas
-- (con `created_at = min(booking.created_at)`) y `messages.conversation_id`
-- apuntando a ella. Lo que NO hizo fue rellenar `last_message_at`: esa columna
-- solo la escriben las dos funciones de envío, y esos mensajes ya estaban
-- escritos. O sea que **toda conversación anterior al 17-ago tiene
-- `last_message_at` a NULL aunque esté llena de mensajes.**
--
-- Rompe dos cosas, una visible y otra que se acaba de volver peligrosa:
--
--   1. LA BANDEJA ORDENA MAL. `my_conversations()` ordena por
--      `last_message_at desc nulls last`: un hilo con actividad de ayer, pero
--      anterior a M-12, se va al FONDO de la lista, debajo de conversaciones
--      vacías. Es un bug de hoy, no una hipótesis.
--
--   2. LA PURGA PODRÍA BORRAR DE MÁS. `20260820120000` acaba de cambiar el
--      reloj a `coalesce(last_message_at, created_at)` para que los hilos
--      abiertos y nunca usados dejen de ser inmortales. Ese `coalesce` da por
--      hecho que `last_message_at is null` significa «aquí no se ha escrito
--      nunca» — y por culpa de esto significaba también «se escribió antes del
--      17-ago». Sobre un par sin compra, con `created_at` heredado de una
--      reserva vieja, la purga se llevaría el hilo entero (y sus mensajes, por
--      cascada) semanas antes de tiempo.
--
-- Las dos se arreglan con el mismo `update`, y hay que hacerlo AQUÍ y no en el
-- fichero de la purga porque aquel ya está aplicado y las migraciones no se
-- editan (regla de oro 5).
--
-- ⚠️ EL INVARIANTE QUE SE RESTAURA, Y QUE NO HAY QUE VOLVER A ROMPER:
--     `last_message_at is null`  ⟺  esta conversación no tiene ni un mensaje.
-- Se sostiene solo mientras `messages` siga sin más vía de escritura que
-- `send_message` y `send_conversation_message`, que la actualizan siempre. Si
-- alguna vez se insertan mensajes por otro camino (un backfill, una
-- importación, un `insert` de soporte), ese camino tiene que tocar
-- `last_message_at` o volvemos aquí — con la purga borrando de más.
--
-- Es una reparación de datos de una sola vez: se puede volver a ejecutar sin
-- efecto (el `where` deja de encontrar filas en cuanto se corrige).
-- ============================================================================

update public.conversations c
   set last_message_at = ultimo.fecha
  from (
    select m.conversation_id, max(m.created_at) as fecha
      from public.messages m
     where m.conversation_id is not null
     group by m.conversation_id
  ) ultimo
 where ultimo.conversation_id = c.id
   -- Solo las que se quedaron sin reloj. A las que ya lo tienen no se las
   -- toca: su valor lo puso la función de envío y es el bueno.
   and c.last_message_at is null;
