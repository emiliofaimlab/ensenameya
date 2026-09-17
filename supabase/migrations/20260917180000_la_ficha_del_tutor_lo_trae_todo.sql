-- ============================================================================
-- La ficha del tutor: el espejo de `20260917170000`, por el otro lado del aula.
--
-- POR QUÉ. El cliente pidió para los tutores lo mismo que acababa de pedir para
-- los alumnos: lista corta y «ficha completa en modal». Esta función deja de
-- devolver el registro de docencia y devuelve el expediente.
--
-- ⚠️ QUÉ **NO** ENTRA AQUÍ, Y ES LA DECISIÓN IMPORTANTE DE ESTA MIGRACIÓN:
--
--   · **Los datos bancarios.** `tutor_payout_accounts` guarda el número de
--     cuenta, el documento de identidad y la fecha de nacimiento del tutor. De
--     esa tabla salen TRES cosas y solo tres: que hay cuenta configurada, el
--     país y los cuatro últimos dígitos (`bank_account_last4`, que existe
--     precisamente para esto). Un expediente que se abre de un clic y se
--     descarga en CSV no es sitio para un IBAN. Quien necesite el dato completo
--     para conciliar un pago lo tiene en `/admin/payouts`, con su motivo.
--
--   · **Los documentos KYC.** Sale el RECUENTO por estado, no los ficheros. Los
--     enlaces al bucket privado se firman con TTL de 5 minutos a propósito
--     (S-19: «se ven, no se comparten»), y firmar seis por cada uno de los 32
--     tutores en cada carga de la lista sería absurdo además de peligroso. Los
--     documentos se revisan donde se revisan: `/admin/tutores/[id]`, que es
--     SCR-AD05 y tiene las acciones.
--
-- O sea: esta ficha es para SABER, y la pantalla de revisión es para HACER. No
-- se solapan a propósito.
--
-- ⚠️ DROP + CREATE, como sus dos hermanas de hoy: cambiar el `returns table` es
-- cambiar el tipo de retorno. Primo hermano de la regla de oro 12. Grants
-- repuestos abajo, revoke de PUBLIC incluido.
-- ============================================================================

-- ⚠️ SE TIRAN LAS DOS FIRMAS, la vieja y la que crea esta misma migración.
-- `drop function` identifica por ARGUMENTOS, así que nombrar solo `(date, date)`
-- deja viva cualquier `(date, date, uuid)` anterior y el `create` de abajo muere
-- con 42723 «already exists with same argument types» — una SOBRECARGA, que es
-- el mismo agujero de la regla de oro 12 por el otro lado. Pasa de verdad en
-- cuanto la migración se reaplica: un `migration repair` + `db push` mientras se
-- depura ya basta.
drop function if exists public.tutor_teaching_record(date, date);
drop function if exists public.tutor_teaching_record(date, date, uuid);

