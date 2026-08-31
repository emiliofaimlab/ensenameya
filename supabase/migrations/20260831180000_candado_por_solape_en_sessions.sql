-- ============================================================================
-- Enséñame Ya — S-41 de verdad: el candado anti-doble-reserva pasa de comparar
-- INICIOS a comparar INTERVALOS.
--
-- ── QUÉ ESTABA MAL ──────────────────────────────────────────────────────────
--
-- Desde `20260709160000_ep06_checkout.sql:46-48` el candado es
--
--   unique index sessions_no_double_booking_idx on sessions (tutor_id, start_at)
--     where status not in ('cancelled','no_show')
--
-- y un índice único compara VALORES, no tramos. Para el mismo tutor,
-- 9:00–10:00 y 9:30–11:00 son dos claves distintas: el índice las deja pasar y
-- las dos hacen COMMIT. Lo único que hoy separa esas dos reservas es el
-- `tstzrange &&` de `get_available_slots` (`20260817200000:325-330`), que es una
-- LECTURA PREVIA, no un candado: en READ COMMITTED —que es lo que da PostgREST—
-- dos transacciones simultáneas no se ven la una a la otra, las dos leen «libre»
-- y las dos escriben.
--
-- Se puede llegar ahí por dos caminos, y los dos están hoy en el producto:
--
--   1. CARRERA ENTRE DOS ALUMNOS. Tutor con dos mentorías de duración distinta
--      (60 y 90 min) sobre la misma franja: las rejillas quedan desalineadas
--      (9:00 / 9:30) y basta con que las dos reservas se crucen. La ventana va
--      desde la revalidación de `create_booking_line` hasta el COMMIT, y nada
--      la acorta: el INSERT solo bloquea sobre su clave exacta.
--
--   2. UN PAQUETE CONTRA SÍ MISMO, sin concurrencia ninguna.
--      `create_booking_line` valida los N horarios en UNA sentencia
--      (`20260827150000:395-403`) y los inserta DESPUÉS en bucle (`:441-446`):
--      entre medias no se vuelve a mirar nada y las N filas no se comparan entre
--      sí. Con dos `availability_rules` solapadas el mismo lunes —que la UI
--      permite crear, `availability-manager.tsx:97` solo valida `end > start`—
--      el calendario ofrece 9:00 y 9:30 y el alumno puede marcar las dos.
--
-- ── POR QUÉ AHORA, Y NO «CUANDO DÉ PROBLEMAS» ───────────────────────────────
--
-- Porque el paso de agenda configurable (la migración siguiente) convierte el
-- caso raro en el caso NORMAL. Hoy el paso es igual a la duración, así que
-- dentro de una misma mentoría los huecos nunca se pisan y hacen falta dos
-- mentorías desalineadas para reproducirlo. Con incrementos de 30 min sobre
-- clases de 60, 9:00–10:00 y 9:30–10:30 son dos huecos ofrecidos del MISMO
-- producto. El divisor no se puede enviar encima de este índice.
--
-- ── LA PRIMITIVA ────────────────────────────────────────────────────────────
--
-- `EXCLUDE USING gist` es exactamente esto: «no puede haber dos filas donde
-- tutor_id sea igual Y los intervalos se solapen». Lo comprueba el motor en el
-- INSERT, dentro de la transacción, así que cierra la carrera de raíz — deja de
-- importar quién leyó qué y cuándo. `get_available_slots` sigue filtrando, pero
-- pasa a ser cortesía (no ofrecer lo que va a fallar) en vez de ser la única
-- defensa.
--
-- El `tutor_id with =` es lo que exige `btree_gist`, habilitada aparte en
-- `20260831170000_habilita_btree_gist.sql`. Aquí NO se vuelve a crear.
--
-- ⚠️ EL RANGO ES MEDIO ABIERTO `[)` —el default de `tstzrange`— y eso es la
-- diferencia entre pegado y solapado: una clase que acaba a las 10:00 y otra
-- que empieza a las 10:00 NO chocan. Es la misma semántica que ya usan
-- `get_available_slots:329`, `holdsQueSolapan` (`lib/checkout/hold.ts:181-184`)
-- y el bucle de `create_order` (`20260827150000:656-660`); con `[]` este candado
-- prohibiría las clases consecutivas, que es el caso más normal que hay.
--
-- ⚠️ `start_at = end_at` daría un rango VACÍO, y un rango vacío no solapa con
-- nada — se colaría por debajo del candado. No puede ocurrir: la tabla lleva
-- `check (end_at >= start_at + interval '30 minutes')` desde
-- `20260709140000:72`. Se anota porque el día que alguien relaje ese check,
-- relaja también esto sin enterarse.
--
-- ── EL PREDICADO, Y POR QUÉ NO SE REACTIVA NADIE ────────────────────────────
--
-- `where status not in ('cancelled','no_show')` es el mismo de siempre: una
-- sesión muerta suelta el horario. Importa que ninguna transición DEVUELVA una
-- fila al índice, porque eso sí podría chocar contra algo agendado después.
-- Comprobado sobre las migraciones: los `update public.sessions … set status`
-- del proyecto entero solo escriben 'cancelled' (17) e 'in_progress' (4).
-- Ninguno resucita una cancelada.
--
-- ── SE SUSTITUYE, NO SE SUMA ────────────────────────────────────────────────
--
-- El índice único se ELIMINA. La exclusión lo cubre entero —dos filas con el
-- mismo `start_at` y el mismo tutor tienen rangos que se solapan por
-- definición— así que dejarlo sería un segundo índice sobre una tabla caliente
-- para no cubrir nada nuevo, y además mantendría vivo un segundo código de
-- error (23505) para el mismo choque. Con la exclusión sola, toda colisión de
-- agenda sale por 23P01 y hay UN camino que mantener.
--
-- ⚠️ Y ESE CAMBIO DE CÓDIGO ES LO QUE OBLIGA AL SEGUNDO BLOQUE de esta
-- migración. `create_booking_line` captura hoy `unique_violation` y traduce el
-- choque a «ese horario acaba de ser tomado» (`20260827150000:449-452`). Un
-- 23P01 no entra por ahí: saldría crudo, con el nombre de la constraint dentro,
-- a la cara de quien está pagando.
-- ============================================================================


