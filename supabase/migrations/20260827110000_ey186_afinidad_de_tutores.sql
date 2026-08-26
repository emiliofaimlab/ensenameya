-- ============================================================================
-- Enséñame Ya — EY-186 · B5.3: el carrusel de tutores del panel del alumno.
--
-- QUÉ SE PIDIÓ, Y EN QUÉ SE DIFERENCIA DE LA FICHA. La ficha de Jira dejaba
-- abierto «definir si se **guarda** el tutor o la mentoría como favorito», o
-- sea, favoritos EXPLÍCITOS: una estrellita y una tabla de marcadores. El
-- responsable pidió literalmente lo contrario:
--
--     «Es en el home de estudiante. Acá debemos tener un algoritmo de tutores
--      favoritos dependiendo de mis visitas a clases, clases compradas,
--      tutores vistos.»
--
-- Manda eso. Aquí no hay ningún botón de guardar: el favorito se **deduce**.
-- Tres consecuencias de diseño que conviene dejar por escrito porque no se
-- pueden leer del código:
--
--   1. Es el panel del alumno (`/app`), no la portada pública.
--   2. El favorito es del TUTOR, no de la mentoría.
--   3. Al no haber marcador explícito, no hay nada que «quitar de favoritos».
--      Por eso la pantalla NO usa la palabra «favoritos»: prometería un control
--      que no existe. Ver la nota del componente.
--
-- ── LAS DOS CAPAS ───────────────────────────────────────────────────────────
-- **Capa 1 — lo que YA existe.** Compras (`bookings`), clases dadas
-- (`sessions`) y las reseñas que el propio alumno escribió (`reviews`). Es la
-- señal más fuerte que hay y no necesitaba ni una tabla nueva: funciona sola,
-- desde el primer despliegue, para cualquier alumno con historial.
--
-- **Capa 2 — «tutores vistos».** Eso NO existía en ninguna parte
-- (`grep -riE "tutor_views|viewed_at|recently_viewed" supabase/` → cero) y es
-- lo único que esta migración añade como superficie nueva: `tutor_views`.
--
-- ── POR QUÉ `tutor_views` ES UNA TABLA APARTE Y NO UNA COLUMNA EN `profiles` ─
-- ⚠️ `20260703120000:16` hace `grant select, update on public.profiles to
-- authenticated` sobre la TABLA ENTERA. Cualquier columna nueva ahí nace
-- escribible por el propio usuario vía PostgREST, y `profiles_update_own` la
-- deja pasar. Un `revoke update (columna)` no lo arregla mientras el privilegio
-- de tabla siga puesto. Guardar aquí el historial de navegación habría sido
-- dárselo al navegador para que lo reescribiera a gusto.
--
-- ── LAS TRES CONDICIONES DE LA CAPA 2, DESDE EL DÍA UNO ─────────────────────
--
-- **a) Solo con sesión.** `record_tutor_view` devuelve `false` sin `auth.uid()`
--    y `anon` ni siquiera puede ejecutarla. Registrar la navegación de anónimos
--    es abrir un registro que hoy no existe para una señal que no se puede
--    atribuir a nadie: coste puro.
--
-- **b) Con retención, y con el plazo decidido.** 90 días desde la última
--    visita, purgados por `pg_cron` (§4). El razonamiento, entero:
--      · Es dato personal sin contenido —quién miró a quién, cuántas veces—.
--        Todo lo demás con dato personal en esta plataforma tiene plazo (el
--        chat 30 días, RN-41; las grabaciones su cron). Esto no puede ser la
--        excepción que crece para siempre.
--      · 90 días ≈ un trimestre lectivo: quien navegó en enero y compra en
--        marzo sigue teniendo un panel útil, y una cuenta que se queda quieta
--        no deja rastro más allá del trimestre.
--      · Es donde la escalera de `afinidad_peso_reciente` toca suelo: a partir
--        del día 90 una visita ya no pierde peso, se queda en el mínimo para
--        siempre. Guardarla más tiempo no mejora la recomendación, solo acumula.
--      · ⚠️ Sí, 90 > los 30 del chat, y es deliberado: el chat guarda CONTENIDO
--        (mensajes y adjuntos) y esto guarda cuatro números. La sensibilidad es
--        otra y el horizonte de utilidad también. El número es una decisión de
--        producto y se mueve cambiando la constante de §4, no el diseño.
--
-- **c) Es la escritura más frecuente de la plataforma — y por eso NO es un log.**
--    Crece con el tráfico, no con las ventas. Dos decisiones para acotarlo:
--      · **Una fila por (usuario, tutor)** con contadores y fechas, NO una fila
--        por visita. El ranking solo pregunta «cuántas veces» y «hace cuánto»:
--        un log se agregaría a exactamente eso en cada lectura, así que se
--        guarda la respuesta y no el enunciado. Con la fila-por-par la tabla
--        deja de crecer tras la primera visita de ese par y queda acotada por
--        `usuarios × tutores mirados`; con log crecería por página vista. Lo
--        que se pierde es la línea temporal completa (a qué hora navega cada
--        cual) — que nadie ha pedido y que es justo lo que habría que borrar.
--      · **Antirrebote de 30 minutos en el `on conflict`** (§2): recargar la
--        ficha veinte veces no escribe veinte veces. El tope real de escritura
--        es ~2 por par y hora, pase lo que pase con el tráfico.
--
-- ⚠️ **LO QUE ESTA MIGRACIÓN NO ARREGLA Y HAY QUE DECIR EN VOZ ALTA:** las
-- páginas legales publicadas (`/privacy`, `/cookies`, `/terms`) **no mencionan
-- que se guarde historial de navegación**. No se tocan aquí a propósito —el
-- texto legal es decisión de producto, y el del cliente en `ensenameya.com` es
-- otro documento distinto— pero quedan pendientes de revisión antes de que esto
-- llegue a producción.
-- ============================================================================


