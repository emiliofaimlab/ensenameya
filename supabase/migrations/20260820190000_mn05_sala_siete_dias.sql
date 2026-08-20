-- ============================================================================
-- MN-05 · La sala abre 7 días antes y sigue abierta 7 días después.
--
-- Respuesta del cliente a P-6 (20-ago), y son DOS respuestas, no una:
--   1. la ventana de acceso pasa de 10 min/10 min a **7 días/7 días**;
--   2. preguntado si aceptaba que el tutor cobrase esos mismos días más tarde,
--      dijo que **NO**.
--
-- Esa segunda respuesta es la que da forma a toda esta migración, porque hoy
-- «¿puedo entrar a la sala?» y «¿la mentoría terminó?» son EL MISMO `+10
-- minutes` por accidente histórico, escrito en dos sitios distintos:
--   · `session_access_window()` (20260716120000), que lee `join_session`;
--   · `close_expired_sessions()` (misma migración), con el umbral A MANO.
--
-- Y el segundo es el que manda de verdad: es quien pasa la sesión a
-- `completed`/`no_show`, la reserva a `completed` y **fija `bookings.completed_at`**
-- — el reloj del que cuelga el dinero del tutor. `build_payout_for_tutor` y
-- `run_payout_batch` (20260716140000) exigen literalmente
-- `b.completed_at <= now() - retención`. Mover ese umbral a 7 días retrasaría
-- TODOS los payouts una semana, contra el §12 del contrato publicado (pagos
-- entre 7 y 14 días tras la clase).
--
-- ── LA SEPARACIÓN, EN UNA FRASE ─────────────────────────────────────────────
--   · **El estado de la sesión gobierna la CONTABILIDAD.** No se mueve.
--   · **La ventana gobierna el ACCESO.** Se amplía a 7+7.
-- Son dos relojes distintos y a partir de aquí tienen dos nombres distintos:
-- `session_live_window()` (la clase está ocurriendo) y `session_access_window()`
-- (la sala admite gente). Que hasta hoy coincidieran no era diseño, era que
-- nadie los había tenido que separar.
--
-- ⚠️ **CONSECUENCIA DIRECTA, Y ES LO MENOS INTUITIVO DE TODO ESTO:**
-- si la sesión se cierra a los 10 min pero la sala sigue abierta 7 días,
-- entonces `join_session` TIENE que dejar entrar a una sesión que ya está
-- `completed` o `no_show`. Hasta hoy las rechazaba con «la sesión ya terminó»,
-- y con la ventana larga esa línea dejaría la mitad de MN-05 sin efecto: el
-- alumno vería el botón durante 7 días y el server le diría que no cada vez.
-- Lo que SÍ sigue cerrando la puerta es `cancelled` — entrar a la sala de una
-- reserva cancelada no debe poderse, y ahí no hay nada que matizar.
--
-- ── LO QUE **NO** CAMBIA, Y CONVIENE QUE QUEDE ESCRITO ──────────────────────
--   · `close_expired_sessions()` cierra en `end_at + 10 min`, igual que ayer.
--     Se reescribe abajo SOLO para que el umbral deje de ser un literal suelto
--     y pase a llamarse `session_live_window()`. Mismo comportamiento, mismo
--     minuto: si esta migración cambiara un solo segundo de ese cierre, estaría
--     incumpliendo la respuesta del cliente.
--   · El §17 del contrato («si el alumno no asiste, no hay reembolso») NO se
--     abre más de lo que ya estaba. Se comprobó, y este es el resultado:
--     `cancel_booking` (20260817170000) solo acepta la reserva en
--     `pending_payment`, `pending_acceptance` o `confirmed`. Como el cierre no
--     se mueve, la reserva sigue pasando a `completed` en `end_at + 10 min`
--     (más lo que tarde el cron, que corre cada 5 min), y a partir de ahí ya no
--     es cancelable. El hueco que existe —cancelar al 50 % entre el fin de la
--     clase y el cierre, ≤15 min— es el de HOY, no lo abre esta migración y no
--     se toca aquí porque cerrarlo es tocar `cancel_booking`, que es dinero y
--     es otra ficha.
--   · El `exp` del meeting-token de Daily. MN-05a (`05d1286`) lo desacopló del
--     de la sala justamente para poder llegar a este día sin firmar credenciales
--     válidas durante una semana. Aquí no se deshace: la sala vive 7 días, el
--     token sigue siendo corto. Ver `src/lib/daily.ts`.
-- ============================================================================


