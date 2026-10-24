-- ============================================================================
-- Enséñame Ya — la hora de una clase grupal la fija el primer alumno
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Decisión del cliente y de Jose (24-oct): el horario de las grupales funciona
-- EXACTAMENTE como el de las 1:1. Hasta hoy el tutor publicaba fechas fijas
-- (`publicar_clase_grupal`, 20261008160000 → 20261017120000:499); eso se
-- borra. El tutor solo mantiene su disponibilidad semanal y el alumno elige en
-- el MISMO selector de las 1:1 (`/reservar/[productId]`, `get_available_slots`).
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §3 (RG-01 y RG-05 reescritas).
--
-- ── EL MODELO: PLANTILLA + CLASES NACIDAS ──────────────────────────────────
-- · El producto grupal que crea el tutor es la PLANTILLA: título, precio por
--   cupo, `capacity`, `min_seats`, duración y `package_num_sessions` (= N
--   fechas por ciclo, RG-16). Sale en el catálogo. NUNCA tiene `group_classes`.
-- · Cuando un alumno elige un horario libre, `abrir_clase_grupal` crea una
--   CLASE NACIDA: otro producto (`group_template_id` = la plantilla) que copia
--   los datos de la plantilla, con sus N `group_classes`. Esa fila es la que se
--   compra (`create_booking_line`, sin tocar) y la que ven el chat, la sala, el
--   mínimo, los regalos, los reembolsos y el payout: TODAS esas funciones son
--   «por producto» (cupos_libres, cierre_de_inscripcion, conversations por
--   group_product_id, cancelar_clase_grupal, regalos_de_clase_a_saldo,
--   cancelar_grupales_sin_minimo…). Reescribirlas «por edición» eran ~25
--   funciones a ciegas; con un producto por clase siguen valiendo tal cual.
-- · La clase nacida NO sale en los listados: el catálogo filtra
--   `group_template_id is null` (`src/lib/catalog/queries.ts`). Se puede LEER
--   por su id (la RLS de products no cambia), que es lo que necesita el
--   checkout de quien se suma.
-- · Sumarse a una clase ya nacida es el camino de siempre: checkout del
--   producto nacido → `create_booking_line` (fechas fijas, cupo, corte).
--
-- ── LA CARRERA (dos alumnos, el mismo horario libre, a la vez) ─────────────
-- `abrir_clase_grupal` bloquea la fila de la PLANTILLA (`for update`). El
-- segundo espera, y su siguiente sentencia (READ COMMITTED) ya ve la clase del
-- primero: si sus horarios son EXACTAMENTE esos, se le devuelve esa misma
-- clase (terminan juntos); si se pisan pero no son los mismos (otro ciclo), el
-- hueco ya no sale en `get_available_slots` y se le dice que elija de nuevo.
-- Debajo sigue la red de siempre: `group_classes_sin_solape_por_tutor` impide
-- dos fechas grupales vivas del mismo tutor que se pisen, y el candado entre
-- tablas (20261008120100) el cruce con las 1:1. El cupo apartado durante el
-- pago (`cupos_apartados`, 20261017180000) no cambia.
--
-- ── LO QUE SE BORRA ────────────────────────────────────────────────────────
-- · `publicar_clase_grupal(uuid, timestamptz[])` y
--   `horarios_libres_del_tutor(integer, date, date)`: solo servían para que el
--   tutor publicara fechas. Cancelar, reagendar, sacar alumnos y la gestión
--   del admin se quedan.
--
-- ── LOS DATOS DE DEV ───────────────────────────────────────────────────────
-- Cada grupal que ya tenía fechas pasa a ser una clase NACIDA de una plantilla
-- nueva que copia sus datos (y se queda con su slug, así sus enlaces siguen
-- llevando a la ficha). Lo vendido no se toca: reservas, sesiones, chat y sala
-- siguen colgando del producto de siempre. Si una de esas clases tenía fechas
-- `scheduled` y NINGUNA reserva viva, sus fechas se cancelan: nadie eligió esa
-- hora y seguir bloqueándola en la agenda 1:1 del tutor era el modelo viejo.
-- (El producto se archiva solo, `grupal_al_cambiar_fechas`.) Los materiales
-- (`tutor_materials`) se quedan en la clase vieja, donde los ven sus inscritos.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Una clase abierta que nadie paga no puede bloquear al tutor para siempre:
--   `cerrar_clases_grupales_vacias()` (pg_cron `cerrar-grupales-vacias`, cada
--   10 min) cancela las fechas de las nacidas hace más de 20 min sin una sola
--   reserva viva. Regla 11: tras aplicar, mirar su última corrida.
-- · `products.group_template_id` y `group_opened_by` NO se escriben desde el
--   cliente: el tutor tiene `update` de TABLA en products, así que los guarda
--   `products_protege_clase_nacida` (solo `abrir_clase_grupal` y esta
--   migración los ponen, con `ey.abriendo_clase_grupal` en la transacción).
-- · Regla 10: la FK nueva es products → products (autorreferencia). No hay
--   tabla puente nueva; ningún embed existente cambia. Quien quiera embeber la
--   plantilla desde la nacida tiene que nombrar la FK
--   (`products!products_group_template_id_fkey`).
-- · Regla 12: `abrir_clase_grupal` es nueva; `get_available_slots` y
--   `products_guarda_grupal` conservan su firma (`create or replace`).
-- · `group_classes_public` gana `group_template_id` AL FINAL (create or replace
--   view no reordena columnas).
-- ============================================================================