-- ── 0 · El peso que le queda a algo por lo viejo que es ─────────────────────
-- Escalera de cuatro peldaños y no una exponencial, a propósito: hay que poder
-- explicarle al cliente por qué un tutor está delante de otro, y «tu clase es
-- de hace un mes, cuenta un 70 %» se explica; `exp(-d/60)` no. Además una
-- escalera es ESTABLE: el orden del panel no se reordena solo cada hora.
--
-- El suelo es 0.2 y NO 0: una clase que diste es un hecho, no caduca. Solo
-- deja de mandar frente a lo reciente.
create or replace function public.afinidad_peso_reciente(p_cuando timestamptz)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when p_cuando is null                         then 0.2
    when p_cuando > now() - interval '7 days'     then 1.0
    when p_cuando > now() - interval '30 days'    then 0.7
    when p_cuando > now() - interval '90 days'    then 0.4
    else                                               0.2
  end::numeric;
$$;

comment on function public.afinidad_peso_reciente(timestamptz) is
  'EY-186: cuánto pesa hoy algo que pasó en `p_cuando`. Escalera 1.0 / 0.7 / 0.4 / 0.2 por tramos de 7, 30 y 90 días. Suelo 0.2 y no 0: una clase dada no caduca, solo deja de mandar.';

revoke execute on function public.afinidad_peso_reciente(timestamptz) from public;
-- La llama `student_tutor_affinity`, que es SECURITY INVOKER: el permiso lo
-- necesita quien llama, no la función que la envuelve.
grant  execute on function public.afinidad_peso_reciente(timestamptz) to authenticated;


-- ── 1 · «Tutores vistos» — la única superficie nueva ────────────────────────
create table public.tutor_views (
  user_id  uuid not null references public.profiles       (id)         on delete cascade,
  -- FK a `tutor_profiles` y no a `profiles`: solo se puede haber visto la
  -- ficha de quien tiene ficha. Y así la fila muere con el perfil de tutor.
  tutor_id uuid not null references public.tutor_profiles (profile_id) on delete cascade,

  -- Los DOS contadores de la petición, en la MISMA fila. Separados porque no
  -- valen igual —abrir una mentoría concreta es más intención que aterrizar en
  -- un perfil— y en la misma fila porque separarlos en dos filas duplicaría la
  -- tabla para guardar un entero.
  views       integer not null default 0,  -- «tutores vistos»: fichas de /tutors/[id]
  class_views integer not null default 0,  -- «visitas a clases»: fichas de /products/[id]

  -- UTC (RN-01/02) y SIEMPRE del servidor: las pone `now()` dentro de la RPC,
  -- nunca el navegador. Mismo motivo que `mark_conversation_read` (N-23): un reloj
  -- adelantado en el cliente falsearía el orden del panel y esquivaría el
  -- antirrebote de §2.
  first_viewed_at timestamptz not null default now(),
  last_viewed_at  timestamptz not null default now(),

  primary key (user_id, tutor_id)
);