-- ── 1) La ventana de ACCESO: 7 días a cada lado ─────────────────────────────
--
-- Se mantiene el nombre porque el nombre siempre fue correcto: esta función es
-- «¿la sala admite a alguien?». Lo que estaba mal era que además hiciera de
-- «¿la clase está pasando?», que es lo que se le quita justo debajo.
--
-- Simétrica (7 antes y 7 después) porque así lo pidió el cliente. No hay
-- ninguna razón técnica para que los dos lados sean iguales.
--
-- ⚠️ Si mañana pide 14 antes y 2 después, hay que tocar TRES cosas, no una:
--   1. esta función,
--   2. `ACCESS_WINDOW_DAYS` en `src/lib/room-window.ts` — el respaldo del
--      cliente para las filas anteriores a MN-05, que decide si las pantallas
--      ofrecen el botón «Entrar a la sala»,
--   3. el backfill de más abajo, que hay que volver a correr: las columnas ya
--      materializadas NO se recalculan solas.
-- Mientras 1 y 2 no coincidan, la pantalla ofrece un botón que el servidor
-- rechaza. (Los copys visibles salen del mismo módulo, así que no cuentan.)
create or replace function public.session_access_window(
  p_start timestamptz,
  p_end   timestamptz
)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(p_start - interval '7 days', p_end + interval '7 days', '[]');
$$;

comment on function public.session_access_window(timestamptz, timestamptz) is
  'MN-05 (P-6, 20-ago): ventana en la que la SALA admite gente — 7 días antes del inicio y 7 después del fin. Es ACCESO, no contabilidad: quien decide si la mentoría terminó es session_live_window() / close_expired_sessions(), y ese reloj no se mueve porque de él cuelga bookings.completed_at y con él los payouts (§12 del contrato).';


-- ── 2) La ventana de la CLASE: los 10 min de siempre, ahora con nombre ──────
--
-- Esto es lo que antes hacía `session_access_window` y lo que
-- `close_expired_sessions` llevaba escrito a mano. Es el reloj de la
-- CONTABILIDAD y responde a otra pregunta: «¿esto es la clase, o alguien está
-- curioseando la sala?».
--
-- Dos consumidores, y por eso es una función y no dos literales:
--   · `close_expired_sessions()` usa su EXTREMO SUPERIOR para cerrar;
--   · `join_session()` usa el RANGO ENTERO para decidir si mueve el ciclo M5.
--
-- ⚠️ Ojo al usarla en el cron: `not (rango @> now())` NO es «la clase terminó»
-- — también es true para una clase que aún no ha empezado, y cerrar por eso
-- mataría toda la agenda futura en la primera pasada. El cierre se pregunta
-- SIEMPRE con `now() > upper(...)`.
create or replace function public.session_live_window(
  p_start timestamptz,
  p_end   timestamptz
)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(p_start - interval '10 minutes', p_end + interval '10 minutes', '[]');
$$;

comment on function public.session_live_window(timestamptz, timestamptz) is
  'MN-05: la ventana de la CLASE (10 min antes / 10 min después, el valor de siempre de RN-18/S-45). Gobierna la CONTABILIDAD: cierre automático de la sesión y transición del ciclo M5. NO es la ventana de acceso a la sala, que es session_access_window() y desde MN-05 son 7 días. Separarlas fue el encargo: el cliente amplió el acceso pero dijo que NO al cobro más tardío.';

-- Sin `revoke` en ninguna de las dos, y es deliberado (el gotcha de US-605 es
-- real, pero aquí no aplica): las dos son funciones puras sobre dos timestamps
-- que el que llama ya tiene en la mano. No leen ni una tabla, así que no hay
-- nada que filtrar. Las que sí necesitan candado son las `security definer` de
-- abajo, y lo llevan.


