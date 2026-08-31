-- ============================================================================
-- Enséñame Ya — el bloque grande de *office hours*, partido por un divisor.
--
-- ── LA PETICIÓN ─────────────────────────────────────────────────────────────
--
-- «¿Puede un tutor declarar 8:00–17:00 de una vez?» Sí, y ya funcionaba: el
-- corte por duración existe desde US-601 y una franja 8:00–17:00 con una
-- mentoría de 60 min produce NUEVE huecos, no una clase de nueve horas. Lo que
-- no existía es lo que hace Calendly encima de eso: separar CADA CUÁNTO EMPIEZA
-- un hueco de CUÁNTO DURA la clase.
--
-- Hoy el paso ES la duración: clases de 60 min sólo pueden empezar cada 60 min.
-- Calendly los tiene como dos ajustes independientes («start time increments»,
-- por defecto 30 min, con el aviso explícito de que NO se actualizan solos al
-- cambiar la duración), y con eso una clase de 60 min sobre 9:00–12:00 puede
-- ofrecerse a las 9:00, 9:30, 10:00, 10:30 y 11:00.
--
-- Ese último dato es la regla que gobierna el `generate_series` de abajo: **el
-- último hueco es el último que CABE ENTERO**. 11:30 no se ofrece porque
-- terminaría a las 12:30, fuera de la franja. Igual que hoy: ningún hueco
-- desborda nunca el final del bloque.
--
-- ── LO QUE HAY QUE HABER LEÍDO ANTES ────────────────────────────────────────
--
-- ⚠️ Esta migración va DESPUÉS de `20260831180000` y no es un capricho de
-- orden. Un paso más fino que la duración hace que los huecos de UNA MISMA
-- mentoría se pisen entre sí (9:00–10:00 y 9:30–10:30 con paso 30 y duración
-- 60): eso es exactamente lo que el índice único viejo —`(tutor_id, start_at)`—
-- dejaba pasar, porque comparaba inicios y no intervalos. Sin la constraint de
-- exclusión puesta primero, esta migración convierte un fallo raro en el
-- comportamiento por defecto.
--
-- ── COMPATIBILIDAD: LA COLUMNA NACE NULA Y NULA SIGNIFICA «COMO HOY» ────────
--
-- `start_time_increment_min` es nullable y `null` = «el paso es la duración».
-- El BACKFILL es NO HACER NADA: toda mentoría existente cae en ese caso y su
-- calendario no se mueve un minuto. Mismo criterio y mismo porqué que N-04
-- (`20260817200000:33-40`) — rellenar la foto de hoy congelaría un valor que
-- nadie eligió y que nadie sabría distinguir después de uno deliberado.
--
-- Y no es una promesa de comentario, es aritmética: con paso = duración el tope
-- nuevo se reduce al viejo, término a término. Ver la nota del `generate_series`.
-- ============================================================================


-- ── 1) La columna ───────────────────────────────────────────────────────────
--
-- Sin `not null` y sin default a propósito (ver arriba). El `check` acota lo
-- que tiene sentido en una agenda: por debajo de 5 min la rejilla es ruido y
-- por encima de 4 h ya no es un paso, es otra franja. Se permite a propósito un
-- paso MAYOR que la duración: es la única forma que tiene hoy un tutor de dejar
-- aire entre clases (los buffers propiamente dichos son fase 2 y dependen de
-- decisiones de producto que el cliente no ha respondido).
alter table public.products
  add column if not exists start_time_increment_min integer
    check (start_time_increment_min is null
           or (start_time_increment_min >= 5 and start_time_increment_min <= 240));

comment on column public.products.start_time_increment_min is
  'Cada cuántos minutos puede EMPEZAR una clase de esta mentoría. NULL = cada session_duration_min, que es el comportamiento anterior al 31-ago-2026 y el de toda mentoría que no lo configure. Independiente de la duración (modelo de Calendly): el hueco solo se ofrece si la clase entera cabe dentro de la franja.';

-- Grants por columna. `products` ya lleva `grant insert, update, delete` a nivel
-- de TABLA desde EP-04 (20260709120000:78) y un grant de tabla cubre también las
-- columnas que lleguen después, así que esto es cinturón y tirantes — el mismo
-- criterio, y por el mismo motivo, que `auto_accept_bookings`
-- (`20260817180000:95-103`): la regla de oro 9 muerde en EJECUCIÓN, nunca en el
-- typecheck, y una línea al lado de la columna sobrevive al día que alguien
-- estreche el grant de tabla.
grant insert (start_time_increment_min) on public.products to authenticated;
grant update (start_time_increment_min) on public.products to authenticated;

