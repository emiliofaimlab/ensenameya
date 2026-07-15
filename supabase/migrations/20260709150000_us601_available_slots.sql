-- ============================================================================
-- Enséñame Ya — US-601 (S2): slots disponibles de un producto.
-- Función controlada (SECURITY DEFINER): resuelve la disponibilidad real del
-- tutor combinando availability_rules − exceptions(block) + exceptions(open),
-- menos las sesiones ya ocupadas (S-41, no doble-reserva), solo futuro.
--
-- Por qué en la BD y no en JS:
--   · `AT TIME ZONE tz` interpreta la hora de pared del tutor → instante UTC con
--     DST correcto (RN-01/02), sin depender de una librería de fechas.
--   · el filtro anti-doble-reserva lee `sessions` de OTROS alumnos, invisibles
--     al cliente por RLS → requiere privilegio (por eso SECURITY DEFINER).
-- Devuelve instantes UTC (timestamptz); el cliente los pinta en su hora local.
-- weekday: 0=domingo (extract(dow) coincide con availability_rules).
-- ============================================================================

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
  v_tutor_id uuid;
  v_tz       text;
  v_duration int;
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
    cross join lateral generate_series(
      0,
      floor(extract(epoch from (r.end_time - r.start_time)) / (v_duration * 60))::int - 1
    ) as i(n)
  ),
  -- Slots extra desde excepciones 'open' con rango horario.
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
    -- S-41: no solapa una sesión ya agendada del tutor.
    and not exists (
      select 1 from public.sessions se
      where se.tutor_id = v_tutor_id
        and se.status not in ('cancelled', 'no_show')
        and tstzrange(se.start_at, se.end_at) && tstzrange(r.s_start, r.s_end)
    )
  order by r.s_start;
end;
$$;

-- ponytail: slots back-to-back (paso = duración) desde el inicio de cada ventana;
-- si hace falta una grilla fija (cada :00/:30) o buffers entre clases, se añade
-- aquí. Ventanas que cruzan medianoche no se contemplan (poco realista en tutoría).

grant execute on function public.get_available_slots(uuid, date, date) to authenticated;
