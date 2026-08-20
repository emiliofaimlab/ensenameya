-- ============================================================================
-- MN-06 — El chat, solo después de reservar.
--
-- LA DECISIÓN. El cliente contestó P-1 el 20-ago: «sí, el chat solo tras
-- reservar; la minuta manda». Es una MARCHA ATRÁS CONSCIENTE sobre M-12
-- (`20260817210000`, del 17-ago), que abrió el chat antes de comprar. Está
-- confirmado por escrito, así que se hace — pero se hace ENCIMA, no borrando:
-- `9305c1c` no se revierte y `20260817210000` no se edita (regla de oro 5).
-- Todo lo que M-12 construyó —la conversación como ancla, el histórico
-- continuo, la bandeja, la purga, los reportes— sigue en pie y sigue siendo
-- correcto. Lo único que cambia es QUIÉN puede empezar y QUIÉN puede escribir.
--
-- ── POR QUÉ NO HAY UNA SOLA POLÍTICA RLS AQUÍ ───────────────────────────────
-- Sería trabajo muerto y conviene decirlo antes de que alguien lo eche en
-- falta en la revisión. `conversations` no tiene política de INSERT para NADIE
-- (M-12 lo dejó escrito: se crean por función), y los dos caminos de creación
-- —`open_conversation` y el trigger `bookings_ensure_conversation`— son
-- SECURITY DEFINER, que se saltan la RLS por definición. Una política nueva no
-- la evaluaría nadie. La barrera va DENTRO de las funciones, que es donde ya
-- viven los otros tres frenos de la decisión (e) de M-12.
--
-- ── EL PREDICADO: «COMPRÓ» NO ES SUFICIENTE, Y ESA ES LA TRAMPA ─────────────
-- La tentación es meter `pair_has_booking` a secas en las dos funciones. Rompe
-- el checkout a medias, y de la peor manera posible:
--
--   `send_message` (la vía de la reserva) DELEGA en `send_conversation_message`
--   cuando el par todavía no ha comprado. Es deliberado y está razonado en
--   M-12: la reserva nace en `pending_payment` en cuanto alguien empieza a
--   pagar, así que un checkout abandonado traía un `booking_id` con el que
--   saltarse los topes anti-spam. Con `pair_has_booking` a secas dentro de la
--   función delegada, un alumno que dejó el pago a medias abre `/chat/<reserva>`
--   —la pantalla DE SU PROPIA RESERVA— escribe, y recibe «no tienes mentoría
--   con este tutor». En su propia reserva.
--
-- Así que el predicado es «este par tiene una relación comercial VIVA o
-- CERRADA»: compró, o tiene un checkout en curso. Vive en UNA función,
-- `pair_can_chat`, y las dos guardas leen de ella — la lección de MN-08
-- (`20260820130000`): dos definiciones distintas de lo mismo acaban
-- discrepando, y entonces la bandeja dice una cosa y el hilo otra.
--
-- ⚠️ Y `pending_payment` NO es una puerta trasera abierta, porque dura 20
-- MINUTOS: `expire_stale_bookings` (`20260709190000`, pg_cron cada 5 min) pasa
-- esas reservas a `cancelled` sin pago. O sea que el checkout abandonado
-- habilita el chat el rato que dura el checkout y ni un minuto más, y encima
-- con los topes de M-12 puestos (5 seguidos / 20 totales), porque
-- `pair_has_booking` sigue diciendo que no ha comprado.
--
-- ⚠️ CONSECUENCIA QUE HAY QUE DECIR EN VOZ ALTA: un par cuya ÚNICA reserva se
-- canceló antes de darse (checkout caducado, tutor que no aceptó, cancelación
-- del alumno) se queda sin poder escribir. Es la misma lista de estados que ya
-- decide si el tutor ve el nombre de su alumno (`tutor_students`) y si el hilo
-- caduca a los 30 días; añadirle `cancelled` aquí sería estrenar una CUARTA
-- lectura de «este par tiene relación», justo después de que MN-08 las
-- unificara. El hilo se sigue leyendo y se sigue descargando; y si hay que
-- hablar de la cancelación, para eso está `/contacto` (DL-01). Si el cliente
-- quiere lo contrario, es una línea en `pair_can_chat` y ningún cambio más.
--
-- ── LOS HILOS QUE YA EXISTEN: VISIBLES, PERO SIN PODER ESCRIBIR (P-1b) ──────
-- No se borra ninguno. La visibilidad no depende de nada de este fichero: la
-- da la política `conversations_select_participant` de M-12 y la de `messages`
-- que cuelga de ella, y las dos siguen intactas. Un hilo pre-compra sigue
-- apareciendo en la bandeja, se sigue abriendo y se sigue descargando desde
-- `/api/chat/<id>/download`; lo único que ya no acepta es un mensaje nuevo.
-- ⚠️ PERO «no se borra ninguno» vale solo para ESTA migración, no para
-- siempre, y conviene no leerlo de más. `purge_expired_messages()` borra la
-- conversación entera —con sus mensajes, marcas de lectura y reportes por
-- cascada— cuando lleva 30 días sin actividad y el par no ha comprado, y NO
-- exige que esté vacía. Al cerrar la escritura, `last_message_at` se congela en
-- el último mensaje que se pudo mandar: **a los 30 días de ese instante, todos
-- los hilos pre-compra desaparecen solos.**
--
-- No se cambia aquí a propósito. Es coherente con la retención de 30 días que
-- las páginas legales publican para el chat (decisión 22), así que tocarla
-- sería cambiar una política publicada, no arreglar un fallo. Pero el cliente
-- pidió que estos hilos «se queden visibles» y esto los caduca: es una decisión
-- de producto pendiente, no un descuido. Anotada en el Doc 20.
--
-- ── DÓNDE EXACTAMENTE VA LA GUARDA EN `open_conversation` ───────────────────
-- La función hace tres cosas en orden: valida el tutor, RECUPERA el hilo si ya
-- existe, y si no lo crea. La guarda va después de validar el tutor y ANTES de
-- la recuperación. Es una decisión, no un detalle:
--
--   · Puesta DESPUÉS, la función seguiría devolviendo el id a cualquier par que
--     ya tuviera hilo — o sea, a exactamente los hilos que P-1b acaba de dejar
--     en solo lectura. Devolver una llave de una habitación donde no se puede
--     hacer nada no es amable: es una función que miente, y el día que alguien
--     escriba una pantalla nueva leerá ese `return` como un permiso.
--   · Puesta ANTES, la respuesta a «¿puedo empezar a hablar con este tutor sin
--     comprarle?» es NO siempre, sin depender de cuándo se abrió el hilo. Un
--     solo modo de fallo y un solo mensaje.
--   · Y no le cuesta nada a P-1b: `open_conversation` NO es el camino por el
--     que se ven los hilos viejos. Eso es `my_conversations()` + la RLS. Su
--     único llamante era el botón «Escribir a …» de la ficha pública del
--     tutor, que esta misma ficha retira.
--
-- El `insert` final queda como respaldo y no como camino principal: hoy toda
-- reserva crea su hilo por trigger, así que quien pasa la guarda casi siempre
-- lo encuentra ya hecho. «Casi»: la purga borra el hilo vacío de un par cuya
-- reserva se canceló, y si ese par vuelve a comprar hay que poder recrearlo.
--
-- ORDEN OBLIGATORIO al desplegar: `db:push` → `db:types` → frontend. Esta
-- migración cambia la FIRMA de `my_conversations()` (columna `can_chat`); un
-- frontend que llegue antes pide una columna que todavía no existe.
-- ============================================================================

