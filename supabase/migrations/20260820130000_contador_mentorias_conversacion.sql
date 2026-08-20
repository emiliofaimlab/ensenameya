-- ============================================================================
-- L1-2 · MN-08 — Cuántas mentorías hay detrás de esta conversación.
--
-- LO QUE PEDÍA LA MINUTA. En la bandeja, junto a cada persona, «3 mentorías».
-- Hoy `my_conversations()` (M-12, `20260817210000`) solo sabe decir SÍ/NO
-- (`has_booking`) y cuál fue la ÚLTIMA reserva del par: nunca un recuento.
--
-- ── Por qué NO una columna materializada ────────────────────────────────────
-- La tentación es `conversations.mentorias_count` mantenida por trigger. Sería
-- un cuarto sitio donde vive la verdad sobre las reservas de un par —después de
-- `bookings`, de `pair_has_booking` y de `tutor_students`— y el primero que
-- puede quedarse DESFASADO en silencio: cualquier cambio de estado que no pase
-- por el trigger (un `update` de soporte, un reembolso, un borrado en cascada)
-- deja el número mintiendo sin que nada falle. La bandeja carga como mucho unas
-- decenas de filas y ya cruza reservas en la misma consulta; se cuenta al leer.
--
-- ── ⚠️ «MENTORÍA» ADMITE TRES CUENTAS DISTINTAS, Y DAN TRES NÚMEROS ─────────
-- Es la pregunta P-7 del Doc 20, sin responder a día de hoy:
--   (a) títulos distintos comprados  → `count(distinct b.product_id)`
--   (b) compras                      → `count(distinct b.id)`
--   (c) clases                       → la suma de `b.num_sessions`
-- Sobre las MISMAS filas: quien compró dos veces la misma mentoría de 4 clases
-- es 1, 2 y 8. Se entregan **dos** columnas —(a) como `product_count`, que es
-- la lectura literal de «cuántas mentorías», y (c) como `session_count`— para
-- que cuando el cliente conteste la decisión sea de PINTADO y no de esquema:
-- ninguna respuesta obliga a otra migración. (b) no se añade porque en el
-- catálogo de hoy —productos de una sola clase— coincide con (c); si el cliente
-- pide expresamente «compras» y para entonces hay paquetes, es una columna más
-- sobre esta misma función.
--
-- `session_count` sale de `sum(b.num_sessions)` y NO de contar filas de
-- `public.sessions`, a propósito. Dos razones: `num_sessions` es el snapshot
-- congelado de la reserva (regla de oro 7) y no depende de que las filas de
-- `sessions` existan o de en qué estado estén; y contar `sessions` obligaría a
-- decidir qué hacer con `cancelled` / `no_show`, o sea a estrenar una lista de
-- estados MÁS —exactamente lo que este fichero existe para evitar (abajo).
-- (De paso: el comentario de `20260709140000` dice que las sesiones «se crean
-- al confirmar la reserva» y es falso — las crea `create_booking` como hold del
-- slot. Otra razón para no colgar de ahí un número que se enseña.)
--
-- ── ⚠️⚠️ UNA SOLA LISTA DE ESTADOS EN TODO EL REPO ──────────────────────────
-- «Es mi alumno» / «este par compró» estaba escrito LITERALMENTE DOS VECES:
-- en `tutor_students` (`20260817150000`) y en `pair_has_booking`
-- (`20260817210000`), que ya avisaba de que «dos definiciones distintas
-- acabarían discrepando». Un contador con su propia lista sería la tercera, y
-- entonces el mismo par diría dos cosas en dos pantallas: la bandeja «2
-- mentorías» y el chat «sin reserva».
--
-- Así que la lista se extrae a `pair_booking_stats(alumno, tutor)` y
-- `pair_has_booking` pasa a LEER DE ELLA. El criterio no cambia ni un estado;
-- lo que cambia es que ahora solo está escrito en un sitio.
--
-- ⚠️ NO REESCRIBAS ESTA LISTA EN OTRA FUNCIÓN. Si necesitas «reservas del par»
-- en algún sitio nuevo, llama a `pair_booking_stats`. Y si algún día el
-- criterio tiene que cambiar, se cambia aquí y `tutor_students` se alinea con
-- una migración propia (esa sigue teniéndolo inline: es una RPC de otro carril
-- y no se toca desde aquí, pero es la última copia que queda).
--
-- ORDEN OBLIGATORIO al desplegar: `db:push` → `db:types` → frontend. Esta
-- migración cambia la FIRMA de `my_conversations()`; un frontend que llegue
-- antes pide columnas que todavía no existen.
-- ============================================================================

-- ── 1 · La lista de estados, una sola vez ────────────────────────────────────
-- Misma definición que traía `pair_has_booking` desde M-12, palabra por
-- palabra. Fuera se quedan `pending_payment` (checkout abandonado: no ha pagado
-- nadie) y `cancelled` sin `completed_at` (se deshizo antes de darse); dentro
-- entra cualquier reserva con `completed_at`, porque un reembolso posterior a
-- la clase no borra que la clase se dio (ver el razonamiento largo en
-- `20260817150000`, decisión 2).
--
-- SECURITY DEFINER por lo mismo que su predecesora: ni el alumno puede leer las
-- reservas del tutor ni al revés, y esto solo devuelve agregados sobre un par
-- que el llamante ya conoce. No mira `auth.uid()` en ningún sitio —recibe el
-- par por parámetro—, así que sirve igual desde una sesión que desde el cron.
create or replace function public.pair_booking_stats(
  p_student_id uuid,
  p_tutor_id   uuid
)
returns table (
  has_booking   boolean,
  -- Mentorías distintas compradas: la lectura literal de «cuántas mentorías».
  product_count integer,
  -- Clases contratadas (suma de los snapshots `bookings.num_sessions`).
  session_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) > 0,
    count(distinct b.product_id)::int,
    coalesce(sum(b.num_sessions), 0)::int
  from public.bookings b
  where b.student_id = p_student_id
    and b.tutor_id   = p_tutor_id
    and (
      b.status in ('pending_acceptance', 'confirmed', 'in_progress', 'completed')
      or b.completed_at is not null          -- reembolsada DESPUÉS de darse
    );
