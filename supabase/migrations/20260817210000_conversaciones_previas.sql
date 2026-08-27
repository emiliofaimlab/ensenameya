-- ============================================================================
-- M-12 — Hablar con el tutor ANTES de pagarle.
--
-- EL PROBLEMA. El chat solo existía dentro de una reserva pagada
-- (`messages.booking_id not null` + RLS "eres participante de ESA reserva") y
-- encima con una ventana que abría 2 días antes de la clase (RN-41). Para
-- preguntar "¿esto cubre lo que necesito?" había que comprar primero: una
-- barrera justo en el segundo en que se decide la compra.
--
-- ── DECISIÓN (a) · DÓNDE CUELGA UN MENSAJE SIN RESERVA ──────────────────────
-- Las dos salidas eran: (1) `booking_id` nullable con algo por encima, o (2)
-- una tabla de conversaciones de la que cuelgue `messages`. Se elige (2), y no
-- por gusto arquitectónico:
--
--   · Con `booking_id` nullable hacen falta DOS anclas vivas a la vez (reserva
--     y "lo otro"), y todo lo que hoy cuelga del chat —RLS, marcas de lectura,
--     contador de no leídos, purga, descarga— tendría que aprender a distinguir
--     el caso nulo. Cada uno de esos sitios es una oportunidad de fallar
--     ABIERTO, que es la peor manera de fallar en un chat privado.
--   · Con una conversación por encima hay UN ancla y UNA política. La
--     pertenencia se decide en un sitio y el resto la hereda.
--
-- El ancla es el PAR (alumno, tutor), único. Y de ahí sale gratis lo que pedía
-- el enunciado: **histórico continuo**. Al comprar no hay nada que migrar ni
-- que fusionar — la conversación ya era la misma antes del pago, y la reserva
-- se limita a etiquetar los mensajes que se escriben dentro de ella
-- (`messages.booking_id`, ahora opcional). El alumno que preguntó el martes y
-- compró el jueves sigue viendo su pregunta arriba del hilo.
--
-- ⚠️ CONSECUENCIA QUE HAY QUE DECIR EN VOZ ALTA: dos reservas del mismo par
-- comparten hilo. Antes cada reserva tenía el suyo. Es lo que ya describía la
-- decisión 15 ("bandeja estilo LinkedIn"): en una bandeja se habla con
-- PERSONAS, no con facturas. El precio es que la ficha de una reserva enseña
-- también lo hablado en otra del mismo tutor; el beneficio es que nadie tiene
-- que adivinar en cuál de los tres hilos con la misma persona escribió aquello.
--
-- ⚠️ Y OTRA: LA VENTANA DE RN-41 (2 días antes) SE ACABA. No es que se decida
-- quitarla, es que deja de poder existir: si el alumno puede escribir a ese
-- tutor SIN reserva, un candado que solo mira las reservas no cierra nada — lo
-- único que conseguiría es que el mismo hilo acepte mensajes desde la ficha
-- pública y los rechace desde la ficha de la reserva. La otra mitad de RN-41
-- —la retención— sigue viva y se detalla abajo.
--
-- ── DECISIÓN (b) · RETENCIÓN DE LO PRE-COMPRA ───────────────────────────────
-- `messages.expires_at` nace como `now() + 30 días` EN CADA MENSAJE. Aplicado a
-- una consulta previa eso hace dos destrozos: la conversación se evapora sola
-- antes de que dé tiempo a comprar, y se erosiona POR ARRIBA — el alumno vería
-- el final de su propia conversación sin el principio (es el AB-01 que ya está
-- documentado en `chat-launcher.tsx`, y que aquí no se toca para el chat de
-- reserva: cambiar esa retención por nuestra cuenta borraría conversaciones que
-- hoy la gente da por guardadas).
--
-- Para lo pre-compra la retención se ancla a la CONVERSACIÓN, no al mensaje:
--
--   · un mensaje sin reserva nace con `expires_at = null` → la purga por
--     mensaje no lo ve nunca (`where expires_at < now()` descarta los nulos);
--   · la conversación entera caduca a los **30 días sin actividad** SI nunca
--     llegó a haber compra. Se borra completa, de una pieza. No se erosiona.
--   · si el par SÍ compró, el bloque pre-compra se queda mientras exista la
--     conversación: son como mucho 20 mensajes de texto (ver el tope de abajo),
--     sin adjuntos, y son el registro de lo que se prometió ANTES de pagar —
--     justo lo que hace falta si alguien discute qué incluía la clase, y lo que
--     el §21 de los Términos publicados hoy convierte en relevante.
--
-- El número —30 días— es el que el cliente aprobó en la decisión 22; lo que
-- cambia es desde cuándo se cuenta.
--
-- ── DECISIÓN (c) · SIN ADJUNTOS ANTES DE COMPRAR ────────────────────────────
-- Se impone en el SERVIDOR y por triplicado, porque esconder el clip no impide
-- nada:
--   1. `send_conversation_message` (la vía pre-compra) NO TIENE parámetro de
--      adjunto. No es que lo rechace: no existe.
--   2. `check` en la tabla: `attachment_path` exige `booking_id`.
--   3. la RLS de Storage ya exigía que la carpeta fuera el id de una reserva de
--      la que eres participante (`20260722180000`), así que sin reserva no hay
--      dónde subir.
--
-- ── DECISIÓN (e) · ABUSO Y DESINTERMEDIACIÓN ────────────────────────────────
-- Un canal alumno→tutor abierto sin compra es spam y es la vía obvia para
-- llevarse la clase fuera de la plataforma, cosa que el §21 de los Términos
-- prohíbe expresamente. Tres frenos, todos en `send_conversation_message` /
-- `open_conversation` y todos solo MIENTRAS NO HAYA COMPRA:
--   · 5 mensajes seguidos sin que el tutor conteste;
--   · 20 mensajes del alumno en la conversación;
--   · 10 conversaciones nuevas por alumno cada 24 h (spray sobre el catálogo).
-- El tutor nunca tiene tope: está contestando en su propia bandeja.
-- Más la puerta de moderación: `conversations.blocked_at` (solo admin) y
-- `conversation_reports` + `report_conversation` para que un participante
-- levante la mano.
--
-- ── DECISIÓN (f) · N-23 (no leídos) SIGUE CONTANDO ──────────────────────────
-- `message_reads` se llamaba por reserva y una consulta previa no tiene
-- ninguna, así que la marca se re-teclea por conversación y pasa a llamarse
-- `conversation_reads`. Las dos funciones de N-23 se sustituyen por sus
-- equivalentes (`mark_conversation_read`, `unread_conversation_counts`) con la
-- MISMA lógica —marca del servidor, `greatest` al avanzar, INVOKER en el
-- recuento—: lo único que cambia es la columna por la que agrupan. Las viejas
-- se DROPEAN en vez de dejarlas: una función que dice `booking` y agrupa por
-- conversación es una trampa para el siguiente que la lea.
-- El canal de Realtime no se toca: `messages` ya estaba en la publicación y la
-- burbuja escucha la tabla entera dejando que la RLS acote (ahora, por
-- conversación).
-- ============================================================================