-- ── 1 · El predicado, en un solo sitio ───────────────────────────────────────
-- «Este par puede tener chat»: compró (la lista de estados de
-- `pair_booking_stats`, que es la única que hay) o está pagando ahora mismo.
--
-- SECURITY DEFINER por lo mismo que sus dos vecinas: ni el alumno puede leer
-- las reservas del tutor ni al revés, y esto solo devuelve un booleano sobre un
-- par que el llamante ya conoce. No mira `auth.uid()` en ningún sitio.
create or replace function public.pair_can_chat(p_student_id uuid, p_tutor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.pair_has_booking(p_student_id, p_tutor_id)
      or exists (
        select 1
          from public.bookings b
         where b.student_id = p_student_id
           and b.tutor_id   = p_tutor_id
           -- El checkout EN CURSO, y solo ése: `expire_stale_bookings` lo pasa
           -- a `cancelled` a los 20 minutos, así que esta rama se cierra sola.
           and b.status = 'pending_payment'
      );
$$;

comment on function public.pair_can_chat(uuid, uuid) is
  'MN-06: ¿este par puede escribirse? Compró (`pair_has_booking`) o tiene un checkout en curso (`pending_payment`, que caduca en 20 min). ÚNICO sitio donde vive la puerta del chat: la leen `open_conversation` y `send_conversation_message`. NO tiene grant a ningún rol de la API: recibe el par por parámetro y no mira `auth.uid()`, así que publicarla por PostgREST dejaría preguntar por dos uuid cualesquiera (la lección de `20260820150000`). Sus llamantes son SECURITY DEFINER y corren como su dueña.';

revoke execute on function public.pair_can_chat(uuid, uuid) from public;
revoke execute on function public.pair_can_chat(uuid, uuid) from anon;
revoke execute on function public.pair_can_chat(uuid, uuid) from authenticated;

-- ── 2 · La puerta de entrada ─────────────────────────────────────────────────
-- Idéntica a la de M-12 salvo el bloque marcado. Se reescribe entera porque un
-- `create or replace` no admite parches: la migración original ya está aplicada
-- y no se edita (regla de oro 5).
create or replace function public.open_conversation(p_tutor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
  v_nuevas int;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if v_uid = p_tutor_id then
    raise exception 'no puedes escribirte a ti mismo' using errcode = 'check_violation';
  end if;

  -- Solo tutores APROBADOS reciben consultas. Sin esto, `p_tutor_id` sería un
  -- uuid cualquiera de `profiles` y esto se convertiría en un canal de mensajes
  -- entre usuarios arbitrarios, que es otro producto y sin moderación.
  if not exists (
    select 1 from public.tutor_profiles tp
     where tp.profile_id = p_tutor_id
       and tp.approval_status = 'approved'
  ) then
    raise exception 'ese tutor no está disponible' using errcode = 'no_data_found';
  end if;

  -- ── MN-06 · LA PUERTA ─────────────────────────────────────────────────────
  -- Antes de recuperar el hilo, no después: el porqué está en la cabecera. El
  -- mensaje se enseña tal cual al usuario (el frontend pinta `error.message`),
  -- así que dice qué hacer y no qué ha fallado.
  if not public.pair_can_chat(v_uid, p_tutor_id) then
    raise exception 'reserva una mentoría con este tutor para poder escribirle'
      using errcode = 'check_violation';
  end if;

  -- Si ya existe, se devuelve TAL CUAL: eso es el histórico continuo. Volver de
  -- la ficha del tutor a una conversación de hace tres meses (o a la de una
  -- reserva ya dada) es exactamente lo que se quiere.
  select id into v_id
    from public.conversations
   where student_id = v_uid and tutor_id = p_tutor_id;
  if v_id is not null then
    return v_id;
  end if;

  -- Freno de spray sobre el catálogo (decisión e de M-12): abrir hilo con 200
  -- tutores de madrugada. Con la puerta de MN-06 delante ya casi no puede
  -- dispararse —hacen falta 10 reservas en 24 h—, pero se queda: es un cinturón
  -- barato y el día que el criterio de arriba se relaje vuelve a ser la única
  -- red.
  select count(*) into v_nuevas
    from public.conversations
   where student_id = v_uid
     and created_at > now() - interval '24 hours';
  if v_nuevas >= 10 then
    raise exception 'has abierto demasiadas conversaciones hoy; inténtalo mañana'
      using errcode = 'check_violation';
  end if;

  -- ⚠️ RESPALDO, no camino principal: desde M-12 toda reserva crea su hilo por
  -- el trigger `bookings_ensure_conversation`, así que quien llega hasta aquí
  -- normalmente ya lo tenía. Se conserva porque la purga SÍ borra el hilo vacío
  -- de un par cuya reserva se canceló, y ese par puede volver a comprar.
  insert into public.conversations (student_id, tutor_id)
  values (v_uid, p_tutor_id)
  -- Dos pestañas pulsando a la vez: el unique salta y `do update` devuelve la
  -- fila que ganó en vez de un 23505 en la cara del usuario.
  on conflict (student_id, tutor_id) do update set updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.open_conversation(uuid) is
  'M-12 + MN-06: abre (o recupera) el hilo del alumno con un tutor aprobado, y SOLO si el par ya tiene mentoría reservada o un checkout en curso (`pair_can_chat`). Devuelve siempre la MISMA conversación: es lo que hace que comprar no reinicie el histórico.';

revoke execute on function public.open_conversation(uuid) from public;
revoke execute on function public.open_conversation(uuid) from anon;
grant  execute on function public.open_conversation(uuid) to authenticated;

-- ── 3 · La escritura ─────────────────────────────────────────────────────────
-- Idéntica a la de M-12 salvo el bloque marcado. La guarda va después del
-- bloqueo por moderación y antes de los topes: son tres filtros del mismo tipo
-- —«puedes escribir aquí»— y este es el más general de los tres.
--
-- ⚠️ Frena a los DOS lados, no solo al alumno. Los topes anti-spam de abajo son
-- solo para el alumno (el tutor contesta en su bandeja: ponerle tope sería
-- castigar al que atiende), pero «este hilo es de solo lectura» no es un tope:
-- es el estado del hilo. Un tutor que pudiera seguir escribiendo en una
-- consulta previa dejaría el hilo a medias —él habla, el otro no puede
-- responder—, que es peor que cerrarlo entero.
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
  v_seguidos int;
  v_total    int;
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
  -- pantalla de su propia reserva. El razonamiento largo, en la cabecera.
  --
  -- El mensaje está redactado para que valga a los dos lados: el tutor también
  -- lo puede recibir, y «no tienes mentoría con este tutor» no le diría nada.
  if not public.pair_can_chat(v_c.student_id, v_c.tutor_id) then
    raise exception 'para escribir aquí hace falta una mentoría reservada entre los dos'
      using errcode = 'check_violation';
  end if;

  v_comprado := public.pair_has_booking(v_c.student_id, v_c.tutor_id);

  -- Los topes son SOLO para el alumno y SOLO antes de la primera compra. El
  -- tutor contesta en su propia bandeja: ponerle tope sería castigar al que
  -- atiende. Y con la compra hecha manda la relación comercial, no el freno.
  --
  -- ⚠️ Desde MN-06, `not v_comprado` aquí ya solo puede significar UNA cosa:
  -- checkout en curso (lo demás no ha pasado la puerta de arriba). Los topes se
  -- quedan igual: son 20 minutos de ventana, pero es la ventana en la que el
  -- alumno tiene un `booking_id` y todavía no ha pagado nadie.
  if v_uid = v_c.student_id and not v_comprado then
    -- (i) Mensajes seguidos sin respuesta. Es el freno que de verdad para el
    -- acoso: da igual cuántos escribas si el otro participa.
    select count(*) into v_seguidos
      from public.messages m
     where m.conversation_id = v_c.id
       and m.sender_id = v_uid
       and m.created_at > coalesce(
             (select max(r.created_at) from public.messages r
               where r.conversation_id = v_c.id and r.sender_id = v_c.tutor_id),
             '-infinity'::timestamptz
           );
    if v_seguidos >= 5 then
      raise exception 'espera a que el tutor responda antes de seguir escribiendo'
        using errcode = 'check_violation';
    end if;

    -- (ii) Tope duro de la consulta. Una relación de soporte infinita y gratis
    -- es justo la desintermediación que el §21 de los Términos prohíbe: a los
    -- 20 mensajes, o se compra o se habla en otra parte.
    select count(*) into v_total
      from public.messages m
     where m.conversation_id = v_c.id
       and m.sender_id = v_uid
       and m.booking_id is null;
    if v_total >= 20 then
      raise exception 'has alcanzado el límite de mensajes antes de reservar'
        using errcode = 'check_violation';
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
  'M-12 + MN-06: mensaje en el hilo del par. Exige `pair_can_chat` (mentoría reservada o checkout en curso) — no `pair_has_booking`, porque `send_message` delega aquí durante el checkout. Sin adjuntos por diseño; topes anti-spam mientras el alumno no haya pagado.';

revoke execute on function public.send_conversation_message(uuid, text) from public;
revoke execute on function public.send_conversation_message(uuid, text) from anon;
grant  execute on function public.send_conversation_message(uuid, text) to authenticated;

-- ── 4 · Que la bandeja sepa dónde se puede escribir ──────────────────────────
-- Sin esto, la UI no puede distinguir un hilo de solo lectura de uno vivo: los
-- dos llegan con `has_booking = false` —el legado pre-compra y el checkout en
-- curso— y solo uno acepta mensajes. Un cuadro de texto que traga lo escrito y
-- devuelve un error rojo del servidor es peor que un cuadro deshabilitado con
-- una explicación, así que la respuesta la da quien la sabe: la base de datos.
--
-- ⚠️ `can_chat` NO incluye `blocked_at`, aunque las dos cosas impidan escribir.
-- Son dos motivos distintos y la pantalla dice cosas distintas («bloqueada por
-- moderación» vs. «reserva para escribir»); mezclarlas obligaría a la UI a
-- adivinar cuál de los dos era. `blocked_at` ya viaja en su propia columna.
--
-- ⚠️ `create or replace` NO SIRVE: añadir una columna a un `returns table`
-- cambia el tipo de retorno y Postgres lo rechaza. Hay que dropear y volver a
-- crear — y RE-DECLARAR los grants debajo, que el `drop` se lleva. (Es la misma
-- nota que dejó MN-08 dos días antes; se cumple igual.)
drop function if exists public.my_conversations();

create function public.my_conversations()
returns table (
  id                 uuid,
  other_id           uuid,
  other_name         text,
  other_avatar_path  text,
  -- `true` si el OTRO es el tutor (o sea: yo soy el alumno de este hilo).
  other_is_tutor     boolean,
  last_message_at    timestamptz,
  has_booking        boolean,
  -- MN-06 · ¿se puede escribir en este hilo? Difiere de `has_booking` solo
  -- durante el checkout (20 min), que es justo el caso que la UI no sabía ver.
  can_chat           boolean,
  -- MN-08 · las dos lecturas de «cuántas mentorías» (ver P-7).
  product_count      integer,
  session_count      integer,
  blocked_at         timestamptz,
  last_booking_id    uuid,
  last_product_title text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    case when c.student_id = (select auth.uid()) then c.tutor_id else c.student_id end,
    -- El nombre del tutor sale de `tutor_profiles.display_name` (la copia
    -- publicable, DD-01) y el del alumno de `profiles.full_name`. Son dos
    -- caminos distintos porque son dos datos distintos: uno es público de
    -- catálogo y el otro es privado y solo lo ve quien comparte hilo.
    case when c.student_id = (select auth.uid())
         then (select tp.display_name from public.tutor_profiles tp where tp.profile_id = c.tutor_id)
         else (select p.full_name     from public.profiles       p  where p.id         = c.student_id)
    end,
    case when c.student_id = (select auth.uid())
         then (select tp.avatar_path from public.tutor_profiles tp where tp.profile_id = c.tutor_id)
         else (select p.avatar_path  from public.profiles       p  where p.id         = c.student_id)
    end,
    c.student_id = (select auth.uid()),
    c.last_message_at,
    -- `has_booking` sale del MISMO agregado que los dos recuentos
    -- (`pair_booking_stats`): es el resultado idéntico con una llamada por fila
    -- en vez de dos, y garantiza que «tiene reserva» y «tiene 2 mentorías» no
    -- puedan contradecirse.
    st.has_booking,
    -- MN-06 · la misma función que rechaza en el servidor. Si algún día las dos
    -- respuestas se separan, la culpa será de haber escrito el criterio dos
    -- veces — por eso aquí no se escribe, se llama.
    public.pair_can_chat(c.student_id, c.tutor_id),
    st.product_count,
    st.session_count,
    c.blocked_at,
    ultima.id,
    ultima.title
  from public.conversations c
  left join lateral (
    select b.id, pr.title
      from public.bookings b
      join public.products pr on pr.id = b.product_id
     where b.student_id = c.student_id
       and b.tutor_id   = c.tutor_id
     order by b.created_at desc
     limit 1
  ) ultima on true
  -- Lateral hermano del de arriba (MN-08). Siempre devuelve exactamente una
  -- fila —es un agregado sin `group by`—, así que el `left join` nunca añade
  -- nulos y `has_booking` sigue sin poder ser null.
  left join lateral public.pair_booking_stats(c.student_id, c.tutor_id) st on true
  -- El filtro de participación, a mano y explícito: es DEFINER, así que la RLS
  -- de `conversations` no está mirando. Es LA línea que no se puede tocar.
  where (select auth.uid()) in (c.student_id, c.tutor_id)
  order by c.last_message_at desc nulls last, c.created_at desc;
$$;

comment on function public.my_conversations() is
  'M-12 + MN-08 + MN-06: la bandeja. Por cada hilo del usuario, con quién habla (nombre y foto), si ya hubo compra (`has_booking`), si se puede escribir (`can_chat`, que añade el checkout en curso), cuántas mentorías (`product_count`) y cuántas clases (`session_count`) hay detrás, y de qué mentoría fue la última reserva. SECURITY DEFINER acotada por participación en la conversación.';

revoke execute on function public.my_conversations() from public;
revoke execute on function public.my_conversations() from anon;
grant  execute on function public.my_conversations() to authenticated;
