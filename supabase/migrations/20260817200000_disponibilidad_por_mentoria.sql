-- ============================================================================
-- Enséñame Ya — N-04: la disponibilidad se elige POR MENTORÍA.
--
-- Hoy la disponibilidad es un ajuste GLOBAL del tutor: `availability_rules` se
-- resuelve por `tutor_id`, así que si dice «los lunes de 9 a 12 estoy libre»,
-- esa franja vale a la vez para TODAS sus mentorías. Un tutor que da guitarra
-- los lunes y cálculo los jueves no lo puede expresar: hoy le pueden reservar
-- cálculo el lunes.
--
-- El cliente lo pidió al revés — primero se define la disponibilidad, y al
-- crear cada mentoría se elige a QUÉ BLOQUES pertenece. Eso es exactamente una
-- relación N–M entre `products` y `availability_rules`, que es lo que abre esta
-- migración; el mismo patrón (y las mismas políticas) que `product_categories`.
--
-- ⚠️⚠️ LA COMPATIBILIDAD HACIA ATRÁS NO ES OPCIONAL, Y ES EL PUNTO ENTERO.
--
-- `get_available_slots` no es «la función del panel del tutor»: la llaman TRES
-- superficies, y dos de ellas son la puerta del dinero.
--   · el calendario de la ficha pública del tutor (P07, `anon` — 20260723150000);
--   · el selector de horario del flujo de reserva (`/reservar/[productId]`);
--   · `create_booking` (20260715170000:169), que revalida en servidor que cada
--     slot pedido siga libre antes de crear reserva y pago.
--
-- Si esta migración cambiara la semántica «un producto ve la disponibilidad de
-- su tutor» sin más, el día que se aplique TODAS las mentorías existentes se
-- quedarían con cero horarios: catálogo sin calendario, reserva imposible y
-- `create_booking` rechazando todo con «algún horario ya no está disponible».
-- De ahí la regla que gobierna el resto del archivo:
--
--        UNA MENTORÍA SIN BLOQUES ASIGNADOS VE TODA LA DISPONIBILIDAD
--        DE SU TUTOR, EXACTAMENTE COMO HOY.
--
-- Y por eso el BACKFILL es NO HACER NADA (ver §1): la tabla nace vacía, toda
-- mentoría existente cae en «sin bloques» y su comportamiento no se mueve un
-- milímetro. Se consideró asignar explícitamente todas las reglas del tutor a
-- todas sus mentorías —dejaría el estado más «legible» en la BD— y se descarta
-- por dos motivos: (1) congelaría la foto de hoy, de modo que una franja NUEVA
-- creada mañana no aparecería en las mentorías viejas, que es justo lo
-- contrario de lo que hacen hoy; (2) N filas × M reglas de datos inventados que
-- nadie pidió, imposibles de distinguir después de los que el tutor sí eligió.
--
-- LO QUE **NO** TOCA ESTA MIGRACIÓN, a propósito:
--   · La zona horaria. La disponibilidad se sigue interpretando en la del TUTOR
--     (`profiles.timezone`, RN-01/RN-02), no en la del visitante. El `at time
--     zone v_tz` de abajo es el de siempre, sin un carácter de diferencia.
--   · Las reservas YA creadas. No cuelgan de ningún bloque ni lo necesitan: una
--     vez creada, la reserva vive de `sessions.start_at/end_at` (instantes UTC).
--     Cambiar los bloques de una mentoría no invalida nada agendado — como
--     mucho deja de ofrecer ESE hueco en el futuro.
--   · Las excepciones puntuales (`availability_exceptions`). Ver §4.
-- ============================================================================

