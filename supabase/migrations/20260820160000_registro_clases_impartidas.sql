-- ============================================================================
-- L3-3 · MN-14a — El registro de clases impartidas por tutor.
--
-- QUÉ ES ESTO Y QUÉ NO ES. El punto MN-14 de la minuta pide una campaña con
-- beneficios bilaterales «considerando el registro de las últimas clases
-- impartidas». El motor de promociones (MN-14b / L3-4) está BLOQUEADO por P-9
-- —quién absorbe el descuento, plataforma o tutor— porque esa respuesta decide
-- si `tutor_net_amount` cambia, y eso entra en `create_booking`, el snapshot
-- financiero congelado (regla de oro 2). Aquí no se escribe ni una línea de
-- eso.
--
-- Lo que sí se entrega hoy es la mitad barata, que **sirve aunque la campaña no
-- se apruebe nunca**: saber qué tutores están activos, cuántas clases han dado,
-- a cuánta gente distinta y cuándo fue la última. Es una SEGMENTACIÓN de
-- solo lectura. No crea tablas, no crea columnas y no toca dinero.
--
-- ⚠️⚠️ MÉTRICA INTERNA (ADMIN), NO PÚBLICA — DECISIÓN TOMADA, NO SE REABRE.
-- Enseñar «142 clases impartidas» en la ficha pública del tutor es una decisión
-- de PRODUCTO que el cliente no ha tomado, y cambia lo que la plataforma
-- publica de una persona (su volumen de trabajo, su antigüedad, cuántos alumnos
-- distintos ha tenido). Si algún día se quiere pública, el sitio es la vista
-- `tutors_public` —`with (security_invoker = true)` y columnas explícitas,
-- precedente `20260804120000`— y NUNCA esta función abierta a `anon`: una RPC
-- `SECURITY DEFINER` sin guard es exactamente la fuga que hubo ayer con
-- `pair_booking_stats` (`20260820150000`, punto 1).
--
-- ── ⚠️ EL ESQUEMA MANDA: LO QUE `no_show` SIGNIFICA DE VERDAD ───────────────
-- El enunciado de la ficha da por hecho que el esquema distingue «el tutor
-- faltó» de «el alumno faltó». NO LO HACE, y conviene saberlo antes de usar
-- este número para repartir premios. Quien escribe los estados terminales es
-- `close_expired_sessions()` (`20260716120000`), y su regla es literalmente
-- una sola línea:
--
--     status = case when s.status = 'in_progress' then 'completed' else 'no_show' end
--
-- O sea: `no_show` = **NADIE abrió la sala** dentro de la ventana. Si UNO de
-- los dos entró, la sesión pasó a `in_progress` en `join_session()` y al vencer
-- la ventana se cierra como `completed` — aunque el otro no llegara a
-- aparecer. Por tanto:
--   · `no_shows`   = clases que no las abrió nadie. No dice de quién fue la
--                    culpa, porque la base de datos no lo sabe.
--   · `impartidas` = sesiones que terminaron en `completed`, o sea que alguien
--                    entró (o que el tutor las cerró a mano con
--                    `complete_session()`, que acepta cerrar desde `scheduled`).
-- Ninguna de las dos es «el tutor dio la clase» en sentido estricto. Es lo que
-- hay HOY; medir asistencia de verdad exige registrar participación por
-- persona, y eso es otra ficha.
--
-- ── ⚠️ DP-08 SIGUE ABIERTA: LAS DOS COLUMNAS VAN SEPARADAS ─────────────────
-- Si un `no_show` cuenta o no como clase impartida es DP-08 (Doc 2 §2.13), sin
-- responder desde junio, y su default operable («no-show del alumno = sesión
-- consumida») ni siquiera es simétrico. Esta función NO decide: devuelve
-- `impartidas` y `no_shows` por separado y quien consuma suma o no suma. Si
-- mañana DP-08 se resuelve, se cambia el PINTADO, no el esquema ni esta
-- función. No las juntes aquí.
--
-- ── Por qué `start_at` y no `completed_at` ─────────────────────────────────
-- `primera_clase` / `ultima_clase` salen de `sessions.start_at`, que es el
-- reloj de la clase. `completed_at` es el reloj de la CONTABILIDAD: lo pone el
-- cron `close-expired-sessions` cuando le toca correr (cada 5 min, y no antes
-- de `end_at + 10 min`), o el tutor al cerrar antes de tiempo — dos clases
-- idénticas pueden tener `completed_at` separados por un cuarto de hora por
-- razones que no tienen que ver con la clase. Además `completed_at` es NULL en
-- las `no_show` (esa misma línea del `case` no lo toca), así que una métrica
-- colgada de él no se puede extender al otro lado sin cambiar de significado.
-- `start_at` es `not null` por esquema y no depende de cuándo corrió un job.
--
-- ── El rango es una ventana, y se aplica a TODA la fila ────────────────────
-- Con `p_from`/`p_to`, `ultima_clase` es la última clase DENTRO de la ventana,
-- no la última en absoluto: un tutor que dio 200 clases hasta marzo y ninguna
-- desde entonces sale con ceros y nulos en la ventana de 90 días. Es la lectura
-- correcta para segmentar («quién está activo AHORA») y es la misma convención
-- que `admin_stats` (`20260715190000`). Para el histórico completo, se llama
-- sin parámetros.
-- ============================================================================

