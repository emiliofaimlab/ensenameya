-- ============================================================================
-- Enséñame Ya — N-27: un "N.º de sesión" corto que se pueda decir por teléfono
--
-- Petición literal del cliente: «cada sesión debe tener un ID global para poder
-- hacerle seguimiento a las transacciones, que estén atados a la transacción».
-- Hoy lo único que identifica una clase es el uuid de `sessions`, que ni se
-- dicta, ni se apunta, ni se busca en un extracto bancario. Y el que aparecía
-- en la descarga del chat parecía un código interno (N-26).
--
-- POR QUÉ EL ANCLA ES LA RESERVA Y NO EL PAGO. La reserva se crea ANTES de que
-- exista cobro confirmado (`create_booking` la deja en `pending_payment` con un
-- `payments` en `pending`), y hay reservas que nunca llegan a pagarse. Si el
-- número colgara del pago, media plataforma —las que están a medio pagar, las
-- que expiraron— no tendría número justo mientras se la está persiguiendo por
-- teléfono. Con el ancla en la reserva el número existe desde el primer
-- segundo, y como `payments` es 1:1 con `bookings`, conciliar dinero ↔ clase
-- sigue siendo un salto directo: la referencia de la reserva ES la del cobro.
--
-- FORMA: `<referencia-de-reserva>-<sequence_no>` → `7K3M9Q-2`.
--   · 6 caracteres de un alfabeto SIN parecidos (nada de 0/O, 1/I/L, U/V): esto
--     se dicta por teléfono y se copia a mano en una hoja de cálculo, y una O
--     que era un cero cuesta una llamada más.
--   · Aleatorio, no correlativo. Un contador publica cuántas reservas lleva la
--     plataforma a cualquiera que compre dos veces; con 30^6 (729 millones) el
--     número no dice nada y sigue cabiendo en un asunto de correo.
--   · El guion no está en el alfabeto, así que partir "referencia" y "ordinal"
--     nunca es ambiguo.
--
-- ⚠️ NO ES UN SECRETO Y NO AUTORIZA NADA. Quien tenga el número no ve la clase:
-- la barrera sigue siendo la RLS de participante. Es una etiqueta para hablar,
-- como el número de un pedido.
--
-- ⚠️ NADA DE `not null` EN NINGUNA DE LAS DOS COLUMNAS, a propósito. El camino
-- de escritura de `bookings` es el del dinero (`create_booking`). Un `not null`
-- convierte cualquier futuro despiste con el trigger en un checkout que
-- revienta; sin él, lo peor que pasa es una reserva sin número visible, y la UI
-- ya cae al "Sesión 1 · 2 · 3" de siempre cuando falta.
-- ============================================================================

-- ── 1) La referencia de la reserva ──────────────────────────────────────────
alter table public.bookings
  add column if not exists booking_ref text;

comment on column public.bookings.booking_ref is
  'N-27: referencia corta y legible de la reserva (6 caracteres, sin 0/O/1/I/L/U). Es la mitad izquierda del "N.º de sesión" y la que concilia el cobro: payments es 1:1 con bookings. No confundir con payments.provider_payment_id, que es la referencia EXTERNA del PSP.';

-- `nulls distinct` (el comportamiento por defecto): mientras el backfill de
-- abajo no haya pasado, varias filas pueden tener null sin chocar entre ellas.
create unique index if not exists bookings_booking_ref_idx
  on public.bookings (booking_ref);

-- ── 2) Generador de referencias libres ──────────────────────────────────────
-- `security definer` porque el que comprueba la colisión tiene que ver TODAS
-- las reservas, no las suyas: bajo la RLS del alumno el `not exists` diría que
-- sí siempre y el número repetido lo cazaría el índice único, es decir, un
-- error en mitad del checkout.
create or replace function public.generar_referencia_reserva()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Crockford sin 0/1: ni ceros que parecen oes ni eles que parecen unos. La U
  -- también fuera, para que el azar no componga palabras que nadie quiere leer
  -- en su factura.
  c_alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_ref  text;
  v_i    integer;
  v_intentos integer := 0;
