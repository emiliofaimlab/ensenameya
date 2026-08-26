-- ============================================================================
-- Enséñame Ya — EY-194: vuelve la consulta previa a la compra
-- (Doc 21 · marcha atrás EXPLÍCITA sobre P-1 · reabre M-12, cierra MN-06)
--
-- ⚠️ ESTO DESHACE UNA DECISIÓN QUE EL CLIENTE TOMÓ POR ESCRITO EL 20-AGO, y va
-- dicho aquí antes que nada. P-1 fue «sí, el chat solo tras reservar» y se
-- ejecutó el mismo día (MN-06, `20260820180000`). El 26-ago el cliente pidió lo
-- contrario, con estas palabras:
--
--     «Queremos que las preguntas sean privadas y directas entre Tutor y
--      estudiante […] consideramos que esa relación tutor-estudiante es
--      primordial y la mejor manera de hacerla crecer es darle ese chat directo
--      y no estilo foro.»
--
-- Es legítimo —M-12 se cerró el mismo día en que se construyó y el cliente
-- nunca llegó a verlo funcionando, porque no está en producción— pero es marcha
-- atrás, no un ajuste.
--
-- ── POR QUÉ ESTA MIGRACIÓN ES TAN CORTA ─────────────────────────────────────
-- Porque MN-06 se escribió para poder deshacerse. Dejó el criterio en UNA sola
-- función y las dos puertas —`open_conversation` y `send_conversation_message`—
-- leen de ella. Así que reabrir el canal es cambiar `pair_can_chat`, y ninguna
-- de las dos funciones se toca: se evita reescribir 200 líneas de anti-spam
-- para cambiar una condición, que es como se introducen las divergencias.
--
-- ── LO QUE **NO** SE TOCA, Y NO ES PEREZA ───────────────────────────────────
--   · **Los topes de M-12 se quedan enteros**: 5 mensajes seguidos sin que el
--     tutor conteste, 20 en total antes de comprar, 10 hilos nuevos por alumno
--     y día. Son los límites que el propio enunciado del cliente pedía
--     («x número de mensajes»), y ahora vuelven a ser la barrera real — antes
--     estaban detrás de una puerta cerrada y casi no llegaban a actuar.
--   · **Sin adjuntos antes de comprar.** `send_conversation_message` no tiene
--     ni el parámetro. Por diseño.
--   · **La fusión con el chat de la clase no hay que programarla**: nunca
--     fueron dos hilos. La conversación se ancla al par (alumno, tutor), así
--     que quien preguntó el martes y compró el jueves sigue viendo su pregunta
--     arriba del todo.
--   · **`open_conversation` sigue exigiendo tutor APROBADO** y sigue rechazando
--     escribirse a uno mismo. Eso nunca fue de MN-06.
--
-- ── DOS EFECTOS QUE HAY QUE SABER ANTES DE APLICARLA ────────────────────────
--   1. **Los hilos congelados el 20-ago vuelven a admitir escritura.** MN-06 los
--      dejó en solo lectura sin borrarlos; al reabrir la puerta se descongelan
--      solos. Es lo que significa reabrir, pero conviene no descubrirlo después.
--   2. ⚠️ **La purga de 30 días NO se toca y sigue corriendo.**
--      `purge_expired_messages()` borra la conversación entera —mensajes,
--      marcas de lectura y reportes por cascada— a los 30 días sin actividad si
--      el par no compró. Los hilos del 17-20 de agosto llevan el reloj corriendo
--      desde que se congelaron: si nadie escribe, desaparecen a mediados de
--      septiembre. No se cambia aquí porque ese plazo coincide con la retención
--      que las páginas legales publican, y tocarlo sería cambiar una política
--      publicada — es decisión de producto, no de esta migración.
-- ============================================================================


-- ── El predicado, ahora sin puerta ──────────────────────────────────────────
--
-- Se conserva la FUNCIÓN aunque su cuerpo pase a ser `true`, y no se borra a
-- propósito. Dos razones:
--   · Sus tres llamantes (`open_conversation`, `send_conversation_message` y
--     `my_conversations`) seguirían necesitando algo en su sitio, y borrarla
--     obligaría a reescribir las tres para quitar la llamada — justo lo que
--     esta migración evita.
--   · El criterio ha cambiado dos veces en nueve días. Mientras siga viviendo
--     en un solo sitio, la próxima vez vuelve a ser una migración de diez
--     líneas. Repartido por las tres funciones, no.
--
-- Qué limita entonces el canal, ahora que esto no limita nada: los topes de
-- M-12 dentro de `send_conversation_message` y `open_conversation`. Están
-- intactos y son los que el cliente pidió.
create or replace function public.pair_can_chat(p_student_id uuid, p_tutor_id uuid)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select true;
$$;

comment on function public.pair_can_chat(uuid, uuid) is
  'EY-194 (26-ago): la puerta de MN-06 se retira — cualquier alumno puede escribir a un tutor aprobado ANTES de comprar, que es lo que pidió el cliente al elegir el mix del Doc 21. Se conserva la función, con cuerpo `true`, porque es el ÚNICO sitio donde vive este criterio y ya ha cambiado dos veces en nueve días: mientras siga aquí, volver a cerrarlo es una migración de diez líneas. Lo que limita el canal son los topes de M-12 (5 seguidos / 20 totales / 10 hilos al día) dentro de open_conversation y send_conversation_message, intactos.';

-- Sigue sin `grant` a ningún rol de la API, igual que en MN-06: recibe el par
-- por parámetro y no mira `auth.uid()`, así que publicarla por PostgREST dejaría
-- preguntar por dos uuid cualesquiera (la lección de `20260820150000`). Sus
-- llamantes son SECURITY DEFINER y corren como su dueña.
revoke execute on function public.pair_can_chat(uuid, uuid) from public;
revoke execute on function public.pair_can_chat(uuid, uuid) from anon;
revoke execute on function public.pair_can_chat(uuid, uuid) from authenticated;
