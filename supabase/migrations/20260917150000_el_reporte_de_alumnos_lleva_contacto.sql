-- ============================================================================
-- El reporte de alumnos enseña el CONTACTO (correo y teléfono).
--
-- POR QUÉ. El cliente, sobre la pantalla que se estrenó esta misma mañana: «no
-- me salen sus contactos, solo los nombres. No puedo ver correos ni números».
-- Tiene razón y no era un olvido — era que el correo NO SE PUEDE LEER por RLS:
-- `profiles` no tiene columna `email` y `auth.users` no lo lee ningún rol de la
-- API. Hasta hoy, NINGUNA pantalla del panel enseñaba el correo de nadie.
--
-- POR QUÉ AQUÍ Y NO CON `service_role` EN LA PANTALLA. La otra vía era bajar a
-- `createAdminClient()` y la Auth Admin API (`listUsers`) desde el Server
-- Component. Se descartó por cara y por frágil: `listUsers` pagina de 50 en 50,
-- así que serían N/50 viajes HTTP EN CADA RENDER —con mil alumnos, veinte— para
-- un dato que está a un `join` de distancia. Esta función ya es
-- `security definer` y ya tiene el guard de admin: el `join` a `auth.users` no
-- abre ninguna puerta que no estuviera abierta, y no cuesta nada.
--
-- ⚠️ ESTO ES UN DROP + CREATE, NO UN `create or replace`. PostgreSQL no deja
-- cambiar el tipo de retorno de una función existente («cannot change return
-- type of existing function»), y añadir dos columnas al `returns table` es
-- justo eso. Primo hermano de la regla de oro 12 (allí era añadir un ARGUMENTO,
-- que además crea una sobrecarga y da `PGRST203`). Y el `drop` se lleva por
-- delante los `grant execute`: se reponen abajo, íntegros.
--
-- ⚠️ CUENTAS DADAS DE BAJA: `anonymize_account` (`20260826230000`) reescribe el
-- correo a `cuenta-eliminada+<uuid>@ensenameya.invalid`. Saldrá tal cual, que es
-- exactamente lo que debe verse: la fila sigue ahí por rastro financiero y su
-- correo real ya no existe en ningún sitio.
-- ============================================================================

drop function if exists public.student_learning_record(date, date);

create function public.student_learning_record(
  p_from date default null,
  p_to   date default null
)
returns table (
  student_id        uuid,
  alumno_nombre     text,
  -- El contacto. Viaja con la fila por lo mismo que el nombre: sin él, quien
  -- consuma esto necesita una segunda consulta con un `in (…)` de todos los
  -- uuid — y para el correo, ni siquiera podría hacerla.
  correo            text,
  -- `profiles.phone` (E.164, CHECK de RN-44). Es NULABLE de verdad y su ausencia
  -- SIGNIFICA algo: el paso 3 del onboarding lo exige, así que un alumno sin
  -- teléfono no terminó el registro por la puerta normal — o entró por el
  -- checkout de invitado, que da el onboarding por hecho para no romper el pago
  -- (`/api/checkout/invitado`). La pantalla lo distingue en vez de pintar «—».
  telefono          text,
  alta              timestamptz,
  suspendido        boolean,
  reservas          integer,
  tomadas           integer,
  no_shows          integer,
  tutores_distintos integer,
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
  v_to   timestamptz := case when p_to is null then 'infinity'::timestamptz
                             else (p_to + 1)::timestamptz end;
begin
  -- ⚠️ LA BARRERA, NO EL GRANT — y ahora con más motivo que ayer: detrás de esta
  -- línea hay una lista de correos y teléfonos. Va PRIMERO, antes de leer nada.
  if not public.has_role('admin') then
    raise exception 'solo un admin ve el registro de alumnos'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    p.phone,
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
  -- `join` y no `left join`: `profiles` nace de un trigger sobre `auth.users`,
  -- así que un perfil sin su cuenta es un estado imposible. Si algún día
  -- apareciera, que desaparezca de la lista es mejor que pintar media fila.
  join auth.users u on u.id = p.id
  left join lateral (
    select
      count(*) filter (where se.status = 'completed')::int as n_tomadas,
      count(*) filter (where se.status = 'no_show')::int   as n_no_shows,
      count(distinct se.tutor_id) filter (where se.status = 'completed')::int as n_tutores,
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
             -- `gross_amount − credit_amount`: lo que salió de SU bolsillo, no
             -- el GMV. El cargo por servicio del 5 % va dentro (`20260916120000`).
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
  where exists (
          select 1 from public.user_roles ur
          where ur.user_id = p.id and ur.role = 'alumno'
        )
    and not exists (
          select 1 from public.tutor_profiles tp
          where tp.profile_id = p.id
        )
  order by s.n_tomadas desc, b.n_reservas desc, s.t_ultima desc nulls last, p.full_name;
end;
$$;

comment on function public.student_learning_record(date, date) is
  'Registro de aprendizaje por alumno (contacto, reservas pagadas, mentorías tomadas, no-shows, tutores distintos, gastado por moneda, primera y última clase) dentro de una ventana opcional de fechas. Espejo de tutor_teaching_record. MÉTRICA INTERNA con DATO PERSONAL dentro: el guard has_role(''admin'') va DENTRO de la función — el grant a authenticated es inevitable (el panel llama con la clave ANON) y no es la barrera. El correo sale de auth.users por join, no de profiles, que no tiene esa columna; es la única superficie del panel que lo enseña. "Alumno" = tiene el rol alumno y NO tiene fila en tutor_profiles, el criterio complementario de /admin/tutores. `gastado` es gross_amount − credit_amount: lo que salió de su bolsillo, no el GMV.';

-- El `drop` de arriba se llevó los grants por delante. Se reponen íntegros,
-- incluido el revoke de PUBLIC — que incluye a `anon` — del gotcha de US-605.
revoke execute on function public.student_learning_record(date, date) from public;
revoke execute on function public.student_learning_record(date, date) from anon;
grant  execute on function public.student_learning_record(date, date) to authenticated;