-- ── El índice ────────────────────────────────────────────────────────────────
-- La consulta de abajo es, por tutor: «cuenta y saca los extremos de sus
-- sesiones en estado terminal-con-clase, dentro de un rango de fechas».
--
-- Los tres índices que ya tiene `sessions` (`20260709140000`) no sirven:
--   · `sessions_tutor_id_idx (tutor_id)` trae TODAS las sesiones del tutor,
--     incluidas las `scheduled` del futuro y las `cancelled`, y deja el filtro
--     de estado y el de fecha para el heap. En un tutor veterano eso es
--     recorrer toda su agenda histórica para contar una parte.
--   · `sessions_status_idx (status)` tiene cinco valores: como columna líder no
--     descarta casi nada.
--   · `sessions_start_at_idx (start_at)` ordena bien pero mezcla a todos los
--     tutores; habría que leer el rango de fechas entero para quedarse con uno.
--
-- Así que: parcial y compuesto.
--   · `(tutor_id, start_at)` en ese orden — `tutor_id` es la igualdad (una
--     franja por tutor) y `start_at` es a la vez el filtro de rango y el
--     min/max, así que `primera_clase` y `ultima_clase` son los dos extremos de
--     la MISMA franja: no hay que ordenar nada aparte.
--   · `where status in ('completed', 'no_show')` — son exactamente los dos
--     estados que esta métrica mira, y tienen una propiedad que los hace ideales
--     para un índice parcial: en M5 (Doc 2 §2.8) son TERMINALES. Una fila entra
--     en este índice una sola vez, cuando acaba, y no vuelve a salir ni a
--     moverse. El índice no paga el trasiego `scheduled → in_progress →
--     completed` de cada sesión ni indexa el futuro, que es la mitad viva de la
--     tabla y la que más se actualiza.
--
-- Deliberadamente SIN `include (status, student_id)` para forzar un index-only
-- scan: un scan index-only necesita el visibility map al día, y `sessions` es
-- una tabla que se reescribe constantemente (`sessions_set_updated_at` dispara
-- en cada cambio de estado, y la purga de grabaciones toca filas viejas), así
-- que los bits del VM se limpian y el «index-only» acaba yendo al heap
-- igualmente — con el índice el doble de grande. Mismo criterio que
-- `20260715190000`: para el volumen del MVP la agregación en vivo es
-- instantánea, y se optimiza cuando el histórico pese de verdad, no por si
-- acaso.
create index if not exists sessions_tutor_impartidas_idx
  on public.sessions (tutor_id, start_at)
  where status in ('completed', 'no_show');

comment on index public.sessions_tutor_impartidas_idx is
  'MN-14a: registro de docencia por tutor. Parcial sobre los dos estados TERMINALES que cuentan como clase-que-ocurrió (una fila entra una vez y no vuelve a moverse) y compuesto (tutor_id, start_at) para que el rango de fechas y los extremos primera/última salgan de la misma franja.';