-- ── 3) Las columnas muertas se despiertan ───────────────────────────────────
--
-- `sessions.access_opens_at` / `access_closes_at` existen desde 20260709140000
-- y **no las leía ni las escribía nadie**: la ventana se recalculaba en cinco
-- sitios distintos (dos en SQL, `WINDOW_MIN` en `live-room.tsx`, el `+10 min`
-- del endpoint de la sala y el margen del token). Los Docs 01 y 02 llevan desde
-- junio dándolas por fuente de verdad. A partir de aquí lo son.
--
-- Se materializan en columnas —en vez de calcularlas al vuelo cada vez— porque
-- eso es lo que permite que la ventana de una sesión concreta pueda dejar de
-- ser la fórmula algún día (soporte alargando una sala, una promoción, una
-- clase reprogramada) sin tener que preguntárselo a una función global. Hoy
-- todas valen la fórmula; mañana no tienen por qué.
create or replace function public.sessions_set_access_window()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_win tstzrange := public.session_access_window(new.start_at, new.end_at);
begin
  -- Deriva SIEMPRE, también si el `insert` traía valores. Es a propósito: hoy
  -- ningún camino escribe estas columnas (`create_booking` no las nombra), así
  -- que respetar un valor recibido solo serviría para que un cliente con grant
  -- de `update` se fabricara su propia ventana. El día que exista de verdad un
  -- «alargar esta sala» será una RPC controlada que desactive esto a
  -- conciencia, no un `update` suelto que el trigger deje pasar por descuido.
  new.access_opens_at  := lower(v_win);
  new.access_closes_at := upper(v_win);
  return new;
end;
$$;

revoke execute on function public.sessions_set_access_window() from public;

-- `update of start_at, end_at` y no un `update` a secas: si una sesión se mueve
-- de hora, su ventana tiene que seguirla, pero los otros veinte updates que
-- recibe una fila de `sessions` (cambios de estado, `daily_room_name`,
-- `recordings_purged_at`…) no tienen por qué recalcular nada.
drop trigger if exists sessions_set_access_window on public.sessions;
create trigger sessions_set_access_window
  before insert or update of start_at, end_at on public.sessions
  for each row execute function public.sessions_set_access_window();

comment on column public.sessions.access_opens_at is
  'MN-05 · instante desde el que la sala admite gente. Lo deriva el trigger sessions_set_access_window a partir de session_access_window(start_at, end_at) — hoy start_at − 7 días. NO es cuándo empieza la clase (eso es start_at) ni cuándo se cierra la contabilidad (eso es session_live_window).';
comment on column public.sessions.access_closes_at is
  'MN-05 · instante en que la sala deja de admitir gente. Derivado (end_at + 7 días). Es también el `exp` con el que se crea la room en Daily. Ojo: la sesión ya está `completed`/`no_show` mucho antes — el estado es contabilidad, esta columna es acceso.';


-- ── 4) Backfill: 72 filas en dev y todas a null ─────────────────────────────
--
-- Se RELLENAN, en vez de dejar que `join_session` caiga a la fórmula cuando son
-- nulas. Las dos cosas, de hecho: el backfill deja los datos coherentes hoy y
-- el respaldo de la RPC (abajo) cubre cualquier fila que se cuele mañana. Pero
-- el respaldo solo no bastaba, y la razón es un pie que conviene no pisar:
--
--   ⚠️ `tstzrange(null, null, '[]')` en Postgres NO es un rango vacío: es
--   `(,)`, **infinito por los dos lados**, y `@> now()` devuelve TRUE. O sea
--   que construir el rango directamente desde las columnas haría que una fila
--   sin ventana diera acceso ETERNO a la sala. Falla ABIERTO, que es
--   exactamente al revés de la regla de oro 1. Por eso abajo el respaldo es un
--   `coalesce` explícito columna a columna y nunca un rango armado con nulos.
--
-- Y sin backfill nadie se queda fuera de su sala en el intervalo entre esta
-- migración y el despliegue: las 72 filas quedan con ventana desde ya.
--
-- Sí, esto mueve `sessions.updated_at` de todas ellas (lo hace
-- `sessions_set_updated_at`, 20260709140000). Se acepta: esa columna es
-- auditoría de fila, no la lee ninguna regla de negocio ni ninguna pantalla.
--
-- No dispara `sessions_set_access_window`: ese trigger es `update of start_at,
-- end_at` y aquí no se toca ninguna de las dos. Por eso el `set` va escrito.
update public.sessions
   set access_opens_at  = lower(public.session_access_window(start_at, end_at)),
       access_closes_at = upper(public.session_access_window(start_at, end_at))
 where access_opens_at is null
    or access_closes_at is null;