-- ── 1) La tabla puente ──────────────────────────────────────────────────────
--
-- PK compuesta (product_id, rule_id): la relación es un hecho, no una entidad —
-- no hay nada que decir de «esta franja en esta mentoría» aparte de que existe.
-- Sin `id` propio, la reconciliación del formulario (borrar todas e insertar
-- las elegidas) es trivial y un doble envío no puede duplicar nada.
--
-- `on delete cascade` en los dos lados, y conviene tener claro qué significa
-- cada uno porque NO son simétricos:
--   · products    → se borra la mentoría, sus enlaces sobran. Obvio.
--   · availability_rules → el tutor borra una franja (el aspa del panel de
--     disponibilidad). El enlace desaparece con ella, y AHÍ HAY UN EFECTO QUE
--     HAY QUE MIRAR DE FRENTE: si esa era la ÚNICA franja de una mentoría, la
--     mentoría se queda «sin bloques» y por la regla de arriba vuelve a ver
--     TODA la disponibilidad del tutor. O sea: borrar una franja puede ABRIR
--     una mentoría en lugar de cerrarla.
--     Se acepta, y se acepta sabiendo por qué: la alternativa (que quede con
--     cero horarios) deja al tutor con una mentoría publicada e irreservable
--     sin que nada se lo diga, y el fallo cae del lado de «se ofrecen huecos de
--     más», donde todavía hay un humano aceptando la reserva. La mitigación va
--     donde se ve: el panel de disponibilidad avisa de qué mentorías usan cada
--     franja antes de dejar borrarla.
create table if not exists public.product_availability_rules (
  product_id uuid        not null references public.products (id)           on delete cascade,
  rule_id    uuid        not null references public.availability_rules (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, rule_id)
);

-- Índice del lado contrario (la PK ya cubre product_id): «¿qué mentorías usan
-- esta franja?», que es la consulta del panel de disponibilidad y la que hace
-- el `cascade` al borrar una regla. Espeja `product_categories_category_id_idx`.
create index if not exists product_availability_rules_rule_id_idx
  on public.product_availability_rules (rule_id);

comment on table public.product_availability_rules is
  'N-04: a qué bloques de disponibilidad (availability_rules) pertenece cada mentoría. SIN FILAS PARA UN PRODUCTO = ese producto se ofrece en TODA la disponibilidad de su tutor (compatibilidad hacia atrás: es el estado de todo lo anterior al 17-ago-2026 y de todo lo que se cree sin elegir bloques).';

-- ── 2) Coherencia: la franja y la mentoría, del mismo tutor ─────────────────
--
-- Una FK no puede decir «y además que las dos apunten al mismo dueño», así que
-- lo dice un trigger. La RLS de §3 ya lo impide desde el navegador, pero esto
-- es otra cosa: vale también para `service_role`, para un seed y para el psql
-- de un domingo. Sin él, `(mentoría de Ana, franja de Luis)` es una fila
-- perfectamente válida — inerte, porque `get_available_slots` filtra las reglas
-- por `tutor_id` de todas formas, pero basura que alguien acabará leyendo como
-- si significara algo.
--
-- SECURITY DEFINER a propósito, igual que `enforce_product_publish_guard`
-- (20260709120000): el guard no debe depender de lo que el que escribe alcance
-- a LEER. Con la RLS del invocador de por medio, una fila que no ve se
-- comportaría como una fila que no existe y el guard saltaría por el motivo
-- equivocado (o dejaría pasar lo que no debe cuando lo escribe un rol con más
-- alcance).
create or replace function public.enforce_product_rule_same_tutor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.products p
    join public.availability_rules r on r.tutor_id = p.tutor_id
    where p.id = new.product_id
      and r.id = new.rule_id
  ) then
    raise exception 'N-04: la franja de disponibilidad y la mentoría deben ser del mismo tutor'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- NO se revoca el `execute` de esta función, y no es un olvido: es una función
-- de trigger, llamarla a pelo devuelve «can only be called as a trigger» y no
-- toca nada. El privilegio de ejecutar el trigger se comprueba al CREAR el
-- trigger, no en cada disparo, así que revocarlo aquí no protegería de nada y
-- sí abriría la puerta a una sorpresa en RUNTIME. Mismo criterio que el resto
-- de triggers del proyecto (`set_updated_at`, `products_publish_guard`).
drop trigger if exists product_availability_rules_same_tutor
  on public.product_availability_rules;
