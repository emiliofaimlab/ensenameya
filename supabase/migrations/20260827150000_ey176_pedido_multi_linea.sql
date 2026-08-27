-- ============================================================================
-- Enséñame Ya — EY-176 · B3.1: EL MOTOR DE COBRO POR LÍNEA DE COMPRA (1 de 3)
--
-- Qué añade este fichero: la CABECERA DE PEDIDO (`orders`), el enlace
-- `bookings.order_id` y la función que crea N reservas en UNA transacción.
-- Los otros dos ficheros de la ficha:
--   · 20260827160000 — el webhook confirma TODAS las líneas (el fallo grave);
--   · 20260827170000 — el cobro tardío de un pedido (X-02 con un solo `pi_`).
--
-- ── LAS TRES DECISIONES DE PRODUCTO QUE ESTO IMPLEMENTA ─────────────────────
--
-- P-2 · **el carrito NO retiene el horario.** El reloj de 7 minutos sigue
--   arrancando al entrar al pago, exactamente como hoy: `expire_stale_bookings`
--   corta por `bookings.created_at` (20260826120000) y este fichero NO lo toca.
--   Las N reservas del pedido nacen en la MISMA transacción, así que comparten
--   `created_at` al milisegundo y el cron las vence a la vez, en una sola
--   pasada. Esa coincidencia no es casual: es lo que hace que un pedido no se
--   pueda quedar medio vivo por el reloj.
--
-- P-1 · **si una línea pierde su hueco, se cae el pedido entero.** Sale gratis:
--   una función plpgsql corre dentro de la transacción de quien la llama, así
--   que un `raise` en la línea 3 deshace también las líneas 1 y 2. Lo único que
--   hubo que añadir es DECIR CUÁL falló — ver el bloque `exception` de
--   `create_order`, que devuelve el índice en `detail` y el producto en `hint`.
--
-- P-3 · **un cobro con varias líneas dentro.** De ahí `orders`: un cargo, una
--   cabecera, y N filas de `payments` colgando de sus N reservas.
--
-- ── POR QUÉ ESTE MODELO Y NO «UN PAGO CON VARIOS `payout_items`» ────────────
--
-- El diseño alternativo —`payments` como cabecera del pedido— está DESCARTADO
-- y no por gusto (Doc 23 §23.3.1). Lo que lo mata es una fuga de RLS:
-- `payments_select_tutor` (20260709140000:167-175) autoriza al tutor por
-- `payments.booking_id`, así que si el pago fuese del pedido, **cada tutor
-- vería el importe total del pedido**, incluidas las líneas de sus
-- competidores. Y detrás vienen `payout_items.payment_id unique`, el
-- `tier_split_pct` único por pago, y el `select … into` sin `limit 1` del
-- clawback de US-704 (20260817170000:475-502), que da por hecho ≤ 1 fila.
--
-- Con la cabecera aparte, cada línea sigue siendo lo que ya era —una reserva,
-- un pago, un snapshot financiero congelado— y por eso **`payouts`,
-- `payout_items`, `build_payout_for_tutor`, `tutor_balance`, `manage_payout`,
-- `request_withdrawal` y el clawback no se tocan en toda la ficha.**
--
-- ⚠️ Y POR ESO MISMO NO HAY `payments.order_id`. El Doc 23 lo proponía; se
-- descarta a propósito. Todo lo que necesita el pedido se llega por
-- `payments → bookings.order_id`, que es un `join` de nada, y así `payments`
-- —la tabla que el tutor SÍ puede leer— no gana ni una columna nueva. Una
-- fuente de verdad para la pertenencia al pedido, no dos que puedan discrepar.
-- ============================================================================


-- ── 1) El estado del pedido ────────────────────────────────────────────────
--
-- ⚠️ ESTE ENUM HABLA DEL **CARGO**, NO DE LAS LÍNEAS. Un pedido `paid` puede
-- tener luego una línea reembolsada y otra cancelada por el tutor: eso vive en
-- `bookings.status` y `payments.status`, que es donde siempre ha vivido. Aquí
-- solo se responde «¿se llegó a cobrar este pedido?».
--
-- Consecuencia que hay que conocer: un pedido cuyas reservas venció
-- `expire_stale_bookings` a los 7 minutos **se queda en `pending_payment` para
-- siempre**, porque nunca se cobró. Es la verdad, no un descuido, y se prefiere
-- a reescribir el cron —que es hoy la función más delicada del proyecto— solo
-- para mover una etiqueta. Quien necesite saber si un pedido sigue vivo mira
-- sus reservas; `find_open_order` (abajo) hace exactamente eso.
create type public.order_status as enum (
  'pending_payment',  -- creado, con el cobro sin resolver (o nunca abierto)
  'paid',             -- el PSP confirmó el cargo
  'cancelled'         -- el cargo falló o caducó de forma terminal
);


