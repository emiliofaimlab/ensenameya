-- ============================================================================
-- Enséñame Ya — NTF-21: «tienes un mensaje nuevo» (EY-151 · EP-12 · Doc 7)
--
-- QUÉ PASABA: escribir en el chat no avisaba a NADIE. El mensaje aparecía en la
-- app y ahí se quedaba hasta que el otro entrase por su cuenta. Con el chat
-- previo a la compra reabierto el 26-ago (`20260826140000`) eso pasa de
-- incómodo a caro: el canal que el cliente quiere para «hacer crecer la
-- relación tutor-estudiante» es justo el que el tutor no mira, y una pregunta
-- de preventa sin responder es una venta perdida — no un correo de menos.
--
-- El código NTF-21 no es inventado: lo reservó Jira el 4-ago para esta historia
-- (`EY-151`, ver `docs/BACKLOG.md` §sync 2026-08-04). NTF-18 y NTF-20 siguen
-- libres, sin cablear, y no se tocan.
--
-- ── DÓNDE SE ENGANCHA: `messages`, NO LAS FUNCIONES DE ENVÍO ────────────────
-- Hay DOS puertas de escritura (`send_message`, la de la reserva con adjuntos,
-- y `send_conversation_message`, la de la consulta previa) y las dos han
-- cambiado de cuerpo tres veces este mes (M-12 → MN-06 → EY-194). Meter el
-- aviso dentro de ellas sería duplicarlo y garantizar que la cuarta versión se
-- deje una. Un trigger `after insert` sobre la tabla lo ve todo: venga de donde
-- venga el mensaje, existe = hay que avisar. Es además la línea que ya sigue
-- el resto de EP-12 (Doc 7 §reactivas: los avisos cuelgan de transiciones de
-- datos, no de las RPC de negocio).
--
-- ── LAS CUATRO TRAMPAS, Y CÓMO SE RESUELVEN ─────────────────────────────────
--
-- 1 · NO AVISAR AL QUE ESCRIBE. El destinatario se deduce del PAR de la
--     conversación (`student_id`/`tutor_id`), que es el ancla desde M-12, y no
--     de la reserva: un mensaje pre-compra no tiene `booking_id`. Si el emisor
--     no es ninguno de los dos —imposible hoy, las dos RPC lo comprueban— no se
--     encola nada en vez de adivinar.
--
-- 2 · UN CORREO POR CONVERSACIÓN, NO POR MENSAJE. Veinte mensajes seguidos son
--     un correo. Se decide con TRES condiciones, en este orden:
--
--       a) nunca se le avisó de este hilo            → se avisa;
--       b) el último aviso tiene más de 24 h         → se avisa (recordatorio);
--       c) LEYÓ desde el último aviso Y ese aviso    → se avisa.
--          tiene más de 1 hora
--
--     (c) es la que hace el trabajo fino. «Leyó desde el último aviso» evita el
--     correo que no aporta nada: si aún no ha abierto el hilo, ya tiene un
--     aviso pendiente y repetirlo no le dice nada nuevo. Y el «más de 1 hora»
--     está porque la marca de lectura se refresca sola mientras la pantalla del
--     chat está abierta (`markConversationRead`, `components/chat/unread.ts`):
--     sin ese freno, una conversación en vivo mandaría UN CORREO POR MENSAJE,
--     que es exactamente lo que esta migración viene a evitar.
--     (b) existe para que quien nunca lee no se quede sin enterarse jamás: el
--     techo real es 1 correo/hora por hilo, y en el peor caso 1 al día.
--
--     ⚠️ Lo que se PIERDE con (c), dicho en voz alta: si el destinatario estuvo
--     en el hilo hace un rato y llega un mensaje 5 minutos después, no hay
--     correo hasta que pase la hora. Es el precio de no convertir una
--     conversación viva en 40 correos, y el mensaje sigue estando en la app con
--     su contador de no leídos.
--
--     LA `dedupe_key` ES LA SEGUNDA CERRADURA, y hace falta: la comprobación de
--     arriba es un `select` y dos mensajes que entren a la vez (dos
--     transacciones en el mismo segundo) ven los dos «no hay aviso previo» y
--     encolan los dos. La clave lleva hilo + destinatario + HORA UTC, así que
--     el `on conflict do nothing` de `enqueue_notification` (US-1202) descarta
--     el segundo. Al revés no vale: una clave por hora a secas mandaría dos
--     correos a las 10:59 y las 11:01, que es el fallo clásico de agrupar por
--     cubos fijos. Ventana deslizante para decidir, cubo fijo para la carrera.
--
-- 3 · EL CORREO NO LLEVA EL MENSAJE. El payload es solo `conversation_id`. Ni
--     el texto ni el nombre de quien escribe. Un correo se reenvía, se queda en
--     bandejas ajenas y se indexa: meter ahí lo que dos personas se dicen en
--     privado sería publicar el chat por la puerta de atrás, y encima con la
--     purga de 30 días corriendo dentro de la app y ninguna fuera. Es la misma
--     regla que ya escribió `lib/email-templates.ts` para el resto: el correo
--     dice el HECHO y lleva a la pantalla.
--
-- 4 · NO HAY QUE DUPLICAR NUMERACIÓN NI PLANTILLA. Se comprobó: no existe
--     ninguna NTF de mensajería (las que hay son reserva, pago, KYC, payout,
--     grabación), y `email-templates.ts` no tenía plantilla de chat. La nueva
--     es `new_message`, y la lista de `email-templates.check.ts` —que es el
--     contrato: plantilla que no esté ahí se marca `failed` en silencio— pasa
--     de 11 a 12.
--
-- ── DOS COSAS QUE CONVIENE SABER ────────────────────────────────────────────
--   · La CAMPANA (US-1203) pinta las filas de `notifications` sin filtrar por
--     canal, así que este aviso sale también ahí aunque su canal sea `email`.
--     Por eso el mismo commit le da texto propio y enlace en `lib/notifications.ts`;
--     sin eso diría «Novedad en tu cuenta (NTF-21)».
--   · La purga del chat borra conversaciones enteras a los 30 días sin actividad
--     (pares que no compraron), pero NO borra sus notificaciones: un aviso muy
--     viejo puede acabar enlazando a un hilo que ya no existe y esa pantalla
--     responde 404. Pasa solo con avisos de hace más de un mes, la campana
--     enseña ocho, y añadir una cascada de `notifications` a la purga sería
--     borrar el registro de que el correo se envió.
-- ============================================================================