-- ── 5) join_session v3 — el acceso deja de recalcular y deja de confundirse ─
--
-- Cuerpo íntegro de la v2 (20260717120000, Daily real), con tres cambios y
-- ninguno más. Se parte de esa versión y no de la de EP-08 porque en Postgres
-- una función no se parchea, se reescribe entera: arrancar de la vieja
-- devolvería el `sim-*` y el token falso sin que nada avisara.
--
--   A. La sesión terminada por tiempo YA NO cierra la puerta. Solo `cancelled`.
--   B. La reserva `completed` SÍ da acceso — y esto no es un detalle: en cuanto
--      `close_expired_sessions` cierra la última sesión, la reserva pasa a
--      `completed`. Sin esta línea la sala se cerraría a los 10 minutos por la
--      puerta de al lado y MN-05 no se notaría en absoluto.
--   C. La ventana sale de las COLUMNAS, no de la fórmula.
--
-- Lo que se conserva sin tocar: la comprobación de participante (RLS
-- reforzada), el nombre determinista de sala y la firma del jsonb, que ahora
-- lleva dos campos más.
create or replace function public.join_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_sess    record;
  v_booking public.booking_status;
  v_room    text;
  v_win     tstzrange;
  v_opens   timestamptz;
  v_closes  timestamptz;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select s.id, s.booking_id, s.student_id, s.tutor_id, s.status,
         s.start_at, s.end_at, s.daily_room_name, s.daily_room_url,
         s.access_opens_at, s.access_closes_at
    into v_sess
  from public.sessions s
  where s.id = p_session_id
    and (s.student_id = v_uid or s.tutor_id = v_uid);   -- RLS de participante, reforzada
  if v_sess.id is null then
    raise exception 'sesión no encontrada' using errcode = 'no_data_found';
  end if;

  select status into v_booking from public.bookings where id = v_sess.booking_id;

  -- ⚠️ CAMBIO B · `completed` entra en la lista. Una reserva completada es una
  -- clase que YA OCURRIÓ y se pagó, no una reserva muerta: durante los 7 días
  -- siguientes su sala sigue siendo el sitio donde están los materiales y el
  -- hilo. Las que siguen fuera son las que no deben tener sala nunca:
  -- `cancelled` y `refunded` porque el dinero volvió, y `pending_payment` /
  -- `pending_acceptance` porque todavía no hay clase que abrir.
  if v_booking not in ('confirmed', 'in_progress', 'completed') then
    raise exception 'la reserva no está activa (%).', v_booking using errcode = 'check_violation';
  end if;

  -- ⚠️ CAMBIO A · Antes: `if v_sess.status in ('completed','cancelled','no_show')`
  -- → «la sesión ya terminó». Ahora solo `cancelled`.
  --
  -- `completed` y `no_show` son estados de la CONTABILIDAD: dicen que el reloj
  -- de la clase venció (y con él arrancó el de cobro del tutor), no que la sala
  -- deba estar cerrada. `cancelled` es otra cosa entera: esa clase no va a
  -- existir, no se ha cobrado o se ha devuelto, y su sala no se abre ni dentro
  -- de la ventana ni fuera.
  if v_sess.status = 'cancelled' then
    raise exception 'esta sesión está cancelada' using errcode = 'check_violation';
  end if;

  -- ⚠️ CAMBIO C · La ventana se LEE. El `coalesce` es el respaldo para una fila
  -- que llegara sin ventana (ver el aviso del rango infinito en el bloque 4):
  -- columna a columna, nunca un `tstzrange` armado con nulos.
  --
  -- No se aprovecha para reparar la fila con un `update`: sería una escritura
  -- en el camino más caliente de la sala para arreglar un caso que el backfill
  -- y el trigger ya cubren entre los dos.
  v_win    := public.session_access_window(v_sess.start_at, v_sess.end_at);
  v_opens  := coalesce(v_sess.access_opens_at,  lower(v_win));
  v_closes := coalesce(v_sess.access_closes_at, upper(v_win));

  if now() < v_opens or now() > v_closes then
    raise exception 'fuera de la ventana de acceso' using errcode = 'check_violation';
  end if;

  -- Nombre de sala determinista: el endpoint lo usa para crear/reusar la room
  -- en Daily sin que la BD tenga que conocer el dominio ni guardar la URL.
  v_room := 'ey-' || replace(v_sess.id::text, '-', '');
  if v_sess.daily_room_name is distinct from v_room then
    update public.sessions set daily_room_name = v_room where id = v_sess.id;
  end if;

  -- ── El ciclo M5 (US-802) se mueve SOLO si esto es la clase ────────────────
  --
  -- ⚠️ AQUÍ ESTÁ EL DINERO, Y ES LA PARTE QUE MÁS FÁCIL SE ROMPE.
  --
  -- Hasta hoy «entrar» y «empezar la clase» eran lo mismo, porque solo se podía
  -- entrar 10 minutos antes. Con 7 días ya no: abrir la sala el martes para
  -- probar la cámara NO es empezar la mentoría del lunes siguiente. Si el ciclo
  -- se moviera con cada entrada, pasarían las dos cosas, y las dos son graves:
  --
  --   · la reserva saltaría a `in_progress` una semana antes, y `cancel_booking`
  --     NO acepta `in_progress` (20260817170000). El alumno perdería en silencio
  --     el derecho a cancelar con reembolso del 100 % que le da RN-37 por
  --     avisar con ≥24 h — por haber curioseado la sala;
  --   · una sesión ya cerrada volvería a `in_progress`, el cron la re-cerraría y
  --     `completed_at` se rehacía con la fecha de hoy. Eso es exactamente
  --     retrasar el payout del tutor, que es lo que el cliente dijo que NO.
  --
  -- Por eso el gate es `session_live_window` y no la ventana de acceso. Fuera
  -- de la clase se entra a la sala, pero no se toca ni un estado.
  --
  -- ⚠️ El precio de esta decisión, escrito para que nadie lo descubra por su
  -- cuenta: quien entre a la sala MÁS de 10 min antes y no vuelva a pedir
  -- entrada nunca —se queda dentro del iframe toda la clase— dejará la sesión
  -- sin abrir, y el cron la cerrará como `no_show` aunque la clase ocurriera.
  -- Lo tapa el cliente: `live-room.tsx` vuelve a llamar a este endpoint cuando
  -- se abre la ventana de la clase. Si algún día se reescribe esa pantalla
  -- (MN-04 lo haría), esa llamada tiene que sobrevivir.
  if public.session_live_window(v_sess.start_at, v_sess.end_at) @> now() then
    if v_sess.status = 'scheduled' then
      update public.sessions set status = 'in_progress' where id = v_sess.id;
    end if;
    if v_booking = 'confirmed' then
      update public.bookings set status = 'in_progress' where id = v_sess.booking_id;
    end if;
  end if;

  -- Sin token aquí: lo firma el server con la API key (Doc 1 §1.4.11: el token
  -- se genera al unirse y NO se almacena).
  --
  -- Tres relojes salen por esta puerta y cada uno tiene un consumidor distinto,
  -- así que no se pueden fusionar por parecerse:
  --   · `ends_at`   → `exp` del meeting-token (corto; MN-05a);
  --   · `closes_at` → `exp` de la SALA en Daily (7 días; MN-05);
  --   · `starts_at` → duración de la clase, de donde sale el tope de minutos
  --                   que un participante puede estar conectado.
  return jsonb_build_object(
    'room_name',  v_room,
    'is_tutor',   v_sess.tutor_id = v_uid,
    'starts_at',  v_sess.start_at,
    'ends_at',    v_sess.end_at,
    'closes_at',  v_closes
  );