-- ── 2) La cabecera del pedido ──────────────────────────────────────────────
create table public.orders (
  id                  uuid        primary key default gen_random_uuid(),

  student_id          uuid        not null references public.profiles (id) on delete cascade,

  status              public.order_status not null default 'pending_payment',

  -- Snapshot del ruteo, igual que `payments.provider`: lo congela la creación y
  -- no se relee. Todas las líneas de un pedido comparten proveedor por
  -- construcción (`create_order` lo exige), porque un cargo solo puede salir
  -- por una pasarela.
  provider            text        not null,

  -- Moneda ÚNICA del pedido. También la exige `create_order`: sumar dos monedas
  -- en un cargo sería inventarse un tipo de cambio.
  currency            char(3)     not null,

  -- El `pi_…` del ÚNICO cargo del pedido. Lo sella el webhook antes de
  -- confirmar nada, igual que hace con `payments.provider_payment_id`.
  provider_payment_id text,

  -- ⚠️ LA HUELLA DE LO QUE SE PIDIÓ, Y PARA QUÉ SIRVE DE VERDAD.
  --
  -- No es auditoría: es el candado contra el pedido duplicado. Recargar la
  -- pantalla de pago, un doble clic o volver atrás no pueden crear un segundo
  -- pedido con las mismas líneas — y no por elegancia, sino porque el segundo
  -- FALLARÍA: las reservas del primero ya retienen esos huecos y
  -- `get_available_slots` descuenta toda sesión no cancelada del tutor sin
  -- mirar de quién es. O sea que el alumno se bloquearía a sí mismo, que es el
  -- mismo candado que documenta `lib/checkout/hold.ts` para una línea suelta.
  --
  -- La compone SIEMPRE el servidor (`order_lines_fingerprint`), nunca el
  -- navegador: una huella que pusiera el cliente sería el cliente decidiendo
  -- qué pedido reutiliza.
  lines_fingerprint   text        not null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.orders is
  'EY-176: cabecera de un cobro con varias líneas. Un pedido = un cargo en la tarjeta = N reservas con su propio pago cada una. El estado habla del CARGO, no de las líneas.';
comment on column public.orders.lines_fingerprint is
  'Huella canónica de (mentoría, horarios) del pedido. Sirve para reutilizar el pedido abierto en vez de crear uno duplicado que se bloquearía a sí mismo. La compone el servidor.';

create index orders_student_idx on public.orders (student_id, status);
create index orders_provider_pid_idx on public.orders (provider_payment_id);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();


-- ── 3) El enlace: qué reserva pertenece a qué pedido ───────────────────────
--
-- NULLABLE, y eso es la mitad del ahorro de esta ficha: la compra de UNA
-- mentoría no cambia en absoluto. `create_booking` sigue existiendo con su
-- misma firma, sigue creando una reserva sin pedido, y el checkout de siempre
-- no se entera de que existe `orders`.
--
-- ⚠️ `on delete set null` y NO `cascade`. Borrar un pedido no puede llevarse
-- por delante reservas pagadas. El único borrado posible sería el cascada desde
-- `profiles`, y ahí las reservas ya mueren por su propio `student_id`; con
-- `cascade` aquí, además, el orden de borrado decidiría si se pierden datos
-- contables. (Hoy ni siquiera pasa: EY-192 anonimiza el perfil y NO lo borra,
-- justo para conservar `bookings`/`payments` por plazo fiscal.)
alter table public.bookings
  add column order_id uuid references public.orders (id) on delete set null;

comment on column public.bookings.order_id is
  'EY-176: pedido al que pertenece esta línea, o null si se compró suelta. El snapshot financiero sigue siendo de la reserva, no del pedido.';

create index bookings_order_idx on public.bookings (order_id) where order_id is not null;


-- ── 4) RLS — default-deny (regla de oro 1) ─────────────────────────────────
alter table public.orders enable row level security;

-- El alumno lee sus pedidos. Nadie más los lee salvo el admin.
create policy "orders_select_student"
  on public.orders for select
  using ( (select auth.uid()) = student_id );