-- ── 1 · La conversación ──────────────────────────────────────────────────────
create table public.conversations (
  id         uuid        primary key default gen_random_uuid(),
  -- Quién escribe primero y quién recibe. El par es la identidad del hilo, por
  -- eso van aquí y no en cada mensaje: la RLS pregunta UNA vez.
  student_id uuid        not null references public.profiles (id) on delete cascade,
  tutor_id   uuid        not null references public.profiles (id) on delete cascade,

  -- Desnormalizado a propósito: la bandeja ordena por actividad y la purga de
  -- lo pre-compra decide por esta fecha. Un `max(created_at)` sobre `messages`
  -- en cada apertura de la bandeja es un scan por conversación para pintar un
  -- orden. Lo mantienen las dos funciones de envío, que son la ÚNICA vía de
  -- escritura de `messages`.
  last_message_at timestamptz,

  -- Puerta de moderación (decisión e). La escribe el admin; con fecha puesta,
  -- las funciones de envío rechazan.
  blocked_at     timestamptz,
  blocked_reason text,

  created_at timestamptz not null default now(),   -- UTC (RN-02)
  updated_at timestamptz not null default now(),

  -- UNA conversación por par: es lo que hace que comprar no abra un hilo nuevo.
  constraint conversations_pair_unique unique (student_id, tutor_id),
  -- Hablar consigo mismo no es una conversación, es una nota.
  constraint conversations_no_self check (student_id <> tutor_id)
);

comment on table public.conversations is
  'M-12: hilo 1:1 entre un alumno y un tutor, exista o no reserva. Ancla del chat desde M-12; `messages.booking_id` pasó a ser una etiqueta de contexto.';

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- La bandeja pide "mis conversaciones ordenadas por actividad" desde los dos
-- lados. Dos índices y no uno compuesto por (student, tutor): las consultas
-- entran por un lado o por el otro, nunca por los dos. El `unique` de arriba ya
-- cubre (student_id, tutor_id) para el camino de `open_conversation`.
create index conversations_student_idx on public.conversations (student_id, last_message_at desc);
create index conversations_tutor_idx   on public.conversations (tutor_id,   last_message_at desc);

-- ── RLS: default-deny; solo los dos participantes ───────────────────────────
alter table public.conversations enable row level security;

-- ESTA POLÍTICA ES LO ÚNICO QUE PROTEGE EL CHAT. Un tercero no lee la
-- conversación, y como `messages` se apoya en ella (abajo), tampoco los
-- mensajes. Sin política de admin a propósito: el chat no se lee "por
-- soporte" — para eso está el reporte, que trae el hilo con consentimiento del
-- que lo levanta.
create policy "conversations_select_participant"
  on public.conversations for select
  using ( (select auth.uid()) in (student_id, tutor_id) );

-- Sin insert/update/delete para NADIE, ni siquiera para el admin. Se crean por
-- `open_conversation` y por el trigger de `bookings`, se bloquean por
-- `set_conversation_blocked` (los tres SECURITY DEFINER) y se borran por purga
-- o por cascada al borrarse un perfil.
--
-- ⚠️ Y el bloqueo NO puede ser una política de UPDATE, aunque sea lo primero
-- que uno escribe. Un `update … where id = $1` tiene que LEER la fila para
-- encontrarla, y en ese caso Postgres aplica también las políticas de SELECT:
-- como el admin no es participante, no vería ninguna fila y el `update` no
-- fallaría — no haría NADA, que es peor. Una función DEFINER se salta ese nudo
-- sin abrirle al admin la lectura de las conversaciones.

-- ── Grants (auto-expose OFF) ────────────────────────────────────────────────
grant select on public.conversations to authenticated;

-- Regla de oro 9. Hoy el único job que toca esta tabla es la purga del chat, y
-- entra por una función SECURITY DEFINER (corre como su dueña, así que los
-- grants de rol no le aplican). El grant va igual: el día que esa purga se
-- mueva a un Route Handler con `service_role` —como ya pasó con
-- `/api/cron/recordings-purge`— la falta del grant no la ve ni el build ni el
-- typecheck, revienta en producción a las 04:00. Ha mordido cinco veces este
-- mes; sale más barato el renglón.
grant select, insert, update, delete on public.conversations to service_role;