-- ── 1 · las columnas ───────────────────────────────────────────────────────
alter table public.products
  add column if not exists group_template_id uuid
    constraint products_group_template_id_fkey references public.products (id) on delete restrict,
  add column if not exists group_opened_by uuid
    constraint products_group_opened_by_fkey references public.profiles (id) on delete set null;

comment on column public.products.group_template_id is
  'RG-01 (24-oct) · en una CLASE GRUPAL NACIDA, la plantilla de la que nació (la grupal que publicó el tutor). NULL = producto normal o plantilla. La nacida copia precio, cupo, mínimo, duración y N de la plantilla al nacer y no sale en los listados. La ponen abrir_clase_grupal y la migración 20261024120000; nunca el cliente (products_protege_clase_nacida).';
comment on column public.products.group_opened_by is
  'RG-01 (24-oct) · el alumno que abrió esta clase nacida eligiendo la hora. Solo para el tope de clases abiertas sin pagar y la auditoría; NULL en las migradas del modelo viejo.';

alter table public.products drop constraint if exists products_clase_nacida_es_grupal;
alter table public.products add constraint products_clase_nacida_es_grupal check (
  group_template_id is null or (pricing_model = 'group' and group_template_id <> id)
);

create index if not exists products_group_template_idx
  on public.products (group_template_id)
  where group_template_id is not null;


-- ── 2 · nadie más escribe esas dos columnas ────────────────────────────────
create or replace function public.products_protege_clase_nacida()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_abriendo boolean := coalesce(current_setting('ey.abriendo_clase_grupal', true), '') = 'si';
begin
  if v_abriendo then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.group_template_id is not null or new.group_opened_by is not null then
      raise exception 'una clase grupal nace cuando un alumno elige su horario'
        using errcode = '42501';
    end if;
  else
    new.group_template_id := old.group_template_id;
    new.group_opened_by   := old.group_opened_by;
  end if;
  return new;
end;
$$;

comment on function public.products_protege_clase_nacida() is
  'RG-01 (24-oct) · group_template_id y group_opened_by solo los escribe abrir_clase_grupal (o una migración), marcando ey.abriendo_clase_grupal = si en su transacción. Un INSERT del cliente con ellas se rechaza; un UPDATE conserva el valor anterior.';

revoke execute on function public.products_protege_clase_nacida() from public, anon, authenticated;

drop trigger if exists products_protege_clase_nacida on public.products;
create trigger products_protege_clase_nacida
  before insert or update of group_template_id, group_opened_by on public.products
  for each row execute function public.products_protege_clase_nacida();


