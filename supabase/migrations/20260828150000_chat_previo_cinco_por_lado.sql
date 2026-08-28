-- ═══════════════════════════════════════════════════════════════════════════
-- Chat previo a la reserva: CINCO MENSAJES POR CADA LADO
--
-- Decisión del cliente (sesión del 28-ago-2026): «5 mensajes máximo de lado y
-- lado, 5 del tutor, 5 del estudiante. más nada».
--
-- ── QUÉ CAMBIA, Y POR QUÉ IMPORTA ──────────────────────────────────────────
-- Los topes de M-12 que había hasta hoy eran DOS, y los dos eran **solo del
-- alumno**:
--
--   (i)  5 mensajes SEGUIDOS sin que el tutor conteste
--   (ii) 20 mensajes en total antes de comprar
--
-- Y esa asimetría era deliberada: «el tutor contesta en su propia bandeja:
-- ponerle tope sería castigar al que atiende» (`20260817210000`). El cliente ha
-- decidido lo contrario —quiere el canal previo acotado por igual a los dos—,
-- así que aquí se invierte esa decisión a propósito, no por descuido.
--
-- ⚠️ **CONSECUENCIA QUE HAY QUE CONOCER:** a partir de ahora un tutor que gaste
-- sus cinco mensajes NO PUEDE contestar la última pregunta del alumno. Antes
-- eso no podía pasar. Es el precio de la simetría y está aceptado; si algún día
-- escuece, lo que hay que subir es el tope del tutor, no volver a cero.
--
-- ── POR QUÉ DESAPARECE EL TOPE DE «SEGUIDOS» ───────────────────────────────
-- No se relaja: se vuelve **inalcanzable**. Con cinco mensajes en total por
-- lado nadie puede encadenar seis sin respuesta, así que la comprobación (i)
-- era código muerto que solo podía confundir al siguiente que leyera esto. El
-- freno anti-acoso que (i) daba lo da ahora, y más fuerte, el tope duro.
--
-- El tope de 20 (ii) se sustituye por el de 5: es el mismo criterio —«o se
-- compra o se habla en otra parte», §21 de los Términos— con otro número.
--
-- El tope de 10 hilos al día de `open_conversation` **no se toca**: es otra
-- cosa (cuántos tutores puedes abrir), y el cliente no habló de él.
--
-- ── LO QUE NO CAMBIA ───────────────────────────────────────────────────────
-- · Los topes siguen siendo SOLO antes de la primera compra. Con la reserva
--   hecha manda la relación comercial y el canal se abre.
-- · `pair_can_chat` (la puerta de MN-06, hoy con cuerpo `true` por EY-194)
--   sigue mandando sobre quién puede escribir. Aquí solo se cuenta.
-- · Sin adjuntos antes de comprar, por diseño de M-12.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * El tope, en UN solo sitio.
 *
 * Es una función y no un número repetido en dos `if` porque la interfaz también
 * lo dice en voz alta ahora («te quedan N de 5»), y un tope que la pantalla
 * promete distinto del que el servidor aplica es exactamente el fallo que hay
 * que evitar. `immutable` para que el planner la trate como la constante que es.
 *
 * SIN grant a ningún rol de la API: no hace falta que el navegador la llame —el
 * front lleva su propia constante junto al texto—, y todo lo que no necesita
 * estar publicado en PostgREST no se publica (la lección de `20260820150000`).
 */
create or replace function public.pre_booking_message_cap()
returns int
language sql
immutable
set search_path = ''
as $$ select 5 $$;

comment on function public.pre_booking_message_cap() is
  'Cliente 28-ago-2026: mensajes que cada lado puede enviar en el chat previo a la reserva. ÚNICO sitio donde vive el número; lo lee send_conversation_message. Sustituye a los topes de M-12 (5 seguidos / 20 totales), que eran solo del alumno.';

revoke execute on function public.pre_booking_message_cap() from public;
revoke execute on function public.pre_booking_message_cap() from anon;
revoke execute on function public.pre_booking_message_cap() from authenticated;