-- ── 2 · Toda reserva tiene su conversación ───────────────────────────────────
-- El hilo del par tiene que existir ANTES de que nadie escriba en él, porque
-- `send_message` (la vía de la reserva, que no se puede cambiar de firma: la
-- llama `lib/chat/attachments.ts`) necesita saber a qué conversación pegar el
-- mensaje. Se garantiza con un trigger y no "cuando haga falta" porque el
-- camino de creación de reservas es de otro carril y no se toca: un trigger es
-- aditivo y no le cambia la firma a nadie.
--
-- SECURITY DEFINER: `conversations` no tiene política de INSERT (a propósito),
-- así que un trigger normal —que corre con los privilegios de quien inserta la
-- reserva— chocaría con la RLS. Y `service_role`, que sí se la salta, seguiría
-- necesitando el grant de tabla (regla 9). Como DEFINER, el invariante se
-- cumple venga la reserva de donde venga.
create or replace function public.ensure_conversation_for_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conversations (student_id, tutor_id)
  values (new.student_id, new.tutor_id)
  on conflict (student_id, tutor_id) do nothing;   -- ya hablaban: es la misma
  return new;
end;
$$;

create trigger bookings_ensure_conversation
  after insert on public.bookings
  for each row execute function public.ensure_conversation_for_booking();

-- ── 3 · Backfill: una conversación por cada par que ya existía ───────────────
-- Sin esto, las reservas anteriores a esta migración se quedan con mensajes
-- huérfanos y `conversation_id` no puede ser NOT NULL.
insert into public.conversations (student_id, tutor_id, created_at)
select b.student_id, b.tutor_id, min(b.created_at)
  from public.bookings b
 group by b.student_id, b.tutor_id
on conflict (student_id, tutor_id) do nothing;

-- ── 4 · `messages` cuelga de la conversación ─────────────────────────────────
alter table public.messages
  add column conversation_id uuid references public.conversations (id) on delete cascade;

update public.messages m
   set conversation_id = c.id
  from public.bookings b
  join public.conversations c
    on c.student_id = b.student_id
   and c.tutor_id   = b.tutor_id
 where b.id = m.booking_id;

alter table public.messages alter column conversation_id set not null;

-- `booking_id` deja de ser obligatorio: pasa de ANCLA a ETIQUETA de contexto
-- ("este mensaje se escribió dentro de la reserva X"). Sigue sirviendo para los
-- adjuntos (carpeta de Storage), para la retención de 30 días por mensaje y
-- para saber de qué mentoría se hablaba.
alter table public.messages alter column booking_id drop not null;

-- Decisión (b): un mensaje pre-compra no caduca por su cuenta, caduca con su
-- conversación. El default de 30 días se queda para los mensajes de reserva.
alter table public.messages alter column expires_at drop not null;

-- Los dos invariantes de arriba, escritos donde no se pueden olvidar:
--   · sin reserva no hay adjunto (decisión c, tercera cerradura);
--   · reserva ⇔ caducidad por mensaje. Un mensaje de reserva SIN `expires_at`
--     viviría para siempre; uno pre-compra CON `expires_at` se erosionaría solo.
alter table public.messages
  add constraint messages_adjunto_requiere_reserva
    check (attachment_path is null or booking_id is not null),
  add constraint messages_caducidad_por_reserva
    check ((booking_id is null) = (expires_at is null));

-- El hilo se lee entero por conversación y en orden. El índice viejo
-- (booking_id, created_at) se queda: lo siguen usando la ficha de la reserva,
-- la sala y la purga por mensaje.
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ── RLS de `messages`: misma frase, ancla nueva ─────────────────────────────
-- Antes: "eres participante de ESA reserva". Ahora: "eres participante de ESA
-- conversación". Para los mensajes de reserva es exactamente lo mismo —los
-- participantes de una reserva son el par de su conversación— y además cubre
-- los que no tienen reserva. Un tercero sigue sin leer nada.
drop policy if exists "messages_select_participant" on public.messages;

create policy "messages_select_participant"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (select auth.uid()) in (c.student_id, c.tutor_id)
    )
  );

-- Sigue sin haber política de INSERT/UPDATE/DELETE: se escribe por las dos
-- funciones de envío, que son las que validan tope, bloqueo y adjuntos.

-- ── 5 · N-23 re-tecleada por conversación ────────────────────────────────────
-- Mismo diseño que `message_reads` (`20260817190000`) y por los mismos motivos:
-- una fila por (hilo, persona) porque los lectores son dos y la fila del
-- mensaje es una; un INSTANTE y no el id del último mensaje leído porque la
-- purga se llevaría la marca por cascada justo cuando el contador debe quedarse
-- en cero.
create table public.conversation_reads (
  conversation_id uuid        not null references public.conversations (id) on delete cascade,
  user_id         uuid        not null references public.profiles (id)      on delete cascade,
  last_read_at    timestamptz not null default now(),   -- UTC, la pone el servidor
  primary key (conversation_id, user_id)
);

comment on table public.conversation_reads is
  'M-12: hasta cuándo ha leído cada participante su conversación. Sustituye a `message_reads` (N-23), que se llamaba por reserva y no servía para una consulta previa a la compra.';

