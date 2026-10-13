-- EY-228 · Un tutor que reserva una clase como ALUMNO deja de ofrecer ese hueco
-- como tutor. Antes `get_available_slots` solo descontaba las sesiones donde él
-- era el tutor, así que su agenda seguía abierta a la hora en que él estaba
-- recibiendo clase (pedido de Verónica: «que se bloquee esa hora»).
--
-- ⚠️ CUERPO ÍNTEGRO de `20260831190000`. El único cambio es la condición de
-- sesiones ocupadas: `se.tutor_id = v_tutor_id` → `… or se.student_id = v_tutor_id`.
-- Misma firma → `create or replace` es seguro (regla de oro 12 no aplica).

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
      -- EY-228 · …ni una que el tutor esté TOMANDO como alumno: es la misma
      -- persona y tampoco puede dar clase mientras recibe otra.
      -- ponytail: solo oculta el hueco; la constraint de exclusión sigue siendo
      -- por tutor_id, así que una carrera exacta (reservar a la vez como alumno
      -- y como tutor) podría colarse. Si pasa, un trigger en `sessions`.
      where (se.tutor_id = v_tutor_id or se.student_id = v_tutor_id)
        and se.status not in ('cancelled', 'no_show')
        and tstzrange(se.start_at, se.end_at) && tstzrange(r.s_start, r.s_end)
    )
  order by r.s_start;
end;
$$;

comment on function public.get_available_slots(uuid, date, date) is
  'US-601 + N-04 + paso de agenda: huecos libres de un producto. La rejilla avanza cada products.start_time_increment_min (o cada session_duration_min si es NULL) y solo ofrece el hueco si la clase cabe entera en la franja. Resuelve availability_rules − exceptions(block) + exceptions(open) − sesiones ocupadas (las que da Y las que toma como alumno, EY-228), en la zona horaria del tutor, y arranca en el día de HOY PARA EL TUTOR (no en la fecha UTC). Si el producto tiene filas en product_availability_rules, solo cuentan ESAS reglas.';

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