-- `service_role` no recibe nada, y conviene decir por qué para que no se añada
-- «por si acaso»: la única que lee esta columna es `get_available_slots`, que es
-- SECURITY DEFINER → corre con los privilegios de su dueño y ni RLS ni grants le
-- aplican. El día que un Route Handler o un job la lea con el cliente admin,
-- ESE día toca el grant.


-- ============================================================================
-- 2) get_available_slots v3
--
-- ⚠️ Cuerpo íntegro de `20260817200000:214-333` (que a su vez venía de US-601).
-- Una función de Postgres no se parchea, se reescribe entera, así que se copia y
-- se marcan LOS DOS cambios:
--
--   A. el paso de la rejilla sale de `v_step`, no de `v_duration`;
--   B. el suelo de la ventana de días se mide en la zona del TUTOR, no en UTC.
--
-- Lo demás —el filtro N-04 por bloques, el `at time zone` del tutor, las
-- excepciones `block`/`open`, el anti-doble-reserva de S-41, el `> now()`— es
-- idéntico a propósito.
--
-- ⚠️ LA FIRMA NO SE TOCA (uuid, date, date). Es requisito duro: la llaman TRES
-- superficies —el calendario público P07 como `anon`, el selector de
-- `/reservar/[productId]`, y `create_booking_line` (`20260827150000:398`) para
-- revalidar en servidor— y un `create or replace` con otros parámetros crearía
-- una SEGUNDA función en vez de sustituir ésta, dejando al flujo de pago
-- validando contra la versión vieja sin que nada avise.
-- ============================================================================
--
-- ── CAMBIO B · EL DÍA DEL TUTOR, QUE ES EL BUG QUE MÁS DINERO CUESTA ────────
--
-- La versión anterior arrancaba la serie en `greatest(p_from, current_date)`.
-- `current_date` es una fecha **UTC** (así lo asume el propio proyecto, ver
-- `lib/catalog/queries.ts:1041`), pero ese `day` se combina luego con la hora de
-- pared y se interpreta **en la zona del tutor**. Son dos calendarios distintos
-- comparados como si fueran uno.
--
-- El efecto, con un tutor en Lima (UTC−5) y franja 08:00–22:00:
--   · a las 18:00 de Lima (23:00 UTC) el calendario ofrece 19:00, 20:00 y 21:00;
--   · a las 19:00 de Lima son las 00:00 UTC del día siguiente, `current_date`
--     avanza, el lunes de Lima cae por debajo del `greatest` y **deja de
--     generarse**: los huecos de 20:00 y 21:00 —futuros, libres, dentro de la
--     franja— desaparecen de la ficha, del selector y de la revalidación.
-- Son 5 h cada noche en Lima y 4 h en Caracas, en las horas de más demanda de
-- una plataforma de clases, y en TODO el mercado objetivo (LATAM entera está al
-- oeste de UTC). Falla cerrado —no hay doble reserva, sólo ventas perdidas—, que
-- es justo por lo que nadie lo había visto.
--
-- LA CORRECCIÓN, y por qué es un `case` y no un `greatest`: `p_from` cumple DOS
-- papeles que hay que separar. Los cuatro sitios que llaman a esta función pasan
-- «hoy en UTC» queriendo decir «desde ahora» (`rangoPublicado()` y el
-- `current_date` de `create_booking_line`); pero la firma admite también un
-- `p_from` de verdad futuro. Se distinguen comparándolo con `current_date`:
--   · `p_from <= current_date` → el caller dice «desde ahora» → el suelo es HOY
--     PARA EL TUTOR, que es lo único que casa con los días que se generan;
--   · `p_from >  current_date` → es un límite futuro deliberado → se respeta tal
--     cual, sin tocarlo.
-- Un `greatest(p_from, hoy_del_tutor)` NO habría arreglado nada: con el tutor al
-- oeste, `p_from` (UTC) es precisamente el mayor de los dos y el bug sobrevive.
--
-- `p_to` se deja en UTC a propósito: por arriba, un día de desfase sólo puede
-- ofrecer un día de más sobre un horizonte de 30 que es un número de producto,
-- no un contrato — y sobre todo, `create_booking_line` calcula su tope con la
-- misma expresión, así que lo que se ofrece y lo que se revalida siguen
-- coincidiendo, que es lo que de verdad importa.
create or replace function public.get_available_slots(
  p_product_id uuid,
  p_from date default current_date,
  p_to   date default (current_date + 21)
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tutor_id   uuid;
  v_tz         text;
  v_duration   int;
  -- Cambio A · cada cuánto EMPIEZA un hueco. `null` en la mentoría = la
  -- duración, que es el comportamiento de siempre.
  v_step       int;
  -- Cambio B · el suelo de la ventana, ya resuelto en el calendario correcto.
  v_desde      date;
  -- N-04 · ¿esta mentoría declaró bloques? Se resuelve UNA vez y fuera de la
  -- consulta grande: es la diferencia entre «filtra por mis bloques» y «no
  -- filtres», no un dato que cambie de fila a fila.
  v_has_blocks boolean;
begin
  -- Solo producto 'active' de tutor 'approved' es reservable (RN-24).
  select p.tutor_id, p.session_duration_min, pr.timezone, p.start_time_increment_min
    into v_tutor_id, v_duration, v_tz, v_step
  from public.products p
  join public.tutor_profiles tp
    on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  join public.profiles pr on pr.id = p.tutor_id
  where p.id = p_product_id and p.status = 'active';

  if v_tutor_id is null or v_duration is null or v_tz is null then
    return; -- sin producto reservable → sin slots
  end if;

  -- Sin paso declarado, el paso es la duración: exactamente la rejilla anterior
  -- a esta migración. El `greatest(…, 1)` es una red por si algún día el `check`
  -- de la columna se relaja: un paso de 0 haría que `generate_series` intentara
  -- devolver infinitas filas.
  v_step := greatest(coalesce(v_step, v_duration), 1);

  -- Cambio B. Ver la nota larga de la cabecera.
  v_desde := case
               when p_from <= current_date then (now() at time zone v_tz)::date
               else p_from
             end;

  select exists (
    select 1 from public.product_availability_rules par
    where par.product_id = p_product_id
  ) into v_has_blocks;

  return query
  with days as (
    select gd::date as day, extract(dow from gd::date)::int as weekday
    from generate_series(v_desde::timestamp, p_to::timestamp, interval '1 day') gd
  ),
  -- Slots base desde las reglas recurrentes.
  --
  -- ⚠️ EL TOPE DEL `generate_series` ES LA REGLA DE CALENDLY, y es donde el paso
  -- y la duración dejan de ser lo mismo. Se quieren todos los `n` tales que
  --
  --     start + step·n + duración  ≤  end        (el hueco cabe ENTERO)
  --   ⇔ n ≤ ((end − start) − duración) / step
  --
  -- así que el tope es `floor(((end−start) − dur) / step)`. Con una franja
  -- 9:00–12:00, duración 60 y paso 30 sale `floor((180−60)/30) = 4` → n = 0..4 →
  -- 9:00, 9:30, 10:00, 10:30 y 11:00. El 11:30 no aparece porque acabaría a las
  -- 12:30, fuera de la franja.
  --
  -- ⚠️ Y CON PASO = DURACIÓN ESTO ES EL TOPE VIEJO, no «parecido»: sustituyendo
  -- step por dur queda `floor((L−dur)/dur) = floor(L/dur − 1) = floor(L/dur) − 1`
  -- —restar un entero conmuta con `floor`— que es literalmente la expresión de
  -- `20260817200000:280`. Ahí es donde se apoya el «la columna nace nula y no
  -- cambia nada» de la cabecera.
  --
  -- Franja más corta que la clase → el numerador es negativo → el tope es < 0 →
  -- `generate_series(0, negativo)` no devuelve filas. Que es lo correcto.
  rule_slots as (
    select d.day, (r.start_time + make_interval(mins => v_step * i.n)) as wall_start
    from days d
    join public.availability_rules r
      on r.tutor_id = v_tutor_id and r.is_active and r.weekday = d.weekday
      -- N-04 · con bloques declarados, solo cuentan los suyos. Sin bloques,
      -- `not v_has_blocks` es cierto para TODAS las filas y el `or` deja pasar
      -- la regla entera: el comportamiento anterior a N-04, que es lo que
      -- sostiene el catálogo público y `create_booking`.
      and (
        not v_has_blocks
        or exists (
          select 1 from public.product_availability_rules par
          where par.product_id = p_product_id
            and par.rule_id = r.id
        )
      )
    cross join lateral generate_series(
      0,
      floor(
        (extract(epoch from (r.end_time - r.start_time)) - (v_duration * 60))
        / (v_step * 60)
      )::int
    ) as i(n)
  ),
  -- Slots extra desde excepciones 'open' con rango horario (siguen siendo del
  -- tutor, no del bloque — ver la nota de 20260817200000 §4). Mismo paso y mismo
  -- tope que arriba: una excepción es una franja como cualquier otra.
  open_slots as (
    select x.date as day, (x.start_time + make_interval(mins => v_step * i.n)) as wall_start
    from public.availability_exceptions x
    cross join lateral generate_series(
      0,
      floor(
        (extract(epoch from (x.end_time - x.start_time)) - (v_duration * 60))
        / (v_step * 60)
      )::int
    ) as i(n)
    where x.tutor_id = v_tutor_id
      and x.type = 'open'
      and x.start_time is not null and x.end_time is not null
      and x.date between v_desde and p_to
  ),
  resolved as (
    select
      s.day,
      s.wall_start,
      -- RN-01/RN-02: hora de pared del TUTOR → instante UTC, con DST correcto.
      -- La zona sigue siendo la suya, nunca la del visitante.
      (s.day + s.wall_start) at time zone v_tz as s_start,
      (s.day + s.wall_start + make_interval(mins => v_duration)) at time zone v_tz as s_end
    from (select day, wall_start from rule_slots
          union
          select day, wall_start from open_slots) s
  )
  select r.s_start, r.s_end
  from resolved r
  where r.s_start > now()  -- solo futuro
    -- excepción 'block' ese día: día completo (sin horas) o rango que solapa.
    and not exists (
      select 1 from public.availability_exceptions b
      where b.tutor_id = v_tutor_id and b.type = 'block' and b.date = r.day
        and (
          b.start_time is null
          or (r.wall_start < b.end_time
              and (r.wall_start + make_interval(mins => v_duration)) > b.start_time)
        )
    )
    -- S-41: no solapa una sesión ya agendada del tutor. OJO, esto es de TUTOR y
    -- no de bloque, y así se queda: el tutor es una persona y no puede dar dos
    -- clases a la vez aunque sean de mentorías distintas.
    --
    -- ⚠️ Desde `20260831180000` esto ya NO es la única defensa: la constraint de
    -- exclusión `sessions_sin_solape_por_tutor` lo comprueba en el INSERT. Aquí
    -- se queda porque su trabajo es otro — no ofrecer un hueco que va a fallar—,
    -- y porque con paso fino los huecos ofrecidos se pisan entre sí y hay que
    -- descontar la clase entera, no solo su inicio.
    and not exists (
      select 1 from public.sessions se
      where se.tutor_id = v_tutor_id
        and se.status not in ('cancelled', 'no_show')
        and tstzrange(se.start_at, se.end_at) && tstzrange(r.s_start, r.s_end)
    )
  order by r.s_start;
end;
$$;

comment on function public.get_available_slots(uuid, date, date) is
  'US-601 + N-04 + paso de agenda: huecos libres de un producto. La rejilla avanza cada products.start_time_increment_min (o cada session_duration_min si es NULL) y solo ofrece el hueco si la clase cabe entera en la franja. Resuelve availability_rules − exceptions(block) + exceptions(open) − sesiones ocupadas, en la zona horaria del tutor, y arranca en el día de HOY PARA EL TUTOR (no en la fecha UTC). Si el producto tiene filas en product_availability_rules, solo cuentan ESAS reglas.';

-- `create or replace` conserva los privilegios existentes, pero se rehacen por
-- si esta migración se aplica sobre una base donde la función no existía: en
-- Postgres el `execute` nace concedido a PUBLIC, así que revocar ANTES de
-- conceder no es ceremonia (mismo gotcha de 20260715150000, 20260806120000 y
-- 20260817200000). Se restituye exactamente el juego de hoy: `anon` (el
-- calendario de la ficha pública P07), `authenticated` (el flujo de reserva) y
-- `service_role`.
revoke execute on function public.get_available_slots(uuid, date, date) from public;

grant  execute on function public.get_available_slots(uuid, date, date) to anon;
grant  execute on function public.get_available_slots(uuid, date, date) to authenticated;
grant  execute on function public.get_available_slots(uuid, date, date) to service_role;