-- Traspaso de las marcas que ya había. Dos reservas del mismo par colapsan en
-- una conversación, así que puede haber DOS marcas para el mismo destino: se
-- queda la más avanzada (`max`), que es lo que hace el `greatest` del upsert.
-- Al revés —quedarse la vieja— resucitaría contadores de mensajes ya leídos.
insert into public.conversation_reads (conversation_id, user_id, last_read_at)
select c.id, r.user_id, max(r.last_read_at)
  from public.message_reads r
  join public.bookings b      on b.id = r.booking_id
  join public.conversations c on c.student_id = b.student_id
                             and c.tutor_id   = b.tutor_id
 group by c.id, r.user_id;

drop table public.message_reads;

alter table public.conversation_reads enable row level security;

-- Política de PROPIEDAD, no de participación: "soy participante" dejaría que el
-- tutor leyera la marca del alumno, o sea, un acuse de lectura que nadie ha
-- decidido (el razonamiento completo está en `20260817190000`). La pertenencia
-- se comprueba al ESCRIBIR, dentro de la RPC.
create policy "conversation_reads_select_own"
  on public.conversation_reads for select
  using ( (select auth.uid()) = user_id );

grant select on public.conversation_reads to authenticated;
-- Regla de oro 9: mismo argumento que en `conversations` — la purga la borra
-- por cascada hoy, pero el grant se deja puesto antes de que muerda.
grant select, insert, update, delete on public.conversation_reads to service_role;

-- Las funciones viejas se van con su tabla: reciben/devuelven `booking_id` y ya
-- no hay forma de que digan la verdad.
drop function if exists public.mark_messages_read(uuid);
drop function if exists public.unread_message_counts();

-- ── 6 · Helpers de negocio ───────────────────────────────────────────────────

-- ¿Este par llegó a comprar? Es la pregunta que levanta los topes de la
-- decisión (e) y la que decide si la conversación caduca a los 30 días.
--
-- La lista de estados es LA MISMA que usa `tutor_students` (`20260817150000`)
-- para decidir si el tutor puede ver el nombre de su alumno, y a propósito:
-- dos definiciones distintas de "es mi alumno" acabarían discrepando. Fuera se
-- quedan `pending_payment` (checkout abandonado: no ha pagado nadie) y
-- `cancelled` sin `completed_at` (se deshizo antes de darse).
create or replace function public.pair_has_booking(p_student_id uuid, p_tutor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
     where b.student_id = p_student_id
       and b.tutor_id   = p_tutor_id
       and (
         b.status in ('pending_acceptance', 'confirmed', 'in_progress', 'completed')
         or b.completed_at is not null          -- reembolsada DESPUÉS de darse
       )
  );
$$;

comment on function public.pair_has_booking(uuid, uuid) is
  'M-12: ¿el alumno llegó a comprarle al tutor? Levanta los topes anti-spam del chat previo y exime a la conversación de la purga a 30 días.';

-- SECURITY DEFINER porque la llaman funciones que ya son DEFINER y porque el
-- alumno no puede leer las reservas del tutor ni al revés; solo devuelve un
-- booleano sobre un par que el llamante ya conoce.
revoke execute on function public.pair_has_booking(uuid, uuid) from public;
revoke execute on function public.pair_has_booking(uuid, uuid) from anon;
grant  execute on function public.pair_has_booking(uuid, uuid) to authenticated;