-- ── 3 · products_guarda_grupal: la plantilla se publica sin fechas ─────────
-- Reemplaza a 20261017120000:600. Solo cambian dos bloques (marcados
-- «20261024»); el trigger y su lista de columnas no se tocan.
CREATE OR REPLACE FUNCTION public.products_guarda_grupal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- A · RG-21: una oferta de academia no es grupal hasta la Fase I.
  if new.pricing_model = 'group' and new.academy_id is not null then
    raise exception 'las clases grupales de academia todavía no están disponibles'
      using errcode = 'check_violation';
  end if;

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

  -- 20261024 · tampoco la plantilla de la que ya nacieron clases: sus clases
  -- quedarían colgando de una mentoría 1:1.
  if tg_op = 'UPDATE'
     and old.pricing_model is distinct from new.pricing_model
     and exists (select 1 from public.products c where c.group_template_id = old.id)
  then
    raise exception 'esta clase grupal ya tiene clases abiertas por alumnos: no cambia de tipo'
      using errcode = 'check_violation';
  end if;

  -- B6 · con la clase publicada (ya tiene fechas), lo que el alumno compró no
  -- cambia por debajo (RG-02; Emilio, 16-oct): mínimo, precio y duración
  -- quedan fijos —se cancela y se publica otra— y el cupo puede subir, pero
  -- nunca por debajo de las reservas vivas (Daily admite cupo + 1: un cupo
  -- más bajo dejaba fuera de la sala a alumnos que habían pagado).
  if tg_op = 'UPDATE' and new.pricing_model = 'group'
     and exists (select 1 from public.group_classes g where g.product_id = old.id)
  then
    if new.min_seats is distinct from old.min_seats then
      raise exception 'Con la clase publicada, el cupo mínimo ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    if new.price_amount is distinct from old.price_amount then
      raise exception 'Con la clase publicada, el precio ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    if new.session_duration_min is distinct from old.session_duration_min then
      raise exception 'Con la clase publicada, la duración ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    -- `package_num_sessions` es la N del prorrateo (precio_vigente_grupal):
    -- moverla es cambiar el precio. Solo vale el valor que escribe
    -- publicar_clase_grupal, que es el número de fechas.
    if new.package_num_sessions is distinct from old.package_num_sessions
       and new.package_num_sessions is distinct from
           (select count(*)::int from public.group_classes g where g.product_id = old.id)
    then
      raise exception 'Con la clase publicada, el número de fechas ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    if new.currency is distinct from old.currency then
      raise exception 'Con la clase publicada, la moneda ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    if new.capacity is distinct from old.capacity and new.min_seats is not null
       and new.capacity < new.min_seats
    then
      raise exception 'El cupo no puede quedar por debajo del cupo mínimo de la clase.'
        using errcode = 'check_violation';
    end if;
    if new.capacity is distinct from old.capacity and new.capacity < (
         select count(*) from public.bookings b
          where b.product_id = old.id
            and b.status in ('pending_payment', 'pending_acceptance', 'confirmed', 'in_progress'))
    then
      raise exception 'El cupo no puede quedar por debajo de los alumnos ya inscritos o pagando.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- 20261024 · la PLANTILLA grupal (sin group_template_id) se publica sin
  -- fechas, como una 1:1: la hora la fija el primer alumno. Una clase NACIDA
  -- (con group_template_id) no se activa sin sus fechas: abrir_clase_grupal la
  -- inserta en borrador, le pone las fechas y después la activa. Solo en la
  -- TRANSICIÓN a 'active': una clase cuyas fechas ya pasaron sigue editándose.
  if new.pricing_model = 'group' and new.status = 'active'
     and new.group_template_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and not exists (
       select 1 from public.group_classes g
        where g.product_id = new.id and g.status = 'scheduled'
     )
  then
    raise exception 'una clase grupal nace con sus fechas'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;


-- ── 4 · get_available_slots: la plantilla grupal ofrece la agenda del tutor ─
-- Reemplaza a 20261017110000:540. Cambian el filtro del producto (una
-- plantilla grupal SÍ tiene horarios; una clase nacida no) y el suelo de la
-- ventana (+48 h en una grupal con cupo mínimo, B7). Lo demás, idéntico:
-- RG-05 sigue restando las grupales programadas a cualquier producto del tutor.
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
  -- 20261024 · el suelo de la ventana: ahora, salvo en una plantilla grupal
  -- con cupo mínimo, donde es ahora + 48 h (B7).
  v_suelo      timestamptz := now();
  v_min_seats  smallint;