-- ── El índice que sostiene la ventana ───────────────────────────────────────
-- La comprobación pregunta «¿cuándo fue el último NTF-21 de ESTE hilo a ESTA
-- persona?» en cada mensaje insertado. Sin índice eso es recorrer todas las
-- notificaciones del destinatario, y `notifications` es la tabla que más crece
-- del proyecto (una fila por evento y persona, para siempre). Parcial porque
-- solo interesan las NTF-21, y con la expresión del payload dentro para que la
-- respuesta salga del índice y no del heap.
create index if not exists notifications_ntf21_hilo_idx
  on public.notifications (
    recipient_id,
    (payload ->> 'conversation_id'),
    created_at desc
  )
  where type = 'NTF-21';

-- ── El trigger ──────────────────────────────────────────────────────────────
-- SECURITY DEFINER + `search_path = ''` como el resto de EP-12: lee
-- `conversations` y `conversation_reads`, que son default-deny y de las que el
-- emisor solo ve lo suyo — y aquí hace falta mirar la marca de lectura del
-- OTRO, que ninguna política deja leer (a propósito: sería un acuse de lectura
-- que nadie ha decidido dar). Nada de eso sale de la función: solo decide si se
-- encola.
--
-- ⚠️ SIN `exception when others`, y es a conciencia: lo que aquí falle tumba el
-- INSERT del mensaje. Se ha mirado qué puede fallar y no queda nada — la clave
-- repetida la absorbe el `on conflict do nothing`, y el destinatario no puede
-- haber desaparecido porque `conversations` cae por cascada con el perfil. Si
-- algún día se añade algo que pueda lanzar (una llamada externa, una tabla
-- nueva), ES AQUÍ donde hay que envolverlo: perder un mensaje del chat por un
-- correo que no se pudo encolar sería un intercambio pésimo.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_tutor   uuid;
  v_dest    uuid;
  v_ultimo  timestamptz;   -- último NTF-21 de este hilo a esta persona
  v_leido   timestamptz;   -- hasta dónde tiene leído el destinatario
begin
  select c.student_id, c.tutor_id
    into v_student, v_tutor
    from public.conversations c
   where c.id = new.conversation_id;

  -- Sin conversación no hay par y no hay a quién avisar. No debería pasar
  -- (`messages.conversation_id` es NOT NULL con FK), pero un `return` es más
  -- barato que un error dentro del INSERT de un mensaje.
  if v_student is null then
    return new;
  end if;

  v_dest := case
              when new.sender_id = v_student then v_tutor
              when new.sender_id = v_tutor   then v_student
            end;
  if v_dest is null then
    return new;   -- el emisor no es del par: no se adivina destinatario
  end if;

  select max(n.created_at)
    into v_ultimo
    from public.notifications n
   where n.recipient_id = v_dest
     and n.type = 'NTF-21'
     and n.payload ->> 'conversation_id' = new.conversation_id::text;

  select r.last_read_at
    into v_leido
    from public.conversation_reads r
   where r.conversation_id = new.conversation_id
     and r.user_id = v_dest;

  -- Las tres condiciones de arriba (a, b, c). `-infinity` para el que nunca
  -- abrió el hilo: no ha leído nada, así que (c) no se cumple.
  if not (
       v_ultimo is null
       or v_ultimo < now() - interval '24 hours'
       or (coalesce(v_leido, '-infinity'::timestamptz) > v_ultimo
           and v_ultimo < now() - interval '1 hour')
     ) then
    return new;
  end if;

  perform public.enqueue_notification(
    v_dest,
    'NTF-21',
    'email',
    'new_message',
    -- Solo el hilo. Ni cuerpo, ni remitente, ni `booking_id` (que además
    -- mandaría el enlace del correo a la reserva en vez de al chat).
    jsonb_build_object('conversation_id', new.conversation_id),
    -- hilo + destinatario + hora UTC (RN-01/02: la BD siempre en UTC).
    'NTF-21:conv:' || new.conversation_id || ':' || v_dest || ':' ||
      to_char(now() at time zone 'utc', 'YYYYMMDDHH24')
  );

  return new;
end;
$$;

comment on function public.notify_new_message() is
  'NTF-21 (EY-151): avisa por correo al OTRO participante de la conversación. Agrupa por hilo — ver la migración 20260826160000 para las tres condiciones y por qué la dedupe_key va por hora.';

drop trigger if exists notifications_on_message on public.messages;
create trigger notifications_on_message
  after insert on public.messages
  for each row execute function public.notify_new_message();