create policy "orders_select_admin"
  on public.orders for select
  using ( public.has_role('admin') );

-- ⚠️ NO HAY POLÍTICA PARA EL TUTOR, Y ES EL PUNTO ENTERO DE ESTE DISEÑO.
-- El tutor ve su reserva (`bookings_select_tutor`) y su pago
-- (`payments_select_tutor`), y ahí se acaba. Si pudiera leer `orders` sabría
-- que su clase se compró junto a otras y —vía el importe del pedido— cuánto
-- cobran los demás. Eso es exactamente la fuga que hizo descartar el diseño B.

-- Sin políticas de insert/update/delete: escribe `create_order` (SECURITY
-- DEFINER, o sea como dueño) y el webhook con `service_role`, que se salta la
-- RLS pero NO los grants — ver abajo.


-- ── 5) Grants (auto-expose OFF) ────────────────────────────────────────────
--
-- Privada → `authenticated`, nunca `anon`. La política de arriba acota a quién.
grant select on public.orders to authenticated;

-- ⚠️ REGLA DE ORO 9, la que ya mordió cuatro veces en agosto. `service_role` se
-- salta la RLS pero NO los `grant` de tabla, y en este proyecto «auto-expose
-- new tables» está OFF. El webhook de Stripe lee el pedido y le sella el `pi_`
-- con el cliente `service_role`: sin estas dos líneas, `permission denied` **en
-- tiempo de ejecución**, no en el build ni en el typecheck ni en `db:push`.
--
-- El `update` va por COLUMNAS, como el de `payments` (20260806170000:49): el
-- webhook cambia el estado y sella la referencia, y no tiene por qué poder
-- reescribir la moneda ni el dueño de un pedido.
grant select                                on public.orders to service_role;
grant update (status, provider_payment_id)  on public.orders to service_role;