begin
  -- Solo producto 'active' de tutor 'approved' es reservable (RN-24).
  select p.tutor_id, p.session_duration_min, pr.timezone, p.start_time_increment_min,
         case when p.pricing_model = 'group' then p.min_seats end
    into v_tutor_id, v_duration, v_tz, v_step, v_min_seats
  from public.products p
  join public.tutor_profiles tp
    on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  join public.profiles pr on pr.id = p.tutor_id
  where p.id = p_product_id and p.status = 'active'
    -- 20261024 · una grupal se reserva como una 1:1: la PLANTILLA (sin
    -- group_template_id) ofrece la agenda del tutor y el primer alumno fija la
    -- hora (abrir_clase_grupal). Una clase YA NACIDA no tiene horarios que
    -- elegir: sus fechas son las de `group_classes`. Y sin el interruptor del
    -- admin (RG-18) no se abren clases nuevas.
    and (
      p.pricing_model <> 'group'
      or (p.group_template_id is null and tp.group_classes_enabled)
    );

  if v_tutor_id is null or v_duration is null or v_tz is null then
    return; -- sin producto reservable → sin slots
  end if;

  -- Sin paso declarado, el paso es la duración: exactamente la rejilla anterior
  -- a esta migración. El `greatest(…, 1)` es una red por si algún día el `check`
  -- de la columna se relaja: un paso de 0 haría que `generate_series` intentara
  -- devolver infinitas filas.
  v_step := greatest(coalesce(v_step, v_duration), 1);

  -- B7 · con cupo mínimo, la primera fecha a más de 48 h: el mínimo se revisa
  -- una vez a las 24 h (cancelar_grupales_sin_minimo), y una clase abierta para
  -- mañana se cancelaría sola en el primer pase del cron, sin tiempo de llenarse.
  if v_min_seats is not null then
    v_suelo := now() + interval '48 hours';
  end if;

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
  where r.s_start > v_suelo  -- solo futuro (y +48 h en grupal con mínimo)
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


