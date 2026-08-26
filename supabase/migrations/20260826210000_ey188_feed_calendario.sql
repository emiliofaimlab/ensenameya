-- ============================================================================
-- Enséñame Ya — EY-188 / B5.5: suscripción de calendario (Apple, Google)
--
-- Lo que se pide NO es un botón de «descargar .ics». Un .ics descargado es una
-- foto: se congela en el momento de la descarga y a partir de ahí miente cada
-- vez que la reserva cambia. Lo que se construye aquí es un **feed suscribible**
-- —una URL que el propio calendario relee solo— para que altas, cancelaciones y
-- (el día que exista) reprogramaciones lleguen sin que el usuario haga nada.
--
-- ── POR QUÉ UN TOKEN PROPIO Y NO LA SESIÓN ──────────────────────────────────
-- Quien pide esta URL no es el navegador del usuario: es un servidor de Google
-- o de Apple, sin cookies, sin cabeceras nuestras y sin forma de renovar nada.
-- Eso descarta las tres alternativas obvias:
--
--   · **El JWT de sesión en la URL** — caduca en una hora (el feed moriría solo
--     al día siguiente), no se puede revocar sin cerrar la sesión del usuario en
--     todos sus dispositivos, y sobre todo **autoriza la API entera**: un JWT
--     filtrado no enseña un horario, deja escribir en nombre de su dueño.
--   · **`profiles.referral_code`** — lo aporta el propio usuario al registrarse
--     (`20260729130000:17-34`), o sea que es un secreto que él elige.
--   · **`sessions.session_ref`** — es **no único a propósito** y su comentario
--     lo dice con todas las letras: «etiqueta para hablar, NO autoriza nada»
--     (`20260817140000:130-142`).
--
-- ── QUÉ EXPONE ESTA URL SI SE FILTRA, EXACTAMENTE ───────────────────────────
-- Hay que escribirlo porque es un secreto de baja fricción: viaja en claro
-- dentro de una URL, se queda guardado en la configuración del calendario del
-- usuario y —esto es lo importante— **en los servidores de un tercero**, que lo
-- reusará cada pocas horas durante años.
--
--   Expone, SOLO de su dueño: cuándo tiene clase, cuánto dura, el título de la
--   mentoría, el N.º de sesión y un enlace a nuestra sala (que sigue exigiendo
--   sesión iniciada para entrar, ver `/api/room/[sessionId]`).
--
--   NO expone: correo, teléfono, importes, medios de pago, ni nada de la otra
--   parte más allá de su **nombre enmascarado** («María G.», vía
--   `public.mask_person_name`, la misma regla que firma las reseñas). El nombre
--   completo del alumno o del tutor NO viaja al calendario: quien lea el feed
--   filtrado no debe salir de ahí con una lista de personas identificables.
--
--   NO permite escribir NADA. El token solo abre una función de lectura.
--
-- ── CÓMO SE REVOCA ──────────────────────────────────────────────────────────
-- `revoke_calendar_feed_token()` borra la fila. A partir de ese instante la URL
-- devuelve 404 y el calendario suscrito se queda vacío. Regenerar es revocar +
-- volver a activar: el token viejo no vuelve nunca (es aleatorio, no derivado).
-- ⚠️ Lo que NO podemos hacer es que Google o Apple olviden la URL vieja: eso lo
-- borra el usuario en su aplicación. Por eso revocar tiene que ser barato.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, Y POR QUÉ ────────────────────────────────
-- **No añade `grant select on public.products to service_role`**, que es lo que
-- pedía el diseño de partida (Doc 23 §23.5). Ese grant hace falta si el feed
-- consulta las tablas DIRECTAMENTE con el cliente `service_role` — y tendría
-- razón: `products` solo concede a `anon, authenticated` (`20260706120000:172`)
-- y `service_role` no hereda de `anon`, así que sería `permission denied` en
-- ejecución (regla de oro 9, por cuarta vez).
--
-- Aquí no hace falta porque **el feed no consulta ninguna tabla**: llama a
-- `public.calendar_feed(text)`, que es `security definer` y por tanto lee como
-- su dueño, no como `service_role`. Es el mismo patrón que
-- `pending_email_notifications` (`20260806150000:72-101`), que lee
-- `auth.users` sin que nadie le conceda nada a `service_role`.
--
-- ⚠️ SI ALGÚN DÍA ALGUIEN REESCRIBE EL ROUTE HANDLER PARA CONSULTAR LAS TABLAS
-- A PELO, entonces sí: `grant select on public.products to service_role` en la
-- misma migración, o el feed se cae en runtime y en silencio.
--
-- Y hay una segunda razón, más importante que ahorrarse un grant: con la RPC,
-- **el handler no puede pedir las sesiones de otra persona**. No recibe ningún
-- id de usuario; recibe un token, y quien lo traduce a filas es SQL. Un fallo de
-- filtrado en TypeScript no puede convertirse en una fuga.
-- ============================================================================

