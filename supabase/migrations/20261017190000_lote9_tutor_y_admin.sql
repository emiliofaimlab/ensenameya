-- ============================================================================
-- Enséñame Ya — lote 9 del sondeo de grupales: tutor y admin
--
-- `docs/SONDEO-GRUPALES-LOTES.md`, lote 9. Cierra la parte de BD de M18, M32 y
-- P48; el resto del lote (A4, M16, M19, P1…P53) es de pantalla.
--
-- ── Qué versión reemplaza cada función (regla del plan §2) ─────────────────
-- · admin_sacar_de_clase_grupal 20261014160000:45 (+ M32), con el comentario
--                               vigente de 20261017120000:714
-- · tutor_students ............ 20260817150000:83 (+ P48)
-- Nueva: horarios_libres_del_tutor (RPC para authenticated), cuyo cuerpo sale
-- de get_available_slots en 20261017110000:540.
-- Los tres cuerpos vivos en dev coinciden con esas versiones (comparados con
-- pg_get_functiondef el 17-oct): no hay cambios de la rama `dev` que combinar.
--
-- ── M18 · publicar una grupal viendo la agenda ─────────────────────────────
-- Las fechas se tecleaban a ciegas y el choque solo aparecía al publicar.
-- `horarios_libres_del_tutor` es `get_available_slots` sin producto: las
-- franjas de TODAS las reglas activas del tutor (no hay bloques N-04 que
-- filtrar), las excepciones 'open', y fuera los bloqueos, las sesiones que da o
-- toma (EY-228) y sus fechas grupales publicadas (RG-05). Paso fijo de 30 min y
-- la duración que vaya a tener la clase. Siempre del que llama: no recibe tutor.
-- Sin filtro de aprobación: publicar ya lo exige, y un tutor pendiente puede
-- ir viendo su agenda.
--
-- ── M32 · en la lista de inscritos, quién salió por el equipo ──────────────
-- `bookings.sacado_por_admin_at` la escribe `admin_sacar_de_clase_grupal`
-- después de `cancel_booking`. Con el ciclo empezado (M1) la reserva no se
-- cancela —sigue in_progress o pasa a completed—, y aun así queda marcada:
-- la marca dice quién la sacó, no en qué estado quedó.
--
-- ── P48 · la baja de una grupal pagada conserva el nombre ──────────────────
-- `tutor_students` solo veía reservas vivas, así que quien pagó un cupo y se
-- dio de baja salía como «Alumno» en «Reservas» y en la ficha. En una grupal
-- el tutor ya vio el nombre en la lista de inscritos: se exige un pago que
-- llegó a cobrarse (paid / partially_refunded / refunded). Un checkout
-- abandonado (pending, failed) no cuenta. En 1:1 la regla no cambia.
-- ============================================================================


