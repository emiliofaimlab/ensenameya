-- ============================================================================
-- La ficha del alumno: TODO lo que el panel puede saber de una persona.
--
-- POR QUÉ. El cliente, sobre la pantalla de esta mañana: la lista se queda en
-- nombre y correo, y el detalle se abre aparte con «toda la información del
-- estudiante… mientras más podamos mejor». Así que esta función deja de
-- devolver una fila de métricas y pasa a devolver la ficha entera.
--
-- ⚠️ DROP + CREATE por tercera vez hoy, y por el mismo motivo de siempre:
-- cambiar el `returns table` es cambiar el tipo de retorno y PostgreSQL lo
-- rechaza. Primo hermano de la regla de oro 12. Los `grant execute` se reponen
-- abajo.
--
-- POR QUÉ UNA SOLA FUNCIÓN Y NO UNA DE LISTA + OTRA DE DETALLE. Porque el CSV
-- pide exactamente lo mismo que el detalle, pero de todos a la vez, y el modal
-- pide lo mismo de uno. Con dos funciones habría dos sitios donde se define qué
-- es «toda la información» y se separarían el día que alguien toque uno solo.
-- Aquí la pantalla carga la ficha completa de todos y el modal no tiene que
-- pedir nada al abrirse: se abre instantáneo y sin un `route.ts` de por medio.
--
-- ⚠️ EL TECHO DE ESA DECISIÓN, escrito para el día que moleste: son ~1,5 KB de
-- JSON por alumno. Con los 19 de dev son 30 KB y no se nota; con mil serían
-- 1,5 MB en cada carga de la lista y entonces hay que partir esto en dos —la
-- lista se queda con `p_resumen := true` y el modal pide su fila con
-- `p_student_id`—. Los dos parámetros ya están puestos para que ese día sea
-- cambiar quién los pasa, no reescribir la función.
--
-- LO QUE NO ESTÁ Y NO VA A ESTAR, aunque «todo» suene a todo:
--   · **El chat.** `conversations` y `messages` no tienen política de admin y
--     está razonado en su migración (`20260817210000`): «el chat no se lee por
--     soporte». La única puerta sigue siendo un reporte.
--   · **La navegación.** `tutor_views` tampoco, y también a propósito
--     (`20260827140000`): «un administrador no necesita saber por dónde navega
--     nadie». Por eso «tutores favoritos» aquí se calcula con CLASES DADAS, que
--     es lo que el alumno hizo, no lo que miró.
-- ============================================================================

drop function if exists public.student_learning_record(date, date);