create trigger product_availability_rules_same_tutor
  before insert or update on public.product_availability_rules
  for each row execute function public.enforce_product_rule_same_tutor();

-- ── 3) RLS default-deny (regla de oro 1) + grants (auto-expose OFF, regla 9) ─
alter table public.product_availability_rules enable row level security;

-- El tutor gestiona los bloques de SUS mentorías. `for all` cubre también el
-- SELECT —así el formulario de edición puede releer lo que guardó, incluso en
-- un borrador que todavía no es público—, exactamente como
-- `product_categories_write_own` (20260709120000:60).
drop policy if exists "product_availability_rules_write_own"
  on public.product_availability_rules;
create policy "product_availability_rules_write_own"
  on public.product_availability_rules for all to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_availability_rules.product_id
        and p.tutor_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_availability_rules.product_id
        and p.tutor_id = (select auth.uid())
    )
  );

drop policy if exists "product_availability_rules_select_admin"
  on public.product_availability_rules;
create policy "product_availability_rules_select_admin"
  on public.product_availability_rules for select
  using ( public.has_role('admin') );

-- SIN política pública, y es deliberado: a diferencia de `product_categories`,
-- aquí no hay nada que el catálogo necesite leer directamente. Lo que el
-- visitante ve son HUECOS, y esos los sirve `get_available_slots`, que es
-- SECURITY DEFINER — corre con los privilegios de su dueño, así que ni esta RLS
-- ni estos grants le aplican. Publicar además la tabla solo añadiría superficie
-- (qué franja concreta alimenta qué oferta) sin pintar un píxel de más.
grant select, insert, update, delete on public.product_availability_rules to authenticated;

-- Regla de oro 9: `service_role` se salta la RLS pero NO los grants de tabla, y
-- eso muerde en RUNTIME —ni en el build ni en el typecheck—. Hoy no hay ningún
-- job ni Route Handler que lea esta tabla con el cliente admin (el único lector
-- es la función definer de §4), pero el alta de mentoría es candidata natural a
-- moverse a un Route Handler, y ese día el fallo sería un `permission denied`
-- en producción. La línea cuesta nada.
grant select, insert, update, delete on public.product_availability_rules to service_role;

-- `anon` no recibe nada: default-deny se queda como está.

-- ============================================================================
-- 4) get_available_slots v2 — los slots salen de los bloques de ESE producto
-- ============================================================================
--
-- ⚠️ Cuerpo íntegro de 20260709150000 (US-601). Una función de Postgres no se
-- parchea, se reescribe entera, así que se copia y se marca EL cambio: dos
-- líneas en el `join` de `rule_slots` y la variable que las alimenta. Lo demás
-- —el `at time zone` del tutor, el corte por duración, los `block`, el
-- anti-doble-reserva de S-41, el `> now()`— es idéntico a propósito.
--
-- La FIRMA no se toca (uuid, date, date). Es requisito duro: `create_booking`
-- la llama por esa firma exacta y un `create or replace` con otros parámetros
-- crearía una SEGUNDA función en vez de sustituir esta, dejando al flujo de
-- reserva validando contra la versión vieja sin que nada avise.
--
-- SOBRE LAS EXCEPCIONES `open`: se quedan como están, aplicando a todas las
-- mentorías del tutor. Una excepción es un «ese día concreto abro de 16 a 18»,
-- no cuelga de ninguna regla semanal y por tanto no hay bloque al que
-- asignarla. Restringirlas exigiría su propia tabla puente y su propia UI, y el
-- cliente pidió los BLOQUES. Queda escrito para que se vea que es una decisión
-- y no un descuido: si mañana molesta —«abrí el sábado para guitarra y me
-- reservaron cálculo»—, el sitio de arreglarlo es aquí.
-- Las excepciones `block` siguen siendo globales sin discusión posible: el
-- tutor no está, y no está para todas sus mentorías a la vez.
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
  -- N-04 · ¿esta mentoría declaró bloques? Se resuelve UNA vez y fuera de la
  -- consulta grande: es la diferencia entre «filtra por mis bloques» y «no
  -- filtres», no un dato que cambie de fila a fila.
  v_has_blocks boolean;