begin
  loop
    v_ref := '';
    for v_i in 1..6 loop
      v_ref := v_ref
        || substr(c_alfabeto, 1 + floor(random() * length(c_alfabeto))::integer, 1);
    end loop;

    exit when not exists (
      select 1 from public.bookings b where b.booking_ref = v_ref
    );

    -- Con 729 millones de combinaciones esto no debería girar nunca dos veces.
    -- El tope está para que un día raro (columna llena, random() amañado en un
    -- test) sea un error que se lee, y no un checkout colgado para siempre.
    v_intentos := v_intentos + 1;
    if v_intentos > 20 then
      raise exception 'no se pudo generar una referencia de reserva libre';
    end if;
  end loop;

  return v_ref;
end;
$$;

revoke execute on function public.generar_referencia_reserva() from public;

-- ── 3) Se rellena sola al crear la reserva ──────────────────────────────────
-- Trigger y NO un cambio en `create_booking`: esa función congela el snapshot
-- financiero y cuanto menos se toque, mejor (lo dice su propio comentario en
-- 20260709160000). Además así queda cubierto cualquier otro camino de alta que
-- aparezca mañana — el de la aceptación automática, un seed, un arreglo a mano.
create or replace function public.bookings_set_booking_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_ref is null then
    new.booking_ref := public.generar_referencia_reserva();
  end if;
  return new;
end;
$$;

revoke execute on function public.bookings_set_booking_ref() from public;

drop trigger if exists bookings_set_booking_ref on public.bookings;
create trigger bookings_set_booking_ref
  before insert on public.bookings
  for each row execute function public.bookings_set_booking_ref();

-- ── 4) El número de la sesión ───────────────────────────────────────────────
alter table public.sessions
  add column if not exists session_ref text;

comment on column public.sessions.session_ref is
  'N-27: "N.º de sesión" visible (bookings.booking_ref || ''-'' || ordinal). Se calcula al insertar; null solo en filas raras sin reserva legible. Etiqueta para hablar, NO autoriza nada: la barrera sigue siendo la RLS de participante.';

-- Denormalizado (columna) y no una vista ni un join: lo pide la cabecera de la
-- sala, la lista de sesiones de las dos pantallas de reserva, el botón de
-- grabación y la descarga del chat. Cinco sitios con un join extra cada uno,
-- para un dato que no cambia nunca, es peor negocio que una columna.
--
-- ⚠️ Índice NO único. La unicidad de verdad la da `bookings_booking_ref_idx`;
-- el sufijo `-N` ya es único dentro de la reserva porque `create_booking`
-- numera 1..N. Hacerlo único aquí significaría que un choque imposible aborta
-- el INSERT de una sesión — y ese insert es el del checkout, que ya traduce
-- cualquier `unique_violation` a "ese horario acaba de ser tomado". Prefiero
-- una etiqueta repetida a un pago que falla mintiendo sobre el motivo.
create index if not exists sessions_session_ref_idx
  on public.sessions (session_ref);

create or replace function public.sessions_set_session_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref     text;
  v_ordinal integer;
begin
  select b.booking_ref into v_ref
  from public.bookings b
  where b.id = new.booking_id;

  -- Sin referencia de reserva no hay número que componer. Se deja en null y la
  -- UI cae al "Sesión N" de toda la vida en vez de pintar un "null-1".
  if v_ref is null then
    new.session_ref := null;
    return new;
  end if;

  -- ⚠️ `sessions.sequence_no` es integer NULLABLE (20260709140000:70).
  -- `create_booking` siempre lo numera, pero la columna admite null y hay filas
  -- viejas que lo tienen. El respaldo es la posición cronológica dentro de la
  -- reserva; no es tan estable como el `sequence_no` real —si mañana se cuela
  -- una sesión anterior, el ordinal de las siguientes ya no cuadraría con lo
  -- que se calculó— y por eso es respaldo y no el camino normal.
  v_ordinal := coalesce(
    new.sequence_no,
    (
      select count(*) + 1
      from public.sessions s
      where s.booking_id = new.booking_id
        and s.id <> new.id
        and s.start_at < new.start_at
    )
  );

  new.session_ref := v_ref || '-' || v_ordinal;
  return new;