-- ============================================================================
-- 6) LA HUELLA CANÓNICA DE UN CARRITO
--
-- Formato: por línea, `<uuid de la mentoría>~<ms>.<ms>…` con los instantes
-- ordenados; las líneas ordenadas entre sí y unidas por `!`. Es el mismo
-- formato que `cartLineKey` escribe en la cookie `ey-cart`
-- (`src/lib/cart/cookie.ts`), y la coincidencia es deliberada: cuando algo no
-- cuadre, el valor de la columna se puede comparar a ojo con el de la cookie.
--
-- ⚠️ MILISEGUNDOS Y NO ISO, por la misma razón que la cookie: `…T08:00:00.000Z`
-- y `…T08:00:00+00:00` son el mismo instante y dos textos distintos, así que
-- una huella hecha de texto ISO fallaría en reconocer el pedido que acaba de
-- crear. Con el número no hay dos formas de escribir el mismo momento.
-- ============================================================================
-- ⚠️ `stable` Y NO `immutable`, aunque parezca una función pura. Dentro hay un
-- `text::timestamptz` y un `extract(epoch …)`, y los dos dependen del `TimeZone`
-- de la sesión para una cadena sin desfase: eso es `stable` por definición.
-- Declararla `immutable` sería una mentira que Postgres NO comprueba, y el día
-- que alguien la usara en un índice ese índice quedaría corrupto en silencio.
-- No hay índice sobre ella hoy; se declara bien igualmente.
create or replace function public.order_lines_fingerprint(p_lines jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  -- ⚠️ LOS DOS `jsonb_typeof` SON GUARDAS, NO CEREMONIA. `jsonb_array_elements`
  -- sobre un escalar revienta con «cannot extract elements from a scalar», y
  -- esta función la alcanza `find_open_order`, que está concedida a
  -- `authenticated`: el cuerpo lo puede escribir cualquiera. Con la guarda, una
  -- entrada mal formada devuelve una huella que no casa con ningún pedido —que
  -- es la respuesta correcta— en vez de un 500.
  select coalesce(string_agg(huella, '!' order by huella), '')
  from (
    select (linea->>'product_id') || '~' || coalesce((
      select string_agg(
               (extract(epoch from s.valor::timestamptz) * 1000)::bigint::text,
               '.' order by s.valor::timestamptz
             )
      from jsonb_array_elements_text(
             case when jsonb_typeof(linea->'slots') = 'array'
                  then linea->'slots' else '[]'::jsonb end
           ) as s(valor)
    ), '') as huella
    from jsonb_array_elements(
           case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end
         ) as linea
  ) h;
$$;

revoke execute on function public.order_lines_fingerprint(jsonb) from public;
revoke execute on function public.order_lines_fingerprint(jsonb) from anon;
revoke execute on function public.order_lines_fingerprint(jsonb) from authenticated;


-- ============================================================================
-- 7) ¿HAY YA UN PEDIDO ABIERTO PARA ESTE CARRITO?
--
-- Es el equivalente de pedido a `buscarReservaDelAlumno` (`lib/checkout/hold.ts`)
-- y responde a la misma pregunta: al recargar la pantalla de pago, ¿reutilizo
-- lo que hay o pido otra vez?
--
-- ⚠️ NO BASTA CON QUE EL PEDIDO SIGA EN `pending_payment`. Sus reservas pueden
-- haberlas vencido `expire_stale_bookings` hace un minuto, y en ese caso los
-- huecos ya están libres y lo correcto es empezar de cero. Por eso se exige que
-- TODAS sus líneas sigan en `pending_payment` — que es, además, la misma
-- condición de «todo o nada» de P-1 aplicada a la reutilización.
--
-- Se expone a `authenticated` porque solo lee lo del propio llamador (el
-- `student_id = auth.uid()` está dentro) y porque el Route Handler la necesita
-- para desempatar una carrera de dos pestañas sin volver a crear nada.
-- ============================================================================
create or replace function public.find_open_order(p_lines jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student uuid := (select auth.uid());
  v_fp      text;
  v_order   uuid;
begin
  if v_student is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  v_fp := public.order_lines_fingerprint(p_lines);
  if v_fp = '' then
    return null;
  end if;

  select o.id into v_order
  from public.orders o
  where o.student_id = v_student
    and o.status = 'pending_payment'
    and o.lines_fingerprint = v_fp
    -- Tiene líneas…
    and exists (select 1 from public.bookings b where b.order_id = o.id)
    -- …y TODAS siguen esperando el mismo cobro.
    and not exists (
      select 1 from public.bookings b
      where b.order_id = o.id and b.status <> 'pending_payment'
    )
  order by o.created_at desc
  limit 1;

  return v_order;
end;
$$;

revoke execute on function public.find_open_order(jsonb) from public;
revoke execute on function public.find_open_order(jsonb) from anon;
grant  execute on function public.find_open_order(jsonb) to authenticated;


-- ============================================================================
-- 8) UNA LÍNEA — el cuerpo de `create_booking`, extraído tal cual
--
-- ⚠️ ESTO NO ES CÓDIGO NUEVO: es el cuerpo LITERAL de `create_booking`
-- (20260715170000:104-226) con dos cambios y ni uno más:
--   · el alumno llega por parámetro en vez de resolverse con `auth.uid()`
--     —lo comprueba el envoltorio, que es quien tiene delante a la persona—;
--   · devuelve el id de la reserva, como antes.
-- La revalidación de huecos, el tier (RN-06), el cálculo del total (RN-10), el
-- ruteo (RN-33), el snapshot congelado en `payments` y el hold de `sessions`
-- son los de siempre, con las mismas líneas y los mismos mensajes.
--
-- POR QUÉ EXTRAERLO en vez de copiarlo dentro de `create_order`: porque son
-- doce reglas de dinero y dos copias divergen. La primera vez que alguien
-- cambie el cálculo del split en un sitio y no en el otro, la mitad de los
-- pedidos pagará un porcentaje distinto al de la compra suelta, y nada avisará.
--
-- ⚠️ INTERNA. Sin `grant` a nadie: la llaman `create_booking` y `create_order`,
-- las dos SECURITY DEFINER del mismo dueño. En Postgres el `execute` nace
-- concedido a PUBLIC, así que el `revoke` de abajo no es ceremonia — es lo que
-- impide que cualquiera cree una reserva a nombre de OTRO alumno pasándole el
-- uuid que quiera.
-- ============================================================================
create or replace function public.create_booking_line(
  p_student    uuid,
  p_product_id uuid,
  p_slots      timestamptz[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prod     record;
  v_required int;
  v_total    bigint;
  v_split    numeric(5,2);          -- US-1103: lo resuelve el tier del tutor (RN-06)
  v_net      bigint;
  v_fee      bigint;
  v_payee    char(2) := 'VE';         -- ponytail: payout_country del tutor llega en S3/C-13
  v_provider text;
  v_avail    int;
  v_booking  uuid;
  v_slot     timestamptz;
  v_seq      int := 0;
begin
  select p.id, p.tutor_id, p.pricing_model, p.price_amount, p.currency,
         p.session_duration_min, p.package_num_sessions
    into v_prod
  from public.products p
  join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  where p.id = p_product_id and p.status = 'active';
  if v_prod.id is null then
    raise exception 'producto no reservable' using errcode = 'check_violation';
  end if;

  -- US-1103 (RN-06): el split lo define el tier del tutor. Sin tier asignado
  -- cae al default; si tampoco hay default se PARA en vez de inventar un número
  -- — es dinero, no un valor cosmético.
  select tt.split_pct into v_split
    from public.tutor_profiles tp
    join public.tutor_tiers tt on tt.id = tp.tier_id
   where tp.profile_id = v_prod.tutor_id;

  if v_split is null then
    select split_pct into v_split from public.tutor_tiers where is_default;
  end if;

  if v_split is null then
    raise exception 'el tutor no tiene tier asignado y no hay tier por defecto'
      using errcode = 'check_violation';
  end if;

  v_required := case when v_prod.pricing_model = 'per_package'
                     then coalesce(v_prod.package_num_sessions, 1) else 1 end;
  if coalesce(array_length(p_slots, 1), 0) <> v_required then
    raise exception 'debes elegir % horario(s)', v_required using errcode = 'check_violation';
  end if;

  -- Cada slot pedido debe seguir disponible (reglas − excepciones − ocupados, S-41).
  --
  -- ⚠️ DENTRO DE UN PEDIDO, ESTA COMPROBACIÓN VE LAS LÍNEAS ANTERIORES. Las N
  -- reservas se crean en la misma transacción, así que al llegar a la línea 2
  -- las `sessions` de la línea 1 ya existen y `get_available_slots` las
  -- descuenta. Es lo correcto —un tutor no da dos clases a la vez— y es lo que
  -- hace que un carrito con dos mentorías del mismo tutor a la misma hora se
  -- caiga aquí en vez de venderse.
  select count(*) into v_avail
  from unnest(p_slots) as s(slot)
  where exists (
    select 1 from public.get_available_slots(p_product_id, current_date, current_date + 30) g
    where g.slot_start = s.slot
  );
  if v_avail <> v_required then
    raise exception 'algún horario ya no está disponible' using errcode = 'check_violation';
  end if;

  -- Montos (unidades menores) según modelo (RN-10).
  v_total := case
    when v_prod.pricing_model = 'per_hour'
      then round(v_prod.price_amount * v_prod.session_duration_min / 60.0)
    else v_prod.price_amount   -- per_session (1) o per_package (precio del paquete = total)
  end;
  v_net := round(v_total * v_split / 100.0);
  v_fee := v_total - v_net;

  -- US-701: ruteo por geografía; sin regla activa → bloqueada (RN-33).
  select charge_provider into v_provider
  from public.payment_routing_rules
  where is_active and payee_country = v_payee and payer_country is null
  order by priority
  limit 1;
  if v_provider is null then
    raise exception 'sin ruta de pago disponible para el destino' using errcode = 'check_violation';
  end if;

  insert into public.bookings (
    student_id, product_id, tutor_id, status, pricing_model, num_sessions,
    session_duration_min, currency, subtotal_amount, total_amount, tier_split_pct, payee_country
  ) values (
    p_student, v_prod.id, v_prod.tutor_id, 'pending_payment', v_prod.pricing_model, v_required,
    v_prod.session_duration_min, v_prod.currency, v_total, v_total, v_split, v_payee
  ) returning id into v_booking;

  -- US-702: split congelado en el pago (server-side).
  insert into public.payments (
    booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount,
    tier_split_pct, payee_country, provider
  ) values (
    v_booking, 'pending', v_prod.currency, v_total, v_fee, v_net, v_split, v_payee, v_provider
  );

  -- Sessions = hold del slot (S-41). El índice único cierra la carrera.
  foreach v_slot in array p_slots loop
    v_seq := v_seq + 1;
    insert into public.sessions (booking_id, tutor_id, student_id, sequence_no, start_at, end_at, status)
    values (v_booking, v_prod.tutor_id, p_student, v_seq, v_slot,
            v_slot + make_interval(mins => v_prod.session_duration_min), 'scheduled');
  end loop;

  return v_booking;
exception
  when unique_violation then
    raise exception 'ese horario acaba de ser tomado' using errcode = 'check_violation';
end;
$$;

revoke execute on function public.create_booking_line(uuid, uuid, timestamptz[]) from public;
revoke execute on function public.create_booking_line(uuid, uuid, timestamptz[]) from anon;
revoke execute on function public.create_booking_line(uuid, uuid, timestamptz[]) from authenticated;


-- ============================================================================
-- 9) `create_booking` — MISMA FIRMA, MISMO COMPORTAMIENTO, AHORA UN ENVOLTORIO
--
-- No cambia nada para nadie: mismos parámetros, mismo valor de vuelta, mismos
-- mensajes de error, mismo `grant`. Lo único que cambia es de dónde sale el
-- cuerpo. La compra de UNA mentoría —la ficha del tutor, el selector de
-- horarios, `/reservar/<id>/checkout`, `resume-payment`— no se entera.
-- ============================================================================
create or replace function public.create_booking(
  p_product_id uuid,
  p_slots      timestamptz[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := (select auth.uid());
begin
  if v_student is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  return public.create_booking_line(v_student, p_product_id, p_slots);
end;
$$;

-- `create or replace` conserva los privilegios, pero se repiten por si esta
-- migración se aplica sobre una base donde la función no existiera: en Postgres
-- el `execute` nace concedido a PUBLIC. Mismo gotcha de 20260715150000,
-- 20260806120000, 20260817160000 y 20260826120000.
revoke execute on function public.create_booking(uuid, timestamptz[]) from public;
revoke execute on function public.create_booking(uuid, timestamptz[]) from anon;
grant  execute on function public.create_booking(uuid, timestamptz[]) to authenticated;


-- ============================================================================
-- 10) EL PEDIDO — N reservas en UNA transacción (P-1 · P-3)
--
-- Entrada: `[{"product_id": "<uuid>", "slots": ["<ISO>", …]}, …]`.
-- Salida: el id del pedido.
--
-- ── TODO O NADA, Y POR QUÉ SALE GRATIS (P-1) ────────────────────────────────
-- Una función plpgsql corre DENTRO de la transacción de quien la llama, y
-- PostgREST le da una transacción por petición. Así que cualquier `raise` que
-- salga de aquí deshace las líneas que ya se habían creado: no hay reservas
-- huérfanas, no hay holds sueltos que limpiar y no hace falta compensación
-- ninguna. La atomicidad no se programa; se hereda.
--
-- ⚠️ EL MATIZ QUE HAY QUE CONOCER: eso vale porque nadie envuelve esta llamada
-- en su propio bloque `exception`. Si algún día se llama a `create_order` desde
-- otra función plpgsql que capture el error, las líneas anteriores
-- SOBREVIVIRÍAN al `raise` (el bloque interno solo deshace su subtransacción).
-- Quien lo haga, que abra transacción propia o que asuma que P-1 deja de valer.
--
-- ── CUÁL FALLÓ ──────────────────────────────────────────────────────────────
-- El mensaje se conserva TAL CUAL —para que `esCarreraDeHorario`
-- (`lib/checkout/hold.ts`) siga reconociendo los tres disfraces de la carrera
-- de horarios sin tocarlo— y el índice de la línea viaja aparte, en `detail`, y
-- el producto en `hint`. PostgREST los publica como `error.details` y
-- `error.hint`, así que el navegador puede señalar la línea culpable sin
-- parsear una cadena.
-- ============================================================================
create or replace function public.create_order(p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student    uuid := (select auth.uid());
  v_n          int;
  v_idx        int := 0;
  v_linea      jsonb;
  v_product    uuid;
  v_slots      timestamptz[];
  v_tramos     jsonb := '[]'::jsonb;
  v_dur        int;
  v_tutor      uuid;
  v_slot       timestamptz;
  v_ids        uuid[] := '{}';
  v_booking    uuid;
  v_order      uuid;
  v_monedas    char(3)[];
  v_provs      text[];
  v_r          record;
begin
  if v_student is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  -- `jsonb_array_length` sobre algo que no es un array revienta con un error
  -- crudo de Postgres, y esta función está concedida a `authenticated`: el
  -- cuerpo puede ser cualquier cosa. Se comprueba el tipo antes de medirlo.
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'el pedido no lleva ninguna mentoría' using errcode = 'check_violation';
  end if;

  v_n := jsonb_array_length(p_lines);
  if v_n is null or v_n < 1 then
    raise exception 'el pedido no lleva ninguna mentoría' using errcode = 'check_violation';
  end if;
  -- Mismo tope que la cookie del carrito (`CART_MAX_LINEAS`). Se repite aquí
  -- porque el navegador puede mandar lo que quiera: la cookie es entrada del
  -- usuario, no un contrato.
  if v_n > 10 then
    raise exception 'un pedido admite como máximo 10 mentorías' using errcode = 'check_violation';
  end if;

  -- ── Reutilizar antes que crear ────────────────────────────────────────────
  -- Recargar la pantalla de pago no puede abrir un segundo pedido: el primero
  -- ya retiene esos huecos y el segundo chocaría contra ellos. Ver
  -- `find_open_order`.
  v_order := public.find_open_order(p_lines);
  if v_order is not null then
    return v_order;
  end if;

  -- ── Los tramos que se van a pedir, para poder soltar lo propio ────────────
  -- Se recorren las líneas ANTES de crear nada: hace falta saber qué horarios y
  -- de qué tutor para localizar los holds del propio alumno que estorban.
  for v_linea in select * from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;
    v_product := (v_linea->>'product_id')::uuid;
    if v_product is null then
      raise exception 'línea sin mentoría' using errcode = 'check_violation', detail = v_idx::text;
    end if;

    -- ⚠️ SE COMPRUEBA QUE `slots` SEA UN ARRAY ANTES DE ABRIRLO. Con un escalar
    -- —`"slots": "hoy"`— `jsonb_array_elements_text` revienta con «cannot
    -- extract elements from a scalar», un error crudo de Postgres que saldría
    -- de aquí sin traducir. El cuerpo lo compone un Route Handler nuestro, pero
    -- esta función está concedida a `authenticated`: cualquiera puede llamarla
    -- con lo que quiera. Falla cerrado y con un mensaje que dice qué línea es.
    if jsonb_typeof(v_linea->'slots') is distinct from 'array' then
      raise exception 'línea sin horarios' using errcode = 'check_violation',
        detail = v_idx::text, hint = v_product::text;
    end if;

    select array_agg(valor::timestamptz order by valor::timestamptz)
      into v_slots
      from jsonb_array_elements_text(v_linea->'slots') as t(valor);
    if v_slots is null or array_length(v_slots, 1) = 0 then
      raise exception 'línea sin horarios' using errcode = 'check_violation',
        detail = v_idx::text, hint = v_product::text;
    end if;

    -- La duración sale del producto y no del navegador: es la que mide el
    -- solape, igual que en `holdsQueSolapan`. Sin duración declarada, un minuto
    -- basta para que «empiezan a la misma hora» siga contando como choque; con
    -- cero el intervalo sería vacío y no solaparía ni consigo mismo.
    select p.tutor_id, greatest(coalesce(p.session_duration_min, 0), 1)
      into v_tutor, v_dur
      from public.products p where p.id = v_product;

    if v_tutor is not null then
      foreach v_slot in array v_slots loop
        v_tramos := v_tramos || jsonb_build_object(
          'tutor', v_tutor,
          'ini',   v_slot,
          'fin',   v_slot + make_interval(mins => v_dur)
        );
      end loop;
    end if;
  end loop;

  -- ── Soltar los holds PROPIOS que estorban ────────────────────────────────
  --
  -- ⚠️ ES OBLIGATORIO Y NO ES CORTESÍA. `get_available_slots` descuenta toda
  -- sesión no cancelada del tutor **sin mirar de quién es la reserva**, así que
  -- una reserva a medias del propio alumno que solape le contesta «algún
  -- horario ya no está disponible» sobre un hueco que retiene él mismo. Es el
  -- caso normal de volver atrás y recomponer el carrito, y con N líneas basta
  -- que UNA solape para tirar el pedido entero (P-1).
  --
  -- Va AQUÍ DENTRO y no en el navegador —donde vive `holdsQueSolapan` para la
  -- compra suelta— porque tiene que ocurrir DESPUÉS de la reutilización: si el
  -- navegador soltara primero, cancelaría el pedido abierto que veníamos a
  -- reutilizar y crearía uno nuevo en cada recarga.
  --
  -- ⚠️ EL COSTE ACEPTADO, EL MISMO QUE YA DOCUMENTA `lib/checkout/hold.ts`: si
  -- ese hold se estuviera pagando en otra pestaña, esto se lo cancela. Desde
  -- aquí no hay forma de distinguir «hold olvidado» de «hold que se está
  -- pagando»: los dos son una reserva en `pending_payment`. El dinero está
  -- cubierto igualmente — X-02 devuelve entero el cobro que llegue sobre algo
  -- ya cancelado.
  for v_r in
    select distinct b.id
      from public.bookings b
      join public.sessions s on s.booking_id = b.id
      join jsonb_array_elements(v_tramos) tr on true
     where b.student_id = v_student
       and b.status = 'pending_payment'
       and s.status not in ('cancelled', 'no_show')
       and b.tutor_id = (tr->>'tutor')::uuid
       -- Solape de intervalos medio abiertos, igual que el `tstzrange &&` del
       -- resto del proyecto: pegado no es solapado (una sesión que acaba a las
       -- 9:00 no estorba a otra que empieza a las 9:00).
       and s.start_at < (tr->>'fin')::timestamptz
       and (tr->>'ini')::timestamptz < s.end_at
  loop
    perform public.cancel_booking(
      v_r.id,
      'Se soltó el horario para poder pagar varias mentorías en un solo pedido'
    );
  end loop;

  -- ── Las líneas, una a una, en esta misma transacción ─────────────────────
  v_idx := 0;
  for v_linea in select * from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;
    v_product := (v_linea->>'product_id')::uuid;

    select array_agg(valor::timestamptz order by valor::timestamptz)
      into v_slots
      from jsonb_array_elements_text(v_linea->'slots') as t(valor);

    begin
      v_booking := public.create_booking_line(v_student, v_product, v_slots);
    exception
      when others then
        -- El mensaje viaja INTACTO: `esCarreraDeHorario` lo reconoce por
        -- subcadena y traducirlo aquí rompería esa detección. Lo que se añade
        -- es de dónde vino, en campos que PostgREST publica aparte.
        raise exception '%', sqlerrm
          using errcode = sqlstate,
                detail  = v_idx::text,
                hint    = v_product::text;
    end;

    v_ids := array_append(v_ids, v_booking);
  end loop;

  -- ── Un cargo = una moneda y una pasarela ─────────────────────────────────
  --
  -- Los dos snapshots salen de `payments`, que es lo que acaba de congelar cada
  -- línea. Sumar dos monedas sería inventarse un tipo de cambio; repartir un
  -- cargo entre dos pasarelas es imposible. Con el catálogo de hoy no puede
  -- pasar ninguna de las dos, y por eso mismo conviene que salte aquí y no en
  -- un 400 de Stripe.
  select array_agg(distinct p.currency), array_agg(distinct p.provider)
    into v_monedas, v_provs
    from public.payments p
   where p.booking_id = any(v_ids);

  if coalesce(array_length(v_monedas, 1), 0) <> 1 then
    raise exception 'un pedido no puede mezclar monedas' using errcode = 'check_violation';
  end if;
  if coalesce(array_length(v_provs, 1), 0) <> 1 then
    raise exception 'un pedido no puede mezclar pasarelas de pago' using errcode = 'check_violation';
  end if;

  -- ── La cabecera, al final ────────────────────────────────────────────────
  -- Se inserta DESPUÉS de las líneas para poder copiarles moneda y pasarela sin
  -- adivinarlas antes de tiempo. El `update` de vuelta cierra el enlace; todo
  -- dentro de la misma transacción, así que nadie ve nunca un pedido sin
  -- líneas ni una línea sin pedido.
  insert into public.orders (student_id, provider, currency, lines_fingerprint)
  values (v_student, v_provs[1], v_monedas[1], public.order_lines_fingerprint(p_lines))
  returning id into v_order;

  update public.bookings set order_id = v_order where id = any(v_ids);

  return v_order;
end;
$$;

comment on function public.create_order(jsonb) is
  'EY-176: crea N reservas y su cabecera de pedido en UNA transacción (P-1 todo o nada). Reutiliza el pedido abierto del mismo carrito y suelta antes los holds propios que solapan. El importe de cada línea lo congela create_booking_line en payments.gross_amount.';

-- ⚠️ NO se calcula ningún importe fuera de `payments`. `create_order` no suma
-- nada: el total del cargo lo compone quien abre la Session, leyendo
-- `sum(payments.gross_amount)` de las líneas del pedido (regla de oro 2).
revoke execute on function public.create_order(jsonb) from public;
revoke execute on function public.create_order(jsonb) from anon;
grant  execute on function public.create_order(jsonb) to authenticated;
