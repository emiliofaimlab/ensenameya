-- ============================================================================
-- Enséñame Ya — publicar una clase grupal (Fase C §10.2)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §10.2, tres piezas:
--   1. `get_available_slots` resta las fechas grupales publicadas (RG-05) y
--      no ofrece horarios para un producto grupal.
--   2. `products_guarda_grupal`: el interruptor RG-18 a nivel de DATOS.
--   3. `publicar_clase_grupal(p_product, p_fechas)`: la única vía de crear
--      las fechas de una clase.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `get_available_slots` REEMPLAZA a la versión VIVA de dev (sacada con
--   `pg_get_functiondef` el 8-oct; su última migración es `20260831190000:137`).
--   Dos cambios marcados «G ·». Firma intacta: la lee el catálogo con `anon`.
--
-- · EL HUECO QUE CIERRA EL TRIGGER. `products` tiene grant de escritura de
--   tabla completo para `authenticated` (`20260709120000:78`) y
--   `products_update_own` deja al tutor escribir su fila. Sin el trigger, un
--   tutor sin el interruptor crea un producto 'group' desde el navegador y lo
--   activa sin fechas: sale en el catálogo como clase grupal vacía. El
--   interruptor (`group_classes_enabled`, `20261008120100`) solo protegía su
--   propia columna; esto protege lo que el interruptor promete.
--
-- · Publicar es UNA vez. Mover o quitar fechas va por
--   `reagendar_clase_grupal` / `cancelar_fecha_grupal`, que tienen inscritos
--   y reembolsos que atender. Aquí no hay inscritos: por eso esta función
--   puede ser simple.
-- ============================================================================