-- ── 1) El token ─────────────────────────────────────────────────────────────
-- Tabla propia y no una columna en `profiles`, por dos razones concretas:
--   a) `profiles` la leen doce pantallas; una columna secreta ahí es una que se
--      cuela el día que alguien escriba `select("*")`.
--   b) Aquí caben `created_at` y `last_seen_at`, que es el único diagnóstico
--      real de «¿la suscripción funciona?» — si el calendario nunca ha pasado a
--      buscarla, `last_seen_at` sigue nulo y no hay que adivinar.
create table if not exists public.calendar_feed_tokens (
  -- El token ES la clave: la búsqueda del feed es un `where token = …` y así va
  -- por el índice primario sin uno extra.
  token        text        primary key,
  -- Uno por persona. Dos dispositivos comparten la misma URL a propósito:
  -- tokens por dispositivo multiplican la superficie filtrable y no aportan
  -- nada mientras revocar sea «todo o nada», que es lo que pide el MVP.
  user_id      uuid        not null unique
                           references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- Última vez que un calendario pasó a leerlo. Nulo = nadie se ha suscrito.
  last_seen_at timestamptz
);

comment on table public.calendar_feed_tokens is
  'EY-188: token opaco que autoriza SOLO la lectura del feed .ics de una persona. No es una sesión: no caduca, no autoriza escritura y se revoca borrando la fila.';
comment on column public.calendar_feed_tokens.last_seen_at is
  'Última lectura del feed. Nulo = el calendario del usuario nunca ha venido a buscarlo (o acaba de activarlo).';

-- ── 2) RLS: default-deny SIN NINGUNA POLÍTICA, y eso es la decisión ─────────
-- Regla de oro 1 pide RLS + políticas explícitas. La política explícita aquí es
-- **que no hay ninguna**: nadie —ni el dueño, ni el admin— lee esta tabla por
-- PostgREST. Todo pasa por las funciones `security definer` de abajo.
--
-- Ventaja concreta: el token NO puede aparecer nunca en la respuesta de una
-- consulta de tabla, así que ningún `select("*")` futuro lo puede filtrar, y el
-- panel de admin no puede enseñar el calendario de nadie por accidente.
alter table public.calendar_feed_tokens enable row level security;

-- Grants explícitos (auto-expose OFF): a nadie. El `revoke` es redundante con
-- el default de Postgres y se escribe igualmente para que se lea la intención.
revoke all on public.calendar_feed_tokens from anon, authenticated;

-- ── 3) Generador ────────────────────────────────────────────────────────────
-- 244 bits de aleatoriedad en 64 caracteres hex. Dos UUID v4 concatenados y sin
-- guiones, para que no se confunda con un id de nada.
--
-- ⚠️ `pg_catalog.gen_random_uuid()` va cualificado a propósito: con
-- `search_path = ''` (obligatorio en `security definer`) el nombre a secas
-- podría no resolverse si pgcrypto vive en `extensions`. Desde PG13 la función
-- es núcleo y está en `pg_catalog`; esta base es PG17 (`config.toml:42`).
create or replace function public.gen_calendar_feed_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(
           pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
           '-', '');
$$;

-- No lo llama nadie de fuera: solo las funciones de abajo, que corren como su
-- dueño y por tanto no necesitan grant.
revoke execute on function public.gen_calendar_feed_token() from public;
revoke execute on function public.gen_calendar_feed_token() from anon;
revoke execute on function public.gen_calendar_feed_token() from authenticated;

-- ── 4) Leer el token propio (sin crearlo) ───────────────────────────────────
-- La pantalla de «Mi cuenta» necesita saber si la sincronización está activa
-- SIN activarla de paso. Si `my_calendar_feed_token()` creara la fila, todo el
-- que abre su cuenta acabaría con un secreto emitido que nunca pidió.
create or replace function public.my_calendar_feed_token()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.token
    from public.calendar_feed_tokens t
   where t.user_id = (select auth.uid());
