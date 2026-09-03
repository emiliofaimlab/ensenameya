-- ============================================================================
-- Enséñame Ya — C2m · el destino de cobro que NO es una cuenta bancaria.
--
-- Hoy un tutor venezolano no tiene forma de decir a dónde cobrar. Y no es un
-- hueco de formulario: es que la única tabla de datos de cobro que existe
-- —`tutor_payout_accounts` (`20260901160000`)— no puede guardarlo, y ensancharla
-- para que pudiera sería estropear justamente lo que la hace buena:
--
--   · `bank_account ~ '^[0-9A-Za-z.-]{4,34}$'` → rechaza la `@` de un correo.
--   · `bank_code` NOT NULL con FK contra `payout_banks` → un correo de PayPal no
--     cuelga de ningún banco, y el catálogo de bancos es de los 8 países de
--     dLocal, que NO incluyen Venezuela.
--   · `beneficiary_document` NOT NULL → dLocal exige documento fiscal; Zelle no
--     sabe qué es eso.
--   · PK por tutor → un solo riel. Aquí hacen falta varios (el mismo tutor puede
--     tener Zinli y Zelle y querer que probemos por orden).
--
-- Aflojar cualquiera de esos cuatro para meter Venezuela dentro convierte una
-- tabla estricta en una tabla laxa **para los ocho países que sí la usan**. Se
-- hace lo contrario: tabla aparte, con su propio catálogo de formatos, y
-- `tutor_payout_accounts` se queda exactamente igual de dura que ayer.
--
-- ── QUÉ ES «MANUAL» AQUÍ, Y POR QUÉ ESTÁN LOS CINCO JUNTOS ──────────────────
--
-- `docs/PAGOS-Y-PAYOUTS.md` §4 clasifica los canales de Venezuela en dos
-- automáticos (Airtm ~1 %, PayPal 2 %) y tres manuales (Zinli, Binance, Zelle).
-- En esta tabla están **los cinco como manuales**, y no es un error de lectura:
-- la decisión de producto del 2-sep es que **no se escriben adaptadores para
-- rieles sin cuenta**. No hay cuenta de PayPal, ni de Airtm, ni de Wise, y por
-- tanto tampoco habrá sandbox que pruebe el adaptador. Lo que sí hay hoy —y es
-- la fase 1 del orden de trabajo de §10, la más urgente porque la deuda con los
-- tutores que ya trabajaron no espera— es **un admin pagando a mano y
-- necesitando saber a dónde**. Eso es lo que esta migración desbloquea.
--
-- El día que se abra la cuenta de Airtm, su fila NO se borra de aquí: se le
-- escribe un adaptador y su `payment_routing_rules.payout_provider` deja de ser
-- `'simulated'`. El canal manual sigue existiendo como respaldo, que es
-- exactamente lo que hace falta cuando un payout automático vuelve `REJECTED`.
--
-- ── LA CONVERSIÓN NO SE PROMETE (decisión del cliente, 2-sep) ───────────────
--
-- Fijamos lo que PAGAMOS nosotros (`payouts.amount`, en USD, sale de nuestro
-- balance) y el tutor recibe el equivalente en su moneda al tipo del proveedor:
-- **el spread lo asume el tutor**. En este riel eso se nota el doble, porque a
-- ese spread se le suma el descuento invisible del P2P venezolano
-- (`docs/PAGOS-Y-PAYOUTS.md` §4). Por eso los textos de ayuda de este catálogo
-- dicen «recibes el equivalente», nunca una cifra: el único canal de todo el
-- sistema donde el importe en destino es exacto es Ecuador, que paga en USD y no
-- pasa por aquí.
--
-- ── EL TITULAR TIENE QUE SER EL TUTOR ───────────────────────────────────────
--
-- §4 lo deja escrito y aquí se repite porque es la regla que más se intenta
-- saltar: «págale a mi primo que tiene Zelle» destruye la trazabilidad y es
-- exactamente el patrón que no puede entrar en el flujo. `holder_name` existe
-- para poder cotejarlo con el KYC, no para que el tutor nombre a un tercero.
-- No hay `check` que lo garantice —dos personas pueden llamarse igual y el
-- nombre del KYC vive en otra tabla— así que es una regla de operaciones con
-- soporte de esquema, no un invariante. El `comment on column` lo dice, para que
-- quien mire la columna dentro de un año no tenga que deducirlo.
--
-- ── PRIVACIDAD: SE COPIA EL PATRÓN DE B1, NO SE REINVENTA ───────────────────
--
-- Un correo de PayPal o un teléfono de Zelle son PII de la misma familia que un
-- número de cuenta, así que se aplica el mismo cerrojo de `20260901160000`:
-- RLS default-deny, UNA política de select de la fila propia, **grants por
-- columna dejando `handle` fuera** (el tutor lee `handle_masked`), CERO grants
-- de escritura para nadie —la única puerta es un RPC `security definer`— y un
-- bloque `DO` al final que **aborta la migración** si `anon` o `authenticated`
-- pueden leer `handle`.
--
-- ⚠️ UNA DIVERGENCIA DELIBERADA CON B1, Y CONVIENE LEERLA ANTES DE COPIARLA:
-- B1 le negó a `service_role` hasta el `select`, porque C2 no necesita la tabla
-- sino UN beneficiario por orden, y eso es `payout_beneficiary(payout_id)`.
-- Aquí `service_role` **sí** tiene `grant select` incluyendo `handle`, porque el
-- riel manual tiene una operación que el automático no tiene: **una persona
-- sentada pagando una lista**. Un admin que va a hacer treinta transferencias a
-- mano necesita la lista entera, no treinta llamadas de una en una. La función
-- `manual_destination(tutor_id)` sigue existiendo y sigue siendo la puerta
-- grepeable para el caso de uno solo.
-- El coste de esa decisión es real y hay que dejarlo escrito: **un
-- `.select("*")` distraído desde un `createAdminClient()` devuelve todos los
-- correos y teléfonos de los tutores**. En B1 eso era imposible; aquí no lo es.
-- Si algún día se prefiere cerrarlo, el cambio es quitar el grant y dar a
-- `manual_destination` una variante de lista — no hay nada más atado a él.
--
-- ── REGLA DE ORO 10 (PGRST201): comprobado, no hay ambigüedad ───────────────
--
-- `tutor_manual_payout_destinations` referencia `profiles` y
-- `payout_manual_channels`. La trampa de `tutor_views` (`20260827140000`) fue
-- unir DOS tablas que ya tenían FK directa entre sí, con lo que PostgREST se
-- encontró dos caminos para el mismo embed y devolvió `PGRST201`. Aquí no pasa:
-- `profiles` y `payout_manual_channels` no se conocían de nada, así que la única
-- relación nueva es `profiles ↔ tutor_manual_payout_destinations`.
--
-- El embed vivo que había que mirar es el de la cola de payouts del admin,
-- `src/app/(app)/admin/payouts/page.tsx:65-67`:
--
--     .from("payouts").select("…, profiles(full_name)")
--
-- `payouts → profiles` sigue teniendo UN solo camino (`payouts.tutor_id`): esta
-- tabla no referencia `payouts`, así que no añade un segundo. **Ese embed no se
-- vuelve ambiguo y no hay que nombrar la FK.** Si mañana alguien añade aquí una
-- columna `payout_id`, deja de ser cierto — y el síntoma será «(0)» en una cola
-- con filas, igual que el 28-ago.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · `payout_manual_channels` — el catálogo. Es documentación, no PII.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Mismo criterio que `payout_country_rules`: **las reglas son dato**. Abrir un
-- canal nuevo, corregir una regex que rechaza correos buenos o apagar uno que
-- Legal ya no admite tiene que ser un `insert`/`update`, no un despliegue. Y
-- aquí hay un caso concreto y cercano, no hipotético: Binance (ver la siembra).
--
-- La etiqueta del identificador vive en esta tabla y no en el TSX por lo mismo
-- que en B1: si el texto que lee el tutor («Correo de PayPal») y la regex que
-- valida lo que escribe están en ficheros distintos, se desincronizan, y el
-- único que se entera es él, tres semanas después, cuando no ha cobrado.
create table public.payout_manual_channels (
  channel        text        primary key
                 check (channel ~ '^[a-z][a-z0-9_]{1,30}$'),
  label          text        not null check (btrim(label) <> ''),
  help           text        not null check (btrim(help) <> ''),

  -- Cómo se llama el identificador EN ESTE CANAL. No es cosmético: «Correo de
  -- PayPal» y «Teléfono o correo de Zelle» son dos preguntas distintas, y
  -- ponerle a las dos «Identificador» es cómo se consigue que un tutor teclee su
  -- número de teléfono en la casilla de PayPal.
  handle_label   text        not null check (btrim(handle_label) <> ''),

  -- Regex POSIX contra la que se valida `handle` ya normalizado (minúsculas si
  -- lleva `@`, sin espacios ni guiones si no). La aplica
  -- `upsert_manual_destination`; el `check` de la tabla de destinos es solo la
  -- red genérica de debajo.
  handle_pattern text        not null check (btrim(handle_pattern) <> ''),

  sort_order     int         not null default 100,

  -- Se desactivan, NO se borran: hay tutores colgando por FK y borrar el canal
  -- de alguien es dejarle sin cobrar por un cambio de configuración que él no
  -- hizo. Mismo criterio que `payout_banks.is_active`.
  is_active      boolean     not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger payout_manual_channels_set_updated_at
  before update on public.payout_manual_channels
  for each row execute function public.set_updated_at();

comment on table public.payout_manual_channels is
  'Catálogo de los canales de cobro NO bancarios con los que se le paga a mano a un tutor (hoy: Venezuela). Es la contrapartida de payout_country_rules para el riel manual: aquí vive la etiqueta que lee el tutor Y la regex que valida lo que escribe, juntas a propósito. No es PII —es documentación de producto— y por eso authenticated la lee entera; anon no, porque nadie sin sesión tiene nada que hacer aquí (regla de oro 1). Los cinco canales están como manuales, PayPal y Airtm incluidos, porque la decisión del 2-sep-2026 es no escribir adaptadores para rieles sin cuenta.';

comment on column public.payout_manual_channels.handle_pattern is
  'Regex POSIX contra la que upsert_manual_destination valida el handle YA NORMALIZADO (minúsculas cuando lleva @; sin espacios, puntos, guiones ni paréntesis cuando no). Es dato y no código para poder aflojarla sin desplegar: rechazar un identificador bueno deja al tutor sin cobrar y sin a quién reclamar, que es el mismo criterio con el que payout_country_rules toma siempre la variante permisiva cuando la documentación se contradice.';

comment on column public.payout_manual_channels.is_active is
  'Apagar un canal es un UPDATE, no una migración. El caso previsto no es hipotético: Binance está aquí porque la decisión 4 del cliente lo admite «solo a petición», pero docs/PAGOS-Y-PAYOUTS.md §4 documenta que enviar USDT desde wallet propia es transmisión de dinero sin licencia (Fla. Stat. §560.103). El día que Legal diga que no, esto se pone a false y el canal desaparece del formulario sin tocar una fila de nadie.';

-- ── RLS + grants ────────────────────────────────────────────────────────────
-- Default-deny y luego se abre lo justo (regla de oro 1). `authenticated` lo lee
-- entero porque lo necesita para dibujar el formulario. `anon` NADA. Y
-- `service_role` tampoco: quien lee este catálogo del lado servidor son los tres
-- RPC de abajo, que son `security definer` y corren como su dueño.
alter table public.payout_manual_channels enable row level security;

create policy "payout_manual_channels_select_auth"
  on public.payout_manual_channels for select
  to authenticated
  using ( true );

grant select on public.payout_manual_channels to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Siembra — los cinco canales de `docs/PAGOS-Y-PAYOUTS.md` §4
-- ════════════════════════════════════════════════════════════════════════════
--
-- Las regex son a propósito **estrictas en la forma y ciegas en el fondo**: un
-- correo tiene que parecer un correo y un teléfono un teléfono, pero no se
-- comprueba que la cuenta exista —no hay endpoint que lo diga en ninguno de los
-- cinco— y no se validan dominios ni prefijos de país. Ese es el mismo trato que
-- B1 hace con los dígitos verificadores: un algoritmo inventado rechaza cuentas
-- buenas, y aquí el rechazo falso lo paga el tutor.
--
-- ponytail: NO hay `unique (channel, handle)`. Sería la forma obvia de cazar el
-- «págale a mi primo» (dos tutores declarando el mismo Zelle) y aun así no se
-- pone, por dos motivos: el mensaje de un `unique_violation` de Postgres lleva
-- **el valor de la clave dentro**, o sea el handle, que es justo lo que
-- `20260901170000` acaba de sacar de los mensajes de error; y compartir un
-- identificador no es prueba de nada por sí solo. El techo es que ese cruce hoy
-- no lo hace nadie: es un chequeo de operaciones sobre el listado que devuelve
-- `manual_destination`, no una restricción de esquema.
insert into public.payout_manual_channels
  (channel, label, help, handle_label, handle_pattern, sort_order)
values
  ('paypal', 'PayPal',
   'Recibes en tu saldo de PayPal. Las cuentas venezolanas de PayPal son en dólares, así que no hay conversión por nuestro lado; lo que hagas después con el saldo (cambiarlo a bolívares) corre por tu cuenta y a tu tipo de cambio.',
   'Correo de tu cuenta PayPal',
   '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$',
   10),

  ('airtm', 'Airtm',
   'Recibes en tu cuenta de Airtm, en dólares. Es el canal con menos comisión de los cinco. Tienes que tener la cuenta verificada a tu nombre: una cuenta sin verificar rechaza los ingresos.',
   'Correo de tu cuenta Airtm',
   '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$',
   20),

  ('zinli', 'Zinli',
   'Recibes en tu cuenta Zinli, en dólares. Se envía a mano, así que puede tardar más que los demás: si tienes prisa, elige otro canal.',
   'Correo de tu cuenta Zinli',
   '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$',
   30),

  -- ⚠️ Binance: activo porque la decisión 4 del cliente lo admite «solo a
  -- petición», y con la salvedad legal escrita en `is_active` arriba. El
  -- identificador de Binance Pay es un número (Pay ID) o el correo de la cuenta;
  -- se admiten los dos porque la app enseña uno u otro según por dónde entres, y
  -- obligar al tutor a encontrar el que nosotros hemos decidido es otra forma de
  -- que no cobre.
  ('binance', 'Binance',
   'Recibes en tu cuenta de Binance. Se envía a mano y solo a petición. Comprueba dos veces el identificador: un envío a un destino equivocado no se puede recuperar.',
   'Pay ID o correo de tu cuenta Binance',
   '^([0-9]{6,12}|[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,})$',
   40),

  -- ⚠️ Zelle es red de EE. UU. a EE. UU.: solo sirve si el tutor tiene una
  -- cuenta bancaria PROPIA allí (§4). La regla del titular, que en los otros
  -- cuatro es de trazabilidad, aquí es además la condición para que el envío
  -- llegue siquiera. Admite teléfono o correo porque Zelle admite los dos y el
  -- tutor rara vez sabe cuál «es» el suyo.
  ('zelle', 'Zelle',
   'Recibes en la cuenta bancaria de Estados Unidos asociada a tu Zelle. Solo funciona si esa cuenta es tuya: Zelle no permite recibir en la cuenta de otra persona.',
   'Teléfono o correo de tu Zelle',
   '^([a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}|\+?[0-9]{10,15})$',
   50);


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · `tutor_manual_payout_destinations` — LA PII
-- ════════════════════════════════════════════════════════════════════════════
--
-- Varias filas por tutor, al revés que B1: la PK es `(tutor_id, channel)`. No es
-- capricho — dLocal quiere UN beneficiario por payout y por eso allí la PK es el
-- tutor; aquí el que paga es una persona, y esa persona quiere poder intentar
-- Zinli y, si el tutor no lo confirma, tirar de Zelle. Modelarlo como uno solo
-- obligaría al tutor a editar su ficha cada vez, que es cuando se introducen las
-- erratas.
create table public.tutor_manual_payout_destinations (
  tutor_id      uuid        not null
                references public.profiles (id) on delete cascade,
  channel       text        not null
                references public.payout_manual_channels (channel),

  -- El titular. No hay `check` que garantice que es el tutor (ver la cabecera);
  -- lo que hay es esta columna, para poder cotejarla con el KYC antes de mandar
  -- el dinero. Se normaliza el espacio interior para que «Ana  Pérez» y
  -- «Ana Pérez» no sean dos titulares distintos a ojo del admin.
  holder_name   text        not null
                check (btrim(holder_name) <> '' and length(holder_name) <= 120),

  -- El identificador en claro. SIN `grant select` para `anon` ni para
  -- `authenticated`: lo que se devuelve al navegador es `handle_masked`.
  -- El `check` es genérico a propósito —quien decide el formato de verdad es la
  -- regex del canal, que es dato y se puede corregir sin migración— y está aquí
  -- solo como red, igual que los `check` de `tutor_payout_accounts`.
  handle        text        not null
                check (handle ~ '^[^[:space:]]{5,120}$'),

  -- Lo único del identificador que sale hacia el navegador. Precedente directo:
  -- `tutor_payout_accounts.bank_account_last4` y, antes, `payment_methods.last4`.
  -- Enseña lo justo para contestar la única pregunta que el tutor se hace al
  -- volver a la pantalla —«¿registré el correo correcto?»—: el dominio entero,
  -- que es lo que distingue un gmail de un hotmail, y las dos primeras letras
  -- de la parte local. Si la parte local es de dos caracteres o menos no se
  -- enseña ninguna, porque enseñar «jo» de «jo@…» es enseñarlo entero.
  -- Los identificadores que no son correo (Pay ID, teléfono) se reducen a los
  -- cuatro últimos, que es lo que el tutor reconoce de su propio número.
  --
  -- Generada y STORED: `strpos`, `split_part`, `left`, `right` y `length` son
  -- inmutables, así que Postgres la admite.
  handle_masked text        generated always as (
                  case
                    when strpos(handle, '@') > 0 then
                      (case
                         when length(split_part(handle, '@', 1)) <= 2 then '····'
                         else left(split_part(handle, '@', 1), 2) || '····'
                       end) || '@' || split_part(handle, '@', 2)
                    else '····' || right(handle, 4)
                  end
                ) stored,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (tutor_id, channel)
);

-- Sin índice extra, y se dice por qué para que no se añada por reflejo: la PK es
-- `(tutor_id, channel)` y su índice ya lleva `tutor_id` de primera columna, que
-- es por donde entran las tres funciones de abajo. El lado `channel` no lo
-- necesita: el catálogo tiene cinco filas y sus filas no se borran nunca
-- (`is_active = false`), así que no hay un `delete` en el padre que tenga que
-- barrer este hijo. (Mismo criterio que `payout_banks` en `20260901160000`.)

create trigger tutor_manual_payout_destinations_set_updated_at
  before update on public.tutor_manual_payout_destinations
  for each row execute function public.set_updated_at();

comment on table public.tutor_manual_payout_destinations is
  'A dónde se le paga a mano a un tutor cuando su país no tiene riel bancario (hoy: Venezuela). Es la hermana no bancaria de tutor_payout_accounts y sigue su mismo patrón de privacidad: RLS de dueño, sin anon, escritura SOLO por upsert_manual_destination / delete_manual_destination (RPC security definer) y lectura enmascarada por column-grants — handle no tiene grant select para authenticated, así que PostgREST no puede devolverlo al navegador por ninguna puerta. Varias filas por tutor, al revés que B1: el que paga es una persona y necesita poder tirar de un segundo canal. ⚠️ A diferencia de B1, service_role SÍ tiene grant select sobre handle, porque el riel manual tiene una operación que el automático no tiene: un admin pagando una lista entera a mano.';

comment on column public.tutor_manual_payout_destinations.holder_name is
  '⚠️ EL TITULAR DE LA CUENTA TIENE QUE SER EL TUTOR. docs/PAGOS-Y-PAYOUTS.md §4: pagar a un tercero («págale a mi primo que tiene Zelle») destruye la trazabilidad y es exactamente el patrón que no puede entrar en el flujo. Esta columna existe para poder cotejarlo con el KYC antes de mandar el dinero, no para que el tutor nombre a otra persona. No es un invariante de esquema —dos personas pueden llamarse igual y el nombre del KYC vive en otra tabla— sino una regla de operaciones con soporte de columna.';

comment on column public.tutor_manual_payout_destinations.handle is
  'El identificador en claro: correo de PayPal/Airtm/Zinli, Pay ID o correo de Binance, teléfono o correo de Zelle. Normalizado por upsert_manual_destination (minúsculas si lleva @; sin espacios, puntos, guiones ni paréntesis si no). SIN grant select para anon ni para authenticated: al tutor se le devuelve handle_masked. service_role sí lo lee, para el listado de pago manual del admin.';

comment on column public.tutor_manual_payout_destinations.handle_masked is
  'Enmascarado para la pantalla del tutor: «jo····@gmail.com» para un correo, «····1234» para un teléfono o un Pay ID. Contesta la única pregunta que se hace al volver —si registró el destino correcto— sin meter un identificador de pago en el payload del RSC, en la caché del navegador y en la pantalla de un locutorio. Un carácter equivocado EN MEDIO no lo caza el ojo de todas formas; lo caza el proveedor al rechazar el envío.';

-- ── RLS: default-deny y una sola política ───────────────────────────────────
-- SOLO select, y solo de la fila propia. No hay política de insert, update ni
-- delete para nadie: la escritura entera pasa por los dos RPC `security definer`
-- de abajo, que no necesitan ni política ni grant. Que la política no exista es
-- el segundo cerrojo — si mañana alguien añade un `grant insert` por costumbre,
-- seguirá sin poder escribir (regla de oro 1).
--
-- Y NO hay política de admin, por el mismo razonamiento que B1: ninguna tarea de
-- admin sobre payouts pasa por leer esto con la sesión del admin desde un Server
-- Component. Quien paga a mano lo hace desde un Route Handler con
-- `service_role`, que se salta la RLS y tiene su grant explícito más abajo.
alter table public.tutor_manual_payout_destinations enable row level security;

create policy "tutor_manual_payout_destinations_select_own"
  on public.tutor_manual_payout_destinations for select
  to authenticated
  using ( (select auth.uid()) = tutor_id );

-- ── Grants por columna: aquí es donde se enmascara ──────────────────────────
-- Ausente a propósito: `handle`. Un `select=*` sobre esta tabla con la sesión
-- del tutor devuelve 42501, que es exactamente lo que se quiere.
grant select (
  tutor_id,
  channel,
  holder_name,
  handle_masked,
  created_at,
  updated_at
) on public.tutor_manual_payout_destinations to authenticated;

-- `anon`: NADA. Es medio aviso de esta migración.
--
-- `service_role`: select CON `handle`, y solo select. Es la divergencia con B1
-- explicada en la cabecera, y hace falta escribirla explícitamente por la regla
-- de oro 9: `service_role` se salta la RLS pero **no** los grants de tabla, y con
-- «auto-expose new tables» en OFF un job que lea esto sin este grant come
-- `permission denied` en tiempo de EJECUCIÓN — no en el build, no en el
-- typecheck. Mordió tres veces el 6-ago.
--
-- Escritura: para NADIE, `service_role` incluido. El admin no corrige el correo
-- de un tutor; se lo pide. Una escritura de admin sobre un destino de pago es
-- indistinguible de un secuestro de payout, y no hay tarea que la necesite.
grant select (
  tutor_id,
  channel,
  holder_name,
  handle,
  handle_masked,
  created_at,
  updated_at
) on public.tutor_manual_payout_destinations to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · `upsert_manual_destination` — la ÚNICA puerta de escritura
-- ════════════════════════════════════════════════════════════════════════════
--
-- No hay `grant insert` ni política de insert para ningún rol, así que esto no
-- es «la forma recomendada»: es la única. Lo mismo que `upsert_payout_account`.
--
-- ⚠️ Y EL INSERT VA DENTRO DE SU PROPIO BLOQUE, que es la lección entera de
-- `20260901170000`: cuando salta un `check` de tabla, Postgres construye el
-- mensaje de error **con la fila que lo violó dentro**, PostgREST lo devuelve
-- tal cual al navegador y el servidor lo escribe en su log. En esta tabla esa
-- fila lleva el correo o el teléfono del tutor. O sea que el mecanismo que
-- existe para proteger el dato sería, al fallar, el que lo publica.
--
-- El camino no es teórico: la validación amable (la regex del canal, que se
-- puede aflojar sin desplegar) y el `check` crudo de la tabla no son idénticos a
-- propósito, así que hay un hueco entre los dos por el que se llega al `insert`
-- con algo que la primera dejó pasar.
create or replace function public.upsert_manual_destination(
  p_channel     text,
  p_holder_name text,
  p_handle      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_ch     public.payout_manual_channels%rowtype;
  v_canal  text;
  v_holder text;
  v_handle text;
begin
  if v_uid is null then
    raise exception 'requiere sesión' using errcode = 'insufficient_privilege';
  end if;

  -- Guard de rol, y de paso el mismo que usa B1: un alumno no tiene fila en
  -- `tutor_profiles`. No se mira `payout_country`: el riel manual existe
  -- justamente para los países que NO están en el desplegable de dLocal, así que
  -- exigir un país declarado aquí sería exigir precisamente lo que falta.
  if not exists (
    select 1 from public.tutor_profiles tp where tp.profile_id = v_uid
  ) then
    raise exception 'solo un tutor puede registrar un destino de cobro'
      using errcode = 'insufficient_privilege';
  end if;

  v_canal := lower(btrim(coalesce(p_channel, '')));

  select * into v_ch
    from public.payout_manual_channels c
   where c.channel = v_canal
     and c.is_active;
  if not found then
    raise exception 'ese canal de cobro no existe o ya no está disponible'
      using errcode = 'check_violation';
  end if;

  -- ── Normalización ─────────────────────────────────────────────────────────
  -- El titular pierde el espacio de sobra («Ana  Pérez» → «Ana Pérez») para que
  -- el admin no vea dos titulares donde hay uno. NO se toca el uso de mayúsculas:
  -- un apellido no es nuestro para reescribirlo.
  v_holder := btrim(regexp_replace(coalesce(p_holder_name, ''), '\s+', ' ', 'g'));

  -- El identificador se parte en dos casos y no en uno, porque son dos tipos de
  -- dato distintos disfrazados de columna única:
  --   · con `@` es un correo → minúsculas (la parte del dominio no distingue
  --     mayúsculas y ningún proveedor de los cinco distingue la local),
  --   · sin `@` es un teléfono o un Pay ID → se le quitan los adornos con los
  --     que la gente escribe los números: espacios, paréntesis, puntos y
  --     guiones. «+1 (305) 555-1234» y «+13055551234» son el mismo teléfono, y
  --     guardar las dos formas sería guardar dos verdades del mismo dato.
  v_handle := btrim(coalesce(p_handle, ''));
  if strpos(v_handle, '@') > 0 then
    v_handle := lower(v_handle);
  else
    v_handle := regexp_replace(v_handle, '[\s().-]', '', 'g');
  end if;

  if v_holder = '' then
    raise exception 'falta el nombre del titular: tiene que ser el tuyo, el de la cuenta a la que cobras'
      using errcode = 'check_violation';
  end if;
  if v_handle = '' then
    raise exception 'falta el dato de %', v_ch.handle_label
      using errcode = 'check_violation';
  end if;

  -- La validación de formato. ⚠️ El mensaje NO lleva el handle dentro: nombra el
  -- campo y el canal, que es lo que el tutor necesita para corregirlo, y nada
  -- más. Un error de formato no vale un correo en el log de Vercel.
  if v_handle !~ v_ch.handle_pattern then
    raise exception '«%» no tiene el formato que espera %', v_ch.handle_label, v_ch.label
      using errcode = 'check_violation';
  end if;

  begin
    insert into public.tutor_manual_payout_destinations as d
      (tutor_id, channel, holder_name, handle)
    values
      (v_uid, v_canal, v_holder, v_handle)
    on conflict (tutor_id, channel) do update
       set holder_name = excluded.holder_name,
           handle      = excluded.handle
     where d.tutor_id = v_uid;

    -- Se devuelve el resumen ENMASCARADO, no la fila: así el formulario repinta
    -- sin volver a consultar y sigue sin haber un camino por el que un
    -- identificador de pago llegue entero al navegador.
    return (
      select jsonb_build_object(
        'channel',       d.channel,
        'label',         v_ch.label,
        'holder_name',   d.holder_name,
        'handle_masked', d.handle_masked,
        'updated_at',    d.updated_at
      )
        from public.tutor_manual_payout_destinations d
       where d.tutor_id = v_uid
         and d.channel  = v_canal
    );
  exception
    -- Los tres de `20260901170000`, más `unique_violation`. Ese cuarto no hace
    -- falta hoy —el único índice único es la PK y el `on conflict` la cubre—
    -- pero se deja puesto porque el mensaje de un `unique_violation` lleva **el
    -- valor de la clave** dentro: el día que alguien añada `unique (channel,
    -- handle)` para cazar destinos compartidos, ese mensaje sería el handle
    -- viajando hasta el navegador, y nadie se acordaría de venir aquí.
    when check_violation
      or not_null_violation
      or string_data_right_truncation
      or unique_violation then
      raise exception 'ese dato no tiene el formato que espera %', v_ch.label
        using errcode = 'check_violation';
  end;
end;
$$;

comment on function public.upsert_manual_destination(text, text, text) is
  'Única puerta de escritura de tutor_manual_payout_destinations (la tabla no tiene grant de insert/update para ningún rol, ni política). Lee auth.uid(), exige que sea un tutor, normaliza (minúsculas si el identificador lleva @; sin espacios ni adornos si es un teléfono o un Pay ID), valida contra el handle_pattern del canal y hace upsert. Envuelve el insert para que un check del esquema no devuelva la fila —el correo o el teléfono en claro— al navegador ni al log, que es la lección de 20260901170000. Devuelve el resumen ENMASCARADO, nunca la fila.';

-- 🔴 En Postgres el EXECUTE de una función nueva se concede a PUBLIC por
-- defecto, y PostgREST publica las funciones de `public` como
-- `POST /rest/v1/rpc/<nombre>`. Sin estos revokes, esto sería un endpoint
-- anónimo que escribe destinos de cobro.
revoke execute on function public.upsert_manual_destination(text, text, text) from public;
revoke execute on function public.upsert_manual_destination(text, text, text) from anon;
grant  execute on function public.upsert_manual_destination(text, text, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · `delete_manual_destination` — el tutor puede retirar un canal
-- ════════════════════════════════════════════════════════════════════════════
--
-- Existe por lo mismo que existe el upsert: la tabla no tiene `grant delete`
-- para nadie, así que sin esto un tutor que se equivoca de canal no puede
-- quitarlo, solo sobreescribirlo — y un destino que ya no controla ahí colgado
-- es exactamente el que acaba recibiendo un pago.
--
-- BORRA, no desactiva: aquí no hay contabilidad que conservar. Lo que se pagó ya
-- está en `payouts`, con su `provider_metadata`, y esta fila no es la prueba de
-- nada. (Y ojo con lo contrario, que es el error de bulto: NO se vuelca el
-- destino dentro de `payouts.provider_metadata` «para dejar traza», porque
-- `payouts` no se borra nunca y cualquier admin lo lee de por vida — es la misma
-- advertencia que `20260901160000` §9 escribió para B1.)
create or replace function public.delete_manual_destination(p_channel text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_canal text;
begin
  if v_uid is null then
    raise exception 'requiere sesión' using errcode = 'insufficient_privilege';
  end if;

  v_canal := lower(btrim(coalesce(p_channel, '')));

  delete from public.tutor_manual_payout_destinations d
   where d.tutor_id = v_uid
     and d.channel  = v_canal;

  -- No es idempotente a propósito: si el tutor cree que tenía Zelle registrado y
  -- no lo tenía, la pantalla tiene que decírselo. Un «borrado» silencioso de
  -- algo que no existía es cómo se convence a alguien de que ya retiró un dato
  -- que sigue vivo en otro canal.
  if not found then
    raise exception 'no tenías ese canal de cobro registrado'
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object('channel', v_canal, 'deleted', true);
end;
$$;

comment on function public.delete_manual_destination(text) is
  'Retira un canal de cobro manual del propio tutor. Es la otra mitad de upsert_manual_destination: la tabla no tiene grant de delete para ningún rol. Borra de verdad —aquí no hay contabilidad que conservar, eso vive en payouts— y levanta no_data_found si no había nada, para que la pantalla no le diga a nadie que retiró un dato que sigue vivo.';

revoke execute on function public.delete_manual_destination(text) from public;
revoke execute on function public.delete_manual_destination(text) from anon;
grant  execute on function public.delete_manual_destination(text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · `manual_destination` — la lectura del identificador entero
-- ════════════════════════════════════════════════════════════════════════════
--
-- El equivalente de `payout_beneficiary` para el riel manual, con una diferencia
-- que viene del modelo: allí la orden decide el beneficiario, porque dLocal
-- quiere uno solo y el país tiene que cuadrar con `payouts.payee_country`. Aquí
-- el destinatario es una persona con varias formas de cobrar, y quien elige por
-- cuál se paga es el admin mirando la lista. Por eso la firma es por tutor y no
-- por payout, y por eso devuelve TODOS sus canales.
--
-- 🔴 Y por eso los cuatro revokes de abajo no son costumbre, son el cerrojo: una
-- `security definer` que devuelve identificadores de pago, publicada por
-- PostgREST y sin revoke, es un endpoint ANÓNIMO que devuelve los correos y
-- teléfonos de todos los tutores a quien le pase un uuid.
create or replace function public.manual_destination(p_tutor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dest jsonb;
begin
  if p_tutor_id is null then
    raise exception 'falta el tutor' using errcode = '22004';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'channel',      d.channel,
             'label',        c.label,
             'holder_name',  d.holder_name,
             'handle',       d.handle,
             'handle_masked', d.handle_masked,
             'is_active',    c.is_active,
             'updated_at',   d.updated_at
           )
           order by c.sort_order, d.channel
         )
    into v_dest
    from public.tutor_manual_payout_destinations d
    join public.payout_manual_channels c on c.channel = d.channel
   where d.tutor_id = p_tutor_id;

  -- Legible, como `payout_beneficiary`: quien llama a esto está a punto de
  -- mandar dinero, y «null» no es una respuesta que se pueda leer a las once de
  -- la noche pagando la lista.
  if v_dest is null then
    raise exception 'el tutor no ha registrado ningún destino de cobro manual'
      using errcode = 'no_data_found';
  end if;

  -- Se devuelve `is_active` del canal en vez de filtrarlo: si Legal apagó
  -- Binance ayer, el admin tiene que VERLO —el tutor sigue esperando su dinero y
  -- hay que decirle que elija otro—, no que el canal desaparezca de la lista sin
  -- explicación. Filtrar aquí sería convertir un apagado de catálogo en un tutor
  -- que parece no haber registrado nada.
  return jsonb_build_object('tutor_id', p_tutor_id, 'destinations', v_dest);
end;
$$;

comment on function public.manual_destination(uuid) is
  'Devuelve los destinos de cobro manual de un tutor CON el identificador en claro, para que el admin pueda pagarle. Es el equivalente de payout_beneficiary para el riel no bancario, con la firma por tutor y no por payout: aquí quien elige el canal es la persona que paga, mirando la lista. Devuelve también is_active del canal en vez de filtrarlo, para que un canal apagado se vea en vez de desaparecer. ⚠️ Sin el revoke de execute a public sería un endpoint anónimo que devuelve los correos y teléfonos de los tutores.';

-- 🔴 Las cuatro líneas que no se pueden olvidar.
revoke execute on function public.manual_destination(uuid) from public;
revoke execute on function public.manual_destination(uuid) from anon;
revoke execute on function public.manual_destination(uuid) from authenticated;
grant  execute on function public.manual_destination(uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · Comprobación en EJECUCIÓN (reglas de oro 9 y 11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- `create or replace` valida la sintaxis, NO ejecuta el cuerpo — es lo que dejó
-- vivo el fallo de `close_expired_sessions()` durante 12.446 corridas. Aquí no
-- se pueden llamar los RPC del tutor (no hay `auth.uid()` en una migración), así
-- que se ejercita lo que sí se puede: las cinco regex sembradas, contra un caso
-- bueno y uno malo de cada una. Si alguna clasifica mal, la migración NO aplica.
do $$
declare
  r     record;
  v_pat text;
begin
  for r in
    select * from (values
      -- Los correos, en los tres canales que solo admiten correo. El handle va
      -- ya normalizado (minúsculas), que es como llega al `~`.
      ('paypal',  'tutor@gmail.com',            true),
      ('paypal',  'tutor@gmail',                false),  -- sin TLD
      ('paypal',  '+13055551234',               false),  -- un teléfono no es un correo
      ('airtm',   'tutor.mentor+ey@correo.com', true),
      ('airtm',   'arroba-ninguna.com',         false),
      ('zinli',   'tutor@hotmail.com',          true),
      ('zinli',   'tutor@@hotmail.com',         false),

      -- Binance: Pay ID numérico o correo.
      ('binance', '123456789',                  true),
      ('binance', 'tutor@gmail.com',            true),
      ('binance', '12345',                      false),  -- corto para ser un Pay ID
      ('binance', 'no-es-ni-uno-ni-otro',       false),

      -- Zelle: teléfono o correo. El teléfono llega ya sin adornos: el
      -- normalizador de `upsert_manual_destination` convierte
      -- «+1 (305) 555-1234» en «+13055551234» antes de llegar al `~`.
      ('zelle',   '+13055551234',               true),
      ('zelle',   '3055551234',                 true),
      ('zelle',   'tutor@gmail.com',            true),
      ('zelle',   '5551234',                    false)   -- demasiado corto
    ) as t(canal, handle, ok)
  loop
    select c.handle_pattern into v_pat
      from public.payout_manual_channels c
     where c.channel = r.canal;

    if v_pat is null then
      raise exception 'C2m: el canal % no quedó sembrado', r.canal;
    end if;

    if (r.handle ~ v_pat) <> r.ok then
      raise exception 'C2m: el canal % clasifica mal un identificador (esperaba %)',
        r.canal, r.ok;
    end if;
  end loop;

  if (select count(*) from public.payout_manual_channels) <> 5 then
    raise exception 'C2m: deberían quedar 5 canales sembrados';
  end if;

  raise notice 'C2m: las cinco regex ejercitadas, 15 casos, todo cuadra.';
end;
$$;

-- Y el otro sitio donde este proyecto se ha quemado: los grants, que muerden en
-- tiempo de ejecución y no en el build (regla de oro 9). Aquí se comprueba
-- sobre todo lo contrario de lo habitual —que NADIE de más puede leer el
-- identificador— porque el modo de fallo de esta migración no es un 42501 en un
-- job: es el correo de un tutor publicado.
do $$
declare
  v_col text;
  v_rol text;
begin
  -- `anon`: ni una columna, ni una escritura. Se pregunta con `has_*_privilege`
  -- y no leyendo `information_schema` porque esas vistas solo enseñan lo
  -- concedido a un rol activo, y aquí lo que se quiere saber es que NO hay nada.
  -- Un privilegio concedido a PUBLIC lo heredan todos los roles, así que
  -- preguntar por `anon` cubre también el grant a PUBLIC olvidado, que es el
  -- peligroso.
  foreach v_col in array array['handle', 'holder_name', 'tutor_id', 'handle_masked'] loop
    if has_column_privilege('anon'::name, 'public.tutor_manual_payout_destinations', v_col, 'select') then
      raise exception 'C2m: anon puede leer tutor_manual_payout_destinations.% y no debería', v_col;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.payout_manual_channels', 'select') then
    raise exception 'C2m: anon puede leer el catálogo de canales y no debería';
  end if;

  -- `authenticated`: lee lo enmascarado y NADA del identificador.
  if has_column_privilege('authenticated'::name, 'public.tutor_manual_payout_destinations', 'handle', 'select') then
    raise exception 'C2m: authenticated puede leer el handle — la lectura tiene que ir enmascarada';
  end if;
  if not has_column_privilege('authenticated', 'public.tutor_manual_payout_destinations', 'handle_masked', 'select') then
    raise exception 'C2m: authenticated NO puede leer handle_masked — la pantalla del tutor no podrá enseñar nada';
  end if;

  -- Escritura: para NADIE de los tres. La única puerta son los dos RPC.
  foreach v_rol in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_rol::name, 'public.tutor_manual_payout_destinations', 'insert')
       or has_table_privilege(v_rol::name, 'public.tutor_manual_payout_destinations', 'update')
       or has_table_privilege(v_rol::name, 'public.tutor_manual_payout_destinations', 'delete') then
      raise exception 'C2m: % puede escribir en tutor_manual_payout_destinations — las puertas son upsert_manual_destination y delete_manual_destination', v_rol;
    end if;
  end loop;

  -- `service_role` SÍ lee el identificador: es la divergencia deliberada con B1,
  -- y se afirma en positivo porque sin ella el listado de pago manual del admin
  -- come `permission denied` en ejecución (regla de oro 9).
  if not has_column_privilege('service_role', 'public.tutor_manual_payout_destinations', 'handle', 'select') then
    raise exception 'C2m: service_role NO puede leer el handle — el admin no podrá pagar a mano';
  end if;

  -- 🔴 Los cerrojos de los tres RPC.
  if has_function_privilege('anon', 'public.manual_destination(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.manual_destination(uuid)', 'execute') then
    raise exception 'C2m: manual_destination es ejecutable sin service_role — endpoint que devuelve identificadores de pago';
  end if;
  if not has_function_privilege('service_role', 'public.manual_destination(uuid)', 'execute') then
    raise exception 'C2m: service_role NO puede ejecutar manual_destination — el admin no podrá pagar a mano';
  end if;
  if has_function_privilege('anon', 'public.upsert_manual_destination(text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.delete_manual_destination(text)', 'execute') then
    raise exception 'C2m: anon puede escribir destinos de cobro';
  end if;
  if not has_function_privilege('authenticated', 'public.upsert_manual_destination(text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_manual_destination(text)', 'execute') then
    raise exception 'C2m: el tutor no puede registrar ni retirar su destino de cobro';
  end if;

  raise notice 'C2m: superficie comprobada — el identificador no lo lee ni anon ni authenticated, y nadie escribe por PostgREST.';
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 8 · ⚠️ LO QUE ESTA MIGRACIÓN DEJA ABIERTO, Y NO ES MENOR
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 `anonymize_account` NO borra esta tabla. Se dice aquí, arriba del todo de
-- lo pendiente, porque es una fuga de PII y no un detalle:
--
--   · La FK a `profiles` es `on delete cascade`, pero **la cascada no se dispara
--     nunca**: al darse de baja, `profiles` no se borra, se VACÍA (bloque 3.2 de
--     `20260901160000`). Ese mismo razonamiento está escrito allí, al lado del
--     `delete from public.tutor_payout_accounts`, que existe justamente porque
--     confiar en la cascada dejaría el número de cuenta vivo para siempre.
--   · Esta tabla no está en esa lista, porque no existía cuando se escribió.
--     Resultado: hoy, un tutor venezolano que se da de baja deja su correo de
--     PayPal o su teléfono de Zelle en la base de datos **indefinidamente**.
--
-- No se arregla aquí a propósito: el arreglo es `create or replace` de
-- `anonymize_account` ENTERA (Postgres no sabe parchear un cuerpo de función), y
-- esa función se está tocando desde varios sitios estos días — dos migraciones
-- que la reemplacen en paralelo se pisan y la última gana en silencio, que es
-- exactamente cómo se pierde un `delete`. Va en su propia migración, con la
-- función delante:
--
--     delete from public.tutor_manual_payout_destinations where tutor_id = p_user_id;
--
-- justo debajo del `delete from public.tutor_payout_accounts` del bloque 3.6, y
-- por el mismo motivo que aquel está ahí y no en `request_account_deletion`: en
-- `request_account_deletion` sería un interbloqueo (se le borran los datos → el
-- payout `scheduled` no se puede pagar → pasa a `failed` → `failed` bloquea la
-- baja → la cuenta queda desactivada para siempre y el tutor no cobra nunca).
--
-- ── Y lo que NO es un hueco, para que no se «arregle» ───────────────────────
--
-- ponytail: no hay preferencia de canal ni orden de intento. Con la PK por
-- `(tutor_id, channel)` el tutor puede tener los cinco y no hay columna que diga
-- por cuál se prueba primero. El techo es deliberado: quien paga es una persona
-- mirando `manual_destination`, y una persona no necesita que le ordenen una
-- lista de cinco. El día que haya un adaptador automático —Airtm es el
-- candidato— ese adaptador querrá saber cuál es «el bueno», y ESE día se añade
-- la columna con el caso de uso delante.
--
-- ponytail: no hay estado de verificación del destino («confirmado por el
-- tutor», «rechazado por el proveedor»). Hoy la confirmación es que el dinero
-- llegó, y quien lo sabe es el admin que lo mandó. Un `status` aquí sería una
-- máquina de estados que nadie hace avanzar, que es la peor clase de estado:
-- el que miente.