-- ── 1 · get_available_slots ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_available_slots(p_product_id uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT (CURRENT_DATE + 21))
 RETURNS TABLE(slot_start timestamp with time zone, slot_end timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  where p.id = p_product_id and p.status = 'active'
    -- G · una clase grupal no tiene horarios que elegir: sus fechas son las
    -- de `group_classes`. Sin esto, la agenda 1:1 del tutor se ofrecería como
    -- si fuera de la clase.
    and p.pricing_model <> 'group';

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
    -- G · RG-05: una fecha grupal publicada quita la hora aunque no tenga un
    -- solo inscrito (sin inscritos no hay `sessions` que la tapen arriba). La
    -- defensa de verdad es `candado_agenda_entre_tablas()`; esto es no ofrecer
    -- lo que va a fallar.
    and not exists (
      select 1 from public.group_classes g
      where g.tutor_id = v_tutor_id
        and g.status = 'scheduled'
        and tstzrange(g.start_at, g.end_at) && tstzrange(r.s_start, r.s_end)
    )
  order by r.s_start;
end;
$function$;


-- ── 2 · products_guarda_grupal (RG-18 en los datos) ─────────────────────────
create or replace function public.products_guarda_grupal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Hacerse grupal exige el interruptor del admin.
  if new.pricing_model = 'group'
     and (tg_op = 'INSERT' or old.pricing_model is distinct from 'group')
     and not exists (
       select 1 from public.tutor_profiles tp
        where tp.profile_id = new.tutor_id and tp.group_classes_enabled
     )
  then
    raise exception 'las clases grupales no están habilitadas para este tutor'
      using errcode = 'check_violation';
  end if;

  -- Una clase con fechas no cambia de tipo: sus fechas y sus inscritos
  -- quedarían colgando de una mentoría 1:1.
  if tg_op = 'UPDATE'
     and old.pricing_model is distinct from new.pricing_model
     and exists (select 1 from public.group_classes g where g.product_id = old.id)
  then
    raise exception 'una clase grupal publicada no cambia de tipo'
      using errcode = 'check_violation';
  end if;

  -- Activarse sin fechas es publicar una clase vacía. Solo en la TRANSICIÓN a
  -- 'active': una clase cuyas fechas ya pasaron sigue pudiendo editarse.
  if new.pricing_model = 'group' and new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and not exists (
       select 1 from public.group_classes g
        where g.product_id = new.id and g.status = 'scheduled'
     )
  then
    raise exception 'una clase grupal se publica con sus fechas'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.products_guarda_grupal() is
  'RG-18 · el tutor no se hace grupal sin el interruptor del admin, una clase con fechas no cambia de tipo y una grupal no se activa sin fechas. Existe porque products tiene grant de escritura completo para authenticated (20260709120000:78).';

drop trigger if exists products_guarda_grupal on public.products;
create trigger products_guarda_grupal
  before insert or update of pricing_model, status on public.products
  for each row execute function public.products_guarda_grupal();


-- ── 3 · publicar_clase_grupal ───────────────────────────────────────────────
create or replace function public.publicar_clase_grupal(
  p_product uuid,
  p_fechas  timestamptz[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prod     record;
  v_fechas   timestamptz[];
  v_choques  text;
  v_i        int := 0;
  v_f        timestamptz;
begin
  select p.id, p.tutor_id, p.pricing_model, p.session_duration_min, p.status
    into v_prod
    from public.products p
   where p.id = p_product
   for update;

  if v_prod.id is null or v_prod.tutor_id is distinct from (select auth.uid()) then
    raise exception 'no puedes publicar esta clase' using errcode = '42501';
  end if;
  if v_prod.pricing_model <> 'group' then
    raise exception 'esta mentoría no es una clase grupal' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.tutor_profiles tp
     where tp.profile_id = v_prod.tutor_id and tp.group_classes_enabled
  ) then
    raise exception 'las clases grupales no están habilitadas para este tutor'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.group_classes g where g.product_id = p_product) then
    raise exception 'esta clase ya está publicada' using errcode = 'check_violation';
  end if;
  if v_prod.session_duration_min is null then
    raise exception 'la clase necesita una duración' using errcode = 'check_violation';
  end if;

  select array_agg(distinct f order by f) into v_fechas from unnest(p_fechas) f;
  -- ponytail: tope de 20 fechas por ciclo, sin dato del cliente detrás; súbelo si lo pide.
  if v_fechas is null or array_length(v_fechas, 1) > 20 then
    raise exception 'una clase lleva entre 1 y 20 fechas' using errcode = 'check_violation';
  end if;
  if v_fechas[1] <= now() then
    raise exception 'las fechas tienen que ser futuras' using errcode = 'check_violation';
  end if;

  -- Las fechas en conflicto, TODAS y por su nombre (G1: el tutor tiene que
  -- saber cuáles mover). Es la comprobación amable; la de verdad es el
  -- candado, que salta abajo si alguien reserva entre medias.
  select string_agg(to_char(f at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), ', ' order by f)
    into v_choques
    from unnest(v_fechas) f
   where exists (
           select 1 from public.sessions s
            where s.tutor_id = v_prod.tutor_id
              and s.status not in ('cancelled', 'no_show')
              and tstzrange(s.start_at, s.end_at)
                  && tstzrange(f, f + make_interval(mins => v_prod.session_duration_min)))
      or exists (
           select 1 from public.group_classes g
            where g.tutor_id = v_prod.tutor_id and g.status = 'scheduled'
              and tstzrange(g.start_at, g.end_at)
                  && tstzrange(f, f + make_interval(mins => v_prod.session_duration_min)))
      -- Dos fechas del propio ciclo que se pisan entre sí.
      or exists (
           select 1 from unnest(v_fechas) o
            where o <> f
              and tstzrange(o, o + make_interval(mins => v_prod.session_duration_min))
                  && tstzrange(f, f + make_interval(mins => v_prod.session_duration_min)));
  if v_choques is not null then
    raise exception 'estas fechas chocan con tu agenda: %', v_choques
      using errcode = 'exclusion_violation', detail = v_choques;
  end if;

  foreach v_f in array v_fechas loop
    v_i := v_i + 1;
    insert into public.group_classes (product_id, tutor_id, sequence_no, start_at, end_at)
    values (p_product, v_prod.tutor_id, v_i, v_f,
            v_f + make_interval(mins => v_prod.session_duration_min));
  end loop;

  -- RG-16: en grupales, package_num_sessions = número de fechas.
  update public.products
     set package_num_sessions = v_i, status = 'active'
   where id = p_product;
end;
$$;

comment on function public.publicar_clase_grupal(uuid, timestamptz[]) is
  'RG-01/RG-05 · crea las fechas de una clase grupal (una o un ciclo) y la activa. Solo el tutor dueño, con el interruptor, una sola vez. Un choque devuelve TODAS las fechas en conflicto en el mensaje y en DETAIL (ISO UTC, separadas por coma) y no crea nada.';

revoke execute on function public.publicar_clase_grupal(uuid, timestamptz[]) from public, anon;
grant  execute on function public.publicar_clase_grupal(uuid, timestamptz[]) to authenticated;