$$;

comment on function public.pair_booking_stats(uuid, uuid) is
  'MN-08: qué hay detrás del par (alumno, tutor) — si llegó a comprar, cuántas mentorías distintas y cuántas clases. ÚNICO sitio donde vive la lista de estados de "este par compró": `pair_has_booking` lee de aquí.';

revoke execute on function public.pair_booking_stats(uuid, uuid) from public;
revoke execute on function public.pair_booking_stats(uuid, uuid) from anon;
grant  execute on function public.pair_booking_stats(uuid, uuid) to authenticated;

-- Sin grant a `service_role` y no es un olvido (regla de oro 9): el único job
-- que llega hasta aquí es la purga del chat, y entra por
-- `purge_expired_messages`, que es SECURITY DEFINER y por tanto corre como su
-- dueña — los grants de rol no le aplican. Es la misma situación que
-- `pair_has_booking` lleva desde M-12 y funciona. ⚠️ El día que esa purga se
-- mueva a un Route Handler con `service_role` —como ya pasó con
-- `/api/cron/recordings-purge`— harán falta los dos grants, y eso no lo ve ni
-- el build ni el typecheck: revienta a las 04:00.

-- ── 2 · `pair_has_booking` ahora es una lectura de lo de arriba ──────────────
-- Misma firma, mismo `security definer`, mismo resultado: lo único que cambia
-- es que la lista de estados ya no está aquí. Todo lo que colgaba de ella
-- —topes anti-spam de `send_conversation_message`, exención de la purga a 30
-- días, `has_booking` de la bandeja— sigue leyendo exactamente lo mismo.
--
-- Nota de coste, por si alguien la ve y le pica: se cambia un `exists` (que
-- corta en la primera fila) por un agregado que lee todas las reservas del par.
-- Son las reservas de UN alumno con UN tutor, por `bookings_student_id_idx`:
-- unas pocas filas. Vale la pena a cambio de que la lista exista una sola vez.
create or replace function public.pair_has_booking(p_student_id uuid, p_tutor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select s.has_booking from public.pair_booking_stats(p_student_id, p_tutor_id) s;
$$;

comment on function public.pair_has_booking(uuid, uuid) is
  'M-12: ¿el alumno llegó a comprarle al tutor? Levanta los topes anti-spam del chat previo y exime a la conversación de la purga a 30 días. Desde MN-08 lee de `pair_booking_stats`, que es donde vive la lista de estados.';

revoke execute on function public.pair_has_booking(uuid, uuid) from public;
revoke execute on function public.pair_has_booking(uuid, uuid) from anon;
grant  execute on function public.pair_has_booking(uuid, uuid) to authenticated;

-- ── 3 · La bandeja, con el recuento ──────────────────────────────────────────
-- ⚠️ `create or replace` NO SIRVE AQUÍ. Añadir columnas a un `returns table`
-- cambia el tipo de retorno de la función, y Postgres lo rechaza con «cannot
-- change return type of existing function». Hay que dropear y volver a crear
-- —y por eso hay que RE-DECLARAR los grants debajo: el `drop` se los lleva.
drop function if exists public.my_conversations();

-- Todo lo demás se conserva tal cual estaba en M-12, y hay dos cosas que NO se
-- pueden tocar aunque parezcan de adorno:
--   · el `where (select auth.uid()) in (c.student_id, c.tutor_id)`: es DEFINER,
--     la RLS de `conversations` no está mirando y ese filtro es LA línea que
--     impide leer la bandeja ajena;
--   · el `limit 1` del lateral `ultima`, que es lo que hace que «la última
--     reserva» sea una y no N filas duplicadas por conversación.
-- El recuento entra por un lateral HERMANO (`st`), sin tocar el anterior.
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
  -- MN-08 · las dos lecturas de «cuántas mentorías» (ver cabecera y P-7).
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
    -- `has_booking` ya no llama a `pair_has_booking`: sale del MISMO agregado
    -- que los dos recuentos. Es el resultado idéntico —esa función lee de
    -- aquí— con una llamada por fila en vez de dos, y sobre todo garantiza que
    -- «tiene reserva» y «tiene 2 mentorías» no puedan contradecirse.
    st.has_booking,
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
  'M-12 + MN-08: la bandeja. Por cada hilo del usuario, con quién habla (nombre y foto), si ya hubo compra, cuántas mentorías (`product_count`) y cuántas clases (`session_count`) hay detrás, y de qué mentoría fue la última reserva. SECURITY DEFINER acotada por participación en la conversación.';

revoke execute on function public.my_conversations() from public;
revoke execute on function public.my_conversations() from anon;
grant  execute on function public.my_conversations() to authenticated;