-- La conversación de una reserva. INVOKER (el default) a propósito: el llamante
-- ya puede leer su reserva y su conversación, así que la RLS de siempre acota y
-- no hay que reimplementar "soy participante" a mano — que es el agujero
-- clásico. A un extraño le devuelve null.
create or replace function public.conversation_of_booking(p_booking_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id
    from public.bookings b
    join public.conversations c
      on c.student_id = b.student_id
     and c.tutor_id   = b.tutor_id
   where b.id = p_booking_id;
$$;

comment on function public.conversation_of_booking(uuid) is
  'M-12: id del hilo del par de esta reserva. SECURITY INVOKER: la RLS de bookings y conversations ya acota.';

revoke execute on function public.conversation_of_booking(uuid) from public;
revoke execute on function public.conversation_of_booking(uuid) from anon;
grant  execute on function public.conversation_of_booking(uuid) to authenticated;

-- ── 7 · Abrir la conversación (desde la ficha del tutor) ─────────────────────
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

  -- Si ya existe, se devuelve TAL CUAL: eso es el histórico continuo. Volver de
  -- la ficha del tutor a una conversación de hace tres meses (o a la de una
  -- reserva ya dada) es exactamente lo que se quiere.
  select id into v_id
    from public.conversations
   where student_id = v_uid and tutor_id = p_tutor_id;
  if v_id is not null then
    return v_id;
  end if;

  -- Freno de spray sobre el catálogo (decisión e): abrir hilo con 200 tutores
  -- de madrugada. El tope cuenta conversaciones CREADAS, no mensajes, así que
  -- no estorba a quien conversa mucho con pocos.
  select count(*) into v_nuevas
    from public.conversations
   where student_id = v_uid
     and created_at > now() - interval '24 hours';
  if v_nuevas >= 10 then
    raise exception 'has abierto demasiadas conversaciones hoy; inténtalo mañana'
      using errcode = 'check_violation';
  end if;

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
  'M-12: abre (o recupera) el hilo del alumno con un tutor aprobado. Devuelve siempre la MISMA conversación: es lo que hace que comprar no reinicie el histórico.';

revoke execute on function public.open_conversation(uuid) from public;
revoke execute on function public.open_conversation(uuid) from anon;
grant  execute on function public.open_conversation(uuid) to authenticated;

-- ── 8 · Enviar en la conversación (la vía pre-compra) ────────────────────────
-- SIN parámetro de adjunto: decisión (c). No hay nada que rechazar porque no
-- hay nada que mandar.
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

  v_comprado := public.pair_has_booking(v_c.student_id, v_c.tutor_id);

  -- Los topes son SOLO para el alumno y SOLO antes de la primera compra. El
  -- tutor contesta en su propia bandeja: ponerle tope sería castigar al que
  -- atiende. Y con la compra hecha manda la relación comercial, no el freno.
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

  -- `expires_at` explícitamente NULL: decisión (b). El `check` de la tabla no
  -- dejaría otra cosa, pero se escribe aquí para que se lea al lado del motivo.
  insert into public.messages (conversation_id, booking_id, sender_id, body, expires_at)
  values (v_c.id, null, v_uid, v_body, null)
  returning id into v_msg;

  update public.conversations set last_message_at = now() where id = v_c.id;

  return v_msg;
end;
$$;

comment on function public.send_conversation_message(uuid, text) is
  'M-12: mensaje en el hilo del par, con o sin reserva. Sin adjuntos por diseño; topes anti-spam mientras el alumno no haya comprado.';

revoke execute on function public.send_conversation_message(uuid, text) from public;
revoke execute on function public.send_conversation_message(uuid, text) from anon;
grant  execute on function public.send_conversation_message(uuid, text) to authenticated;

-- ── 9 · `send_message` (la vía de la reserva) ────────────────────────────────
-- ⚠️ LA FIRMA NO SE TOCA. La llama `src/lib/chat/attachments.ts`, que es de
-- otro carril; cambiarle los parámetros rompería la subida de documentos del
-- chat y de la sala (LV01) sin que lo vea ningún typecheck.
--
-- Cambia lo de dentro:
--   · resuelve y guarda `conversation_id` (el mensaje entra en el hilo del par);
--   · MUERE LA VENTANA DE RN-41. Ya no se comprueba "2 días antes de la 1ª
--     sesión" porque no puede significar nada: los mismos dos, en el mismo
--     hilo, pueden escribirse desde la ficha pública. Mantenerla solo lograría
--     que la reserva rechace lo que la ficha acepta. La otra mitad de RN-41 —la
--     retención— sigue en pie (`expires_at`, 30 días por mensaje).
--   · mantiene el prefijo `chat_` del acuerdo del 17-jul y la comprobación de
--     que el adjunto vive en la carpeta de ESTA reserva.
create or replace function public.send_message(
  p_booking_id      uuid,
  p_body            text,
  p_attachment_path text   default null,
  p_attachment_name text   default null,
  p_attachment_size bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_bk    record;
  v_conv  uuid;
  v_block timestamptz;
  v_msg   uuid;
  v_body  text := btrim(coalesce(p_body, ''));
  v_name  text := btrim(coalesce(p_attachment_name, ''));
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if v_body = '' and p_attachment_path is null then
    raise exception 'el mensaje no puede estar vacío' using errcode = 'check_violation';
  end if;

  -- Participante de la reserva (alumno o tutor).
  select id, student_id, tutor_id into v_bk
  from public.bookings
  where id = p_booking_id and v_uid in (student_id, tutor_id);
  if v_bk.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- El adjunto tiene que vivir en la carpeta de ESTA reserva. Sin esto, un
  -- participante podría colgar en su hilo la ruta de otra reserva suya y
  -- filtrarla al otro lado (la RLS de Storage la dejaría leer: es participante).
  if p_attachment_path is not null then
    if p_attachment_path not like p_booking_id::text || '/%' then
      raise exception 'el adjunto no pertenece a esta reserva' using errcode = 'check_violation';
    end if;
    if v_name = '' or coalesce(p_attachment_size, 0) <= 0 then
      raise exception 'adjunto incompleto' using errcode = 'check_violation';
    end if;

    -- Acuerdo 17-jul: prefijo para separar lo del chat del material inicial.
    -- Idempotente: reenviar un nombre ya prefijado no lo duplica.
    if v_name not like 'chat\_%' then
      v_name := 'chat_' || v_name;
    end if;
  end if;

  -- El hilo del par. El trigger `bookings_ensure_conversation` lo garantiza,
  -- pero el `insert ... on conflict` está por si esta función corriera contra
  -- una reserva creada antes de esta migración en un entorno a medio migrar:
  -- perder el mensaje de un usuario por eso sería peor que crear una fila.
  select id, blocked_at into v_conv, v_block
    from public.conversations
   where student_id = v_bk.student_id and tutor_id = v_bk.tutor_id;

  if v_conv is null then
    insert into public.conversations (student_id, tutor_id)
    values (v_bk.student_id, v_bk.tutor_id)
    on conflict (student_id, tutor_id) do update set updated_at = now()
    returning id, blocked_at into v_conv, v_block;
  end if;

  if v_block is not null then
    raise exception 'esta conversación está bloqueada por moderación'
      using errcode = 'check_violation';
  end if;

  -- ⚠️ UN CHECKOUT ABANDONADO NO ES UNA COMPRA, y era la puerta trasera de esta
  -- migración: la reserva nace en `pending_payment` en cuanto alguien empieza a
  -- pagar, así que sin esta comprobación bastaba con abrir el checkout y
  -- cerrarlo para tener un `booking_id` con el que saltarse los topes de la
  -- decisión (e) y colar adjuntos. (Antes no pasaba de rebote: el chat exigía
  -- que la reserva tuviera sesiones, y esas se crean al confirmar.)
  --
  -- Si el par no ha comprado, esto NO es el chat de una reserva por mucho que
  -- venga con su uuid: se reenvía por la vía de consulta, que aplica los topes
  -- y deja el mensaje sin etiqueta ni caducidad propia. Se delega en vez de
  -- copiar las reglas: dos sitios que cuentan mensajes acaban contando distinto.
  if not public.pair_has_booking(v_bk.student_id, v_bk.tutor_id) then
    if p_attachment_path is not null then
      raise exception 'podrás compartir archivos cuando la reserva esté pagada'
        using errcode = 'check_violation';
    end if;
    return public.send_conversation_message(v_conv, v_body);
  end if;

  insert into public.messages
    (conversation_id, booking_id, sender_id, body,
     attachment_path, attachment_name, attachment_size)
  values
    (v_conv, p_booking_id, v_uid, v_body,
     p_attachment_path, nullif(v_name, ''), p_attachment_size)
  returning id into v_msg;

  update public.conversations set last_message_at = now() where id = v_conv;

  return v_msg;
end;
$$;

grant execute on function public.send_message(uuid, text, text, text, bigint) to authenticated;

-- ── 10 · Marcas de lectura y contador (N-23, por conversación) ───────────────
-- La hora la pone `now()` del servidor y no el navegador: un reloj adelantado
-- marcaría como leídos mensajes que aún no han llegado y el contador se
-- quedaría mudo para siempre en esa conversación.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
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

  select true into v_ok
    from public.conversations
   where id = p_conversation_id
     and v_uid in (student_id, tutor_id);
  if not coalesce(v_ok, false) then
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;

  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_uid, now())
  on conflict (conversation_id, user_id) do update
    -- `greatest` y no `excluded` a secas: dos pestañas (o una petición que se
    -- demora) pueden llegar desordenadas, y una marca vieja pisando a una nueva
    -- resucitaría el contador de mensajes ya leídos. La marca solo avanza.
    set last_read_at = greatest(excluded.last_read_at, conversation_reads.last_read_at)
  returning last_read_at into v_when;

  return v_when;
end;
$$;

revoke execute on function public.mark_conversation_read(uuid) from public;
revoke execute on function public.mark_conversation_read(uuid) from anon;
grant  execute on function public.mark_conversation_read(uuid) to authenticated;

-- SECURITY **INVOKER** (el default), igual que la de N-23: los datos son del
-- propio llamante y la RLS de `messages` (participante) y la de
-- `conversation_reads` (propia) ya recortan exactamente lo que debe ver. Un
-- DEFINER obligaría a reimplementar el "soy participante" a mano.
create or replace function public.unread_conversation_counts()
returns table (
  conversation_id uuid,
  unread          integer,
  last_message_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    m.conversation_id,
    (count(*) filter (
      where m.sender_id <> (select auth.uid())          -- lo mío no me lo cuento
        and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    ))::integer,                                         -- count() da bigint
    max(m.created_at)
  from public.messages m
  left join public.conversation_reads r
    on  r.conversation_id = m.conversation_id
    and r.user_id         = (select auth.uid())
  group by m.conversation_id;
$$;

comment on function public.unread_conversation_counts() is
  'M-12 (sustituye a unread_message_counts de N-23): por cada hilo del usuario, cuántos mensajes ajenos hay tras su marca de lectura y cuándo fue el último.';

revoke execute on function public.unread_conversation_counts() from public;
revoke execute on function public.unread_conversation_counts() from anon;
grant  execute on function public.unread_conversation_counts() to authenticated;

-- ── 11 · La bandeja: con quién hablo ─────────────────────────────────────────
-- SECURITY DEFINER, y aquí sí hace falta: el tutor NO puede leer `profiles`
-- (own-only) y `tutor_students` (`20260817150000`) solo le da los nombres de
-- alumnos con RESERVA VIVA — que es justo lo que una consulta previa a la
-- compra no tiene. Sin esto, al tutor le llegaría "alguien te escribió" sin
-- nombre, que es la mitad de un mensaje.
--
-- La justificación es la misma que la de aquella RPC, un paso más allá: el
-- vínculo que da acceso al dato ya no es la reserva compartida, es la
-- CONVERSACIÓN compartida, que solo existe porque ese alumno decidió escribirle
-- a ese tutor. Columnas elegidas a mano (nombre y foto; nunca el correo) y
-- filtro de participación explícito.
create or replace function public.my_conversations()
returns table (
  id                 uuid,
  other_id           uuid,
  other_name         text,
  other_avatar_path  text,
  -- `true` si el OTRO es el tutor (o sea: yo soy el alumno de este hilo).
  other_is_tutor     boolean,
  last_message_at    timestamptz,
  has_booking        boolean,
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
    public.pair_has_booking(c.student_id, c.tutor_id),
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
  -- El filtro de participación, a mano y explícito: es DEFINER, así que la RLS
  -- de `conversations` no está mirando. Es LA línea que no se puede tocar.
  where (select auth.uid()) in (c.student_id, c.tutor_id)
  order by c.last_message_at desc nulls last, c.created_at desc;
$$;

comment on function public.my_conversations() is
  'M-12: la bandeja. Por cada hilo del usuario, con quién habla (nombre y foto), si ya hubo compra y de qué mentoría. SECURITY DEFINER acotada por participación en la conversación.';

revoke execute on function public.my_conversations() from public;
revoke execute on function public.my_conversations() from anon;
grant  execute on function public.my_conversations() to authenticated;

-- ── 12 · Tiempo de respuesta del tutor (decisión d) ─────────────────────────
-- ⚠️ ESTE DATO NO EXISTÍA, y la tentación era inventarlo ("responde en 2 horas"
-- de adorno). Es una promesa que la plataforma no puede cumplir y que el alumno
-- usa para decidir: **si no hay historial suficiente, esta función devuelve
-- NULL y la ficha no pinta nada**.
--
-- Qué mide: la MEDIANA (no la media: un despiste de tres días no debe mover el
-- número) de lo que tarda el tutor en contestar, sobre los últimos 90 días —un
-- tutor que respondía rápido en marzo no cobra fama eterna—.
--
-- Y mide honesto, que es lo difícil:
--   · Solo cuenta la PRIMERA pregunta de cada ráfaga. Tres mensajes seguidos
--     del alumno son una pregunta, no tres, y contarlos por separado inflaría
--     la muestra con dos latencias casi idénticas.
--   · Las preguntas SIN CONTESTAR no se tiran a la basura: entran como
--     latencia infinita (el centinela). Descartarlas sería el sesgo clásico —un
--     tutor que contesta al 10 % en cinco minutos y ignora el resto saldría
--     como "responde en 5 minutos"—. Si más de la mitad quedaron sin respuesta,
--     la mediana cae en el centinela y la función devuelve NULL: no hay número
--     honesto que dar.
--   · Las preguntas recientes sin respuesta (< 14 días) no cuentan todavía: aún
--     puede llegar. Solo penaliza el silencio consumado.
--   · Mínimo 5 observaciones. Con menos, la mediana es una anécdota.
--
-- Callable por `anon` porque la ficha del tutor es pública. Devuelve UN entero
-- agregado, nunca contenido ni identidades.
create or replace function public.tutor_response_time(p_tutor_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Centinela = "no contestó". En minutos, un número que ninguna latencia real
  -- alcanza; se usa para que la mediana pueda caer EN él y delatar al que no
  -- contesta, cosa que un NULL no haría (percentile_cont los ignora).
  c_sin_respuesta constant double precision := 1e9;
  v_muestras int;
  v_mediana  double precision;
begin
  with hilo as (
    select
      m.conversation_id,
      m.created_at,
      m.sender_id,
      lag(m.sender_id) over (partition by m.conversation_id order by m.created_at) as anterior
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.tutor_id = p_tutor_id
      and m.created_at > now() - interval '90 days'
  ),
  preguntas as (
    -- Del alumno (el hilo tiene exactamente dos personas, así que "no es el
    -- tutor" basta) y primera de su ráfaga.
    select conversation_id, created_at
      from hilo
     where sender_id <> p_tutor_id
       and (anterior is null or anterior = p_tutor_id)
  ),
  latencias as (
    select
      q.created_at,
      (select min(extract(epoch from (r.created_at - q.created_at)) / 60)
         from public.messages r
        where r.conversation_id = q.conversation_id
          and r.sender_id       = p_tutor_id
          and r.created_at      > q.created_at) as minutos
    from preguntas q
  ),
  observaciones as (
    select coalesce(l.minutos::double precision, c_sin_respuesta) as minutos
      from latencias l
     -- Sin respuesta pero reciente: el reloj sigue corriendo, no se juzga.
     -- (El `l.` no es adorno: en el `where` manda la columna de origen, no el
     -- alias de la línea de arriba, y sin prefijo se lee al revés de lo que
     -- hace.)
     where l.minutos is not null
        or l.created_at < now() - interval '14 days'
  )
  select count(*), percentile_cont(0.5) within group (order by o.minutos)
    into v_muestras, v_mediana
    from observaciones o;

  if coalesce(v_muestras, 0) < 5 then
    return null;                       -- muestra insuficiente: no se inventa
  end if;
  if v_mediana >= c_sin_respuesta then
    return null;                       -- más de la mitad sin contestar
  end if;

  -- Mínimo un minuto: un "responde en 0 minutos" se lee como un error.
  return greatest(1, ceil(v_mediana))::integer;
end;
$$;

comment on function public.tutor_response_time(uuid) is
  'M-12: mediana en minutos de lo que tarda el tutor en contestar (90 días, mínimo 5 observaciones, las preguntas sin respuesta cuentan como infinito). NULL = no hay dato honesto que enseñar.';

-- La ficha del tutor es pública (RN-24), así que `anon` también la llama. Solo
-- devuelve un agregado; el `revoke from public` va igual, para conceder a mano
-- y no por el default de Postgres.
revoke execute on function public.tutor_response_time(uuid) from public;
grant  execute on function public.tutor_response_time(uuid) to anon, authenticated;

-- La consulta entra por `conversations.tutor_id` y luego pide los mensajes de
-- cada hilo por (conversación, fecha): los dos índices ya existen
-- (`conversations_tutor_idx`, `messages_conversation_idx`).

-- ── 13 · Moderación: la puerta puesta ────────────────────────────────────────
create table public.conversation_reports (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.conversations (id) on delete cascade,
  reporter_id     uuid        not null references public.profiles (id)      on delete cascade,
  reason          text        not null check (btrim(reason) <> ''),
  created_at      timestamptz not null default now(),
  handled_at      timestamptz,
  handled_by      uuid        references public.profiles (id) on delete set null
);

comment on table public.conversation_reports is
  'M-12: un participante levanta la mano sobre su propia conversación (spam, acoso, o el §21 — llevarse la clase fuera de la plataforma). El panel de moderación es otra historia; esto es la puerta.';

create index conversation_reports_pendientes_idx
  on public.conversation_reports (created_at desc)
  where handled_at is null;

alter table public.conversation_reports enable row level security;

-- El que reporta ve lo suyo (para saber que se envió) y el admin lo ve todo.
create policy "conversation_reports_select"
  on public.conversation_reports for select
  using ( (select auth.uid()) = reporter_id or public.has_role('admin') );

-- Solo el admin cierra un reporte. Sin política de insert: se entra por la RPC,
-- que comprueba que reportas una conversación TUYA.
create policy "conversation_reports_update_admin"
  on public.conversation_reports for update
  using ( public.has_role('admin') )
  with check ( public.has_role('admin') );

grant select on public.conversation_reports to authenticated;
grant update (handled_at, handled_by) on public.conversation_reports to authenticated;
grant select, insert, update, delete on public.conversation_reports to service_role;

create or replace function public.report_conversation(
  p_conversation_id uuid,
  p_reason          text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if v_reason = '' then
    raise exception 'cuéntanos qué ha pasado' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.conversations
     where id = p_conversation_id
       and v_uid in (student_id, tutor_id)
  ) then
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;

  insert into public.conversation_reports (conversation_id, reporter_id, reason)
  values (p_conversation_id, v_uid, left(v_reason, 2000))
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.report_conversation(uuid, text) from public;
revoke execute on function public.report_conversation(uuid, text) from anon;
grant  execute on function public.report_conversation(uuid, text) to authenticated;

-- El otro lado de la puerta: cortar (o reabrir) una conversación. Con
-- `blocked_at` puesto, las dos funciones de envío rechazan y el hilo queda en
-- solo lectura para los dos participantes — se puede seguir leyendo y
-- descargando, que es lo que hace falta si alguien reclama después.
--
-- SECURITY DEFINER y comprobación de rol DENTRO (no una política): ver la nota
-- de arriba sobre por qué un UPDATE con RLS no serviría. El panel de admin es
-- de otro carril; esto es la palanca que le deja lista.
create or replace function public.set_conversation_blocked(
  p_conversation_id uuid,
  p_blocked         boolean,
  p_reason          text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  -- `has_role` ya mira `auth.uid()` por dentro; sin sesión devuelve false, así
  -- que esta línea cubre también el caso de llamarla sin autenticar.
  if not public.has_role('admin') then
    raise exception 'solo un administrador puede moderar conversaciones'
      using errcode = '42501';
  end if;

  update public.conversations
     set blocked_at     = case when p_blocked then now() else null end,
         -- Al desbloquear se limpia el motivo: dejarlo puesto haría que la
         -- siguiente lectura pareciera un bloqueo vivo.
         blocked_reason = case when p_blocked then nullif(btrim(coalesce(p_reason, '')), '') else null end
   where id = p_conversation_id
  returning true into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;

  return p_blocked;
end;
$$;

revoke execute on function public.set_conversation_blocked(uuid, boolean, text) from public;
revoke execute on function public.set_conversation_blocked(uuid, boolean, text) from anon;
grant  execute on function public.set_conversation_blocked(uuid, boolean, text) to authenticated;

-- ── 14 · Purga (US-1703) con la retención de la decisión (b) ─────────────────
-- Sigue siendo la misma función y el mismo cron (`purge-expired-messages`,
-- 04:00 diario, programado desde EP-17): reemplazarla basta.
--
-- Ahora hace dos cosas distintas porque hay dos relojes distintos:
--   1. MENSAJES DE RESERVA: `expires_at < now()`, 30 días desde CADA mensaje.
--      Es el comportamiento de siempre y no se toca (AB-01 sigue abierto: esa
--      conversación se erosiona por arriba y nadie ha decidido cambiar el
--      ancla). Los nulos —lo pre-compra— quedan fuera solos.
--   2. CONSULTAS QUE NO LLEGARON A NADA: la conversación entera, de una pieza,
--      a los 30 días sin actividad y solo si el par NUNCA compró. De una pieza
--      = no se erosiona: o está el hilo completo o no está.
--      Se borra la CONVERSACIÓN, no sus mensajes: la cascada se lleva mensajes,
--      marcas de lectura y reportes. Borrar solo los mensajes dejaría hilos
--      fantasma en la bandeja de los dos.
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

  with idas as (
    delete from public.conversations c
     where c.last_message_at is not null
       and c.last_message_at < now() - interval '30 days'
       and not public.pair_has_booking(c.student_id, c.tutor_id)
    returning 1
  )
  select count(*) into v_consultas from idas;

  return jsonb_build_object(
    'estado',              'activa',
    'retencion_dias',      30,
    'messages_purged',     v_deleted,
    'attachments_purged',  v_objects,
    -- Consultas previas a la compra que caducaron enteras (M-12).
    'consultas_purgadas',  v_consultas
  );
end;
$$;

-- Sigue siendo solo del cron: un `authenticated` que pueda vaciar mensajes
-- ajenos es la lección de US-605.
revoke execute on function public.purge_expired_messages() from public;
revoke execute on function public.purge_expired_messages() from anon;
revoke execute on function public.purge_expired_messages() from authenticated;
grant  execute on function public.purge_expired_messages() to service_role;

-- ⚠️ `pair_has_booking` es SECURITY DEFINER y mira `auth.uid()` en NINGÚN sitio
-- (recibe el par por parámetro), así que funciona igual llamada desde el cron,
-- donde no hay sesión. Si algún día se le añade un filtro por `auth.uid()`, la
-- purga dejaría de borrar en silencio.

-- ── 15 · Realtime ────────────────────────────────────────────────────────────
-- `messages` ya está en la publicación desde EP-17 y no hay que volver a
-- añadirla (hacerlo daría error). Lo que cambia es del lado del cliente: el
-- hilo filtra por `conversation_id=eq.<uuid>` en vez de por reserva, y la
-- burbuja sigue escuchando la tabla entera dejando que la RLS acote — que ahora
-- es la política de conversación. `conversations` NO se añade a la publicación:
-- la bandeja se entera de todo por los INSERT de `messages`.