-- ── 1) El candado ───────────────────────────────────────────────────────────
--
-- El `drop` va PRIMERO. Si fuera al revés, durante unos milisegundos habría dos
-- estructuras vigilando lo mismo y un choque de inicios idénticos saldría por
-- el índice (23505) en vez de por la exclusión (23P01), que es justo la
-- ambigüedad que esta migración quita.
--
-- `if exists` porque esta migración tiene que poder correr sobre una base donde
-- el índice ya no esté (una reejecución, o un entorno recreado desde cero).
drop index if exists public.sessions_no_double_booking_idx;

-- ⚠️ `if not exists` NO existe para `add constraint`, así que la idempotencia
-- se hace a mano. Sin esto, aplicar dos veces revienta con 42710 y deja la
-- migración a medias.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_sin_solape_por_tutor'
      and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_sin_solape_por_tutor
      exclude using gist (
        tutor_id with =,
        tstzrange(start_at, end_at) with &&
      )
      where (status not in ('cancelled', 'no_show'));
  end if;
end
$$;

comment on constraint sessions_sin_solape_por_tutor on public.sessions is
  'S-41 · un tutor no puede tener dos sesiones vivas que se pisen. Sustituye al índice único sessions_no_double_booking_idx (20260709160000), que solo comparaba start_at y dejaba pasar 9:00-10:00 contra 9:30-11:00. Rango medio abierto: pegado no es solapado. Violación = 23P01 (exclusion_violation), no 23505.';