comment on table public.tutor_views is
  'EY-186 (capa 2): a qué tutores ha mirado cada usuario con sesión, cuántas veces y cuándo. UNA fila por par —no un log de visitas— y con purga a 90 días. Solo la escribe `record_tutor_view`; solo la lee su dueño.';

comment on column public.tutor_views.views is
  'Visitas a la ficha del tutor (/tutors/[id]). Antirrebote de 30 min en `record_tutor_view`: no es «páginas servidas», es «veces que volvió».';

comment on column public.tutor_views.class_views is
  'Visitas a la ficha de una mentoría suya (/products/[id]). Es la mitad «visitas a clases» de la petición, la que no deja rastro en `bookings` porque no hubo compra.';

-- El índice de la PK ya sirve a la consulta de afinidad (`where user_id = …`,
-- prefijo de la PK). Este es para la purga, que es el único acceso que NO va
-- por usuario. Sin él la purga diaria hace scan completo de la tabla más
-- escrita del proyecto.
create index tutor_views_caducadas_idx on public.tutor_views (last_viewed_at);

-- Sin `updated_at` ni su trigger: `last_viewed_at` ES la columna de auditoría
-- de esta tabla. Mismo criterio que `conversation_reads` (M-12, `20260817210000`);
-- una segunda marca con el mismo valor solo sería una forma de que un día
-- discrepen.

-- ── RLS: default-deny; cada quien ve SOLO lo suyo ───────────────────────────
alter table public.tutor_views enable row level security;

create policy "tutor_views_select_own"
  on public.tutor_views for select
  using ( (select auth.uid()) = user_id );

-- ⚠️ **NO hay política para el tutor, y es la decisión importante de esta
-- tabla.** «Quién ha visto mi perfil» es una funcionalidad de vigilancia que
-- nadie ha pedido, que el Figma no pinta y que cambiaría por completo lo que el
-- alumno cree que está haciendo al abrir una ficha. Es el mismo razonamiento que
-- dejó fuera el acuse de lectura en `conversation_reads`. Tampoco hay política
-- de admin: un administrador no necesita saber por dónde navega nadie.

-- Sin política de insert/update/delete a propósito: el único camino de
-- escritura es `record_tutor_view` (SECURITY DEFINER). Mismo patrón que
-- `messages` (`send_message`) y `conversation_reads` (`mark_conversation_read`).

-- ── Grants ("auto-expose new tables" OFF) ───────────────────────────────────
-- `select` para que `student_tutor_affinity` —SECURITY INVOKER, corre con los
-- privilegios de quien llama— pueda hacer su join. La política de arriba acota
-- qué filas.
grant select on public.tutor_views to authenticated;

-- ⚠️ Regla de oro 9: `service_role` se salta la RLS pero NO los grants de
-- tabla. La purga de §4 va por `pg_cron`, que corre la función como su dueño y
-- por tanto no mira grants — pero el proyecto tiene el OTRO patrón de job vivo
-- (Route Handlers con `service_role`, `src/app/api/cron/`) y si algún día la
-- purga se mueve allí, sin esto revienta EN EJECUCIÓN, no en el build. Fue lo
-- que mordió tres veces el 6-ago. El grant es barato.
grant select, delete on public.tutor_views to service_role;