end;
$$;

revoke execute on function public.sessions_set_session_ref() from public;

-- También en el `update of sequence_no`: si se renumera una sesión, el número
-- visible tiene que seguirla. `booking_id` entra por lo mismo. Lo que NO se
-- contempla es que cambie `bookings.booking_ref`: esa referencia es inmutable
-- por definición (es lo que la gente ya apuntó en un papel).
drop trigger if exists sessions_set_session_ref on public.sessions;
create trigger sessions_set_session_ref
  before insert or update of sequence_no, booking_id on public.sessions
  for each row execute function public.sessions_set_session_ref();

-- ── 5) Backfill ─────────────────────────────────────────────────────────────
-- Fila a fila y no de una: el generador comprueba colisiones contra la propia
-- tabla, así que un `update` masivo que llama a `random()` por fila se juega el
-- índice único a los dados (paradoja del cumpleaños). Son cientos de filas.
--
-- Sí, esto mueve `updated_at` de las reservas ya existentes (lo hace el trigger
-- `bookings_set_updated_at`). Se acepta: ninguna lógica depende de esa columna
-- —la autocancelación de US-605 mira `created_at`— y desactivar el trigger para
-- un backfill de una vez cuesta más de lo que arregla.
do $$
declare r record;
begin
  for r in select id from public.bookings where booking_ref is null loop
    update public.bookings
       set booking_ref = public.generar_referencia_reserva()
     where id = r.id;
  end loop;
end;
$$;

-- Las sesiones sí van de una: aquí no hay azar, solo composición (y el mismo
-- `updated_at` movido, que tampoco usa nadie). El `row_number()` cubre las filas
-- con `sequence_no` nulo con el mismo criterio que el trigger (orden
-- cronológico, y el id para desempatar y que dos pasadas den lo mismo).
--
-- El trigger de arriba NO se mete: solo se dispara en `insert` y en `update of
-- sequence_no, booking_id`, y esto escribe `session_ref` a secas.
with ordinales as (
  select s.id,
         b.booking_ref,
         coalesce(
           s.sequence_no,
           (row_number() over (
             partition by s.booking_id order by s.start_at, s.id
           ))::integer
         ) as ordinal
  from public.sessions s
  join public.bookings b on b.id = s.booking_id
  where s.session_ref is null
    and b.booking_ref is not null
)
update public.sessions s
   set session_ref = o.booking_ref || '-' || o.ordinal
  from ordinales o
 where o.id = s.id;

-- ── 6) Grants (auto-expose OFF · regla de oro 9) ────────────────────────────
-- `authenticated` ya tiene `grant select` a nivel de TABLA sobre bookings y
-- sessions (20260709140000:182-184), y un grant de tabla cubre las columnas que
-- lleguen después: el cliente lee las dos columnas nuevas sin tocar nada.
--
-- `sessions` ya se lo concedió a `service_role` en 20260806140000, también a
-- nivel de tabla. `bookings` NO tiene ni un grant para ese rol, y este número
-- nace para conciliar dinero: en cuanto alguien lo lea desde el webhook de
-- Stripe, desde un recibo o desde el job de notificaciones se comería un
-- `permission denied` en TIEMPO DE EJECUCIÓN —no en el build, no en el
-- typecheck—, que es exactamente la mordida del 6-ago repetida por cuarta vez.
-- Se concede aquí, con la columna, y no cuando explote.
grant select on public.bookings to service_role;