-- ============================================================================
-- 2) create_booking_line — que el 23P01 salga traducido
--
-- ⚠️ CUERPO ÍNTEGRO de `20260827150000:330-453`. Una función de Postgres no se
-- parchea, se reescribe entera, así que se copia y se marca EL cambio: cuatro
-- líneas en el bloque `exception` del final. Todo lo demás —el tier (RN-06), el
-- total (RN-10), el ruteo (RN-33), el snapshot congelado en `payments`, el hold
-- de `sessions` y los mensajes -- es idéntico a propósito.
--
-- ⚠️ EL MENSAJE NO CAMBIA NI UNA LETRA, y es requisito duro, no estética:
-- `esCarreraDeHorario` (`lib/checkout/hold.ts:249-256`) reconoce la carrera por
-- SUBCADENA del mensaje, y `create_order` lo propaga tal cual para que esa
-- detección siga funcionando desde el carrito (`20260827150000:682-688`).
-- Cambiar el texto rompería las dos pantallas en silencio.
--
-- ⚠️ SE CONSERVA `unique_violation` ADEMÁS de añadir `exclusion_violation`, y no
-- es residuo. Esta función también inserta en `payments`, que tiene
-- `booking_id` UNIQUE (`20260709140000:97`): ese 23505 sigue siendo posible y
-- sin la rama saldría crudo. Que las dos digan lo mismo es correcto — desde
-- fuera son el mismo suceso, «esto ya estaba cogido».
--
-- La firma no se toca: la llaman `create_booking` y `create_order`.
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
  --
  -- ⚠️ LO QUE NO VE, y por eso existe la constraint de exclusión: los slots de
  -- ESTA MISMA llamada. Se validan todos en esta sentencia y se insertan
  -- después, así que un paquete con dos horarios que se pisan entre sí pasa por
  -- aquí sin enterarse. El motor lo corta abajo, en el INSERT.
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

  -- Sessions = hold del slot (S-41). La constraint de exclusión cierra la
  -- carrera Y el solape dentro del propio paquete.
  foreach v_slot in array p_slots loop
    v_seq := v_seq + 1;
    insert into public.sessions (booking_id, tutor_id, student_id, sequence_no, start_at, end_at, status)
    values (v_booking, v_prod.tutor_id, p_student, v_seq, v_slot,
            v_slot + make_interval(mins => v_prod.session_duration_min), 'scheduled');
  end loop;

  return v_booking;
exception
  -- Los dos disfraces del mismo suceso. `exclusion_violation` (23P01) es el
  -- choque de agenda desde que existe `sessions_sin_solape_por_tutor`;
  -- `unique_violation` (23505) sigue vivo por el `booking_id` único de
  -- `payments`. Mismo mensaje en los dos: desde fuera son lo mismo, y el texto
  -- es el que reconoce `esCarreraDeHorario`.
  when exclusion_violation or unique_violation then
    raise exception 'ese horario acaba de ser tomado' using errcode = 'check_violation';
end;
$$;

comment on function public.create_booking_line(uuid, uuid, timestamptz[]) is
  'EY-176 · una línea de pedido: revalida huecos, congela el snapshot financiero y agenda las sesiones. Traduce 23P01/23505 al mensaje de carrera que reconoce esCarreraDeHorario.';

-- Interna: la llaman `create_booking` y `create_order`, las dos SECURITY
-- DEFINER del mismo dueño. `create or replace` conserva privilegios, pero se
-- repiten por si esta migración corre sobre una base donde la función no
-- existiera: en Postgres el `execute` nace concedido a PUBLIC, y sin estos
-- `revoke` cualquiera podría crear una reserva a nombre de OTRO alumno pasando
-- el uuid que quiera.
revoke execute on function public.create_booking_line(uuid, uuid, timestamptz[]) from public;
revoke execute on function public.create_booking_line(uuid, uuid, timestamptz[]) from anon;
revoke execute on function public.create_booking_line(uuid, uuid, timestamptz[]) from authenticated;