end;
$$;

-- `create or replace` conserva privilegios; se repite por si esta migración cae
-- sobre una base donde la función no existiera (en Postgres el `execute` nace
-- concedido a PUBLIC, y PUBLIC incluye a `anon`). Mismo gotcha de US-605.
revoke execute on function public.join_session(uuid) from public;
revoke execute on function public.join_session(uuid) from anon;
grant  execute on function public.join_session(uuid) to authenticated;


-- ── 6) close_expired_sessions v2 — MISMO minuto, ahora con nombre ───────────
--
-- ⚠️ ESTA FUNCIÓN NO CAMBIA DE COMPORTAMIENTO. Ni un segundo. Es el reloj del
-- que cuelga `bookings.completed_at` y con él los payouts (§12 del contrato), y
-- el cliente respondió que NO a cobrar más tarde.
--
-- Lo único que cambia es que el umbral deja de ser el literal
-- `now() > s.end_at + interval '10 minutes'` y pasa a ser el extremo superior
-- de `session_live_window()`. Se reescribe para eso y solo para eso: dejar el
-- literal suelto era la trampa que hacía que ampliar «la ventana» pareciera un
-- cambio de una constante, cuando en realidad había dos ventanas y esta es la
-- que mueve dinero. Con la llamada puesta, quien vuelva aquí lee el nombre y
-- sabe cuál de las dos está tocando.
--
-- ⚠️ `now() > upper(...)` y NO `not (rango @> now())`: la segunda forma también
-- es true ANTES de que la clase empiece, y cerraría de golpe toda la agenda
-- futura como `no_show` en la primera pasada del cron.
create or replace function public.close_expired_sessions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed  int;
  v_booking_ids uuid[];