create function public.tutor_teaching_record(
  p_from     date default null,
  p_to       date default null,
  p_tutor_id uuid default null
)
returns table (
  -- ── Identidad y contacto ──────────────────────────────────────────────────
  tutor_id            uuid,
  tutor_nombre        text,
  nombre_publico      text,
  correo              text,
  telefono            text,
  zona_horaria        text,
  alta                timestamptz,
  -- ── Perfil público ────────────────────────────────────────────────────────
  titular             text,
  nivel               text,
  categorias          jsonb,   -- ["Matemáticas", "Inglés"]
  redes               jsonb,
  academia            text,
  -- ── Estado de la cuenta ───────────────────────────────────────────────────
  aprobado            boolean,
  estado_aprobacion   text,
  aprobado_el         timestamptz,
  notas_aprobacion    text,
  identidad           text,
  suspendido          boolean,
  suspension          jsonb,
  baja                jsonb,
  -- Recuento de los 6 documentos de C-14, NUNCA los ficheros.
  documentos          jsonb,   -- [{estado, n}]
  -- ── Lo que ofrece ─────────────────────────────────────────────────────────
  mentorias_publicadas integer,
  mentorias_detalle    jsonb,  -- [{estado, n}]
  precio_desde         bigint,
  precio_hasta         bigint,
  moneda               text,
  franjas_disponibles  integer,
  -- ── Docencia ──────────────────────────────────────────────────────────────
  -- ⚠️ `impartidas` y `no_shows` NO se suman: DP-08 sigue abierta.
  impartidas          integer,
  no_shows            integer,
  canceladas          integer,
  alumnos_distintos   integer,
  alumnos             jsonb,   -- [{nombre, mentorias}] — con quién repite
  primera_clase       timestamptz,
  ultima_clase        timestamptz,
  proxima_clase       timestamptz,
  -- ── Reputación ────────────────────────────────────────────────────────────
  nota_media          numeric,
  resenas             integer,
  -- ── Dinero ────────────────────────────────────────────────────────────────
  tier                text,
  tier_split_pct      numeric,
  generado            jsonb,   -- [{currency, bruto, neto_tutor, comision}]
  payouts             jsonb,   -- [{estado, n, importe, currency}]
  metodo_de_cobro     text,
  -- ⚠️ SOLO estas tres. Ver la cabecera: ni cuenta, ni documento, ni fecha
  -- de nacimiento.
  cuenta_configurada  boolean,
  cuenta_pais         text,
  cuenta_ultimos4     text,
  -- ── Legal ─────────────────────────────────────────────────────────────────
  terminos            jsonb
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
  -- ⚠️ LA BARRERA, NO EL GRANT. Detrás hay correos, teléfonos y cuánto cobra
  -- cada tutor. Va PRIMERO, antes de leer nada.
  if not public.has_role('admin') then
    raise exception 'solo un admin ve la ficha de los tutores'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    tp.profile_id,
    -- `full_name` es el nombre real, que es lo que el admin necesita para
    -- identificar a la persona; `display_name` es la copia publicable de DD-01
    -- y va aparte, no como sustituto.
    coalesce(p.full_name, tp.display_name),
    tp.display_name,
    u.email::text,
    p.phone,
    p.timezone,
    p.created_at,
    tp.headline,
    tp.teaching_level::text,
    cat.lista,
    tp.socials,
    ac.name,
    tp.approval_status = 'approved',
    tp.approval_status::text,
    tp.approved_at,
    tp.approval_notes,
    tp.identity_verification_status::text,
    sus.activa,
    sus.detalle,
    del.detalle,
    doc.lista,
    pr.n_publicadas,
    pr.detalle,
    pr.precio_min,
    pr.precio_max,
    pr.moneda,
    av.n_franjas,
    s.n_impartidas,
    s.n_no_shows,
    c.n_canceladas,
    s.n_alumnos,
    al.lista,
    s.t_primera,
    s.t_ultima,
    n.t_proxima,
    tp.rating_avg,
    tp.rating_count,
    ti.name,
    ti.split_pct,
    din.generado,
    po.lista,
    pref.method::text,
    cta.hay,
    cta.pais,
    cta.ultimos4,
    te.detalle
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.profile_id
  -- `join` y no `left join`: `profiles` nace de un trigger sobre `auth.users`.
  join auth.users u on u.id = p.id
  left join public.tutor_tiers ti on ti.id = tp.tier_id
  left join public.academies ac on ac.id = tp.academy_id
  left join public.tutor_payout_preferences pref on pref.tutor_id = tp.profile_id

  -- Categorías que enseña. `order by` dentro del agregado para que dos
  -- descargas seguidas del CSV salgan iguales.
  left join lateral (
    select coalesce(jsonb_agg(c2.name order by c2.name), '[]'::jsonb) as lista
    from public.tutor_categories tc
    join public.categories c2 on c2.id = tc.category_id
    where tc.tutor_id = tp.profile_id
  ) cat on true

  -- Recuento de KYC por estado. NUNCA `storage_path` ni `link_url`: ver la
  -- cabecera. Son los 6 documentos de C-14 (cv, título, identidad,
  -- certificado, diploma y corte de notas).
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('estado', z.status, 'n', z.n)
                              order by z.status), '[]'::jsonb) as lista
    from (select vd.status, count(*)::int as n
          from public.verification_documents vd
          where vd.tutor_id = tp.profile_id
          group by vd.status) z
  ) doc on true

  left join lateral (
    select
      count(*) filter (where pd.status = 'active')::int as n_publicadas,
      coalesce(
        (select jsonb_agg(jsonb_build_object('estado', y.status, 'n', y.n) order by y.status)
         from (select pd2.status, count(*)::int as n
               from public.products pd2 where pd2.tutor_id = tp.profile_id
               group by pd2.status) y),
        '[]'::jsonb) as detalle,
      min(pd.price_amount) filter (where pd.status = 'active') as precio_min,
      max(pd.price_amount) filter (where pd.status = 'active') as precio_max,
      -- La moneda de sus mentorías activas. Con varias se queda la primera por
      -- orden alfabético: es un dato de contexto para el precio, no una suma.
      --
      -- ⚠️ El `::text` NO es adorno. `products.currency` es `char(3)`, que
      -- PostgreSQL devuelve como `bpchar`, y un `returns table` que declara
      -- `text` REVIENTA con 42804 —«structure of query does not match function
      -- result type»— en EJECUCIÓN, no al crear la función. Mismo motivo en
      -- `cuenta_pais` (char(2)) y `cuenta_ultimos4`. Es la regla de oro 11 por
      -- otra puerta: crear la función valida la forma, no el contenido.
      -- Los paréntesis son obligatorios: el cast va sobre la expresión
      -- ENTERA. `min(x)::text filter (…)` es un error de sintaxis, porque el
      -- `filter` pertenece al agregado y no a su resultado.
      (min(pd.currency) filter (where pd.status = 'active'))::text as moneda
    from public.products pd
    where pd.tutor_id = tp.profile_id
  ) pr on true

  left join lateral (
    select count(*)::int as n_franjas
    from public.availability_rules ar
    where ar.tutor_id = tp.profile_id and ar.is_active
  ) av on true

  left join lateral (
    select
      count(*) > 0 as activa,
      (jsonb_agg(jsonb_build_object('desde', a.suspended_at, 'motivo', a.reason)
                 order by a.suspended_at desc) -> 0) as detalle
    from public.account_suspensions a
    where a.user_id = tp.profile_id and a.lifted_at is null
  ) sus on true

  left join lateral (
    select (jsonb_agg(jsonb_build_object(
              'estado', d.status, 'solicitada', d.requested_at, 'completada', d.completed_at
            ) order by d.requested_at desc) -> 0) as detalle
    from public.account_deletion_requests d
    where d.user_id = tp.profile_id and d.status <> 'cancelled'
  ) del on true

  -- ⚠️ El `where` repite la MISMA lista de estados que el predicado del índice
  -- parcial `sessions_tutor_impartidas_idx`, palabra por palabra.
  left join lateral (
    select
      count(*) filter (where s2.status = 'completed')::int as n_impartidas,
      count(*) filter (where s2.status = 'no_show')::int   as n_no_shows,
      count(distinct s2.student_id) filter (where s2.status = 'completed')::int as n_alumnos,
      min(s2.start_at) filter (where s2.status = 'completed') as t_primera,
      max(s2.start_at) filter (where s2.status = 'completed') as t_ultima
    from public.sessions s2
    where s2.tutor_id = tp.profile_id
      and s2.status in ('completed', 'no_show')
      and s2.start_at >= v_from and s2.start_at < v_to
  ) s on true

  -- Aparte, para no romper el predicado del índice de arriba.
  left join lateral (
    select count(*)::int as n_canceladas
    from public.sessions s2
    where s2.tutor_id = tp.profile_id and s2.status = 'cancelled'
      and s2.start_at >= v_from and s2.start_at < v_to
  ) c on true

  -- La próxima NO se acota al período: «qué tiene por delante» es de hoy.
  left join lateral (
    select min(s2.start_at) as t_proxima
    from public.sessions s2
    where s2.tutor_id = tp.profile_id and s2.status = 'scheduled'
      and s2.start_at > now()
  ) n on true

  -- Con qué alumnos repite. Tope de 5: es una ficha, no un informe.
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('nombre', y.nombre, 'mentorias', y.n)
                              order by y.n desc, y.nombre), '[]'::jsonb) as lista
    from (
      select coalesce(sp.full_name, 'Alumno sin nombre') as nombre, count(*)::int as n
      from public.sessions s2
      join public.profiles sp on sp.id = s2.student_id
      where s2.tutor_id = tp.profile_id and s2.status = 'completed'
        and s2.start_at >= v_from and s2.start_at < v_to
      group by 1 order by 2 desc, 1 limit 5
    ) y
  ) al on true

  -- Lo que ha generado. Tres cifras y no una: `bruto` es lo que pagó el alumno,
  -- `neto_tutor` lo que le toca a él y `comision` lo que se queda la
  -- plataforma. Desde `20260916120000` el bruto lleva dentro el cargo por
  -- servicio del 5 %, así que bruto ≠ neto + comisión y eso es correcto.
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
             'currency', x.currency, 'bruto', x.bruto,
             'neto_tutor', x.neto, 'comision', x.comision
           ) order by x.currency), '[]'::jsonb) as generado
    from (
      select pa.currency,
             sum(pa.gross_amount)      as bruto,
             sum(pa.tutor_net_amount)  as neto,
             sum(pa.platform_fee_amount) as comision
      from public.payments pa
      join public.bookings bo on bo.id = pa.booking_id
      where bo.tutor_id = tp.profile_id
        and pa.status in ('paid', 'partially_refunded', 'refunded')
        and pa.created_at >= v_from and pa.created_at < v_to
      group by pa.currency
    ) x
  ) din on true

  -- Sus payouts por estado. Sin ventana de fechas: lo que se le debe es de hoy.
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
             'estado', y.status, 'n', y.n, 'importe', y.total, 'currency', y.currency
           ) order by y.status), '[]'::jsonb) as lista
    from (select po2.status::text, count(*)::int as n,
                 sum(po2.amount) as total, po2.currency
          from public.payouts po2
          where po2.tutor_id = tp.profile_id
          group by po2.status, po2.currency) y
  ) po on true

  -- ⚠️ TRES COLUMNAS Y NINGUNA MÁS de `tutor_payout_accounts`. Ver la cabecera.
  left join lateral (
    select
      count(*) > 0 as hay,
      -- `::text` por lo mismo que la moneda de arriba: son `char(n)`.
      min(pac.country)::text             as pais,
      min(pac.bank_account_last4)::text  as ultimos4
    from public.tutor_payout_accounts pac
    where pac.tutor_id = tp.profile_id
  ) cta on true

  left join lateral (
    select (jsonb_agg(jsonb_build_object('version', ta.version, 'aceptados', ta.accepted_at)
                      order by ta.accepted_at desc) -> 0) as detalle
    from public.terms_acceptances ta
    where ta.user_id = tp.profile_id
  ) te on true

  where p_tutor_id is null or tp.profile_id = p_tutor_id
  -- Los más activos primero: es una lista para mirar de un vistazo quién da
  -- clase, no un directorio alfabético.
  order by s.n_impartidas desc nulls last, s.t_ultima desc nulls last, p.full_name;
end;
$$;

comment on function public.tutor_teaching_record(date, date, uuid) is
  'Ficha completa del tutor (identidad, contacto, perfil público, estado de aprobación, recuento de KYC, mentorías publicadas, disponibilidad, docencia, alumnos con los que repite, reputación, tier, dinero generado, payouts y método de cobro) dentro de una ventana opcional de fechas. Alimenta la lista, el modal y el CSV de /admin/tutores/actividad. DATO PERSONAL: guard has_role(''admin'') DENTRO — el grant a authenticated es inevitable (el panel llama con la clave ANON) y no es la barrera. ⚠️ NO devuelve datos bancarios (solo hay-cuenta, país y últimos 4 de tutor_payout_accounts) ni rutas de documentos KYC (solo el recuento por estado): los primeros porque esto se descarga en CSV y los segundos porque sus enlaces se firman a 5 minutos por S-19. Para revisar documentos y aprobar, SCR-AD05 (/admin/tutores/[id]).';

revoke execute on function public.tutor_teaching_record(date, date, uuid) from public;
revoke execute on function public.tutor_teaching_record(date, date, uuid) from anon;
grant  execute on function public.tutor_teaching_record(date, date, uuid) to authenticated;