$$;

revoke execute on function public.my_calendar_feed_token() from public;
revoke execute on function public.my_calendar_feed_token() from anon;
grant  execute on function public.my_calendar_feed_token() to authenticated;

-- ── 5) Activar (crear-o-devolver) ───────────────────────────────────────────
-- Idempotente a propósito: pulsar «Activar» dos veces no invalida la URL que el
-- usuario ya pegó en su calendario. Rotar es una acción DISTINTA y con nombre
-- distinto, porque rota un secreto y rompe suscripciones vivas.
create or replace function public.calendar_feed_token()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_token text;
begin
  if v_user is null then
    raise exception 'auth requerido' using errcode = 'insufficient_privilege';
  end if;

  -- ⚠️ El `do update` NO toca `token`: reasigna `user_id` a sí mismo. Es el
  -- truco de siempre para que un upsert devuelva la fila también cuando ya
  -- existía —`do nothing` no devuelve nada y obligaría a un `select` detrás que
  -- en la carrera de dos pestañas leería NULL, porque la fila de la otra aún no
  -- está confirmada—. Y sobre todo: `do update set token = excluded.token`
  -- habría ROTADO el secreto en silencio, dejando muerta la URL que el usuario
  -- ya pegó en su calendario. Activar es idempotente; rotar tiene otro nombre.
  insert into public.calendar_feed_tokens (user_id, token)
  values (v_user, public.gen_calendar_feed_token())
  on conflict (user_id) do update set user_id = excluded.user_id
  returning token into v_token;

  return v_token;
end;
$$;

revoke execute on function public.calendar_feed_token() from public;
revoke execute on function public.calendar_feed_token() from anon;
grant  execute on function public.calendar_feed_token() to authenticated;

-- ── 6) Revocar ──────────────────────────────────────────────────────────────
-- Borrar la fila es la revocación completa: la URL pasa a 404 en la siguiente
-- lectura del calendario. Devuelve si había algo que borrar, para que la
-- pantalla no anuncie «desconectado» cuando ya lo estaba.
create or replace function public.revoke_calendar_feed_token()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_n    integer;
begin
  if v_user is null then
    raise exception 'auth requerido' using errcode = 'insufficient_privilege';
  end if;

  delete from public.calendar_feed_tokens where user_id = v_user;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke execute on function public.revoke_calendar_feed_token() from public;
revoke execute on function public.revoke_calendar_feed_token() from anon;
grant  execute on function public.revoke_calendar_feed_token() to authenticated;