begin
  -- Cierra las sesiones vencidas y recuerda sus reservas para revisarlas.
  with expired as (
    update public.sessions s
       set status = case when s.status = 'in_progress' then 'completed' else 'no_show' end,
           completed_at = case when s.status = 'in_progress' then now() else completed_at end
     where s.status in ('scheduled', 'in_progress')
       and now() > upper(public.session_live_window(s.start_at, s.end_at))
    returning s.booking_id
  )
  select count(*), array_agg(distinct booking_id) into v_closed, v_booking_ids from expired;

  -- Reservas cuyas sesiones ya están todas resueltas → completed.
  if v_booking_ids is not null then
    update public.bookings b
       set status = 'completed', completed_at = now()
     where b.id = any(v_booking_ids)
       and b.status in ('confirmed', 'in_progress')
       and not exists (
         select 1 from public.sessions s
         where s.booking_id = b.id and s.status in ('scheduled', 'in_progress')
       );
  end if;

  return jsonb_build_object('sessions_closed', coalesce(v_closed, 0));
end;
$$;

comment on function public.close_expired_sessions() is
  'US-802 · cierre automático de la sesión vencida (pg_cron cada 5 min). Umbral: upper(session_live_window()) = end_at + 10 min — el valor de siempre. MN-05 amplió la ventana de ACCESO a 7 días y este umbral NO la sigue a propósito: de aquí sale bookings.completed_at, y con él el plazo de pago al tutor (§12 del contrato). El cliente respondió NO a cobrar más tarde.';

-- Gotcha de US-605: `execute` es de PUBLIC por defecto. Se repite el candado
-- por si la función no existiera en la base donde caiga esta migración — un
-- `authenticated` no debe poder cerrar sesiones ajenas ni acelerar un payout.
revoke execute on function public.close_expired_sessions() from public;
revoke execute on function public.close_expired_sessions() from anon;
revoke execute on function public.close_expired_sessions() from authenticated;
grant  execute on function public.close_expired_sessions() to service_role;

-- Sin tocar el `cron.schedule` de 20260716120000: `create or replace` no altera
-- el job, que invoca la función por nombre. Reprogramarlo aquí solo añadiría
-- una forma de duplicarlo.