-- ── 1 · M18 · horarios_libres_del_tutor ────────────────────────────────────
create or replace function public.horarios_libres_del_tutor(
  p_duracion integer,
  p_desde    date default current_date,
  p_hasta    date default (current_date + 42)
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_tutor_id uuid := (select auth.uid());
  v_tz       text;
  -- Sin producto no hay `start_time_increment_min`: la rejilla de la clase
  -- grupal es de media hora, la misma que ofrecía el formulario.
  v_step     int := 30;
  v_desde    date;
  v_hasta    date;
begin
  if v_tutor_id is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if p_duracion is null or p_duracion < 30 or p_duracion > 240 then
    raise exception 'la duración va de 30 a 240 minutos' using errcode = 'check_violation';
  end if;

  select pr.timezone into v_tz
    from public.profiles pr
    join public.tutor_profiles tp on tp.profile_id = pr.id
   where pr.id = v_tutor_id;
  if v_tz is null then
    return; -- no es tutor, o no tiene zona → sin slots
  end if;

  -- Mismo suelo que get_available_slots (su «Cambio B»): hoy en la zona del
  -- tutor, no en UTC.
  v_desde := case
               when p_desde is null or p_desde <= current_date then (now() at time zone v_tz)::date
               else p_desde
             end;
  -- Tope de 92 días: recorta, no falla. Es para pintar un selector.
  v_hasta := least(coalesce(p_hasta, v_desde + 42), v_desde + 92);

  return query
  with days as (
    select gd::date as day, extract(dow from gd::date)::int as weekday
    from generate_series(v_desde::timestamp, v_hasta::timestamp, interval '1 day') gd
  ),
  -- Mismo tope de generate_series que get_available_slots (la regla de
  -- Calendly: el hueco cabe ENTERO en la franja), con todas las reglas activas.
  rule_slots as (
    select d.day, (r.start_time + make_interval(mins => v_step * i.n)) as wall_start
    from days d
    join public.availability_rules r
      on r.tutor_id = v_tutor_id and r.is_active and r.weekday = d.weekday
    cross join lateral generate_series(
      0,
      floor(
        (extract(epoch from (r.end_time - r.start_time)) - (p_duracion * 60))
        / (v_step * 60)
      )::int
    ) as i(n)
  ),
  open_slots as (
    select x.date as day, (x.start_time + make_interval(mins => v_step * i.n)) as wall_start
    from public.availability_exceptions x
    cross join lateral generate_series(
      0,
      floor(
        (extract(epoch from (x.end_time - x.start_time)) - (p_duracion * 60))
        / (v_step * 60)
      )::int
    ) as i(n)
    where x.tutor_id = v_tutor_id
      and x.type = 'open'
      and x.start_time is not null and x.end_time is not null
      and x.date between v_desde and v_hasta
  ),
  resolved as (
    select
      s.day,
      s.wall_start,
      (s.day + s.wall_start) at time zone v_tz as s_start,
      (s.day + s.wall_start + make_interval(mins => p_duracion)) at time zone v_tz as s_end
    from (select day, wall_start from rule_slots
          union
          select day, wall_start from open_slots) s
  )
  select r.s_start, r.s_end
  from resolved r
  where r.s_start > now()
    and not exists (
      select 1 from public.availability_exceptions b
      where b.tutor_id = v_tutor_id and b.type = 'block' and b.date = r.day
        and (
          b.start_time is null
          or (r.wall_start < b.end_time
              and (r.wall_start + make_interval(mins => p_duracion)) > b.start_time)
        )
    )
    -- Las que da y las que toma como alumno (EY-228).
    and not exists (
      select 1 from public.sessions se
      where (se.tutor_id = v_tutor_id or se.student_id = v_tutor_id)
        and se.status not in ('cancelled', 'no_show')
        and tstzrange(se.start_at, se.end_at) && tstzrange(r.s_start, r.s_end)
    )
    -- RG-05: sus otras fechas grupales publicadas, con o sin inscritos.
    and not exists (
      select 1 from public.group_classes g
      where g.tutor_id = v_tutor_id
        and g.status = 'scheduled'
        and tstzrange(g.start_at, g.end_at) && tstzrange(r.s_start, r.s_end)
    )
  order by r.s_start;
end;
$function$;

comment on function public.horarios_libres_del_tutor(integer, date, date) is
  'M18 · los horarios libres del tutor que llama, sin producto, para elegir las fechas al publicar una clase grupal: la lógica de get_available_slots con todas sus reglas activas, paso de 30 min y la duración dada (30..240). Solo futuro, ventana de 92 días como mucho (por defecto hoy..hoy+42). La defensa de verdad sigue siendo publicar_clase_grupal y candado_agenda_entre_tablas().';

revoke execute on function public.horarios_libres_del_tutor(integer, date, date) from public, anon;
grant  execute on function public.horarios_libres_del_tutor(integer, date, date) to authenticated;


-- ── 2 · M32 · quién salió por el equipo ────────────────────────────────────
alter table public.bookings
  add column if not exists sacado_por_admin_at timestamptz;

comment on column public.bookings.sacado_por_admin_at is
  'G4/M32 · cuándo el equipo sacó a este alumno de una clase grupal (admin_sacar_de_clase_grupal). Null si no lo sacó nadie del equipo';

create or replace function public.admin_sacar_de_clase_grupal(p_booking uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bk     record;
  v_claims text;
  v_sub    text;
  v_res    jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'solo el equipo puede sacar a un alumno de una clase' using errcode = '42501';
  end if;

  select b.id, b.tutor_id, b.pricing_model into v_bk
    from public.bookings b where b.id = p_booking for update;
  if v_bk.id is null or v_bk.pricing_model <> 'group' then
    raise exception 'esta reserva no es de una clase grupal' using errcode = 'check_violation';
  end if;

  v_claims := current_setting('request.jwt.claims', true);
  v_sub    := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_bk.tutor_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_bk.tutor_id::text, true);

  v_res := public.cancel_booking(
    p_booking,
    coalesce(nullif(trim(p_motivo), ''), 'El equipo de Enséñame Ya canceló tu cupo'));

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  -- M32 · la marca para la lista de inscritos. Solo si cancel_booking no
  -- abortó: un fallo arriba se lleva la transacción entera.
  update public.bookings set sacado_por_admin_at = now() where id = p_booking;

  return v_res;
end;
$$;

comment on function public.admin_sacar_de_clase_grupal(uuid, text) is
  'G4 · el admin cancela el cupo de UN alumno en una clase grupal (cancel_booking como el tutor de la reserva): 100 % antes de empezar; con el ciclo empezado, M1, la parte de las fechas que faltan. El alumno recibe NTF-55 con el motivo. M32: marca bookings.sacado_por_admin_at.';

revoke execute on function public.admin_sacar_de_clase_grupal(uuid, text) from public, anon;
grant  execute on function public.admin_sacar_de_clase_grupal(uuid, text) to authenticated;


-- ── 3 · P48 · tutor_students ve la baja de una grupal pagada ───────────────
create or replace function public.tutor_students(p_student_id uuid default null)
returns table (
  student_id  uuid,
  full_name   text,
  avatar_path text,
  timezone    text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Sirve a las dos pantallas: sin argumento devuelve TODOS los alumnos del
  -- tutor (el listado resuelve los nombres de una vez, no uno por reserva) y
  -- con argumento, uno solo (la ficha de N-14). El filtro de relación es el
  -- mismo en ambos casos: pasarle un uuid cualquiera no salta el `exists`.
  select p.id, p.full_name, p.avatar_path, p.timezone
    from public.profiles p
   where (p_student_id is null or p.id = p_student_id)
     and exists (
       select 1
         from public.bookings b
        where b.tutor_id   = (select auth.uid())
          and b.student_id = p.id
          and (
            b.status in ('pending_acceptance', 'confirmed', 'in_progress', 'completed')
            or b.completed_at is not null   -- reembolsada DESPUÉS de darse
            -- P48 · el cupo de una grupal que se llegó a cobrar, aunque luego
            -- se diera de baja: el tutor ya lo vio en la lista de inscritos.
            or (b.pricing_model = 'group'
                and exists (
                  select 1 from public.payments py
                   where py.booking_id = b.id
                     and py.status in ('paid', 'partially_refunded', 'refunded')
                ))
          )
     );
$$;

comment on function public.tutor_students(uuid) is
  'N-13/N-14: identidad mínima del alumno (nombre, foto, zona horaria) para el tutor que comparte con él una reserva viva, o (P48) un cupo grupal que se llegó a cobrar aunque luego se diera de baja. SECURITY DEFINER con columnas explícitas porque `profiles` es own-only y su grant de select es de tabla entera.';

revoke execute on function public.tutor_students(uuid) from public;
revoke execute on function public.tutor_students(uuid) from anon;
grant  execute on function public.tutor_students(uuid) to authenticated;