-- ── 5 · abrir_clase_grupal: el primer alumno fija la hora ──────────────────
create or replace function public.abrir_clase_grupal(
  p_product uuid,
  p_slots   timestamptz[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_tpl     record;
  v_n       int;
  v_slots   timestamptz[];
  v_clase   uuid;
  v_avail   int;
  v_vacias  int;
  v_i       int := 0;
  v_s       timestamptz;
begin
  if v_uid is null then
    raise exception 'necesitas iniciar sesión' using errcode = '28000';
  end if;

  select p.id, p.tutor_id, p.title, p.description, p.outcome, p.price_amount, p.currency,
         p.session_duration_min, p.package_num_sessions, p.capacity, p.min_seats,
         p.cancellation_policy, p.faqs, p.requirements, p.image_path, p.language,
         p.level, p.assignment_mode, p.visibility
    into v_tpl
    from public.products p
    join public.tutor_profiles tp
      on tp.profile_id = p.tutor_id
     and tp.approval_status = 'approved'
     and tp.group_classes_enabled
   where p.id = p_product
     and p.pricing_model = 'group'
     and p.group_template_id is null
     and p.academy_id is null            -- RG-21
     and p.status = 'active'
   -- 🔒 Serializa a quienes abren clase de esta plantilla (ver la cabecera).
   for update of p;

  if v_tpl.id is null then
    raise exception 'esta clase grupal no admite reservas ahora mismo' using errcode = 'check_violation';
  end if;
  -- M11 · el tutor no se inscribe en su propia clase.
  if v_tpl.tutor_id = v_uid then
    raise exception 'no puedes inscribirte en tu propia clase' using errcode = 'check_violation';
  end if;
  if v_tpl.session_duration_min is null then
    raise exception 'esta clase grupal no admite reservas ahora mismo' using errcode = 'check_violation';
  end if;

  -- RG-16 · N fechas por ciclo, como un paquete 1:1.
  v_n := greatest(coalesce(v_tpl.package_num_sessions, 1), 1);
  select array_agg(distinct s order by s) into v_slots from unnest(p_slots) s where s is not null;
  if coalesce(array_length(v_slots, 1), 0) <> v_n then
    raise exception 'debes elegir % horario(s)', v_n using errcode = 'check_violation';
  end if;

  -- ¿Otro alumno acaba de abrir ESA MISMA clase? Entonces es la suya también:
  -- mismas fechas exactas, viva y de esta plantilla. (El cupo y el corte los
  -- vuelve a mirar create_booking_line al pagar.)
  select c.id into v_clase
    from public.products c
   where c.group_template_id = v_tpl.id
     and c.status = 'active'
     and array(select g.start_at from public.group_classes g
                where g.product_id = c.id and g.status = 'scheduled'
                order by g.start_at) = v_slots
   limit 1;
  if v_clase is not null then
    return v_clase;
  end if;

  -- Un alumno no acapara la agenda de nadie: como mucho dos clases abiertas
  -- por él y todavía sin una sola reserva viva (las cierra el cron a los 20 min).
  select count(*) into v_vacias
    from public.products c
   where c.group_opened_by = v_uid
     and c.status = 'active'
     and exists (select 1 from public.group_classes g
                  where g.product_id = c.id and g.status = 'scheduled')
     and not exists (select 1 from public.bookings b
                      where b.product_id = c.id
                        and b.status in ('pending_payment', 'pending_acceptance', 'confirmed', 'in_progress'));
  if v_vacias >= 2 then
    raise exception 'tienes clases abiertas sin pagar: termina el pago de una antes de abrir otra'
      using errcode = 'check_violation';
  end if;

  -- Cada horario sigue libre en la agenda del tutor (reglas − excepciones −
  -- sesiones − grupales programadas, y +48 h con mínimo). Misma función que
  -- pinta el selector: lo que se ofreció es lo que se valida.
  select count(*) into v_avail
    from unnest(v_slots) as s(slot)
   where exists (
     select 1
       from public.get_available_slots(
              v_tpl.id,
              (v_slots[1] at time zone 'UTC')::date - 1,
              (v_slots[v_n] at time zone 'UTC')::date + 1) a
      where a.slot_start = s.slot
   );
  if v_avail <> v_n then
    raise exception 'ese horario acaba de ser tomado' using errcode = 'check_violation';
  end if;

  -- Nace la clase: copia de la plantilla, en borrador hasta tener sus fechas
  -- (products_guarda_grupal no deja activar una nacida sin ellas).
  perform set_config('ey.abriendo_clase_grupal', 'si', true);

  insert into public.products (
    tutor_id, title, description, outcome, pricing_model, price_amount, currency,
    session_duration_min, package_num_sessions, capacity, min_seats,
    auto_accept_bookings, cancellation_policy, faqs, requirements, image_path,
    language, level, assignment_mode, visibility, status,
    group_template_id, group_opened_by
  ) values (
    v_tpl.tutor_id, v_tpl.title, v_tpl.description, v_tpl.outcome, 'group', v_tpl.price_amount, v_tpl.currency,
    v_tpl.session_duration_min, v_n, v_tpl.capacity, v_tpl.min_seats,
    true, v_tpl.cancellation_policy, v_tpl.faqs, v_tpl.requirements, v_tpl.image_path,
    v_tpl.language, v_tpl.level, v_tpl.assignment_mode, v_tpl.visibility, 'draft',
    v_tpl.id, v_uid
  ) returning id into v_clase;

  foreach v_s in array v_slots loop
    v_i := v_i + 1;
    insert into public.group_classes (product_id, tutor_id, sequence_no, start_at, end_at)
    values (v_clase, v_tpl.tutor_id, v_i, v_s,
            v_s + make_interval(mins => v_tpl.session_duration_min));
  end loop;

  update public.products set status = 'active' where id = v_clase;

  perform set_config('ey.abriendo_clase_grupal', '', true);
  return v_clase;
exception
  -- 23P01: otra fecha grupal o una 1:1 del tutor se pisa (exclusión o candado
  -- entre tablas), o dos horarios del propio ciclo se pisan entre sí. El texto
  -- es el que reconoce `esCarreraDeHorario` (lib/checkout/hold.ts).
  when exclusion_violation then
    raise exception 'ese horario acaba de ser tomado' using errcode = 'check_violation';
end;
$$;

comment on function public.abrir_clase_grupal(uuid, timestamptz[]) is
  'RG-01 (24-oct) · el alumno elige horario(s) libres de una plantilla grupal (N = package_num_sessions) y nace la clase: un producto con group_template_id = la plantilla, que copia sus datos, y sus N group_classes. Si otro alumno ya abrió exactamente esas fechas, devuelve esa clase (bloquea la plantilla: dos a la vez terminan en la misma). Devuelve el id del producto nacido; el pago va después por el checkout de ese producto (create_booking_line).';

revoke execute on function public.abrir_clase_grupal(uuid, timestamptz[]) from public, anon;
grant  execute on function public.abrir_clase_grupal(uuid, timestamptz[]) to authenticated;


-- ── 6 · las clases que nadie pagó devuelven la hora ────────────────────────
create or replace function public.cerrar_clases_grupales_vacias()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c       record;
  v_n       int := 0;
  v_fallos  int := 0;
  v_detalle text := '';
begin
  for v_c in
    select p.id
      from public.products p
     where p.group_template_id is not null
       and p.pricing_model = 'group'
       and p.created_at < now() - interval '20 minutes'
       and exists (select 1 from public.group_classes g
                    where g.product_id = p.id and g.status = 'scheduled')
       and not exists (select 1 from public.bookings b
                        where b.product_id = p.id
                          and b.status in ('pending_payment', 'pending_acceptance', 'confirmed', 'in_progress'))
  loop
    -- Regla 11: un fallo por clase no tumba la pasada… pero la pasada sale
    -- `failed` al final, para que se vea en cron.job_run_details.
    begin
      update public.group_classes
         set status = 'cancelled',
             cancelled_at = now(),
             cancel_reason = 'Nadie se inscribió: la hora vuelve a la agenda del tutor'
       where product_id = v_c.id
         and status = 'scheduled';
      v_n := v_n + 1;
    exception when others then
      v_fallos := v_fallos + 1;
      v_detalle := v_detalle || v_c.id || ': ' || sqlerrm || '; ';
    end;
  end loop;

  if v_fallos > 0 then
    raise exception 'cerrar_clases_grupales_vacias: % clase(s) fallaron: %', v_fallos, v_detalle;
  end if;
  return v_n;
end;
$$;

comment on function public.cerrar_clases_grupales_vacias() is
  'RG-01 (24-oct) · cancela las fechas pendientes de una clase grupal NACIDA hace más de 20 min que no tiene ni una reserva viva (nadie la pagó, o todos se dieron de baja): la hora vuelve a la agenda 1:1 del tutor. Sin inscritos no hay avisos que mandar. Corre por pg_cron (cerrar-grupales-vacias, cada 10 min); si una clase falla, la pasada sale failed (regla 11).';

revoke execute on function public.cerrar_clases_grupales_vacias() from public, anon, authenticated;

select cron.unschedule('cerrar-grupales-vacias')
 where exists (select 1 from cron.job where jobname = 'cerrar-grupales-vacias');
select cron.schedule(
  'cerrar-grupales-vacias',
  '*/10 * * * *',
  $cron$ select public.cerrar_clases_grupales_vacias() $cron$
);


-- ── 7 · group_classes_public gana la plantilla (al final) ──────────────────
-- Reemplaza a 20261017180000:57. Con ella el selector pinta, por plantilla,
-- las clases ya nacidas con cupo, destacadas y primero.
create or replace view public.group_classes_public
with (security_invoker = true) as
  select g.id,
         g.product_id,
         g.sequence_no,
         g.start_at,
         g.end_at,
         p.capacity,
         public.cupos_libres(g.product_id) as cupos_libres,
         g.tutor_id,
         p.title,
         p.inscripcion_cierra_at,
         p.min_seats,
         public.inscritos_pagados(g.product_id) as inscritos_pagados,
         public.cupos_apartados(g.product_id) as cupos_apartados,
         p.group_template_id
    from public.group_classes g
    join public.products p on p.id = g.product_id
   where g.status = 'scheduled';

comment on view public.group_classes_public is
  'G2 · lo que el catálogo enseña de una clase grupal: sus fechas pendientes, el cupo y cuántos quedan. security_invoker: hereda la RLS de group_classes y products. Lote 6 · M17: cupos_libres DESCUENTA los holds en curso (un pago abierto ocupa su cupo); inscritos_pagados son SOLO los pagados (confirmed | in_progress). «+N pagando» = capacity − cupos_libres − inscritos_pagados. Lote 8 · M4: cupos_apartados son los pagos en curso (pending_payment), sin decir de quién. 20261024 · group_template_id: la plantilla de la que nació la clase (el selector la usa para ofrecer, destacadas, las clases ya abiertas de esa plantilla).';

grant select on public.group_classes_public to anon, authenticated;


-- ── 8 · lo que solo servía para publicar fechas ────────────────────────────
drop function if exists public.publicar_clase_grupal(uuid, timestamptz[]);
drop function if exists public.horarios_libres_del_tutor(integer, date, date);


-- ── 9 · los datos de dev: cada grupal con fechas pasa a ser clase nacida ───
-- Mismo patrón que 20261002120000 y 20261017110000: las guardas que abortarían
-- por un tutor ya no aprobado o sin el interruptor, apagadas mientras tanto, y
-- el slug escrito a mano (products_slug lo recalcularía).
alter table public.products disable trigger products_publish_guard;
alter table public.products disable trigger products_guarda_grupal;
alter table public.products disable trigger products_slug;

do $$
declare
  v_p     record;
  v_t     uuid;
  v_slug  text;
begin
  perform set_config('ey.abriendo_clase_grupal', 'si', true);

  for v_p in
    select p.*
      from public.products p
     where p.pricing_model = 'group'
       and p.group_template_id is null
       and exists (select 1 from public.group_classes g where g.product_id = p.id)
     order by p.created_at
  loop
    -- La plantilla se queda el slug: los enlaces compartidos llevan a la ficha
    -- donde ahora se elige hora. La clase vieja pasa a «<slug>-<6 del id>».
    v_slug := v_p.slug;
    if v_slug is not null then
      update public.products
         set slug = v_slug || '-' || left(replace(v_p.id::text, '-', ''), 6)
       where id = v_p.id;
    end if;

    insert into public.products (
      tutor_id, title, description, outcome, pricing_model, price_amount, currency,
      session_duration_min, package_num_sessions, capacity, min_seats,
      auto_accept_bookings, cancellation_policy, faqs, requirements, image_path,
      language, level, assignment_mode, visibility, status, slug, created_at
    ) values (
      v_p.tutor_id, v_p.title, v_p.description, v_p.outcome, 'group', v_p.price_amount, v_p.currency,
      v_p.session_duration_min, v_p.package_num_sessions, v_p.capacity, v_p.min_seats,
      true, v_p.cancellation_policy, v_p.faqs, v_p.requirements, v_p.image_path,
      v_p.language, v_p.level, v_p.assignment_mode, v_p.visibility,
      -- Una clase que ya terminó (archivada) deja la plantilla archivada: el
      -- tutor decide si la vuelve a publicar.
      v_p.status, v_slug, v_p.created_at
    ) returning id into v_t;

    insert into public.product_categories (product_id, category_id)
    select v_t, pc.category_id
      from public.product_categories pc
     where pc.product_id = v_p.id
    on conflict do nothing;

    update public.products set group_template_id = v_t where id = v_p.id;

    -- Fechas pendientes que nadie compró: se cancelan (ver la cabecera).
    if not exists (
      select 1 from public.bookings b
       where b.product_id = v_p.id
         and b.status in ('pending_payment', 'pending_acceptance', 'confirmed', 'in_progress')
    ) then
      update public.group_classes
         set status = 'cancelled',
             cancelled_at = now(),
             cancel_reason = 'Cambio de modelo: la hora de la clase la fija el primer alumno'
       where product_id = v_p.id
         and status = 'scheduled';
    end if;
  end loop;

  perform set_config('ey.abriendo_clase_grupal', '', true);
end
$$;

alter table public.products enable trigger products_publish_guard;
alter table public.products enable trigger products_guarda_grupal;
alter table public.products enable trigger products_slug;