create function public.student_learning_record(
  p_from       date default null,
  p_to         date default null,
  -- Una sola fila. Hoy nadie lo usa —la pantalla trae la lista entera— pero es
  -- la mitad del plan de arriba para cuando el volumen obligue.
  p_student_id uuid default null
)
returns table (
  -- ── Identidad y contacto ──────────────────────────────────────────────────
  student_id          uuid,
  alumno_nombre       text,
  correo              text,
  telefono            text,
  zona_horaria        text,
  alta                timestamptz,
  -- ── Qué dijo de sí mismo en el registro ───────────────────────────────────
  objetivo            text,
  onboarding_completo boolean,
  intereses           jsonb,   -- ["Matemáticas", "Inglés"]
  -- ── Estado de la cuenta ───────────────────────────────────────────────────
  suspendido          boolean,
  suspension          jsonb,   -- {desde, motivo} o null
  baja                jsonb,   -- {estado, solicitada, completada} o null
  -- ── Actividad ─────────────────────────────────────────────────────────────
  reservas            integer,
  reservas_detalle    jsonb,   -- [{estado, n}]
  tomadas             integer,
  no_shows            integer,
  canceladas          integer,
  tutores_distintos   integer,
  tutores             jsonb,   -- [{nombre, mentorias}] — los «favoritos»
  primera_clase       timestamptz,
  ultima_clase        timestamptz,
  proxima_clase       timestamptz,
  -- ── Dinero ────────────────────────────────────────────────────────────────
  gastado             jsonb,   -- [{currency, gastado, devuelto}]
  pagos               integer,
  medios_de_pago      jsonb,   -- ["stripe", "dlocalgo"]
  credito_disponible  jsonb,   -- [{currency, saldo}]
  -- ── Lo que ha dejado por escrito ──────────────────────────────────────────
  resenas             integer,
  nota_media          numeric,
  -- ── Referidos y legal ─────────────────────────────────────────────────────
  codigo_referido     text,
  vino_referido       boolean,
  terminos            jsonb    -- {version, aceptados} o null
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
  -- ⚠️ LA BARRERA, NO EL GRANT — y detrás de ella ya no hay unas métricas, hay
  -- el expediente completo de una persona. Va PRIMERO, antes de leer nada.
  if not public.has_role('admin') then
    raise exception 'solo un admin ve la ficha de los alumnos'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    p.phone,
    p.timezone,
    p.created_at,
    p.primary_goal,
    p.onboarding_complete,
    i.lista,
    sus.activa,
    sus.detalle,
    del.detalle,
    b.n_reservas,
    b.detalle,
    s.n_tomadas,
    s.n_no_shows,
    c.n_canceladas,
    s.n_tutores,
    t.lista,
    s.t_primera,
    s.t_ultima,
    n.t_proxima,
    m.gastado,
    m.n_pagos,
    m.medios,
    cr.saldo,
    rv.n_resenas,
    rv.media,
    p.referral_code,
    p.referral_converted_at is not null,
    te.detalle
  from public.profiles p
  -- `join` y no `left join`: `profiles` nace de un trigger sobre `auth.users`,
  -- así que un perfil sin cuenta es un estado imposible.
  join auth.users u on u.id = p.id

  -- Intereses del onboarding. `order by` dentro del agregado para que el CSV
  -- sea reproducible: sin él, dos exportaciones seguidas pueden diferir en el
  -- orden y parecer que cambió algo.
  left join lateral (
    select coalesce(jsonb_agg(cat.name order by cat.name), '[]'::jsonb) as lista
    from public.student_interests si
    join public.categories cat on cat.id = si.category_id
    where si.student_id = p.id
  ) i on true

  -- Suspensión vigente. `lifted_at is null` es el criterio del índice parcial
  -- y el mismo que usa `/admin/reportes`, que es desde donde se suspende.
  left join lateral (
    select
      count(*) > 0 as activa,
      (jsonb_agg(jsonb_build_object(
         'desde',  a.suspended_at,
         'motivo', a.reason
       ) order by a.suspended_at desc) -> 0) as detalle
    from public.account_suspensions a
    where a.user_id = p.id and a.lifted_at is null
  ) sus on true

  -- Baja de cuenta: la PROGRAMADA (que aún se puede cancelar) manda sobre la
  -- ya ejecutada, porque es la que pide una decisión.
  left join lateral (
    select (jsonb_agg(jsonb_build_object(
              'estado',     d.status,
              'solicitada', d.requested_at,
              'completada', d.completed_at
            ) order by d.requested_at desc) -> 0) as detalle
    from public.account_deletion_requests d
    where d.user_id = p.id and d.status <> 'cancelled'
  ) del on true

  -- Reservas que llegaron a valer algo (criterio de `pair_booking_stats`) y el
  -- desglose por estado, que es lo que explica el número de al lado.
  left join lateral (
    select
      count(*) filter (
        where bo.status in ('pending_acceptance','confirmed','in_progress','completed')
           or bo.completed_at is not null
      )::int as n_reservas,
      coalesce(
        (select jsonb_agg(jsonb_build_object('estado', z.status, 'n', z.n) order by z.status)
         from (select bo2.status, count(*)::int as n
               from public.bookings bo2
               where bo2.student_id = p.id
                 and bo2.created_at >= v_from and bo2.created_at < v_to
               group by bo2.status) z),
        '[]'::jsonb) as detalle
    from public.bookings bo
    where bo.student_id = p.id
      and bo.created_at >= v_from and bo.created_at < v_to
  ) b on true

  -- Sesiones terminadas. ⚠️ El `where` repite la MISMA lista de estados que el
  -- predicado del índice parcial `sessions_alumno_tomadas_idx`, palabra por
  -- palabra: si diverge, el planner deja de poder usarlo.
  left join lateral (
    select
      count(*) filter (where se.status = 'completed')::int as n_tomadas,
      count(*) filter (where se.status = 'no_show')::int   as n_no_shows,
      count(distinct se.tutor_id) filter (where se.status = 'completed')::int as n_tutores,
      -- `start_at` y no `completed_at`: el segundo es el reloj del cron y es
      -- null en las `no_show` (razonado en `20260820160000`).
      min(se.start_at) filter (where se.status = 'completed') as t_primera,
      max(se.start_at) filter (where se.status = 'completed') as t_ultima
    from public.sessions se
    where se.student_id = p.id
      and se.status in ('completed', 'no_show')
      and se.start_at >= v_from and se.start_at < v_to
  ) s on true

  -- Canceladas aparte: no caben en el lateral de arriba sin romper el predicado
  -- del índice, y mezclarlas ahí lo convertiría en un seq scan.
  left join lateral (
    select count(*)::int as n_canceladas
    from public.sessions se
    where se.student_id = p.id and se.status = 'cancelled'
      and se.start_at >= v_from and se.start_at < v_to
  ) c on true

  -- La próxima clase NO se acota a la ventana: preguntar «¿qué tiene por
  -- delante?» con un filtro de los últimos 30 días no tiene sentido.
  left join lateral (
    select min(se.start_at) as t_proxima
    from public.sessions se
    where se.student_id = p.id and se.status = 'scheduled'
      and se.start_at > now()
  ) n on true

  -- «Tutores favoritos» = con quién ha dado más clases. Con CLASES y no con
  -- visitas a propósito: `tutor_views` no se lee por admin (`20260827140000`) y
  -- lo que el alumno hizo dice más que lo que miró. Tope de 5: es una ficha,
  -- no un informe.
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
             'nombre',    y.nombre,
             'mentorias', y.n
           ) order by y.n desc, y.nombre), '[]'::jsonb) as lista
    from (
      select coalesce(tp2.full_name, 'Tutor sin nombre') as nombre, count(*)::int as n
      from public.sessions se
      join public.profiles tp2 on tp2.id = se.tutor_id
      where se.student_id = p.id and se.status = 'completed'
        and se.start_at >= v_from and se.start_at < v_to
      group by 1
      order by 2 desc, 1
      limit 5
    ) y
  ) t on true

  -- Dinero. `gross_amount − credit_amount`: lo que salió de SU bolsillo, no el
  -- GMV — un crédito de referido o un regalo no salió de él. El cargo por
  -- servicio del 5 % sí va dentro (`20260916120000`).
  left join lateral (
    select
      coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'currency', x.currency, 'gastado', x.gastado, 'devuelto', x.devuelto
                ) order by x.currency)
         from (
           select pa.currency,
                  sum(pa.gross_amount - pa.credit_amount)
                    filter (where pa.status in ('paid','partially_refunded','refunded')) as gastado,
                  sum(pa.refunded_amount) as devuelto
           from public.payments pa
           join public.bookings bo2 on bo2.id = pa.booking_id
           where bo2.student_id = p.id
             and pa.created_at >= v_from and pa.created_at < v_to
           group by pa.currency
           having sum(pa.gross_amount - pa.credit_amount)
                    filter (where pa.status in ('paid','partially_refunded','refunded')) is not null
         ) x),
        '[]'::jsonb) as gastado,
      coalesce(
        (select count(*)::int
         from public.payments pa
         join public.bookings bo2 on bo2.id = pa.booking_id
         where bo2.student_id = p.id and pa.status in ('paid','partially_refunded','refunded')
           and pa.created_at >= v_from and pa.created_at < v_to),
        0) as n_pagos,
      coalesce(
        (select jsonb_agg(distinct pa.provider)
         from public.payments pa
         join public.bookings bo2 on bo2.id = pa.booking_id
         where bo2.student_id = p.id and pa.provider is not null
           and pa.status in ('paid','partially_refunded','refunded')
           and pa.created_at >= v_from and pa.created_at < v_to),
        '[]'::jsonb) as medios
  ) m on true

  -- Crédito que le queda por gastar. Mismo criterio que `20260912110000`:
  -- `active` + destino `cobro`. Sin ventana de fechas — un saldo es de HOY.
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('currency', w.currency, 'saldo', w.saldo)
                              order by w.currency), '[]'::jsonb) as saldo
    from (
      select cd.currency, sum(cd.amount - cd.consumed_amount)::bigint as saldo
      from public.credits cd
      where cd.beneficiary_id = p.id and cd.status = 'active' and cd.destino = 'cobro'
      group by cd.currency
      having sum(cd.amount - cd.consumed_amount) > 0
    ) w
  ) cr on true

  -- Reseñas que ha DEJADO (no recibido: un alumno no recibe).
  left join lateral (
    select count(*)::int as n_resenas, round(avg(r.rating), 2) as media
    from public.reviews r
    where r.student_id = p.id
  ) rv on true

  -- La última aceptación de términos, que es la que vale.
  left join lateral (
    select (jsonb_agg(jsonb_build_object('version', ta.version, 'aceptados', ta.accepted_at)
                      order by ta.accepted_at desc) -> 0) as detalle
    from public.terms_acceptances ta
    where ta.user_id = p.id
  ) te on true

  -- «Alumno» = tiene el rol y NO tiene ficha de tutor. El rol no sirve de corte:
  -- `handle_new_user` se lo da a todo el mundo y `review_tutor` añade `tutor`
  -- sin quitarlo. Con este criterio esta lista y `/admin/tutores` son
  -- complementarias: cada cuenta sale en una y solo en una.
  where (p_student_id is null or p.id = p_student_id)
    and exists (
          select 1 from public.user_roles ur
          where ur.user_id = p.id and ur.role = 'alumno'
        )
    and not exists (
          select 1 from public.tutor_profiles tp
          where tp.profile_id = p.id
        )
  order by s.n_tomadas desc nulls last, b.n_reservas desc nulls last,
           s.t_ultima desc nulls last, p.full_name;
end;
$$;

comment on function public.student_learning_record(date, date, uuid) is
  'Ficha completa del alumno (identidad, contacto, intereses, estado de la cuenta, actividad, tutores con los que más ha estudiado, dinero, crédito, reseñas, referidos y términos) dentro de una ventana opcional de fechas. Sin p_student_id devuelve a todos, que es lo que alimentan la lista, el modal y el CSV de /admin/alumnos. DATO PERSONAL: el guard has_role(''admin'') va DENTRO — el grant a authenticated es inevitable (el panel llama con la clave ANON) y no es la barrera. NO incluye chat ni navegación: conversations/messages y tutor_views no tienen política de admin, y en los dos casos está razonado en su migración. "Alumno" = tiene el rol alumno y NO tiene fila en tutor_profiles.';

revoke execute on function public.student_learning_record(date, date, uuid) from public;
revoke execute on function public.student_learning_record(date, date, uuid) from anon;
grant  execute on function public.student_learning_record(date, date, uuid) to authenticated;