-- ── La RPC ───────────────────────────────────────────────────────────────────
create or replace function public.tutor_teaching_record(
  p_from date default null,
  p_to   date default null
)
returns table (
  tutor_id          uuid,
  -- El nombre viaja con la fila a propósito: la función devuelve a TODOS los
  -- tutores ordenados por actividad, así que sin él quien la consuma no puede
  -- pintar un top-N sin una segunda consulta con `in (…)` de todos los uuid.
  -- No amplía superficie: el admin ya lee estos mismos nombres por RLS en
  -- `/admin/tutores`, y aquí no entra nadie que no sea admin.
  tutor_nombre      text,
  -- Solo `approved` recibe reservas (RN-04). Es lo mínimo para no confundir «no
  -- ha dado clases» con «todavía no puede darlas»; el estado completo
  -- (`pending` / `rejected` / `suspended`) está a un clic, en su ficha.
  aprobado          boolean,
  -- ⚠️ Las dos siguientes NO SE SUMAN AQUÍ. Ver DP-08 en la cabecera.
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
  -- `to` inclusivo: se elige un DÍA, no un instante → +1 día en exclusiva.
  -- Misma convención (y mismo código) que `admin_stats` / `admin_bookings_by_category`.
  v_to   timestamptz := case when p_to is null then 'infinity'::timestamptz
                             else (p_to + 1)::timestamptz end;
begin
  -- ⚠️ ESTA GUARDA ES LA BARRERA, NO EL GRANT. `authenticated` es el único rol
  -- de la API que puede tener el grant —«admin» no es un rol de Postgres sino
  -- una fila de `user_roles`, y el panel llama con la sesión del admin y la
  -- clave ANON—, así que PostgREST publica esta función para cualquier
  -- autenticado. Lo que le impide leer el rendimiento de todos los tutores de
  -- la plataforma es esta línea y solo esta línea. Es justo lo que le faltaba a
  -- `pair_booking_stats` ayer (`20260820150000`, punto 1): allí el grant era el
  -- único freno, y no había ninguno. Si algún día se toca la firma de esta
  -- función, esta comprobación va PRIMERO, antes de leer nada.
  if not public.has_role('admin') then
    raise exception 'solo un admin ve el registro de clases impartidas'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    tp.profile_id,
    -- `profiles.full_name` es el nombre real (lo que el admin necesita para
    -- identificar a la persona); `display_name` es la copia publicable de DD-01
    -- y aquí solo hace de red por si el perfil se quedó sin nombre.
    coalesce(p.full_name, tp.display_name),
    tp.approval_status = 'approved',
    r.n_impartidas,
    r.n_no_shows,
    r.n_alumnos,
    r.t_primera,
    r.t_ultima
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.profile_id
  -- Lateral: un agregado SIN `group by` devuelve siempre exactamente una fila
  -- (ceros y nulos si el tutor no tiene nada), así que el `left join … on true`
  -- no puede introducir nulos en los contadores y `impartidas` nunca es null.
  -- Mismo patrón que el lateral `st` de `my_conversations` (`20260820130000`).
  --
  -- Se parte de `tutor_profiles` y no de `sessions` A PROPÓSITO: un `group by
  -- tutor_id` sobre `sessions` haría desaparecer al tutor con cero clases, y
  -- «los que nunca han dado una» es precisamente uno de los segmentos que la
  -- campaña querría mirar. Aquí un tutor sin actividad sale con ceros, que es
  -- un dato, no una ausencia.
  left join lateral (
    select
      -- El `where` de abajo repite la MISMA lista de estados que el predicado
      -- del índice parcial, palabra por palabra: si diverge, el planner deja de
      -- poder usarlo y esto se convierte en un seq scan silencioso.
      count(*) filter (where s.status = 'completed')::int as n_impartidas,
      count(*) filter (where s.status = 'no_show')::int   as n_no_shows,
      -- Alumnos distintos a los que se les llegó a dar clase. Los `no_show` no
      -- entran: nadie abrió esa sala, así que contar a ese alumno como «alumno
      -- al que dio clase» sería contar una clase que no ocurrió.
      count(distinct s.student_id) filter (where s.status = 'completed')::int as n_alumnos,
      min(s.start_at) filter (where s.status = 'completed') as t_primera,
      max(s.start_at) filter (where s.status = 'completed') as t_ultima
    from public.sessions s
    where s.tutor_id = tp.profile_id
      and s.status in ('completed', 'no_show')
      and s.start_at >= v_from
      and s.start_at <  v_to
  ) r on true
  -- Los más activos primero: es una lista para segmentar, no un directorio.
  order by r.n_impartidas desc, r.t_ultima desc nulls last, p.full_name;
end;
$$;

comment on function public.tutor_teaching_record(date, date) is
  'MN-14a: registro de docencia por tutor (clases impartidas, no-shows, alumnos distintos, primera y última clase) dentro de una ventana opcional de fechas. MÉTRICA INTERNA: guard `has_role(''admin'')` DENTRO de la función — el grant a `authenticated` es inevitable (el panel llama con la clave ANON) y no es la barrera. `impartidas` y `no_shows` van separadas porque DP-08 sigue abierta. Si algún día se quiere en el perfil público, va por `tutors_public` con `security_invoker`, nunca abriendo esta función a `anon`.';

-- Gotcha de US-605, que `admin_gmv_weekly` se dejó a medias: `execute` es de
-- PUBLIC por defecto, y PUBLIC incluye a `anon`. Un `grant … to authenticated`
-- suelto NO se lo quita. Se revoca explícitamente y se concede solo a
-- `authenticated`, que es quien trae la sesión del admin.
revoke execute on function public.tutor_teaching_record(date, date) from public;
revoke execute on function public.tutor_teaching_record(date, date) from anon;
grant  execute on function public.tutor_teaching_record(date, date) to authenticated;

-- Sin grant a `service_role`, y no es un olvido (regla de oro 9): hoy no la
-- llama ningún job. El día que un Route Handler con `service_role` quiera
-- segmentar tutores para la campaña, hará falta añadirlo — y eso no lo ve ni el
-- build ni el typecheck: revienta en ejecución con `permission denied`, que es
-- exactamente lo que mordió tres veces el 6-ago.