-- ── 7) El feed ──────────────────────────────────────────────────────────────
-- Devuelve `null` si el token no existe (revocado o inventado) y un objeto con
-- los eventos si existe. La diferencia importa: «token desconocido» tiene que
-- ser 404, y «suscripción válida sin clases» tiene que ser un calendario vacío
-- pero legítimo. Un `returns table` no sabe distinguir las dos cosas.
--
-- `security definer` + grant SOLO a `service_role`: la función NO es alcanzable
-- desde `anon`, así que nadie puede tirarle tokens a fuerza bruta directamente
-- contra PostgREST, saltándose nuestro Route Handler.
--
-- ── QUÉ ENTRA EN EL FEED Y QUÉ NO ───────────────────────────────────────────
-- Un feed que anuncia clases que no existen es peor que no tener feed. Las
-- reglas, con el porqué:
--
--   · **Fuera `pending_payment`.** `create_booking` inserta las `sessions` ANTES
--     de cobrar (`20260715170000:211-217`): son el hold del hueco, y el hold
--     dura 7 minutos (`20260826120000`). Publicarlos llenaría el calendario de
--     clases que se evaporan solas.
--   · **`pending_acceptance` entra como TENTATIVE.** Ya está pagada y el hueco
--     está tomado; lo único que falta es que el tutor acepte. `TENTATIVE` es
--     exactamente lo que el formato tiene para eso.
--   · **Las canceladas entran como lápida (`STATUS:CANCELLED`), no desaparecen**
--     — pero SOLO si llegaron a cobrarse. Un hold caducado nunca estuvo en el
--     feed, así que anunciar su cancelación sería inventar una clase que el
--     usuario no vio jamás. El discriminante es el pago: `expire_stale_bookings`
--     deja el pago en `failed` (`20260826120000:105-106`), mientras que una
--     cancelación de verdad lo deja en `paid`/`refunded`.
--   · **Ventana de 90 días hacia atrás, sin límite hacia adelante.** ⚠️ Con esto
--     las clases de hace más de tres meses desaparecen del calendario suscrito
--     (un feed suscrito no acumula: el cliente refleja lo que hay). Se acepta:
--     el historial de verdad vive en el panel, y un feed sin techo es cómo este
--     endpoint acabaría tardando segundos para los tutores con más recorrido.
create or replace function public.calendar_feed(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user    uuid;
  v_tz      text;
  v_eventos jsonb;
begin
  -- Corte barato antes de tocar la tabla: el token real son 64 hex.
  if p_token is null or length(p_token) <> 64 then
    return null;
  end if;

  -- Se marca la lectura en el mismo golpe que se resuelve el dueño. Un token
  -- que no existe no coincide con ninguna fila, así que los intentos a ciegas
  -- no escriben nada.
  update public.calendar_feed_tokens
     set last_seen_at = now()
   where token = p_token
  returning user_id into v_user;

  if v_user is null then
    return null;
  end if;

  select coalesce(p.timezone, 'UTC') into v_tz
    from public.profiles p
   where p.id = v_user;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'session_id',   x.session_id,
               'start_at',     x.start_at,
               'end_at',       x.end_at,
               'created_at',   x.created_at,
               'updated_at',   x.updated_at,
               'estado',       x.estado,
               'secuencia',    x.secuencia,
               'titulo',       x.titulo,
               'con',          x.con,
               'session_ref',  x.session_ref,
               'sequence_no',  x.sequence_no,
               'num_sessions', x.num_sessions
             )
             order by x.start_at
           ),
           '[]'::jsonb)
    into v_eventos
    from (
      select s.id          as session_id,
             s.start_at,
             s.end_at,
             s.created_at,
             s.updated_at,
             s.session_ref,
             s.sequence_no,
             b.num_sessions,
             pr.title      as titulo,
             -- ⚠️ Nombre ENMASCARADO, no el completo: esto viaja a un tercero.
             -- Misma regla que firma las reseñas (`20260729150000:26-42`).
             public.mask_person_name(
               case when s.student_id = v_user then tut.full_name
                    else stu.full_name end
             )             as con,
             case
               when s.status = 'cancelled'
                 or b.status in ('cancelled', 'refunded') then 'cancelada'
               when b.status = 'pending_acceptance'       then 'tentativa'
               else 'confirmada'
             end           as estado,
             -- SEQUENCE del .ics: segundos entre el alta y el último cambio de
             -- la fila. No es «número de revisión» pero cumple lo único que el
             -- formato exige —que no decrezca— y sale de una columna que ya
             -- mantiene el trigger `sessions_set_updated_at`
             -- (`20260709140000:90`). Alternativa descartada: el epoch a secas,
             -- que se sale de un entero de 32 bits en 2038.
             least(
               greatest(
                 0,
                 floor(extract(epoch from (s.updated_at - s.created_at)))
               )::bigint,
               2147483647
             )::integer    as secuencia
        from public.sessions s
        join public.bookings b   on b.id  = s.booking_id
        join public.products pr  on pr.id = b.product_id
        left join public.profiles tut on tut.id = s.tutor_id
        left join public.profiles stu on stu.id = s.student_id
       where (s.student_id = v_user or s.tutor_id = v_user)
         and s.start_at >= now() - interval '90 days'
         and b.status <> 'pending_payment'
         and (
              (s.status <> 'cancelled' and b.status not in ('cancelled', 'refunded'))
              or exists (
                   select 1
                     from public.payments pay
                    where pay.booking_id = b.id
                      and pay.status in ('authorized', 'paid',
                                         'partially_refunded', 'refunded')
                 )
             )
       order by s.start_at
       -- Techo de seguridad, no de producto. Un tutor a 5 clases diarias suma
       -- ~450 solo en los 90 días de atrás, así que 500 se quedaba corto de
       -- verdad. Con 1000 el .ics ronda los 250 KB, que es un tamaño razonable
       -- para algo que se descarga entero cada pocas horas.
       limit 1000
    ) x;

  return jsonb_build_object('ok', true, 'timezone', v_tz, 'eventos', v_eventos);
end;
$$;

revoke execute on function public.calendar_feed(text) from public;
revoke execute on function public.calendar_feed(text) from anon;
revoke execute on function public.calendar_feed(text) from authenticated;
grant  execute on function public.calendar_feed(text) to service_role;