create or replace function public.send_conversation_message(
  p_conversation_id uuid,
  p_body            text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_c        record;
  v_body     text := btrim(coalesce(p_body, ''));
  v_msg      uuid;
  v_comprado boolean;
  v_mios     int;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if v_body = '' then
    raise exception 'el mensaje no puede estar vacío' using errcode = 'check_violation';
  end if;

  select id, student_id, tutor_id, blocked_at into v_c
    from public.conversations
   where id = p_conversation_id
     and v_uid in (student_id, tutor_id);
  if v_c.id is null then
    -- Misma respuesta para "no existe" y "no es tuya": no se confirma la
    -- existencia de conversaciones ajenas.
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;

  if v_c.blocked_at is not null then
    raise exception 'esta conversación está bloqueada por moderación'
      using errcode = 'check_violation';
  end if;

  -- ── MN-06 · LA PUERTA ─────────────────────────────────────────────────────
  -- `pair_can_chat` y NO `pair_has_booking`: aquí entra también `send_message`
  -- cuando el par no ha comprado todavía, y cerrarlo a secas dejaría al alumno
  -- con un checkout a medias leyendo «no tienes mentoría con este tutor» en la
  -- pantalla de su propia reserva.
  --
  -- El mensaje está redactado para que valga a los dos lados: el tutor también
  -- lo puede recibir, y «no tienes mentoría con este tutor» no le diría nada.
  if not public.pair_can_chat(v_c.student_id, v_c.tutor_id) then
    raise exception 'para escribir aquí hace falta una mentoría reservada entre los dos'
      using errcode = 'check_violation';
  end if;

  v_comprado := public.pair_has_booking(v_c.student_id, v_c.tutor_id);

  -- ── EL TOPE, AHORA SIMÉTRICO ──────────────────────────────────────────────
  -- Sin `v_uid = v_c.student_id`: esa condición es justo lo que el cliente
  -- quitó el 28-ago. Ahora cuenta el que escriba, sea quien sea.
  --
  -- `booking_id is null` es lo que hace que esto sea el canal PREVIO: los
  -- mensajes que cuelgan de una reserva son otra conversación y no gastan
  -- cupo. Mismo predicado que usaba el tope de 20 al que sustituye.
  if not v_comprado then
    select count(*) into v_mios
      from public.messages m
     where m.conversation_id = v_c.id
       and m.sender_id = v_uid
       and m.booking_id is null;

    if v_mios >= public.pre_booking_message_cap() then
      -- Dos textos, porque la salida de cada lado es distinta: el alumno
      -- reserva, el tutor espera a que reserven. Un mensaje único obligaría a
      -- redactarlo tan vago que no diría qué hacer.
      if v_uid = v_c.student_id then
        raise exception 'has usado tus % mensajes antes de reservar; reserva una mentoría para seguir hablando con este tutor',
          public.pre_booking_message_cap() using errcode = 'check_violation';
      else
        raise exception 'has usado tus % mensajes antes de la reserva; podrás seguir escribiendo cuando el alumno reserve',
          public.pre_booking_message_cap() using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- `expires_at` explícitamente NULL: decisión (b) de M-12. El `check` de la
  -- tabla no dejaría otra cosa, pero se escribe aquí para que se lea al lado
  -- del motivo.
  insert into public.messages (conversation_id, booking_id, sender_id, body, expires_at)
  values (v_c.id, null, v_uid, v_body, null)
  returning id into v_msg;

  update public.conversations set last_message_at = now() where id = v_c.id;

  return v_msg;
end;
$$;

comment on function public.send_conversation_message(uuid, text) is
  'M-12 + cliente 28-ago-2026: mensaje en el hilo del par. Sin adjuntos por diseño. El tope previo a la reserva es SIMÉTRICO — pre_booking_message_cap() por cada lado— y sustituye a los de M-12 (5 seguidos / 20 totales), que solo pesaban sobre el alumno.';

-- `create or replace` conserva los privilegios, pero se repiten por la misma
-- razón que en `20260820180000`: que el grant se lea junto a la función y no
-- haya que ir a buscarlo tres migraciones atrás.
revoke execute on function public.send_conversation_message(uuid, text) from public;
revoke execute on function public.send_conversation_message(uuid, text) from anon;
grant  execute on function public.send_conversation_message(uuid, text) to authenticated;