begin
  -- Solo producto 'active' de tutor 'approved' es reservable (RN-24).
  select p.tutor_id, p.session_duration_min, pr.timezone
    into v_tutor_id, v_duration, v_tz
  from public.products p
  join public.tutor_profiles tp
    on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  join public.profiles pr on pr.id = p.tutor_id
  where p.id = p_product_id and p.status = 'active';

  if v_tutor_id is null or v_duration is null or v_tz is null then
    return; -- sin producto reservable → sin slots
  end if;

  select exists (
    select 1 from public.product_availability_rules par
    where par.product_id = p_product_id
  ) into v_has_blocks;

  return query
  with days as (
    select gd::date as day, extract(dow from gd::date)::int as weekday
    from generate_series(
      greatest(p_from, current_date)::timestamp, p_to::timestamp, interval '1 day'
    ) gd
  ),
  -- Slots base desde reglas recurrentes, cortados por la duración del producto.
  rule_slots as (
    select d.day, (r.start_time + make_interval(mins => v_duration * i.n)) as wall_start
    from days d
    join public.availability_rules r
      on r.tutor_id = v_tutor_id and r.is_active and r.weekday = d.weekday
      -- ── N-04, EL CAMBIO ────────────────────────────────────────────────
      -- Con bloques declarados, solo cuentan los suyos. Sin bloques,
      -- `not v_has_blocks` es cierto para TODAS las filas y el `or` deja pasar
      -- la regla entera: exactamente el comportamiento anterior a N-04, que es
      -- lo que sostiene el catálogo público y `create_booking`.
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
      floor(extract(epoch from (r.end_time - r.start_time)) / (v_duration * 60))::int - 1
    ) as i(n)
  ),
  -- Slots extra desde excepciones 'open' con rango horario (siguen siendo del
  -- tutor, no del bloque — ver la nota de la cabecera de §4).
  open_slots as (
    select x.date as day, (x.start_time + make_interval(mins => v_duration * i.n)) as wall_start
    from public.availability_exceptions x
    cross join lateral generate_series(
      0,
      floor(extract(epoch from (x.end_time - x.start_time)) / (v_duration * 60))::int - 1
    ) as i(n)
    where x.tutor_id = v_tutor_id
      and x.type = 'open'
      and x.start_time is not null and x.end_time is not null
      and x.date between greatest(p_from, current_date) and p_to
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
  'US-601 + N-04: huecos libres de un producto. Resuelve availability_rules − exceptions(block) + exceptions(open) − sesiones ocupadas, en la zona horaria del tutor. Si el producto tiene filas en product_availability_rules, solo cuentan ESAS reglas; si no tiene ninguna, cuentan todas las del tutor (compatibilidad hacia atrás).';

-- `create or replace` conserva los privilegios existentes, pero se rehacen por
-- si esta migración se aplica sobre una base donde la función no existía: en
-- Postgres el `execute` nace concedido a PUBLIC, así que revocar ANTES de
-- conceder no es ceremonia (mismo gotcha de 20260715150000 y 20260806120000).
--
-- Se restituye exactamente el juego de hoy —`authenticated` (20260709150000) y
-- `anon` (20260723150000, el calendario de la ficha pública P07)— más
-- `service_role`, que NO es privilegio nuevo: hoy puede ejecutarla porque
-- PUBLIC nunca se revocó, y quitárselo de tapadillo rompería en RUNTIME
-- cualquier Route Handler que la use para revalidar horarios en servidor.
revoke execute on function public.get_available_slots(uuid, date, date) from public;

grant  execute on function public.get_available_slots(uuid, date, date) to anon;
grant  execute on function public.get_available_slots(uuid, date, date) to authenticated;
grant  execute on function public.get_available_slots(uuid, date, date) to service_role;