-- ── 2 · Registrar una visita ────────────────────────────────────────────────
-- POR QUÉ UNA RPC Y NO UN INSERT DESDE EL CLIENTE. Tres razones y la tercera
-- es la que decide:
--   1. El reloj lo pone el servidor (ver el comentario de las columnas).
--   2. Sin RPC habría que dar `insert`/`update` sobre la tabla a
--      `authenticated`, y entonces el navegador elige los contadores: nada
--      impide poner `views = 99999` y fijar la cabeza del carrusel.
--   3. **El antirrebote vive aquí.** Es el `where` del `on conflict`: si la
--      última visita de ESE par es de hace menos de 30 minutos, la sentencia no
--      escribe nada — una sonda al índice de la PK y se acabó. Es lo que
--      convierte «una escritura por página vista» en «como mucho dos por par y
--      hora», que es la diferencia entre una tabla que crece con el tráfico y
--      una que no.
--
-- Devuelve `boolean` = «¿se llegó a escribir?». No es decorativo: deja medir el
-- efecto del antirrebote sin instrumentar nada más.
create or replace function public.record_tutor_view(
  p_tutor_id uuid,
  -- 'tutor' = ficha del tutor · 'clase' = ficha de una mentoría suya.
  p_origen   text default 'tutor'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_escrito  boolean;
begin
  -- Sin sesión no se registra NADA (condición (a) de la cabecera). Y se
  -- devuelve `false` en vez de lanzar: esto se dispara desde páginas PÚBLICAS,
  -- donde el visitante anónimo es el caso normal, no un error. Un `raise` aquí
  -- pintaría un fallo en una pantalla que funciona perfectamente.
  if v_uid is null then
    return false;
  end if;

  -- Verse a uno mismo no es interés por nadie. Pasa de verdad: el tutor abre su
  -- propia ficha para comprobar cómo se ve.
  if v_uid = p_tutor_id then
    return false;
  end if;

  if p_origen is null or p_origen not in ('tutor', 'clase') then
    raise exception 'origen no válido: %', p_origen using errcode = '22023';
  end if;

  -- La FK exige que el tutor exista; se comprueba antes para devolver `false`
  -- en vez de reventar por integridad. Un id inválido en la URL es cosa del
  -- 404 de la página, no de esta función.
  if not exists (select 1 from public.tutor_profiles tp where tp.profile_id = p_tutor_id) then
    return false;
  end if;

  insert into public.tutor_views as tv (user_id, tutor_id, views, class_views)
  values (
    v_uid,
    p_tutor_id,
    case when p_origen = 'tutor' then 1 else 0 end,
    case when p_origen = 'clase' then 1 else 0 end
  )
  on conflict (user_id, tutor_id) do update
     set views          = tv.views       + case when p_origen = 'tutor' then 1 else 0 end,
         class_views    = tv.class_views + case when p_origen = 'clase' then 1 else 0 end,
         last_viewed_at = now()
   -- ⚠️ EL ANTIRREBOTE. Si el `where` no se cumple, `do update` no toca la fila
   -- y la sentencia no escribe: no es un `update` que no cambia nada, es un
   -- `update` que no ocurre.
   where tv.last_viewed_at < now() - interval '30 minutes'
  returning true into v_escrito;

  return coalesce(v_escrito, false);
end;
$$;

comment on function public.record_tutor_view(uuid, text) is
  'EY-186: suma una visita del usuario con sesión a la ficha de un tutor (`p_origen` = tutor) o a la de una mentoría suya (= clase). Antirrebote de 30 min por par. Devuelve si llegó a escribir. Sin sesión y sobre uno mismo: no hace nada.';

revoke execute on function public.record_tutor_view(uuid, text) from public;
-- ⚠️ `anon` NO puede llamarla. Es la condición (a) puesta también en el
-- permiso, y no solo en el `if` de dentro: la navegación anónima no se registra
-- ni por accidente ni por un cambio futuro en el cuerpo de la función.
revoke execute on function public.record_tutor_view(uuid, text) from anon;
grant  execute on function public.record_tutor_view(uuid, text) to authenticated;


-- ── 3 · Baja de cuenta: la navegación se va entera y de inmediato ───────────
-- ⚠️ ESTO HACE FALTA PORQUE `anonymize_account` (EY-192, `20260826230000`) NO
-- BORRA `profiles`: la deja como lápida para que reservas y pagos sigan
-- teniendo titular. O sea que el `on delete cascade` de §1 **nunca se dispara
-- en una baja**, y sin esto las filas de navegación de alguien que pidió
-- desaparecer sobrevivirían hasta 90 días.
--
-- Se resuelve con un trigger sobre `account_deletions` —el rastro que esa
-- migración inserta— y NO metiendo una línea en `anonymize_account`: copiar
-- doscientas líneas de una función crítica para añadir un `delete` es la forma
-- de romperla. Con el trigger, cualquier baja limpia esto, la escriba quien la
-- escriba.
--
-- Se borra en LAS DOS DIRECCIONES: lo que esa persona miró, y lo que otros
-- miraron de ella si era tutora. Lo segundo no es estrictamente suyo, pero
-- apunta a alguien que ya no está y no puede volver a salir en ningún carrusel
-- (queda `suspended`): son filas muertas que además le nombran.
create or replace function public.purgar_navegacion_de_baja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tutor_views where user_id  = new.user_id;
  delete from public.tutor_views where tutor_id = new.user_id;
  return new;
end;
$$;

comment on function public.purgar_navegacion_de_baja() is
  'EY-186: al darse de baja una cuenta (EY-192 inserta en `account_deletions`), su historial de navegación se borra al instante en las dos direcciones. Hace falta porque la baja NO borra `profiles`, así que el cascade de `tutor_views` no llega a dispararse.';

drop trigger if exists account_deletions_purga_navegacion on public.account_deletions;
create trigger account_deletions_purga_navegacion
  after insert on public.account_deletions
  for each row execute function public.purgar_navegacion_de_baja();


-- ── 4 · Retención: 90 días desde la última visita ───────────────────────────
-- El plazo y su porqué están arriba, en la cabecera. Aquí solo está el número,
-- en un sitio, para que moverlo sea moverlo.
--
-- Devuelve `jsonb` con el recuento igual que `purge_expired_messages`: un job
-- que borra en silencio no se puede auditar.
create or replace function public.purge_tutor_views()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borradas integer;
begin
  delete from public.tutor_views
   where last_viewed_at < now() - interval '90 days';
  get diagnostics v_borradas = row_count;

  return jsonb_build_object(
    'estado',   'activa',
    'retencion_dias', 90,
    'purgadas', v_borradas
  );
end;
$$;

comment on function public.purge_tutor_views() is
  'EY-186: purga diaria del historial de navegación con más de 90 días sin visitas. Ver la cabecera de la migración para el porqué del plazo.';

revoke execute on function public.purge_tutor_views() from public;
revoke execute on function public.purge_tutor_views() from anon;
revoke execute on function public.purge_tutor_views() from authenticated;
grant  execute on function public.purge_tutor_views() to service_role;

-- 04:30 y no 04:00: a esa hora ya corre `purge-expired-messages`
-- (`20260722200000`), y encadenarlas evita que los dos borrados grandes del día
-- se pisen.
select cron.schedule(
  'purge-tutor-views',
  '30 4 * * *',
  $cron$ select public.purge_tutor_views(); $cron$
);


-- ── 5 · EL ALGORITMO ────────────────────────────────────────────────────────
-- Devuelve los tutores del alumno que llama, ordenados por afinidad DEDUCIDA.
--
-- ── Por qué una función y no cuatro consultas desde Next ────────────────────
-- Porque son cuatro agregados sobre cuatro tablas que hay que cruzar por tutor.
-- Hacerlo en TypeScript son cuatro viajes y el cruce en memoria; aquí es uno y
-- lo cruza el motor. Y sobre todo: el reparto de pesos queda en UN sitio, no
-- esparcido por un `.reduce()` de una carpeta de pantalla.
--
-- ── Por qué SECURITY INVOKER (y no DEFINER, que es lo habitual aquí) ────────
-- Porque no hace falta saltarse nada: las cuatro tablas ya son legibles por su
-- dueño (`bookings_select_student`, `sessions_select_participant`,
-- `reviews_select_public`, `tutor_views_select_own`) y `tutor_profiles` filtra
-- sola por `approved`. Con INVOKER la RLS sigue en pie dentro de la función, así
-- que ni un fallo en el `where` puede enseñar el historial de otro: no hay
-- parámetro de usuario que pasar, el alumno es `auth.uid()` y punto.
--
-- ── LOS PESOS, Y POR QUÉ ESOS ──────────────────────────────────────────────
--   · Clase DADA (`sessions.completed`) ...................... 6
--     La señal más fuerte que existe: pagó, se presentó y la terminó. Es la
--     lectura honesta de «visitas a clases» que sí está registrada hoy.
--   · Mentoría COMPRADA (`bookings` en estado pagado) ........ 4
--     «Clases compradas». Va por debajo de la clase dada a propósito: comprar
--     es intención, aparecer es preferencia.
--   · Mi reseña ............................ (nota − 3) × 3
--     5★ = +6 · 4★ = +3 · 3★ = 0 · 2★ = −3 · 1★ = −6.
--     ⚠️ NO estaba entre las tres señales que pidió el responsable, y entra
--     igual por una razón de corrección, no de ambición: sin ella el panel
--     puede decirle «vuelve a reservar» a un tutor al que el propio alumno
--     puso 1★. Ese es el error que se ve desde fuera. Y de paso es la única
--     señal que distingue «di clase con él» de «me gustó».
--   · Ficha de tutor vista ................................... 1 (tope 3)
--   · Ficha de mentoría suya vista ........................... 2 (tope 3)
--     Los topes NO son cosmética. Sin ellos, recargar una ficha veinte veces
--     coloca a un desconocido por delante del tutor con el que estudias. Con
--     ellos la navegación aporta como mucho 3×1 + 3×2 = **9 puntos**, y una
--     sola clase comprada y dada vale 4 + 6 = **10**. O sea, el invariante:
--     **mirar no puede adelantar a estudiar, por mucho que se mire.**
--
-- Todo se multiplica por `afinidad_peso_reciente` (§0), así que la lista se
-- reordena sola cuando el alumno cambia de intereses, sin tener que olvidar
-- nada.
--
-- ── Lo que NO entra ─────────────────────────────────────────────────────────
--   · `cancelled` / `refunded` / `pending_payment`: valen 0. Una reserva
--     cancelada puede ser un desastre o un cambio de horario, y el dato no
--     distingue; inventarle signo es peor que ignorarla.
--   · El chat. `conversations` diría «le escribió», que es intención real, pero
--     abrirlo aquí es leer una superficie privada para ordenar un carrusel.
--     No compensa y nadie lo pidió.
create or replace function public.student_tutor_affinity(p_limit integer default 8)
returns table (
  tutor_id      uuid,
  display_name  text,
  avatar_path   text,
  headline      text,
  rating_avg    numeric,
  rating_count  integer,
  -- Puntuación total. Se devuelve para poder depurar «¿por qué este primero?»
  -- sin recalcular nada por fuera.
  score         numeric,
  -- El desglose. La pantalla lo necesita para decir POR QUÉ está cada tutor
  -- ahí: una recomendación que no se explica se lee como publicidad (mismo
  -- criterio que el subtítulo de `SugerenciasCard`, N-30).
  sesiones      integer,
  compras       integer,
  mi_nota       integer,
  vistas        integer,
  vistas_clase  integer,
  ultima_vez    timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  -- ⚠️ Todas las referencias van CUALIFICADAS. Los nombres de `returns table`
  -- son parámetros de salida y chocan con cualquier columna homónima sin
  -- prefijo (`tutor_id`, `score`, `display_name`…): sin cualificar, esto
  -- revienta con «column reference is ambiguous» en ejecución.
  return query
  with yo as (
    select (select auth.uid()) as uid
  ),

  -- 1 · Clases dadas con él.
  clases as (
    select s.tutor_id as t,
           count(*)::integer as n,
           max(coalesce(s.completed_at, s.end_at)) as ultima,
           sum(6 * public.afinidad_peso_reciente(coalesce(s.completed_at, s.end_at))) as puntos
      from public.sessions s, yo
     where s.student_id = yo.uid
       and s.status = 'completed'
     group by s.tutor_id
  ),

  -- 2 · Mentorías compradas. Los cuatro estados de abajo son exactamente
  --     aquellos en los que el dinero ya se movió: `pending_acceptance` entra
  --     porque el alumno YA pagó (por eso el panel le promete el 100 % si el
  --     tutor no acepta en 24 h).
  --
  -- ⚠️ Se llama `pagadas` y NO `compras` porque `compras` YA es un parámetro de
  -- salida de esta función. En plpgsql un nombre que es a la vez variable y
  -- relación es una discusión que no hace falta tener: se le cambia el nombre.
  pagadas as (
    select b.tutor_id as t,
           count(*)::integer as n,
           max(b.created_at) as ultima,
           sum(4 * public.afinidad_peso_reciente(b.created_at)) as puntos
      from public.bookings b, yo
     where b.student_id = yo.uid
       and b.status in ('pending_acceptance', 'confirmed', 'in_progress', 'completed')
     group by b.tutor_id
  ),

  -- 3 · Lo que el alumno opinó. `reviews` es de lectura pública, así que lo
  --     que acota aquí es el `student_id`, no la RLS.
  resenas as (
    select r.tutor_id as t,
           (array_agg(r.rating order by r.created_at desc))[1]::integer as ultima_nota,
           sum((r.rating - 3) * 3 * public.afinidad_peso_reciente(r.created_at)) as puntos
      from public.reviews r, yo
     where r.student_id = yo.uid
     group by r.tutor_id
  ),

  -- 4 · Navegación (capa 2). Los `least(…, 3)` son el tope explicado arriba.
  navegacion as (
    select v.tutor_id as t,
           v.views as n_tutor,
           v.class_views as n_clase,
           v.last_viewed_at as ultima,
           (least(v.views, 3) * 1 + least(v.class_views, 3) * 2)
             * public.afinidad_peso_reciente(v.last_viewed_at) as puntos
      from public.tutor_views v, yo
     where v.user_id = yo.uid
  ),

  candidatos as (
    select clases.t     from clases
    union select pagadas.t    from pagadas
    union select resenas.t    from resenas
    union select navegacion.t from navegacion
  ),

  puntuado as (
    select
      tp.profile_id   as t_id,
      tp.display_name as t_nombre,
      tp.avatar_path  as t_avatar,
      tp.headline     as t_titular,
      tp.rating_avg   as t_nota,
      tp.rating_count as t_resenas,
      round(
        coalesce(cl.puntos, 0) + coalesce(co.puntos, 0)
      + coalesce(re.puntos, 0) + coalesce(na.puntos, 0), 2
      ) as t_score,
      coalesce(cl.n, 0)::integer       as t_sesiones,
      coalesce(co.n, 0)::integer       as t_compras,
      re.ultima_nota                   as t_mi_nota,
      coalesce(na.n_tutor, 0)::integer as t_vistas,
      coalesce(na.n_clase, 0)::integer as t_vistas_clase,
      -- `greatest` ignora los nulos en Postgres, así que esto es «lo más
      -- reciente de lo que haya», sin `coalesce` por cada rama.
      greatest(cl.ultima, co.ultima, na.ultima) as t_ultima
    from candidatos c
    join public.tutor_profiles tp on tp.profile_id = c.t
    left join clases     cl on cl.t = c.t
    left join pagadas    co on co.t = c.t
    left join resenas    re on re.t = c.t
    left join navegacion na on na.t = c.t
    -- `approved` explícito aunque la RLS pública ya filtre por él: hay política
    -- de admin y de dueño sobre `tutor_profiles`, así que un admin mirando su
    -- propio panel vería tutores que nadie más ve. Mismo criterio que
    -- `listActiveCategories()`.
    where tp.approval_status = 'approved'
      -- Sin nombre público no hay tarjeta que pintar. Es el mismo filtro que ya
      -- aplicaba a mano el bloque «Tus últimos tutores» (`4f56bb2`).
      and tp.display_name is not null
  )
  select
    puntuado.t_id,
    puntuado.t_nombre,
    puntuado.t_avatar,
    puntuado.t_titular,
    puntuado.t_nota,
    puntuado.t_resenas,
    puntuado.t_score,
    puntuado.t_sesiones,
    puntuado.t_compras,
    puntuado.t_mi_nota,
    puntuado.t_vistas,
    puntuado.t_vistas_clase,
    puntuado.t_ultima
  from puntuado
  -- Un total ≤ 0 solo se da cuando la resta de una reseña floja se come todo lo
  -- demás. Ese tutor no se recomienda: es literalmente lo contrario de un
  -- favorito, y volver a ofrecérselo al alumno que lo puntuó mal es el error
  -- que se ve desde fuera.
  where puntuado.t_score > 0
  order by puntuado.t_score desc, puntuado.t_ultima desc nulls last
  limit greatest(1, least(coalesce(p_limit, 8), 24));
end;
$$;

comment on function public.student_tutor_affinity(integer) is
  'EY-186: tutores del alumno que llama, ordenados por afinidad deducida de sus clases dadas, compras, reseñas propias y navegación (`tutor_views`). SECURITY INVOKER: no hay parámetro de usuario, es `auth.uid()`, y la RLS sigue en pie dentro. Devuelve el desglose para que la pantalla pueda decir por qué está cada tutor.';

revoke execute on function public.student_tutor_affinity(integer) from public;
revoke execute on function public.student_tutor_affinity(integer) from anon;
grant  execute on function public.student_tutor_affinity(integer) to authenticated;
