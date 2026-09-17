-- ============================================================================
-- Registro de aprendizaje por ALUMNO — el espejo de `tutor_teaching_record`.
--
-- POR QUÉ. El panel tenía catorce secciones y ninguna respondía «¿quién está
-- estudiando aquí?». Del lado tutor sí: `/admin/tutores` (quién puede dar
-- clase) y `/admin/tutores/actividad` (quién la da de verdad, MN-14a,
-- `20260820160000`). Del lado alumno no había NADA — el nombre del alumno solo
-- aparecía reserva a reserva en `/admin/bookings`, sin una sola agregación. Lo
-- pidió el cliente el 17-sep: «no veo el reporte de estudiantes».
--
-- ⚠️ NO CONFUNDIR CON `/admin/reportes`, que es la bandeja de MODERACIÓN
-- (`conversation_reports`, EY-189). El parecido de los nombres es justo lo que
-- llevó al cliente a preguntar dónde estaba esto.
--
-- QUIÉN ES «ALUMNO» AQUÍ, que es la decisión de fondo. `handle_new_user`
-- inserta el rol `alumno` a TODO el mundo en el alta (`20260606121500`) y
-- `review_tutor` AÑADE `tutor` sin quitárselo (`20260715170000`): filtrar por
-- `role = 'alumno'` devolvería también a los 8 tutores. El corte es la
-- presencia de `tutor_profiles`, no el rol, y por una razón concreta: es
-- exactamente el criterio de `/admin/tutores`. Así las dos listas son
-- COMPLEMENTARIAS —cada cuenta sale en una y solo en una— y nadie desaparece
-- de las dos ni se cuenta dos veces. Efecto lateral asumido: quien abrió el
-- alta de tutor y la dejó a medias vive en la lista de tutores, que es donde
-- alguien tiene que decidir sobre él.
--
-- INTERNA, igual que su gemela: cuánto estudia alguien, con cuántos tutores y
-- cuánto se ha gastado no se publica en ninguna superficie pública.
-- ============================================================================

-- ── El índice, gemelo del de MN-14a ─────────────────────────────────────────
-- Mismo razonamiento palabra por palabra que `sessions_tutor_impartidas_idx`
-- (`20260820160000`): parcial sobre los dos estados TERMINALES de M5 —una fila
-- entra una vez y no vuelve a moverse, así que el índice no paga el trasiego
-- `scheduled → in_progress → completed` ni indexa el futuro— y compuesto
-- `(student_id, start_at)` para que el rango de fechas y los extremos
-- primera/última salgan de la MISMA franja. Sin `include`, por el mismo motivo
-- que allí: `sessions` se reescribe sin parar y el index-only acabaría yendo al
-- heap igualmente, con el índice el doble de grande.
--
-- ⚠️ El `where` de la consulta de abajo repite esta lista de estados palabra
-- por palabra. Si divergen, el planner deja de poder usar el índice y esto se
-- convierte en un seq scan silencioso.
create index if not exists sessions_alumno_tomadas_idx
  on public.sessions (student_id, start_at)
  where status in ('completed', 'no_show');

comment on index public.sessions_alumno_tomadas_idx is
  'Registro de aprendizaje por alumno. Gemelo de sessions_tutor_impartidas_idx, por el otro extremo de la sesión: parcial sobre los dos estados terminales y compuesto (student_id, start_at).';

