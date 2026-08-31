-- ============================================================================
-- Enséñame Ya — CHECKOUT DE INVITADO · el límite por IP, contado donde dura
--
-- QUÉ ARREGLA. `POST /api/checkout/invitado` crea cuentas con `service_role` y
-- SIN autenticar: es la única puerta del sitio por la que se entra sin sesión y
-- se sale con una fila en `auth.users` (más las tres que escribe
-- `handle_new_user`: perfil, rol y constancia de términos). Su primer límite se
-- contaba en un `Map` de módulo, o sea en la MEMORIA DE LA INSTANCIA — y en
-- Vercel eso no limita nada: cada instancia arranca con el mapa vacío, la
-- plataforma escala por concurrencia y recicla instancias solas, así que 50
-- peticiones en paralelo pasaban 5 × (nº de instancias) y esperar a un arranque
-- en frío devolvía el contador a cero. El techo estaba escrito en el propio
-- fichero; esta migración es el precio que allí se dijo que no se había pagado.
--
-- POR QUÉ UNA TABLA Y NO OTRA COSA. Es el patrón que ya funciona en
-- `contact_messages` (`20260817120000`): contar filas por IP en una ventana. Un
-- almacén compartido (Redis/Upstash) sería una dependencia nueva y un captcha es
-- una decisión de producto; la base ya está aquí y es el único estado que
-- comparten todas las instancias.
--
-- POR QUÉ UNA TABLA APARTE Y NO `profiles.created_at`. Contar altas por fecha
-- daría un tope GLOBAL —bloqueable por cualquiera con un script, y encima
-- mezclado con las altas de `/signup`—. Aquí se cuentan INTENTOS por origen, que
-- es lo que hay que frenar, y solo los de esta puerta.
--
-- LO QUE ESTA TABLA NO ARREGLA (dicho aquí para que no se lea como una
-- protección completa): una IP por visitante sigue siendo una IP por visitante
-- —un bot con proxies o tráfico residencial reparte y pasa—, y una salida NAT
-- compartida (un colegio, una operadora móvil) comparte cupo. Esto acota el
-- daño; no lo cierra. El cierre de verdad es un captcha, y no está decidido.
--
-- ⚠️ REGLA DE ORO 9. `service_role` se salta la RLS pero NO los grants de tabla,
-- y este proyecto tiene "auto-expose new tables" en OFF. Sin el `grant` de abajo
-- el handler come `permission denied` en TIEMPO DE EJECUCIÓN —no en el build, no
-- en el typecheck— y, peor todavía: el límite dejaría de contar justo en el
-- endpoint que lo necesita.
--
-- 20260817120000 (precedente) · 20260831130000 (el resto del checkout invitado)
-- ============================================================================

create table public.signup_attempts (
  id         uuid        primary key default gen_random_uuid(),

  -- La IP tal como la identifica el handler. `text` y no `inet` a propósito: la
  -- cabecera la puede escribir cualquiera y el handler mete en un cubo común
  -- ('sin-ip') todo lo que no parezca una dirección, así que aquí no siempre
  -- entra algo que `inet` sepa parsear — y un insert que revienta sería un
  -- límite que se apaga solo. El tope de 45 es la longitud de una IPv6 con
  -- IPv4 embebida.
  ip         text        not null check (char_length(ip) between 1 and 45),

  created_at timestamptz not null default now()
);

-- La única consulta que se hace: los intentos de UNA ip en los últimos minutos.
create index signup_attempts_ip_recent_idx on public.signup_attempts (ip, created_at desc);

-- ── RLS: default-deny y sin ninguna política ────────────────────────────────
-- Nadie lee esto desde el cliente: son IP de gente sin cuenta, o sea dato
-- personal, y no hay pantalla que las enseñe. El único camino es el Route
-- Handler con `service_role`, que se salta la RLS.
alter table public.signup_attempts enable row level security;

-- ── Grants (auto-expose OFF) ────────────────────────────────────────────────
-- `select` para contar, `insert` para anotar el intento y `delete` porque la
-- retención la hace el propio handler: en cada llamada borra lo anterior a la
-- ventana, que es lo que impide que esta tabla crezca sin tope. Nada de `all`,
-- y ni `authenticated` ni `anon` reciben nada.
grant select, insert, delete on public.signup_attempts to service_role;
