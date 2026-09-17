-- ============================================================================
-- El registro de docencia también lleva CONTACTO — la simétrica de
-- `20260917150000`, que hizo lo mismo del lado alumno esta misma tarde.
--
-- POR QUÉ. El cliente pidió los contactos «y también para los tutores». La
-- asimetría no tenía defensa: `/admin/alumnos` enseña correo y teléfono y
-- `/admin/tutores/actividad`, que es la misma pantalla por el otro extremo de la
-- sesión, no enseñaba ninguno de los dos.
--
-- ⚠️ DROP + CREATE, no `create or replace`: añadir columnas al `returns table`
-- es cambiar el tipo de retorno, y PostgreSQL lo rechaza («cannot change return
-- type of existing function»). Primo hermano de la regla de oro 12. El `drop`
-- se lleva los `grant execute`: se reponen abajo, íntegros.
--
-- ⚠️ EL TELÉFONO DEL TUTOR NO SIGNIFICA LO MISMO QUE EL DEL ALUMNO. Del lado
-- alumno, su ausencia delata una cuenta nacida en el checkout de invitado. Aquí
-- no: `/tutor/onboarding` también lo exige, así que a un tutor aprobado no
-- debería faltarle — y si falta, es una cuenta sembrada o anterior a RN-44. La
-- pantalla no inventa una explicación que no tiene.
-- ============================================================================

drop function if exists public.tutor_teaching_record(date, date);

create function public.tutor_teaching_record(
  p_from date default null,
  p_to   date default null
)
returns table (
  tutor_id          uuid,
  tutor_nombre      text,
  -- El contacto, por lo mismo que en la gemela: sin él haría falta una segunda
  -- consulta con un `in (…)` de todos los uuid — y para el correo, ni eso, que
  -- `auth.users` no lo lee ningún rol de la API.
  correo            text,
  telefono          text,
  aprobado          boolean,
  -- ⚠️ Las dos siguientes NO SE SUMAN AQUÍ. Ver DP-08.
  impartidas        integer,
  no_shows          integer,
  alumnos_distintos integer,
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
  -- ⚠️ LA BARRERA, NO EL GRANT, y desde hoy con correos y teléfonos detrás.
  -- Va PRIMERO, antes de leer nada.
  if not public.has_role('admin') then
    raise exception 'solo un admin ve el registro de clases impartidas'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    tp.profile_id,
    -- `profiles.full_name` es el nombre real; `display_name` es la copia
    -- publicable de DD-01 y hace de red si el perfil se quedó sin nombre.
    coalesce(p.full_name, tp.display_name),
    u.email::text,
    p.phone,
    tp.approval_status = 'approved',
    r.n_impartidas,
    r.n_no_shows,
    r.n_alumnos,
    r.t_primera,
    r.t_ultima
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.profile_id
  -- `join` y no `left join`: `profiles` nace de un trigger sobre `auth.users`,
  -- así que un perfil sin cuenta es un estado imposible.
  join auth.users u on u.id = p.id
  left join lateral (
    select
      -- El `where` repite la MISMA lista de estados que el predicado del índice
      -- parcial, palabra por palabra: si diverge, el planner deja de poder
      -- usarlo y esto pasa a ser un seq scan silencioso.
      count(*) filter (where s.status = 'completed')::int as n_impartidas,
      count(*) filter (where s.status = 'no_show')::int   as n_no_shows,
      count(distinct s.student_id) filter (where s.status = 'completed')::int as n_alumnos,
      min(s.start_at) filter (where s.status = 'completed') as t_primera,
      max(s.start_at) filter (where s.status = 'completed') as t_ultima
    from public.sessions s
    where s.tutor_id = tp.profile_id
      and s.status in ('completed', 'no_show')
      and s.start_at >= v_from
      and s.start_at <  v_to
  ) r on true
  order by r.n_impartidas desc, r.t_ultima desc nulls last, p.full_name;
end;
$$;

comment on function public.tutor_teaching_record(date, date) is
  'MN-14a: registro de docencia por tutor (contacto, clases impartidas, no-shows, alumnos distintos, primera y última clase) dentro de una ventana opcional de fechas. MÉTRICA INTERNA con DATO PERSONAL dentro desde 20260917160000: guard `has_role(''admin'')` DENTRO de la función — el grant a `authenticated` es inevitable (el panel llama con la clave ANON) y no es la barrera. El correo sale de auth.users por join; profiles no tiene esa columna. `impartidas` y `no_shows` van separadas porque DP-08 sigue abierta. Si algún día algo de esto se quiere en el perfil público, va por `tutors_public` con `security_invoker` y SIN el contacto, nunca abriendo esta función a `anon`.';

-- Repuestos tras el `drop`. El revoke de PUBLIC no sobra: `execute` es de
-- PUBLIC por defecto y PUBLIC incluye a `anon` (gotcha de US-605).
revoke execute on function public.tutor_teaching_record(date, date) from public;
revoke execute on function public.tutor_teaching_record(date, date) from anon;
grant  execute on function public.tutor_teaching_record(date, date) to authenticated;