-- ── La RPC ───────────────────────────────────────────────────────────────────
create or replace function public.student_learning_record(
  p_from date default null,
  p_to   date default null
)
returns table (
  student_id        uuid,
  -- El nombre viaja con la fila por lo mismo que en la RPC de tutores: la
  -- función devuelve a TODOS los alumnos ordenados por actividad y sin él
  -- haría falta una segunda consulta con un `in (…)` de todos los uuid. No
  -- amplía superficie: el admin ya lee estos nombres por RLS
  -- (`profiles_select_admin`) y aquí no entra nadie que no sea admin.
  alumno_nombre     text,
  alta              timestamptz,
  -- `account_suspensions` con `lifted_at is null` — el mismo criterio que
  -- `/admin/reportes`, que es desde donde se suspende (`20260828130000`).
  suspendido        boolean,
  -- Reservas que llegaron a valer algo: el mismo criterio que `pair_booking_stats`
  -- (`20260820130000`). Va aparte de `tomadas` porque un alumno que acaba de
  -- pagar tres mentorías para la semana que viene tiene `tomadas = 0`, y sin
  -- esta columna se leería como una cuenta muerta.
  reservas          integer,
  -- ⚠️ Las dos siguientes NO SE SUMAN. Mismo motivo que en el registro de
  -- tutores: si un `no_show` cuenta como clase es DP-08, que sigue abierta.
  tomadas           integer,
  no_shows          integer,
  tutores_distintos integer,
  -- Por moneda, como `admin_stats` (RN-13): sumar monedas distintas da un
  -- número sin sentido. `[{currency, gastado, devuelto}]`, nunca null.
  gastado           jsonb,
  primera_clase     timestamptz,
  ultima_clase      timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := case when p_from is null then '-infinity'::timestamptz
                             else p_from::timestamptz end;
  -- `to` inclusivo: se elige un DÍA, no un instante → +1 día en exclusiva.
  -- Misma convención (y mismo código) que `admin_stats`, `tutor_teaching_record`
  -- y `admin_bookings_by_category`.
  v_to   timestamptz := case when p_to is null then 'infinity'::timestamptz
                             else (p_to + 1)::timestamptz end;
begin
  -- ⚠️ ESTA GUARDA ES LA BARRERA, NO EL GRANT. «admin» no es un rol de Postgres
  -- sino una fila de `user_roles`, y el panel llama con la sesión del admin y la
  -- clave ANON, así que PostgREST publica esta función para cualquier
  -- autenticado. Lo único que impide a un alumno leer el historial de compra de
  -- todos los demás es esta línea. Va PRIMERO, antes de leer nada.
  if not public.has_role('admin') then
    raise exception 'solo un admin ve el registro de alumnos'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.created_at,
    exists (
      select 1 from public.account_suspensions sus
      where sus.user_id = p.id and sus.lifted_at is null
    ),
    b.n_reservas,
    s.n_tomadas,
    s.n_no_shows,
    s.n_tutores,
    m.gastado,
    s.t_primera,
    s.t_ultima
  from public.profiles p
  -- Laterales: un agregado SIN `group by` devuelve siempre exactamente una fila
  -- (ceros y nulos si el alumno no tiene nada), así que el `on true` no puede
  -- meter nulos en los contadores. Mismo patrón que el lateral `r` de
  -- `tutor_teaching_record`. Y se parte de `profiles`, no de `sessions`: con un
  -- `group by student_id` desaparecería el alumno que se registró y no ha
  -- comprado nada, que es precisamente a quien hay que mirar.
  left join lateral (
    select
      count(*) filter (where se.status = 'completed')::int as n_tomadas,
      count(*) filter (where se.status = 'no_show')::int   as n_no_shows,
      -- Tutores distintos con los que llegó a dar clase. Los `no_show` no
      -- entran: nadie abrió esa sala, así que ese tutor no le enseñó nada.
      count(distinct se.tutor_id) filter (where se.status = 'completed')::int as n_tutores,
      -- `start_at` y no `completed_at`, razonado en `20260820160000`:
      -- `completed_at` es el reloj del cron y es null en las `no_show`.
      min(se.start_at) filter (where se.status = 'completed') as t_primera,
      max(se.start_at) filter (where se.status = 'completed') as t_ultima
    from public.sessions se
    where se.student_id = p.id
      and se.status in ('completed', 'no_show')   -- ⚠️ = predicado del índice
      and se.start_at >= v_from
      and se.start_at <  v_to
  ) s on true
  left join lateral (
    select count(*)::int as n_reservas
    from public.bookings bo
    where bo.student_id = p.id
      and bo.created_at >= v_from
      and bo.created_at <  v_to
      and (bo.status in ('pending_acceptance', 'confirmed', 'in_progress', 'completed')
           or bo.completed_at is not null)
  ) b on true
  left join lateral (
    select coalesce(
             jsonb_agg(jsonb_build_object(
               'currency', x.currency,
               'gastado',  x.gastado,
               'devuelto', x.devuelto
             ) order by x.currency),
             '[]'::jsonb
           ) as gastado
    from (
      select pa.currency,
             -- ⚠️ `gross_amount − credit_amount`, no `gross_amount` a secas.
             -- Esto NO es el GMV de `/admin/stats`: es lo que salió del bolsillo
             -- de ESTA persona, y un crédito de referido o un regalo no salió
             -- de él. `gross_amount` ya lleva dentro el cargo por servicio del
             -- 5 % desde `20260916120000`, que también lo paga el alumno, así
             -- que esa parte sí cuenta.
             sum(pa.gross_amount - pa.credit_amount)
               filter (where pa.status in ('paid', 'partially_refunded', 'refunded')) as gastado,
             sum(pa.refunded_amount) as devuelto
      from public.payments pa
      join public.bookings bo2 on bo2.id = pa.booking_id
      where bo2.student_id = p.id
        and pa.created_at >= v_from
        and pa.created_at <  v_to
      group by pa.currency
      having sum(pa.gross_amount - pa.credit_amount)
               filter (where pa.status in ('paid', 'partially_refunded', 'refunded')) is not null
    ) x
  ) m on true
  -- Quien tiene el rol de alumno y NO es tutor. Ver la cabecera: el corte es
  -- `tutor_profiles` —el mismo criterio de `/admin/tutores`— y no el rol,
  -- porque el rol `alumno` lo tiene todo el mundo.
  where exists (
          select 1 from public.user_roles ur
          where ur.user_id = p.id and ur.role = 'alumno'
        )
    and not exists (
          select 1 from public.tutor_profiles tp
          where tp.profile_id = p.id
        )
  -- Los más activos primero: es una lista para mirar de un vistazo quién
  -- estudia, no un directorio alfabético.
  order by s.n_tomadas desc, b.n_reservas desc, s.t_ultima desc nulls last, p.full_name;
end;
$$;

comment on function public.student_learning_record(date, date) is
  'Registro de aprendizaje por alumno (reservas pagadas, mentorías tomadas, no-shows, tutores distintos, gastado por moneda, primera y última clase) dentro de una ventana opcional de fechas. Espejo de tutor_teaching_record por el otro extremo de la sesión. MÉTRICA INTERNA: guard has_role(''admin'') DENTRO de la función — el grant a authenticated es inevitable (el panel llama con la clave ANON) y no es la barrera. "Alumno" = tiene el rol alumno y NO tiene fila en tutor_profiles, que es el criterio complementario de /admin/tutores. `gastado` es gross_amount − credit_amount: lo que salió de su bolsillo, no el GMV.';

-- Gotcha de US-605: `execute` es de PUBLIC por defecto y PUBLIC incluye a
-- `anon`; un `grant … to authenticated` suelto NO se lo quita.
revoke execute on function public.student_learning_record(date, date) from public;
revoke execute on function public.student_learning_record(date, date) from anon;
grant  execute on function public.student_learning_record(date, date) to authenticated;

-- Sin grant a `service_role` (regla de oro 9, por el lado de no conceder de
-- más): hoy solo la llama la pantalla del admin, que va con la clave ANON y la
-- sesión del admin. Ningún job la necesita. Si algún día uno la llamara, el
-- grant va en SU migración — y esa guarda de `has_role` no la pasaría.
