# Enséñame Ya — QA y checklist de lanzamiento (US-1602 · `EY-83`)

> **Qué es esto.** Lo que hay que comprobar antes de abrir la plataforma, y el resultado de la última
> pasada. No es una lista de buenas intenciones: cada tabla de abajo se **ejecutó** contra dev y se
> pegó su salida real. Cuando algo no se pudo verificar, lo dice.
>
> Última pasada completa de la matriz RLS: **2026-07-29** (dev, `lbtpnszjjsxbeileqsja`). Desde
> entonces solo hay repasos puntuales, y cada sección dice cuál es el suyo.
>
> 🔴 **Lo que este documento NO cubre todavía, y es lo más grande que hay abierto: el cobro.** El
> dictado de pagos del 9-sep-2026 (`docs/DICTADO-PAGOS.md`) reestructuró cobro y payout, está
> desplegado en producción, y **su camino principal —el checkout transparente de dLocal— no tiene
> aquí ni una fila de prueba ejecutada**. Las filas que hay que ejercitar están escritas en **§2.5**,
> vacías, esperando a que alguien las corra.
>
> 🔴 **Y la matriz de RLS de §1 va muy por detrás del esquema.** Ver el aviso del principio de §1.

---

## 1. RLS por rol — la barrera de verdad

> 🔴 **ESTA MATRIZ ES DEL 2026-07-29 Y EL ESQUEMA HA CRECIDO 25 TABLAS DESDE ENTONCES. Dieciocho de
> ellas no aparecen ni una vez en este documento**, así que su RLS **no está verificada aquí**. No se
> reconstruye la matriz entera en esta edición porque hacerlo exige ejecutarla con las cuatro cuentas,
> y una matriz inventada es peor que ninguna. Lo que sí se hace es decir exactamente qué falta:
>
> | Tabla nueva sin verificar | Migración que la crea | Por qué importa |
> | :-- | :-- | :-- |
> | `orders` | `20260827150000` | es dinero: la cabecera de una compra de varias líneas |
> | `tutor_payout_accounts` | `20260901160000` | **coordenadas bancarias del tutor** — el dato más sensible del esquema |
> | `tutor_manual_payout_destinations` | `20260902110000` | destinos manuales de Venezuela (Binance, Zinli, Zelle) |
> | `tutor_payout_preferences` | `20260908120000` | por dónde prefiere cobrar el tutor |
> | `payout_country_rules` · `payout_banks` | `20260901160000` | documentación de proveedor: `authenticated` la lee a propósito, pero eso hay que **comprobarlo**, no suponerlo |
> | `payout_manual_channels` | `20260902110000` | ídem, para los canales manuales |
> | `conversations` · `conversation_reads` · `conversation_reports` | `20260817210000` | la bandeja, y **el admin no debe leer el chat** (RN-41) |
> | `message_reads` | `20260817190000` | quién leyó qué mensaje |
> | `product_availability_rules` | `20260817200000` | disponibilidad por producto |
> | `calendar_feed_tokens` | `20260826210000` | **un token de feed es una URL que da acceso sin sesión** |
> | `tutor_views` | `20260827140000` | ⚠️ y **volvió ambiguos los embeds de PostgREST** entre `profiles` y `tutor_profiles` (regla de oro 10) |
> | `storage_purge_queue` | `20260827190000` | cola del barrido de ficheros de cuentas dadas de baja |
> | `account_suspensions` | `20260828130000` | acciones del admin sobre usuarios |
> | `contact_message_attachments` | `20260828161500` | adjuntos del formulario público |
> | `timezone_countries` | `20260908130000` | tabla de consulta; de aquí sale el país de cobro del alumno |
>
> Las que sí están comprobadas —una a una, no por matriz— son `contact_messages`,
> `terms_acceptances`, `late_payment_refunds`, `refund_requests`, `signup_attempts`,
> `account_deletions` y `account_deletion_requests`: ver el bloque de superficies nuevas de más
> abajo, §2.3 y §4.7.

Ejecutado con las tres cuentas fixture + `anon`. Lo que importa no es que la app funcione: es que
**nadie vea lo que no debe**, aunque llame a la API a pelo.

### Lectura (filas visibles por rol)

| Tabla | anon | alumno | tutor | admin | Correcto porque |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `categories` | 10 | 10 | 10 | 10 | catálogo público |
| `products` (activos) | 10 | 10 | 10 | 10 | catálogo público (RN-24) |
| `tutor_profiles` (aprobados) | 15 | 15 | 15 | 15 | solo aprobados salen |
| `profiles` | **401** | 1 | 1 | 43 | privada: cada uno el suyo, admin todos |
| `bookings` | **401** | 21 | 21 | 54 | solo las propias |
| `payments` | **401** | 21 | 21 | 49 | ídem |
| `payouts` | **401** | 0 | 0 | 4 | el alumno no tiene; este tutor tampoco |
| `messages` | **401** | 20 | 7 | **0** | **ni el admin lee el chat** (RN-41) |
| `notifications` | **401** | 34 | 11 | 90 | por destinatario |
| `verification_documents` | **401** | 0 | 1 | 13 | KYC: el suyo y el admin |
| `alert_acks` | **401** | 0 | 0 | 0 | solo admin (vacía tras la prueba) |
| `payment_webhook_events` | **401** | 0 | 0 | 1 | solo admin |
| `tutors_public` (vista, 4-ago) | 16 | n/v | n/v | n/v | catálogo público; hereda la RLS |

`n/v` = no re-ejecutado el 4-ago. La pasada por rol es del 29-jul, anterior a la vista; lo que se
comprobó ahora es la superficie que importa, `anon`.

**`tutors_public` (migración `20260804120000`, DD-04).** Vista nueva y **pública**: envuelve
`tutor_profiles` con el precio de la mentoría activa más barata, para que el rango de precio de P04
lo resuelva Postgres y no el cliente. No tiene RLS propia —las vistas no la tienen—: la hereda con
`security_invoker = true`, así que mandan `tutor_profiles_select_public` y `products_select_public`.
Sin ese flag correría con los privilegios de su dueño y publicaría tutores no aprobados y productos
en borrador; por eso entra en esta matriz y no de tapadillo. Como `anon`: **16 filas, las 16
`approved`, idéntico a `tutor_profiles`** (que hoy también da 16 — el 29-jul eran 15 porque hay una
cuenta fixture más, no un tutor sin aprobar colándose). Escribirla tampoco es opción: el grant es
solo `select` y Postgres la rechaza antes (`55000`, vista no auto-actualizable).

### Escritura que debe fallar (código HTTP / código Postgres)

| Intento | anon | alumno | tutor | admin |
| :-- | :-- | :-- | :-- | :-- |
| `INSERT payments` | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `INSERT payouts` | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `UPDATE tutor_profiles.approval_status` | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `INSERT user_roles` (auto-hacerse admin) | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `UPDATE notifications.status` | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `INSERT bookings` directo | 401/42501 | 403/42501 | 403/42501 | 403/42501 |

**Incluido el admin**: el dinero y los roles se mueven por RPC `SECURITY DEFINER`, nunca por PATCH
(regla de oro 2 y 7). El script vive en el scratchpad de la sesión; re-crearlo es media hora.

### Grants de `service_role` (6-ago)

**`service_role` se salta la RLS pero NO los grants de tabla.** Son dos barreras distintas —
`bypassrls` es un atributo del rol, los privilegios son del objeto — y saltarse una no da la otra.
Aquí se nota más que en otros proyectos porque los proyectos tienen "auto-expose new tables" en
**OFF**: cada tabla declara a mano a quién expone. Hasta el 6-ago no había un solo camino con
`service_role` en la aplicación, así que ninguna tabla le había concedido nada. La lección mordió
**tres veces el mismo día**, siempre igual: `permission denied for table …` en tiempo de ejecución,
con el build en verde.

| Tabla | Concedido a `service_role` | Migración | Quién lo necesita |
| :-- | :-- | :-- | :-- |
| `sessions` | `select` · `update (recordings_purged_at)` | `20260806140000` | cron de purga de grabaciones |
| `profiles` | `select` · `update (stripe_customer_id)` | `20260806170000` | checkout de Stripe |
| `payments` | `select` · `update (provider_payment_id, provider_metadata)` | `20260806170000` | webhook de Stripe |
| `payment_routing_rules` | `select` · `update (charge_provider, payout_provider, is_active)` | `20260806180000` | cambiar de proveedor sin migración |

**Mínimo privilegio, y comprobado.** Los `update` van acotados **por columna**, no a la tabla. Sobre
`sessions` con la clave de servicio: el PATCH de `recordings_purged_at` pasa (**204**) y el de
`end_at` se **deniega (403)**. Esa es la prueba de que el grant por columna hace lo que dice y de
que una clave de servicio filtrada no puede mover el horario de una clase. Ninguna de las cuatro
concede `insert` ni `delete`; en `payment_routing_rules` es deliberado: inventar o borrar un
corredor de pago —o sea, decidir a dónde va el dinero— sigue exigiendo una migración revisada.

⚠️ **Para la próxima**: cualquier trabajo nuevo con `service_role` sobre una tabla que no sea estas
cuatro se va a estrellar igual hasta que declare sus grants. `notifications`, por ejemplo, sigue
**sin** abrirse a `service_role` a propósito — comprobado, el `select` directo devuelve permission
denied — y el job de correo entra por RPC.

### Superficies nuevas del 17-ago — comprobadas una a una, sin re-ejecutar la matriz

Cinco migraciones del 17-ago añaden tablas o RPC nuevas, y **cuatro de ellas tocan datos sensibles**:
dinero, datos personales del alumno y constancia legal. Lo que sigue es lo que se comprobó al
escribirlas —cada línea sale de su commit—, **no** una nueva pasada completa de §1. La matriz por rol
sigue siendo la del 29-jul y **hay que re-ejecutarla antes de abrir**.

| Superficie | Migración | Qué se comprobó |
| :-- | :-- | :-- |
| `contact_messages` | `20260817120000` | público solo por Route Handler con `service_role`; `anon` no inserta (un `insert` abierto a `anon` es un formulario de spam) |
| `terms_acceptances` | `20260817130000` | **el propio interesado no puede crearla ni borrarla** (403 en insert y delete) — una constancia que el interesado pudiera editar no es una constancia |
| `tutor_students` (RPC) | `20260817150000` | `security definer` con **columnas explícitas** y acotada por reserva compartida: un alumno no lista alumnos (0 filas), no pide un perfil ajeno por id (0 filas) y sigue sin leer `profiles`; `anon` 401 |
| `late_payment_refunds` | `20260817160000` | `anon` 401; grants a `service_role` declarados en la misma migración (regla de oro 9) |
| `refund_requests` | `20260817170000` | `anon` 401, un usuario normal ve 0 filas y su `insert` da 403, y **`enqueue_refund` no es invocable** (404) — encolar reembolsos a mano por la API no debe poder hacerse |

⚠️ **`tutor_students` es la primera excepción a que el tutor no vea ningún dato personal del alumno.**
No es un cambio de copy: es un cambio de privacidad, y la próxima pasada de §1 tiene que entrar por
ahí — probando que un tutor **sin** reserva compartida no obtiene nada.

### Funciones: quién puede invocarlas (6-ago)

`confirm_payment` estaba concedida a `authenticated` y su único control era "eres el dueño de la
reserva": **cualquier alumno con sesión podía marcarse el pago como cobrado desde la consola del
navegador**. No robaba nada porque el proveedor ruteado era `simulated` y no había cobro; el agujero
se abría el día que entrase Stripe o DLocal, si para entonces nadie se acordaba de revocarla. Y
tenía un problema de fondo: comprobaba `auth.uid()`, que en un webhook es `null`, así que la función
que existe para que la llame el proveedor de pago era imposible de llamar por el proveedor de pago.

| Función | `anon` | `authenticated` | `service_role` | Qué comprueba |
| :-- | :-- | :-- | :-- | :-- |
| `confirm_payment` | ✗ | ✗ **403** | ✓ | que la reserva exista; **autoriza el grant**, no la fila |
| `confirm_simulated_payment` | ✗ | ✓ | ✓ | ser dueño de la reserva **y** `payments.provider = 'simulated'` |

Verificado contra dev con la cuenta de alumno: `confirm_payment` devuelve **403 permission denied
for function**; `confirm_simulated_payment` sigue aplicando sus dos comprobaciones, y una reserva
real creada y confirmada por el camino nuevo llega a `pending_acceptance` con el pago `paid` — el
`SECURITY DEFINER` sí alcanza la función interna. La reserva de prueba quedó cancelada.

Se revocó de **PUBLIC** primero, no solo de `authenticated`: en Postgres `EXECUTE` se concede a
PUBLIC por defecto y revocar del rol no cierra nada (el gotcha que ya mordió en US-605,
`20260715150000`).

Lo que hace que esto no dependa de acordarse: **el camino del cliente se desarma solo**. En cuanto
`payment_routing_rules` deje de rutear a `simulated`, el snapshot que `create_booking` congela en
`payments.provider` (RN-33) dejará de serlo y `confirm_simulated_payment` empezará a rechazar sin
que nadie toque una línea. El día del lanzamiento no hay que revocar nada: lo impide el dato, no un
punto de una lista.

## 2. Dinero: webhooks, checkout y payouts

**Cómo se rutea el dinero, que es lo que hay que tener en la cabeza para leer el resto de la sección**
(manda `docs/DICTADO-PAGOS.md`):

- **Quién cobra lo decide el país del ALUMNO** — `ruta_de_pago(payments.payer_country).charge_providers`.
  El país se congela al crear la reserva; no se recalcula al pagar.
- **Quién paga al tutor lo decide el país del TUTOR** — `ruta_de_pago(payee_country).payout_providers`.
- **El checkout vive siempre dentro del sitio.** dLocal va por checkout transparente y Stripe por
  Elements; no hay redirección a una página alojada del proveedor.
- **El tutor ve dos tarjetas: PayPal y Banco.** Detrás de Banco compiten **Wise, dLocal y Stripe**, en
  ese orden por coste, y él no ve cuál ejecutó. `20260910180000` lleva una autocomprobación que aborta
  la migración si alguien pone Stripe delante de Wise.
- **La cuenta bancaria por Stripe Connect se eliminó** del producto y del código: la cuenta de
  destinatario la creamos nosotros con los datos que el tutor teclea en nuestro formulario.
- **Los métodos manuales (Binance, Zinli, Zelle) son solo Venezuela**, el único país al que no llega
  ningún riel automático.

### 2.1 Idempotencia de `confirm_payment` (29-jul)

`confirm_payment` con `p_event_id`, sobre una reserva de prueba (cancelada al terminar):

| Llamada | Resultado |
| :-- | :-- |
| 1ª con `evt_qa_…` | `pending_acceptance`, pago `paid` 18,00 US$ |
| 2ª con **el mismo** `evt_qa_…` | `pending_acceptance` — **no-op**, sin segundo cobro |
| 3ª con **otro** id sobre la misma reserva | `pending_acceptance` — **no-op** por estado |

Doble idempotencia (por id de evento **y** por estado), que es la que salva cuando el proveedor
reintenta con un id nuevo.

### 2.2 Stripe de punta a punta, contra la preview (6-ago)

Ya no es una llamada a la RPC haciéndose pasar por el proveedor: es **Stripe entregando el evento de
verdad, firmado, contra un despliegue de Vercel**. En test mode, que da Sessions, webhooks firmados,
rechazos, expiraciones y reembolsos con solo registrar el email — **el KYC solo bloquea live mode**,
así que la premisa de la épica EY-92 ("no iniciar hasta tener AMBAS cuentas") no se sostenía.

| Paso | Resultado |
| :-- | :-- |
| Session creada desde la preview | importe leído de `payments.gross_amount`, **nunca del navegador** |
| Firma inválida | **400**, no 500 (un 500 hace que Stripe reintente tres días un payload que jamás validará) |
| `checkout.session.completed` válido | reserva `pending_acceptance`, pago `paid`, `provider_payment_id` con el `pi_` |
| **Mismo** event id reenviado | no-op: `paid_at` no se movió |
| Session expirada desde la API de Stripe | reserva `cancelled`, pago `failed`, hueco liberado, `pending_webhooks=0` |

El endpoint está dado de alta en Stripe como **`ensenameya-vercel`**, con los 4 eventos de
`checkout.session`, apuntando a la preview con `?x-vercel-protection-bypass=…`. Sin el bypass,
Deployment Protection devuelve **302** antes de que corra una línea nuestra y el webhook no llega
nunca: es lo primero que hay que mirar si un evento aparece como no entregado.

Dos cosas anotadas para que no sorprendan después:

- El endpoint quedó con API version **2026-06-24.dahlia** y el código fija **2026-07-29.dahlia**.
  Es irrelevante para los campos que se leen, pero conviene saberlo antes de depurar una forma rara.
- **Los reembolsos por webhook quedan fuera a propósito**: `refund_payment` arrastra el mismo bug
  que tenía `confirm_payment` —guarda `has_role('admin')`, inalcanzable para un webhook— y esos
  eventos no se registran todavía, así que no hay un bucle de reintentos esperando.

⚠️ **`payment_routing_rules` se cambia con una MIGRACIÓN, no con un `UPDATE`.** Aquí ponía lo
contrario, y esa frase es la causa de que dev y producción llevaran semanas ruteando distinto: un
`UPDATE` a mano no existe como fichero, así que no hay nada que aplicar en el otro ambiente. El ruteo
entero lo declaran `20260904190000` y las `20260910*` (regla de oro 5). El grant acotado de §1 sigue
existiendo, pero usarlo para mover dinero es el error, no la vía.

### 2.3 Fail-closed: sin secreto no corre nada

Los endpoints que un atacante querría disparar responden igual ante una configuración a medias: **no
procesar**. Lo contrario —seguir adelante sin verificar— convierte un despliegue mal configurado en un
endpoint público que borra datos de usuarios, manda correos, paga o marca reservas como pagadas.

| Endpoint | Sin secreto configurado | Con credencial incorrecta |
| :-- | :-- | :-- |
| `/api/cron/recordings-purge` | **503** | **401** |
| `/api/cron/notifications-send` | **503** | **401** |
| `/api/cron/refunds-process` | **503** | **401** |
| `/api/cron/payouts-process` | **503** | **401** |
| `/api/cron/alertas-resumen` | **503** | **401** |
| `/api/cron/referrals-sync` | **503** | **401** |
| `/api/cuenta/eliminar/barrido` | **503** | **401** |
| `/api/webhooks/stripe` | **503** | **400** (firma inválida o ausente) |
| `/api/webhooks/dlocalgo` | **503** | **400** (firma inválida o ausente) |

Comprobados los tres primeros y el webhook de Stripe el 6-ago. Los dos rieles nuevos
—`payouts-process` y el barrido de bajas— **usan el mismo guardián `CRON_SECRET`**, y el webhook de
dLocal la misma verificación de firma, pero **no se han ejercitado con secreto ausente y con secreto
incorrecto**: son dos `curl` y están sin hacer.

Y una distinción que importa cuando lo que falta es el **proveedor** y no el secreto: ningún job
miente en la base de datos.

| Falta la credencial de… | Qué hace el job |
| :-- | :-- |
| Daily | la purga responde `sin-daily` y **no marca nada** como purgado — sellar una sesión sin haber borrado sería peor que no sellarla |
| Resend | el job de correo no toca la cola: los avisos quedan **`pending`, no `failed`**, y el día que se ponga la clave sale todo lo acumulado en la primera pasada |
| Stripe | el checkout ruteado a Stripe **no cae al simulado** (regalaría clases): el adaptador dice que falta la clave y el resolvedor prueba el siguiente candidato del país |
| dLocal | `/api/pagos/confirmar-dlocal` responde **503 «dLocal Go no configurado»** y el lote de payouts **se para entero** en vez de marcar órdenes como fallidas: lo que le pasa a una le pasaría a todas |
| PayPal / Wise | `puedePagar()` da false y el riel **desaparece de la lista de candidatos sin ruido**; la orden se paga por el siguiente o se queda `scheduled` |

### 2.4 ⚠️ `POST /api/checkout/invitado` — lo que NO garantiza (31-ago)

Es la única puerta del sitio por la que se entra **sin sesión** y se sale con una cuenta: el checkout
de invitado crea al comprador con `auth.admin.createUser` (`service_role`) para poder cobrarle, y por
eso no hereda ninguno de los límites que GoTrue le pone a `signUp`. **Esta ruta no está en la lista
de "protegidas"**, y estas tres cosas hay que leerlas antes de abrir al público:

| Lo que se cerró | Lo que sigue abierto |
| :-- | :-- |
| Origen: se rechaza (403) todo `Origin` / `Sec-Fetch-Site` que no sea el propio, y el `Content-Type` tiene que ser JSON — sin eso, cualquier web ajena creaba cuentas desde el navegador **y la IP** de sus visitantes, sin preflight | Un cliente que no manda esas cabeceras (curl, un script) pasa: no hay nada que comprobar. A ese solo lo frena el límite |
| Límite por IP **contra la base** (`signup_attempts`, `20260831140000`): 5 intentos / 10 min. Antes se contaba en la memoria de la instancia, o sea que en Vercel no limitaba nada. ⚠️ **Falla cerrado**: si la tabla no está (migración sin aplicar) el endpoint responde **503** y no crea ni una cuenta — `db:push` antes de desplegar | Se limita por **origen, no por persona**: un bot con proxies reparte y pasa. Y una salida NAT compartida (colegio, operadora móvil) comparte cupo → el sexto comprador legítimo de esa red en diez minutos se come un 429 en mitad de un pago. Lo único que cierra esto es un **captcha**, que no está decidido |
| La IP se toma de las cabeceras que pone la infraestructura (`x-vercel-forwarded-for`, `x-real-ip`) y no del primer elemento de `x-forwarded-for`, que lo escribe el cliente | Sin verificar contra el borde real de Vercel: si algún día la plataforma cambia qué cabecera pone, hay que volver aquí |

⚠️ **Las cuentas nacidas en este endpoint son «correo NO probado».** Llevan `email_confirm: true`
—hace falta para que haya sesión con la que cobrar— pero **nadie ha demostrado poseer esa
dirección**: basta con teclearla. No son lo mismo que una cuenta confirmada por su dueño desde
`/signup`, y hoy **nada en el panel ni en los recuentos las distingue**. Consecuencias que hay que
tener presentes: un correo mal tecleado crea una cuenta real e irrecuperable (el *reset password* va
al buzón equivocado), y alguien puede crear una a nombre de un tercero. Lo único que lo hace
detectable es que **el alta ya no es muda**: al crear la cuenta se manda un aviso a la dirección
(«se creó una cuenta con tu correo… si no fuiste tú, escríbenos»), directo por `sendEmail` y no por
la cola, porque un aviso de seguridad que llega en la pasada del cron de dentro de 2-6 h no avisa.
Sin `RESEND_API_KEY` ese aviso **no sale** (la credencial es el interruptor), así que en un ambiente
sin correo configurado el agujero está entero.

**Grant nuevo de `service_role`** (regla de oro 9, además de los cuatro de §1):
`signup_attempts` → `select, insert, delete` (`20260831140000`) y `profiles` → `update
(onboarding_complete)` (`20260831130000`).

### 2.5 🔴 El cobro y el payout del dictado — SIN EJECUTAR

**Esta es la laguna más grande del documento.** El checkout transparente de dLocal es el camino de
cobro principal para los países que dLocal cubre, está desplegado en producción, y **no tiene ni una
fila de prueba**. Lo que sigue son las filas que hay que correr; la columna de resultado está vacía a
propósito — rellenarla es la pasada de QA que falta.

**Cómo montar cada caso.** El país del alumno se deduce de su zona horaria
(`pais_de_cobro_por_zona(profiles.timezone)`, tabla `timezone_countries`) y se **congela** en
`payments.payer_country` al crear la reserva. Así que el caso se monta cambiando la zona horaria del
alumno **antes** de reservar, no después. Comprobar con
`select (public.ruta_de_pago('<país>')).charge_providers;` qué riel debería salir.

| # | Caso | Qué debe pasar | Resultado |
| :-- | :-- | :-- | :-- |
| C-1 | **Cobro por Stripe** · alumno con zona europea (país `ES`, sin fila propia → rutea por la de por defecto) | `charge_providers` = `{stripe}`; se monta el Elements con `STRIPE_PUBLISHABLE_KEY`; el importe sale de `payments.gross_amount`, nunca del navegador; `checkout.session.completed` firmado deja la reserva en `pending_acceptance` y el pago `paid` | ⬜ |
| C-2 | **Cobro por dLocal transparente** · alumno de `EC` o `CO` | `charge_providers` empieza por `dlocal`; el formulario de tarjeta se monta **dentro del sitio** (`dlocal-embed.tsx`), sin redirección; el PAN no pasa por nuestro servidor; los tres pasos en orden —`GET /v1/checkout/{token}` → `prepare-confirm` → `confirm`— y el cobro lo acredita **el webhook**, no `/api/pagos/confirmar-dlocal` | ⬜ |
| C-3 | **El país del pagador es obligatorio en el transparente** · el mismo caso sin dirección del alumno | dLocal responde `400 5000 «Empty country not allowed»`. Es el fallo que hay que ver una vez para reconocerlo | ⬜ |
| C-4 | **`/api/pagos/confirmar-dlocal` no escribe en `payments`** · confirmar y mirar la fila | ni una escritura desde esa ruta: acreditar sigue siendo exclusivo del webhook (regla de oro 2). Una respuesta `pagado` de esa ruta significa «dLocal aceptó el cargo», no «hay dinero» | ⬜ |
| C-5 | **El `DP-…` no viene del navegador** · mandar a `confirmar-dlocal` el id de un cobro ajeno | rechazado: el identificador se relee de `payments.provider_payment_id` con `service_role` a partir de un `bookingId`/`orderId` cuya propiedad comprueba la RLS | ⬜ |
| C-6 | **Sin claves de dLocal el alumno igual compra** · quitar `DLOCALGO_API_KEY` con un alumno de `EC` | el resolvedor salta dLocal y cobra por **Stripe**, que está en el `charge_providers` de todas las filas. ⚠️ **Ya no es el estado de producción**: dLocal tiene sus claves de producción desde el 10-sep. El caso sigue siendo válido como prueba del respaldo por país (`docs/ENTORNOS.md` §1.2) | ⬜ |
| P-1 | **Payout por Wise** · tutor de un país con `wise_account_type` y con dirección y teléfono | Wise es el primer candidato de Banco; los cuatro pasos —presupuesto, destinatario, transferencia y **fondeo**— y la fila `paid` con NTF-12. ⚠️ El fondeo falla si el balance está a cero: eso es la tarea diaria de operaciones, no un fallo del riel | ⬜ |
| P-2 | **Payout por dLocal** · tutor de uno de los ocho donde dLocal paga (AR, BR, CL, EC, MX, PE, PY, UY) | dLocal va primero en esos países; el diferencial de cambio se aplica con `DLOCALGO_FX_SPREAD` y el detalle archiva tasa publicada, factor y efectiva | ⬜ |
| P-3 | **Payout por Stripe** · tutor con fecha de nacimiento y condiciones aceptadas | Stripe es el **tercer** riel de Banco, siempre detrás de Wise; la cuenta de destinatario la crea la plataforma con lo que el tutor tecleó; en el historial del tutor pone «Transferencia bancaria» y **no aparece el nombre de Stripe** | ⬜ |
| P-4 | **El tutor no ve qué riel pagó** · los tres casos anteriores, mirando su pantalla | una sola tarjeta de «Banco» y un solo texto, idéntico en los tres | ⬜ |
| P-5 | **Sin los datos de ese riel, el riel no se elige** · tutor con cuenta pero sin dirección | `rielSirveParaEsteTutor` descarta Wise **antes** de elegir y paga el siguiente candidato. Este filtro sí está ejercitado: ver §4.9 | ✅ §4.9 |
| P-6 | 🔴 **Riel rechazado: la orden NO baja al siguiente candidato** · forzar un `rechazado` del proveedor | **medido en el código, no en una pasada**: `src/app/api/cron/payouts-process/route.ts:734` escribe `status: 'failed'`, encola NTF-16 y hace `break`. La cola solo lee `scheduled` y `processing`, así que la pasada siguiente ya no la mira, y **ningún otro riel lo intenta**. Un 422 de Wise deja al tutor sin cobrar aunque Stripe pudiera pagarle | ⬜ |

🔴 **P-6 es el hueco que más duele con tres rieles escondidos detrás de una tarjeta**, y conviene no
confundirlo con el descenso que sí existe. Son dos cosas distintas:

- **Antes de elegir sí hay descenso**, y funciona: `payoutProviderFor` recorre los candidatos del país
  en orden y descarta a los que no sirven —por atadura de balance y por `rielSirveParaEsteTutor`
  (`src/lib/payments/riel-viable.ts`)—, así que un riel al que le faltan los datos de esa persona
  nunca se elige. Verificado en §4.9 con un escenario colombiano.
- **Después de elegir no hay segundo intento.** Los desenlaces no terminales —`sin-datos`,
  `sin-fondos`, `transitorio`, `en-duda`— devuelven la orden a la cola y se reintentan; **el rechazo
  del proveedor, no**. Hoy la orden queda «requiere revisión» y la cierra una persona desde
  `/admin/payouts`. Bajar al siguiente candidato tras un rechazo es **trabajo por escribir**, y el
  tutor no puede hacer nada porque no sabe ni qué riel lo intentó.

## 3. Responsive (US-1601)

Barrido automático de scroll horizontal —el síntoma que delata un layout roto— en **17 rutas** a
**360** y **768** px: públicas, panel de alumno y panel de tutor.

Dos fallos reales, los dos corregidos:

- **`/search` a 360 px** — las cuatro pestañas del *segmented control* sumaban 411 px y sacaban scroll
  a toda la página. Ahora envuelven y su padding se reduce en móvil.
- **Footer a 768 px** — el bloque de texto se quedaba con sus 592 px y dejaba las tres columnas de
  enlaces a ~18 px, con "Privacidad" saliéndose de la pantalla. Ahora los enlaces no encogen y cede el
  párrafo. **Afectaba a todas las páginas**, porque el footer es global.

Tras el arreglo: **17/17 rutas limpias a 360 y 768**, y `/`, `/tutors`, `/search` también a 1024 y 1280.

**Repaso del 4-ago.** `/tutors` cambió después del barrido: el filtro de precio dejó de ser cuatro
tramos fijos y es un deslizador de rango continuo (commits `cccb566` y `96f4e0b`). Re-medido a **360
y 768 px**: sin scroll horizontal (`scrollWidth` = `clientWidth`) y el control se pinta entero
("Inversión por clase", 10,00–120,00 US$). Las otras 16 rutas no se han tocado desde el 29-jul.

⚠️ **Esto no es "el responsive del diseño"**: es que nada se rompa. El diseño de tablet/escritorio
sigue pendiente de Diana (decisión 24) y el panel de **admin es desktop-first** por AC, así que no
entró en el barrido.

---

## 4. Checklist de lanzamiento

### 4.1 Antes de abrir

- [x] **Migraciones aplicadas a prod** por CI al mergear a `main` (`supabase/migrations/`, hoy **178**).
      ⚠️ Cuántas lleva cada ambiente **no se escribe aquí**, que es lo que hizo caducar esta línea dos
      veces: se mira en el último run del workflow de migraciones, y las ramas con
      `git rev-list --left-right --count dev...main`.
- [ ] **`npm run db:types` regenerado** y sin cambios pendientes en el PR.
- [ ] **`lint` + `typecheck` + `build`** en verde.
- [ ] **Cuenta de admin sembrada** en prod (`supabase/seed/admin-bootstrap.sql`) — y **completar su
      onboarding**: el gate de `requireUser` (RN-44) también aplica al admin.
      ⚠️ **Con contraseña propia, y no la de dev** (RV-19): en dev el admin comparte contraseña con
      las 12 cuentas de prueba, y esa contraseña está **en claro en el repositorio público**
      (`supabase/seed/dev-poblar.sql`). Procedimiento, rotación y custodia en
      **`docs/ACCESO-ADMIN-DEV.md`** — el acceso de admin ya no vive en el documento de pruebas.
- [ ] **Categorías reales** cargadas (las 10 del seed son de dev).
- [x] **Páginas legales publicadas** (DD-06 → DL-05). Desde el **17-ago** `/terms` sirve los
      **Términos del cliente** (39 secciones, versión **inglesa, que es la que gobierna** por su §38)
      y `/terms/es` la española; `/privacy` y `/cookies` siguen siendo texto nuestro, porque el
      cliente no mandó esos dos. **En producción responden 200** — reverificado el 10-sep contra
      `ensenameya.com/terms` y `/privacy` (el host viejo ahora es un 308).
- [x] **Constancia de aceptación de términos** (`terms_acceptances`, `20260817130000`): quién, cuándo,
      qué versión y qué idioma. ⚠️ **Las cuentas anteriores al 17-ago no tienen fila** — aceptaron una
      casilla que no dejaba rastro, y de un texto distinto. Decidir antes de abrir si se les vuelve a
      pedir (lo contempla el §34) o se da por buena la anterior.
- [x] **`payment_routing_rules` declarada en migraciones** (`20260904190000` y las `20260910*`), no en
      `UPDATE`s a mano — que es lo que hizo que las dos bases divergieran durante semanas: un `UPDATE`
      no existe como fichero y no hay nada que aplicar en el otro ambiente (regla de oro 5).
      ⚠️ **Ese aviso caducó el 10-sep:** producción lleva `sk_live_` y `pk_live_`, con el webhook de
      live registrado y la firma partida por ámbito. La 4242 ya no vale ahí. Lo que **sí** sigue
      abierto es otra cosa: la cuenta de Stripe **no está activada** (KYC), así que un cobro live se
      rechazaría. Tener las claves no es estar en live (§4.4).
- [x] **Las claves de dLocal en producción — 10-sep**, con `DLOCALGO_API_BASE`. Verificado midiendo
      el webhook: pasó de **503 «sin secreto»** a **400 «sin firma»**. El checkout transparente, que
      es el camino principal del dictado, ya existe en prod (`docs/ENTORNOS.md` §1.2).
- [ ] 🔴 **Correr las doce filas de §2.5**: el cobro y el payout del dictado no tienen ni una prueba
      ejecutada en este documento.
- [ ] 🔴 **Mirar la primera purga de grabaciones el 13-sep-2026** — §4.10. Es la retención que prometen
      las páginas legales y nunca se ha ejercitado.
- [ ] **Cola de correo vieja vaciada** antes de dar reloj a Actions — §4.6. Es lo único de esta lista
      que hay que hacer **en un orden concreto** y que no se puede deshacer.

**Sobre las legales, un hallazgo que nadie había mirado.** El cliente **ya tenía** términos y
privacidad publicados en `ensenameya.com` (GoDaddy, "Última actualización: Marzo 23, 2026"). De ahí
salen el buzón oficial **info@ensenameya.com** y su §8 de limitación de responsabilidad, que se
incorporaron a las páginas de la app. Quedan **dos divergencias deliberadas** con ese texto: el suyo
nombra "Stripe o Mercado Pago" (C-01 no está cerrada del todo) y deja los reembolsos vagos, cuando
RN-37 ya es código. Las dos se reconcilian **con el cliente**, no en el repo.

### 4.2 Variables de entorno (Vercel: Production **y** Preview — y GitHub)

| Variable | Sin ella |
| :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | la app no arranca |
| `DAILY_API_KEY` | sala de video **simulada** |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | sin monitoreo de errores |
| `STRIPE_API_KEY` | el checkout ruteado a Stripe no cae al simulado (regalaría clases): el riel sale de la lista de candidatos |
| `STRIPE_PUBLISHABLE_KEY` | **no se pinta el formulario de pago** aunque la secreta esté puesta: `stripe-embed.tsx` la necesita para `loadStripe()` |
| `STRIPE_WEBHOOK_SECRET` | el webhook no procesa **nada**: 503 |
| `DLOCALGO_API_KEY` · `DLOCALGO_SECRET_KEY` | **no hay checkout transparente**: `/api/pagos/confirmar-dlocal` responde 503 y el lote de payouts se para entero. Es el estado de producción hoy |
| `PAYPAL_CLIENT_ID` · `PAYPAL_SECRET` | el riel de payout de PayPal desaparece de los candidatos, sin error |
| `WISE_API_TOKEN` | ídem con Wise |
| `CRON_SECRET` | los **siete** endpoints programados responden **503** y no corren (§2.3, §4.3) — eran cinco hasta el 11-sep; se sumaron `alertas-resumen` y `referrals-sync` |
| `RESEND_API_KEY` | el job de correo no toca la cola (los avisos se quedan `pending`) y el formulario de contacto guarda pero no entrega → **DL-01 sin cumplir** |
| `REFERRAL_FACTORY_API_KEY` | 🔴 **«Invita y gana» entero, apagado.** ⚠️ Esta fila decía «nada, no la lee nadie» y **caducó el 11-sep**: era cierto el 1-sep y dejó de serlo con Referidos v2. Hoy la leen `src/lib/referral-factory.ts`, `/referidos`, `/api/cron/referrals-sync` y `/admin/referidos`. Sin ella la pantalla carga con «El programa de invitaciones todavía no está activo.», nadie recibe enlace y el cron responde `sin-credencial` **con 200** → el workflow **sale en verde sin haber hecho nada** (regla de oro 11). **Está borrada de Vercel desde el 10-sep: reponerla es el punto de gestión nº 1** (`docs/ENTORNOS.md` §3 C.1) |

Detalle en `docs/ENTORNOS.md`. **`service_role` jamás en `NEXT_PUBLIC_*`** (regla de oro 3).

**Estado real al 30-ago.** Quedan por poner:

- [x] ~~`CRON_SECRET` en Vercel~~ — **ya estaba**. Comprobado el 30-ago sin abrir el panel: sin la
      variable el endpoint responde 503 y con ella 401, y un `curl` sin cabecera a
      `https://ensenameya.com/api/cron/notifications-send` devuelve **401** (reverificado el 10-sep
      en los cuatro endpoints de cron; contra el host viejo hoy saldría un 308).
- [ ] 🔴 **`REFERRAL_FACTORY_API_KEY` en Vercel, en los tres ámbitos** (Development, Preview y
      Production). ⚠️ **Este punto está al revés de como se escribió el 30-ago.** Entonces decía que
      la clave «sale de este checklist» porque no la leía nadie, y que lo que encendía el bloque era
      `NEXT_PUBLIC_REFERRAL_URL`. Con Referidos v2 (11-sep) es exactamente lo contrario: las cuatro
      `NEXT_PUBLIC_REFERRAL_*` **se retiran** (ya no las lee ninguna línea de `src/`) y la credencial
      es el único interruptor. Está **borrada de Vercel desde el 10-sep**.
      **Los cinco puntos de gestión de Referidos v2 viven en `docs/ENTORNOS.md` §3 C.1**: reponer la
      clave, retirar las cuatro variables públicas, apagar la campaña **50297** en Referral Factory,
      fijar los textos de recompensa reales desde `/admin/referidos` (DP-32.1 — los del seed son
      **ejemplos sin aprobar** y hoy se le prometen al usuario tal cual) y medir la cadencia real del
      workflow en las primeras 48 h.

**Y en GitHub**, que es donde viven **seis** relojes desde el 11-sep —correo, reembolsos, payouts,
barrido de bajas, resumen de incidencias y **conversiones de referidos**
(`notifications-`, `refunds-`, `payouts-`, `barrido-bajas-`, `alertas-` y `referrals-cron.yml`)—,
todos compartiendo las dos:

- [x] variable `APP_BASE_URL` = **`https://ensenameya.com`** — puesta el 30-ago apuntando a
      `ensenameya.vercel.app` y actualizada al dominio propio el **10-sep**
- [x] secret `CRON_SECRET`, el mismo valor que en Vercel — **30-ago**
- [ ] *(opcional)* secret `VERCEL_PROTECTION_BYPASS`, solo si `APP_BASE_URL` apunta a una preview

⚠️ **Estas dos faltaron durante cuatro días con los workflows ya en `main`, y el resultado fue
exactamente el diseñado: 30 corridas en rojo (15 y 15) entre el 27 y el 30-ago, el 100 % de las que
hubo.** El fallo cerrado hizo su trabajo; lo que no había era nadie leyendo los correos de GitHub.
Si algún día vuelve a pasar, el diagnóstico son diez segundos: `gh variable list` y `gh secret list`
sobre el repo — si salen vacías, es esto y no el endpoint.

### 4.3 Los jobs, y dónde vive el reloj de cada uno

**Nueve son `pg_cron`, dentro de Postgres.** No están en el repo: `grep -rn "cron.schedule"
supabase/migrations/` es la única forma de encontrarlos.

| Job | Cadencia | Qué pasa si no corre |
| :-- | :-- | :-- |
| `expire-stale-bookings` | `* * * * *` | reservas sin pagar bloquean el hueco para siempre |
| `close-expired-sessions` | `*/5` | sesiones vivas eternamente, sin `no_show` — y de esta función cuelga `bookings.completed_at`, o sea el payout |
| `process-notifications` | `*/2` | nada: esta función **solo informa** |
| `process-payouts` | `*/10` | los payouts no pasan de `scheduled` |
| `run-payout-batch` | lunes 03:00 | **nadie cobra** |
| `purge-expired-messages` | 04:00 | el chat no caduca (RN-41) — y esa retención la prometen las páginas legales |
| `purge-contact-messages` | 04:30 | los mensajes del formulario de contacto no caducan |
| `purge-tutor-views` | 04:30 | la tabla de afinidad crece sin fin |
| `complete-pending-account-deletions` | 05:00 | una baja programada nunca se completa |

⚠️ **`process-notifications` no envía nada, y antes tampoco.** Marcaba **toda** la cola como `sent`
cada 2 minutos sin mandar un solo correo, así que cualquier remitente externo habría llegado siempre
a una cola vacía, corriera cuando corriera. El stub se apagó siguiendo el precedente de la pausa de
la purga del chat (`20260722200000`): la función no se borra ni se desprograma el cron —"si se
desprograma, se olvida"— sino que pasa a **informar**. `select public.process_notifications();` dice
cuánto hay encolado, así que si el remitente se cae la cola se ve **crecer** en vez de desaparecer.

🔴 **Un `pg_cron` que falla no se lo dice a nadie, y hay que ir a mirarlo.** No hay build en rojo, ni
500 en Vercel, ni fila en `notifications`: el error se queda en `cron.job_run_details`. Precedente:
`close_expired_sessions()` acumuló **12.446 fallos seguidos y cero éxitos** por un `case` sin
`::session_status`, mientras el cierre manual del tutor tapaba el agujero. La comprobación **hay que
agregarla por job**, no leer las últimas diez filas:

```sql
select j.jobname, d.status, count(*), max(d.start_time)
  from cron.job_run_details d join cron.job j using (jobid)
 group by 1, 2 order by 1, 2;
```

⚠️ **Leer las diez últimas filas es exactamente el error**: solo salen los jobs frecuentes, y los
cuatro diarios más el semanal quedan fuera de la ventana. `run-payout-batch` es dinero y
`purge-expired-messages` sostiene la retención de los legales: los dos pueden llevar semanas rotos sin
aparecer en esa lista.

⚠️ **Y «arreglado» significa arreglado en su ambiente.** El fallo de `close_expired_sessions` siguió
cayendo en **producción** dos días después de que la migración existiera en `dev`, hasta 12.778
corridas rojas. Un `pg_cron` roto se arregla cuando la migración **aterriza**, no cuando se escribe.

**Siete son HTTP, y su reloj vive fuera de la base de datos.** Postgres no puede llamar a APIs
externas aquí (no está `pg_net`, no hay Vault y el repo es público, así que no tiene dónde guardar una
clave). Los siete se autentican con `Authorization: Bearer $CRON_SECRET` (§2.3). **Eran cinco hasta
el 11-sep**: se sumaron `alertas-resumen` y `referrals-sync`.

| Job | Reloj | Cadencia pedida | Qué pasa si no corre |
| :-- | :-- | :-- | :-- |
| `/api/cron/recordings-purge` | Vercel Cron (`vercel.json`) | `0 4 * * *` | las grabaciones no se borran en Daily (RN-42) |
| `/api/cron/notifications-send` | GitHub Actions (`notifications-cron.yml`) | `*/5 * * * *` | los avisos se quedan en `pending` |
| `/api/cron/refunds-process` | GitHub Actions (`refunds-cron.yml`) | `7,22,37,52 * * * *` | **el dinero no vuelve**: la base de datos y el correo dicen "reembolsado" y el alumno no recibe nada (X-01) |
| **`/api/cron/payouts-process`** | GitHub Actions (`payouts-cron.yml`) | `13 * * * *` | **ningún tutor cobra**: las órdenes se quedan `scheduled` y nadie las empuja al proveedor |
| `/api/cron/alertas-resumen` | GitHub Actions (`alertas-cron.yml`) | `41 * * * *` | el resumen de incidencias no se encola |
| **`/api/cron/referrals-sync`** | GitHub Actions (`referrals-cron.yml`) | `0 * * * *` | ninguna conversión llega a Referral Factory: `profiles.referral_converted_at` se queda a null para siempre y el referidor ve «1 invitado · 0 convertidos» eternamente. ⚠️ **Nadie más lo detecta**: RF no manda webhooks (sus endpoints `webhooks` y `events` son 404), así que o lo ve este cron o no lo ve nadie |
| `/api/cuenta/eliminar/barrido` | GitHub Actions (`barrido-bajas-cron.yml`) | `37 5 * * *` | los ficheros de una cuenta dada de baja **siguen en Storage** aunque la fila diga «anonimizada» |

⚠️ **El barrido de bajas NO cuelga de `/api/cron/`.** Buscar los jobs por ese prefijo lo deja fuera, y
es el que borra datos personales.

🔴 **Y `referrals-sync` tiene un silencio propio que ningún otro tiene.** Sin
`REFERRAL_FACTORY_API_KEY` responde `{"status":"sin-credencial"}` **con 200**, y el workflow da esa
respuesta por buena: **sale en verde sin haber hecho nada**. Es deliberado —no hay nada roto, hay algo
sin configurar, y el día que se ponga la variable sale de golpe todo lo acumulado—, pero es
literalmente el patrón de la regla de oro 11: el fallo no se lo dice a nadie. **La clave está borrada
de Vercel desde el 10-sep** (§4.2 y `docs/ENTORNOS.md` §3 C.1), o sea que hoy ese verde no significa
nada.

Los seis de Actions no están en Vercel Cron porque **el plan Hobby limita los crons a uno al día** y
ese hueco lo gasta la purga. Aunque quedara sitio, la cadencia diaria no sirve para ninguno: un aviso
de "tienes 24 h para aceptar esta reserva" que llega mañana no vale, un reembolso pedido a las 04:05
esperaría un día entero cuando el §13 de los Términos promete devolver "al método de pago original", y
un payout que espera un día es un tutor que no cobra. El de reembolsos va cada **15** y no cada 5
porque, una vez pedido a Stripe, el dinero tarda 5-10 días hábiles en llegar a la tarjeta: lo que
importa no es adelantar diez minutos el envío, es que un 429 del PSP no cueste un día de espera hasta
el reintento.

El peaje de Actions, en los propios workflows:

- 🔴 **la cadencia pedida NO es la que GitHub entrega**: medido sobre corridas reales, **una cada 2-6
  horas**, no una cada 5 o 15 minutos. GitHub estrangula los `cron` cortos y no avisa. No se puede
  planificar con "cada 5 minutos"; si hace falta cadencia de verdad, el arreglo es Vercel Pro o un
  reloj externo, no tocar el `cron:`;
- GitHub los **desactiva tras 60 días sin actividad** en el repo;
- y **solo programa los de la rama por defecto** (`main`): un workflow que solo vive en `dev` **no
  tiene reloj**, por muy bien escrito que esté.

Si los correos, los reembolsos o los payouts dejan de salir sin motivo aparente, mirar esas tres cosas
por ese orden.

⚠️ **La trampa de Deployment Protection también aplica aquí**, y es la misma que ya mordió con el
webhook de Stripe (§2): apuntado a una **preview**, el job se come un **302** antes de que corra una
línea nuestra. Con un webhook se nota (el evento sale como no entregado); con un cron **no se nota
nada**, porque un cron que no llega a ninguna parte se parece a un cron que no tenía trabajo.
`refunds-cron.yml` distingue el 3xx y lo dice con todas las letras, y acepta un secret opcional
`VERCEL_PROTECTION_BYPASS` que manda por cabecera; `notifications-cron.yml` todavía no.

### 4.4 Qué está escrito, qué está probado y qué está desplegado

Son tres preguntas distintas y confundirlas es lo que hace que un lanzamiento salga mal. Riel a riel:

| Riel | Escrito | Probado | En producción |
| :-- | :-- | :-- | :-- |
| **Stripe · cobro** | sí | sí, de punta a punta contra la preview (§2.2) | ✅ **claves live (10-sep)** + webhook de live · ⚠️ la cuenta **sin activar** (KYC), así que un cobro live se rechaza |
| **dLocal · cobro transparente** | sí | contra sandbox al escribirlo; **sin filas de QA** (§2.5) | ✅ **producción (10-sep)**: claves + `DLOCALGO_API_BASE`, medido con el 503 → 400 |
| **PayPal · payout** | sí | sí, con dinero moviéndose y repetido dos veces | ✅ **producción (10-sep)** + Log In with PayPal y `Payouts` habilitado · ⚠️ la app **en revisión** (7 días) |
| **dLocal · payout** | sí | contra sandbox | ✅ **producción (10-sep)**, mismas claves que el cobro |
| **Wise · payout** | sí | los pasos sí, el **dinero no**: el fondeo falla con el balance a cero (§4.9) | ✅ **`WISE_API_TOKEN` en Production (10-sep)** · ⚠️ balance a cero, así que el primer payout espera fondeo |
| **Stripe · payout** | sí, como tercer riel de Banco | la receta completa contra la API en España | ✅ claves live (10-sep) · ⚠️ pendiente la activación |
| **Manuales (Venezuela)** | sí | — | — |

**El interruptor es siempre la credencial.** Ningún riel sin clave rompe el sitio: desaparece de la
lista de candidatos y el siguiente del país se hace cargo (§2.3). Y como **todas** las filas de
`payment_routing_rules` llevan `stripe` en `charge_providers`, nadie se queda sin comprar aunque
falte un riel. ✅ **Y desde el 10-sep no falta dLocal en producción**, así que el camino transparente
—el principal del dictado— ya existe ahí.

✅ **Resuelto el 10-sep: producción ya no cobra en *test mode*.** Lleva `sk_live_` y `pk_live_`, con
el webhook de live registrado y `STRIPE_WEBHOOK_SECRET` partido por ámbito.

⚠️ **Pero tener las claves no es estar en live.** La cuenta de Stripe **no está activada** (KYC:
modelo de negocio, teléfono, entidad, cuenta bancaria) y hasta que lo esté un cobro live se rechaza.
Eso es del cliente. La alternativa sigue en pie si urgiera: sacar `stripe` del ruteo de prod con una
migración.

**Lo que NO es simulado y conviene no volver a marcarlo como pendiente:**

- **Correo** — C-11 resuelta y **cerrada el 10-sep**: **Resend** con el dominio `ensenameya.com`
  **verificado** y `EMAIL_FROM = Enséñame Ya <hola@ensenameya.com>` en los dos ámbitos. El envío es
  real (`/api/cron/notifications-send`) y todo el acoplamiento vive en `sendEmail()` (`lib/email.ts`).
  ✅ **Y el primer correo ya se vio llegar:** las **16 variantes** de las 14 plantillas salieron a un
  buzón real desde el remitente de producción y quedaron aprobadas por el cliente. Resend aceptó las
  16, 0 fallos.
- **Grabación de Daily** — el add-on está **contratado y funcionando** (`GET
  api.daily.co/v1/recordings` devuelve grabaciones `finished`), `DAILY_API_KEY` está puesta desde julio
  y **se graba siempre**: RN-42 dejó de exigir el sí de las dos partes y `recording_allowed()` devuelve
  `true` desde `20260902100000`. Por eso la casilla de la sala dice «Entiendo» y no «Acepto».
  ⚠️ Y quien **arranca** la grabación es `start_cloud_recording` en el token (`mintToken`):
  `enable_recording:"cloud"` solo enciende el botón, no graba. Daily no tiene propiedad de sala para
  esto.
- **El borrado a los 30 días está automatizado** (RN-42), pero **nunca se ha ejercitado** — ver §4.10,
  que es lo que hay que mirar el 13-sep.

**Un bug que hacía fallar US-1802 el 100 % de las veces, en silencio.**
`/api/recordings/[sessionId]` derivaba el nombre de sala como `` `ey-${sessionId}` `` —con guiones— y
`join_session` la crea como `'ey-' || replace(id::text,'-','')` —sin ellos—, así que **no coincidían
nunca** y no se encontraba ninguna grabación. Ahora se lee `sessions.daily_room_name` en vez de volver
a derivar el nombre por segunda vez.

✅ **Cerrado el 10-sep.** Era: `ensenameya.com` servía una landing de GoDaddy que no enlazaba a la
app, con dos juegos de términos vivos. Hoy `ensenameya.com` **es** la app, y `www` y
`ensenameya.vercel.app` son 308 hacia ella preservando la ruta. Con eso muere el segundo juego de
términos. El correo del dominio no se tocó: M365 tras Proofpoint, y `info@ensenameya.com` sigue
siendo el buzón del §39.

### 4.5 Decisiones del cliente que siguen abiertas

C-13 (mercado/Venezuela y métodos) · C-07 (ventana de pago) · C-02/C-04 (retención y agrupación de
payout) · C-05 (no-show) · C-06 (checkout invitado) · C-09 (%s de tiers) · C-12 (opt-out) · C-15
(FX) · C-10 (reglas de referidos) · **C-11 ✅ resuelta** (Resend) · C-14 ✅ resuelta.

Ninguna bloquea el despliegue: todas tienen default operable (ver el tracker de
`docs/PLAN-DESARROLLO.md`).

> 🟢 **SUPERADO EL 11-SEP-2026 — «Referidos v2».** Todo lo que sigue en este apartado hasta el
> «Veredicto» es la **verificación del 1-sep** y se conserva como historia: era verdad entonces y
> explica por qué se rehízo. **Ya no describe el estado de hoy.** La atribución **existe**, y el
> recorrido completo es: `/referidos` da de alta al usuario como referidor en Referral Factory
> (`POST users`) y guarda su código en `referral_memberships` → el usuario comparte
> `https://<origen>/?ref=<code>` —**el enlace lo emitimos nosotros**, que es justo lo que RF no hacía
> y por lo que el `?ref=` no llegaba nunca— → el proxy lo guarda en la cookie `ey-ref` (30 días) →
> el alta lo aterriza en `profiles.referral_code` → el cron `/api/cron/referrals-sync` detecta la
> conversión y la manda a RF. Esquema en `20260911120000_referidos_nativos.sql`
> (`referral_campaigns`, `referral_memberships`, `profiles.referral_converted_at` y
> `profiles.referral_rf_user_id`, más las RPC `referral_invitees()` y
> `referral_conversions_pending(int)`).
>
> Y la fila de la tabla de abajo que decía «**La lee para algo** — nadie» también caducó: la leen la
> RPC `referral_invitees()` que pinta la pantalla y `referral_conversions_pending()` que alimenta el
> cron. Lo único que **no** cambió es RN-21: las reglas, los montos y el pago de la recompensa siguen
> viviendo enteros en RF.
>
> ⚠️ Pero encendido **no es lo mismo que desplegado**: `REFERRAL_FACTORY_API_KEY` está borrada de
> Vercel desde el 10-sep y sin ella todo esto está apagado sin que nada se ponga rojo (§4.2 y
> `docs/ENTORNOS.md` §3 C.1).

**C-10 ya no es solo una decisión pendiente: tiene un problema técnico encima.** La campaña de
Referral Factory **no** manda al referido a nuestra app con un código. Lo lleva a una página de
oferta **alojada por RF**, donde deja nombre y email. RF **no ofrece un parámetro de código de
referido**, así que la atribución por cookie `ey-ref` + `profiles.referral_code` (EY-79 / US-1302,
todavía en In Review) **no puede funcionar** con este tipo de campaña.

⚠️ **Lo que este párrafo decía después era falso, y se corrige el 1-sep (D2).** Decía que «se activó
el parámetro `ref_email`» y que la atribución «tiene que ser por email contra la API de RF», en
presente, como si estuviera hecho. **`ref_email` no existe**: `grep -rn "ref_email" src/ supabase/`
devuelve **cero**, y `REFERRAL_FACTORY_API_KEY` **no se lee en ninguna línea de código**. Lo mismo
decían `CLAUDE.md`, `BACKLOG.md` y `PLAN-DESARROLLO.md`; los cuatro están corregidos.

**Qué hay de verdad, seguido de punta a punta (1-sep):**

| Tramo | Fichero:línea | Qué hace |
| :-- | :-- | :-- |
| Escribe la cookie | `src/lib/supabase/middleware.ts:76-83` | si la URL trae `?ref=`, lo guarda en `ey-ref` (30 días, `sameSite lax`, **no** httpOnly) |
| La lee — pantalla | `src/app/(auth)/signup/page.tsx:29-30` | `?ref=` de la URL manda; si no, la cookie |
| La lee — modal | `src/components/auth/signup-form.tsx:60-73, 163` | `refDeCookie()` al enviar → `raw_user_meta_data.referral_code` |
| La lee — Google | `src/components/auth/google-button.tsx:84` → `src/app/auth/callback/page.tsx:34` → `callback-status.tsx:110-116` | el `?ref=` viaja a Google y vuelve; `update … .is("referral_code", null)` para no pisar |
| La lee — invitado | `src/app/api/checkout/invitado/route.ts:429, 442` | cookie leída **en servidor**, al metadata del `createUser` |
| La aterriza | `20260817130000_terms_acceptances.sql:88-93` (`handle_new_user`) | `profiles.referral_code` |
| La borra | `20260826230000_ey192_baja_de_cuenta.sql:326` | `referral_code = null` al anonimizar |
| **La lee para algo** | — | **nadie**. No hay un solo `select` de `referral_code` en `src/` |

**Y la cookie no se escribe nunca**, porque el `?ref=` no llega. Comprobado contra la campaña real
`50297` con la clave de `.env.local`: ni `GET /api/v1/campaigns/50297` ni la página que ve el
referido (`https://vercel.referral-factory.com/<code>`) contienen la cadena `ensenameya` por ningún
lado — **no hay URL de vuelta configurada**, así que no existe la redirección que traería el
parámetro. Los dos extremos lo confirman: **0 de 39 perfiles de dev** tienen `referral_code`, y en RF
solo hay **5 usuarios**, los dos con `referrer_id` metidos a mano por su API (`source: "Api"`) y
ninguno `qualified`; los dos reales (`veronica@faimlab.com`, `faim3110@gmail.com`) entraron por el
embed como **referidores**, sin referidor propio.

→ **Veredicto del 1-sep: no había atribución de referidos de ninguna clase.** No estaba «hecha por
email» ni «hecha por cookie a falta de un ajuste»: estaba **entera por hacer**. El AC de `EY-79`
había que rehacerlo, no revisarlo. ✅ **Y se rehízo el 11-sep** (ver el aviso del principio del
apartado): la atribución existe, no depende de que RF nos devuelva a nadie —el enlace lo emitimos
nosotros— y `EY-148` (RF-03) deja de depender de la integración nativa RF↔Stripe, porque quien marca
la conversión es nuestro cron.

Aparte: los términos que RF le enseña al referido son **su plantilla sin rellenar**, con
corchetes tipo "[Insert link to Privacy Policy here]". Sigue vigente para quien aterrice en la
landing de RF, aunque la pantalla nativa ya no mande a nadie ahí.

**Lo que se midió el 11-sep contra la API real**, con la clave de `.env.local`:

- **Tres campañas `launched`**, no una: **50785** «Enséñame Ya» (`es`, código `ctAI3ZWp`) →
  audiencia alumnos, visible; **50784** «Enséñame Ya - Tutor» (`en`, código `cKAf69gl`) → audiencia
  tutores, visible; y **50297** «Campaign for Enséñame Ya» (`es`, código `cXr65Wou`,
  `vercel.referral-factory.com/cXr65Wou`), la vieja, que entra en el seed **no visible**. Que «solo
  existía la 50297» y que «no existía la campaña de tutores» dejó de ser cierto.
- ✅ **S-32.2 queda RESUELTO, y era FALSO.** El supuesto decía que `POST users` con un correo que ya
  existe en esa campaña devolvería **422**, y por eso el cron traía un plan B (buscar por correo o
  marcar y seguir). Medido: **no da 422** — devuelve **el MISMO usuario**, con su mismo `id` y su
  mismo `code`. O sea que `createUser` es **idempotente por (campaña, correo)**. Y el mismo correo en
  **otra** campaña sí crea un usuario nuevo, con código distinto, que es lo que hace falta para que
  alguien sea referidor en los dos programas a la vez.

### 4.6 ⚠️ Vaciar la cola vieja de correo — ANTES de dar reloj a Actions

**El riesgo, con números.** En **dev** hay **126 notificaciones en `pending`**, de reservas de prueba
de agosto que nunca se enviaron porque no había remitente. Reparto comprobado el 17-ago:

| Destinatario | Pendientes | Qué pasaría |
| :-- | --: | :-- |
| `veronica@faimlab.com` | 24 | 24 correos absurdos sobre reservas de prueba |
| `jose@faimlab.com` | 7 | ídem |
| `diana@faimlab.com` | 6 | ídem |
| cuentas `@ensenameya.dev` | ~89 | **~89 REBOTES**: ese dominio no tiene buzón |

🟢 **EJECUTADO EL 30-AGO. La cola de dev está vacía: `pendientes_email: 0, fallidas: 336`.**

Antes de eso pasaron dos cosas el mismo día. El reloj se encendió (`APP_BASE_URL` + `CRON_SECRET` en
GitHub) **sin** haber vaciado la cola, saltándose el orden que manda esta sección — y no costó nada
solo porque `APP_BASE_URL` apunta a **producción** y esta cola vive en **dev**. Después se ejecutó el
procedimiento de verdad.

**El censo real no fue el de abajo, y por dos motivos.** Eran **336**, no 126 — la cola siguió
creciendo del 17 al 30-ago. Y había **más dominios de los que decía**:

| Dominio | Cerradas | Qué es |
| :-- | --: | :-- |
| `ensenameya.dev` | **187** | 13 buzones del seed. **Dominio sin MX**: eran 187 rebotes garantizados |
| `faimlab.com` | 95 | equipo (`veronica@` 50, `jose@` 23, `diana@` 7, `ennis@` 4) + `josetest*` |
| `gmail.com` | 22 | `ejfaim@`, `codefaim@`, `correo@`, `dianacriverao@` |
| `pruebas.com` | 20 | `mas@pruebas.com` |
| `ey.com` | 11 | `estudiantenuevo@`, `nuevotutor@`, `tutornuevoprueba@` |
| `emilioensen.com` | 1 | `prueba@` |

Las 15 direcciones entregables eran equipo o cuentas de prueba evidentes. **Ni un usuario de fuera** —
se comprobó una a una antes de tocar nada, que es para lo que existe el paso 1.

Por plantilla, las tres primeras: `cancellation` 126, `payment_failed` 57, `payment_receipt` 32.

**Cómo se ejecutó, que no fue con el SQL de abajo.** No hace falta el editor SQL: las dos RPC del job
(`pending_email_notifications` y `mark_notification`, ambas `security definer` y concedidas a
`service_role`) llegan al mismo sitio por la API REST, y `mark_notification(id, false)` hace
exactamente el `update ... set status='failed'` de abajo —con el mismo `and status = 'pending'` y el
mismo `sent_at` nulo—. Se leyó en dos vueltas de 200 y se cerraron 336 con 0 errores. Ojo: por la API
**no** se puede leer `public.notifications` directamente (no tiene `grant select` a `service_role`,
regla de oro 9), pero las RPC sí funcionan.

⚠️ **Esto vuelve a pasar.** 187 de las 336 iban a `@ensenameya.dev`, que sigue sin MX. Mientras el
seed no use direcciones que acepten correo, hay que repetir este procedimiento antes de cada
encendido — ver el aviso del final de la sección.

**Por qué importa y no es cosmético.** La cuenta de Resend es nueva y no tiene historial de envío.
Estrenarla con ~89 rebotes es la forma más rápida de que limiten o suspendan el envío — y es
exactamente lo que hace falta que funcione para **DL-01**, el formulario de contacto que el revisor
de dLocal va a probar a mano esperando respuesta. Se perdería la validación por un montón de correos
de prueba que a nadie le importan.

**Cuándo ejecutarlo.** El orden que decía este párrafo —censo, `update`, y solo entonces las dos
variables— **se saltó el 30-ago**: las variables entraron primero. No costó nada porque apuntan a
prod, pero la lección se mantiene y ahora aplica al siguiente reloj: **antes de que ningún cron
apunte a dev o a una preview**, primero el censo, luego el `update`. El interruptor son **dos** cosas
(clave de Resend **y** reloj) y las dos están ya puestas: lo único que separaba esos 336 correos de
la bandeja de alguien era el valor de una variable. Ya no: la cola está en 0.

> Lo que sigue es el procedimiento **tal como se escribió el 17-ago**, con sus 126. Se conserva
> entero porque hay que volver a ejecutarlo cada vez que el seed vuelva a llenar la cola; los números
> reales de la pasada del 30-ago están arriba.

**1) Censo — confirmar que los números siguen siendo estos.** Desde el SQL editor de **dev** (hace
falta leer `auth.users`, así que esto no sale por la API):

```sql
select public.process_notifications();          -- el resumen rápido

select coalesce(split_part(u.email, '@', 2), '(sin usuario)') as dominio,
       count(*) as pendientes,
       min(n.created_at) as mas_antigua
  from public.notifications n
  left join auth.users u on u.id = n.recipient_id
 where n.status = 'pending' and n.channel = 'email'
 group by 1
 order by 2 desc;
```

**2) El cambio.** Se marca `failed`, en una transacción y guardando antes la foto de lo que se toca:

```sql
begin;

-- Foto de lo que se va a cerrar, para poder decir después qué se hizo.
create temp table _cola_vieja as
  select id, type, template, recipient_id, created_at
    from public.notifications
   where status  = 'pending'
     and channel = 'email'
     -- ⚠️ El corte: el instante JUSTO ANTES de configurar el cron. Todo lo
     -- posterior es tráfico real y tiene que salir. Poner aquí la hora de
     -- verdad, no dejar la de ejemplo.
     and created_at < timestamptz '2026-08-18 00:00:00+00';

select count(*) from _cola_vieja;   -- ¿cuadra con las 126? Si no, parar y mirar.

update public.notifications
   set status = 'failed'
 where id in (select id from _cola_vieja);

commit;
```

**3) Comprobar.** `select public.process_notifications();` → `pendientes_email` en 0 (o solo lo
nuevo). ~~Después ya se pueden dar de alta `APP_BASE_URL` y `CRON_SECRET`.~~ Ya están dadas de alta
(30-ago) y apuntan a prod; lo que habilita este paso es **repuntar el reloj a dev**, si algún día
hace falta.

**Las cuatro decisiones que hay detrás, por si alguien las discute más adelante:**

- **`failed` y no `sent`.** El enum solo tiene `pending | sent | failed`. `sent` escribiría en la
  única tabla que dice si a una persona se la avisó que sí se la avisó, y eso es mentira; `failed`
  dice "no salió y no va a salir", que es exactamente lo que pasó. Además es terminal para el job,
  que solo lee `pending`, y `mark_notification` deja `sent_at` **nulo** al fallar: una fila cerrada a
  mano se distingue siempre de una entregada de verdad.
- **`update`, nunca `delete`.** `idempotency_key` es `unique` y es lo que impide que un mismo evento
  se encole dos veces (US-1202). Borrar las filas destruiría la traza y dejaría la puerta abierta a
  reencolar lo mismo. Cuesta lo mismo y se puede auditar.
- **Solo `channel = 'email'`.** Las `in_app` son la **misma fila** que pinta la campana (US-1203), y
  la campana filtra por `read_at`, no por `status` — así que esto no le quita a nadie sus avisos de
  la app. Acotarlo igualmente es gratis y evita explicaciones.
- **Solo en dev.** La cola de **prod** debería estar vacía: allí no ha llegado ni el código que
  encola. Censarla igual antes del merge; si tuviera algo, es que alguien probó donde no tocaba.

⚠️ **Y esto va a volver a pasar si no se toca el seed.** Las 12 cuentas de prueba viven en
`@ensenameya.dev`, un dominio que **no recibe correo**: cada tanda de pruebas nueva vuelve a llenar
la cola de futuros rebotes. Mientras siga así, este procedimiento hay que repetirlo antes de cada
encendido. La salida limpia es que el seed use direcciones que acepten correo (un buzón propio con
subdirecciones `+algo`, o las direcciones de prueba del propio Resend).

### 4.7 🟢 Baja de cuenta con dinero en vuelo — ciclo ejercitado (31-ago)

`27739b1` + `52e5b69`. Ejecutado contra **dev**, en dos mitades, porque el esquema **no deja forjar
el estado intermedio** — ver el final de esta sección, que es el hallazgo más útil de la pasada.

**Mitad 1 · recolectar y barrer** (usuario desechable creado y borrado para esto):

| Paso | Resultado |
| :-- | :-- |
| 2 ficheros suyos en Storage | `kyc-documents/<uid>/cedula.png` + `avatars/<uid>/foto.png` |
| `anonymize_account` | `ficheros_recolectados: 2`, los deja en `summary` y **no** borra de Storage |
| `account_deletions_pendientes_de_barrido` | los ve: 1 cuenta, 2 ficheros |
| `POST …/barrido?simulacro=1` | `{"cuentas":1,"ficheros":2,"buckets":["avatars","kyc-documents"]}` — y los dos ficheros **siguen** en Storage |
| `POST …/barrido` | `{"ficheros_barridos":2,"ficheros_pendientes":0}` |
| Storage después | `kyc-documents: []` · `avatars: []` |
| `summary` después | `{"ficheros":{}, "ficheros_barridos":2, "ficheros_recolectados":2}` |

**Mitad 2 · pedir, desactivar y arrepentirse** (tutor real del seed, **revertido al terminar**):

| Paso | Resultado |
| :-- | :-- |
| Bloqueante | `saldo_sin_liquidar: 20250` USD, liquidable desde el 7-sep |
| Antes | en catálogo **sí** · mentorías activas **3** |
| `request_account_deletion` | `"programada"` |
| Después | en catálogo **NO** · mentorías activas **0** |
| Fila guardada | `prev_approval: "approved"` + los 3 ids de sus mentorías |
| Segunda llamada | `"ya_programada"` — **sin** repausar ni pisar `prev_active_products` |
| `process_pending_account_deletions()` | `esperando: 1 · completadas: 0` — se niega, correctamente |
| `cancel_account_deletion` | `"cancelada"`; en catálogo **sí** · mentorías activas **3** |
| ¿Anonimizada? | **No** |

La idempotencia no es un detalle: si la segunda llamada pisara `prev_active_products` con la lista ya
vaciada, cancelar dejaría el catálogo apagado **para siempre**. Es el fallo que anticipa el comentario
de `request_account_deletion`, y no ocurre.

⚠️ **LO QUE SIGUE SIN EJERCITARSE: la transición.** Que el `pg_cron` complete una baja cuando el
bloqueante desaparece. No se pudo montar, y el motivo es que **el esquema lo impide a propósito**:
para plantar un bloqueante que luego se pudiera quitar hacía falta insertar en `bookings`, `payments`
o `account_deletion_requests`, y las tres tienen **SELECT pero NO INSERT** para `service_role` — solo
las escriben las funciones `security definer`. Es la regla de oro 2 funcionando (el dinero no se
escribe a mano ni para una prueba), así que el hueco de cobertura es el precio de una barrera que
queremos. Se verá cuando un saldo se liquide solo, o con acceso a `psql`.

Mapa de privilegios comprobado de paso, todo con `service_role`:

| Tabla | SELECT | INSERT / DELETE |
| :-- | :-- | :-- |
| `profiles`, `bookings`, `payments`, `refund_requests`, `account_deletions`, `account_deletion_requests` | ✅ | ❌ 42501 |
| `products`, `tutor_profiles`, `payouts`, `payout_items` | ❌ 42501 | ❌ |

Ninguna rompe nada hoy: todo lo que las lee es `security definer`. Pero es más amplio de lo que decía
la tabla de §1, y lo próximo que las toque sin serlo morderá en ejecución (regla de oro 9).

**Estado de dev al terminar:** 8 tutores, 15 mentorías activas, 33 sesiones vivas — idéntico al de
antes. Nota práctica: `kyc-documents` **rechaza `text/plain`** (solo png, jpeg, webp y pdf); una
subida de prueba con el mime equivocado devuelve 400 y no es un problema de permisos.

### 4.8 🔴 «Los splits del programa de referidos» (EY-209) no existen — desmentido leyendo el esquema (1-sep)

`EY-209` pedía **verificar los splits del programa de referidos**. Se buscó qué verificar y **no hay
nada**: el concepto no existe en la base de datos, ni apagado ni a medias.

**El reparto de una venta tiene exactamente dos tramos, y son complementarios por construcción.**
`payments` (`20260709140000_ep06_booking_core.sql:98-103`) guarda `gross_amount`,
`platform_fee_amount` y `tutor_net_amount`, y las tres las escribe `create_booking` así:

```sql
v_net := round(v_total * v_split / 100.0);
v_fee := v_total - v_net;          -- ← el resto, literalmente
```

(versión vigente: `20260831180000_candado_por_solape_en_sessions.sql:241-242`; idéntico en
`20260827150000`, `20260715170000` y el original `20260709160000`). `v_fee` **no se calcula**: es lo
que sobra. No queda ni un céntimo sin dueño donde pudiera entrar un tercer beneficiario, y meterlo
exigiría **columna nueva + migración**, no configuración. Comprobado también en dev: **115 de 115
`payments` cumplen `gross = fee + net`**, cero descuadres.

**Y el payout tampoco tiene sitio.** `payouts.tutor_id` referencia a un único perfil, y
`payout_items.payment_id` es **`unique`** (`20260716140000_ep10_payouts.sql:47-51`): «un pago ≤ 1
payout», dice el propio comentario. Un referidor no podría cobrar ni como segunda línea del mismo
pago.

**Ni hay a quién pagarle.** No existe ninguna tabla `referr*` en `supabase/migrations/`; la única
huella de referidos en el esquema es la columna `profiles.referral_code`, que —§4.5— **nadie lee** y
que además está vacía en las 39 filas de dev.

> 🟡 **Al día 11-sep:** las dos frases de arriba eran ciertas el 1-sep y hoy no lo son. Sí hay tablas
> `referr*` (`referral_campaigns` y `referral_memberships`, `20260911120000`) y `referral_code` sí lo
> lee alguien. **Pero el veredicto de EY-209 no cambia**: siguen sin existir tabla de recompensas,
> `split_pct` de referido ni sitio en `payouts` para pagarle a un referidor — la recompensa la
> contabiliza y la paga **Referral Factory** (RN-21), no nosotros.

→ **Veredicto: EY-209 se cierra desmentido, sin código.** No es «los splits están mal»: es que un
split de referidos nunca se construyó. El único `split_pct` del sistema es el de `tutor_tiers`
(RN-06, US-1103), que reparte alumno↔plataforma↔tutor y no tiene nada que ver con el programa de
invitaciones. Si el cliente decide que el referidor cobra (C-10, sin resolver), eso es **diseño
nuevo**: tabla, migración y decisión de si sale de la comisión o del neto del tutor.

---

### 4.9 🟡 Wise de punta a punta — el camino recorrido, el dinero no (7-sep)

El riel de payout de Wise se escribió el **7-sep-2026** y se ejercitó contra
`api.transferwise.com` con el token real y el perfil business `136151426`, creando y cancelando
**una transferencia de verdad** (`2357375084`, USD→GBP). No es una lectura de la documentación:
cada fila de abajo es una respuesta HTTP.

| Paso | Llamada | Resultado medido |
| :-- | :-- | :-- |
| 1 · Presupuesto | `POST /v3/profiles/136151426/quotes` | 200 · comisión $0,69 · `payIn: BALANCE` llega **`disabled: true`** con `error.payInmethod.disabled` |
| 2 · Destinatario | `POST /v1/accounts` | 200 · el cuerpo que produce `cuentaDeWise()` lo acepta Wise tal cual |
| 3 · Requisitos | `POST /v1/transfer-requirements` | 200 · `reference` máx **18** en ese corredor |
| 4 · Transferencia | `POST /v1/transfers` | 200 · nace en `incoming_payment_waiting` |
| 5 · Fondeo | `POST /v3/…/transfers/{id}/payments` | **422** `{"status":"REJECTED","errorCode":"balance.payment-option-unavailable"}` |
| 6 · Barrido | `GET /v1/transfers?profile=…` | la reencuentra por su `customerTransactionId` |
| 7 · Idempotencia | `POST /v1/transfers` repetido | **devuelve la MISMA transferencia** |
| 8 · Limpieza | `PUT /…/cancel` + `DELETE /v1/accounts/{id}` | 200 · no queda nada vivo en la cuenta |

**🟢 El paso 7 despeja la única duda que quedaba del contrato.** Wise exige repetir el mismo
`customerTransactionId` para reintentar, pero un presupuesto solo sirve para una transferencia y
caduca a los 30 minutos: un reintento tardío llega con el mismo identificador y un presupuesto
**distinto**, y su documentación no dice qué pasa entonces. Pasa que devuelve la que ya existía. La
idempotencia aguanta el caso del job, que es el único que importa — y con ella, `uuidDePago()`
(UUIDv5 determinista de `payout` + `intento`) es lo que impide pagar dos veces.

**🔴 Lo que NO está probado es el dinero, y no lo va a estar hasta que alguien fondee la cuenta.**
`GET /v4/profiles/136151426/balances` devuelve `[]`: cero balances, ninguna moneda abierta. Por eso
el paso 5 rechaza y por eso el `payIn BALANCE` del paso 1 llega deshabilitado. **Ningún tutor ha
cobrado por Wise**, al contrario que por PayPal (§ `docs/PAGOS-Y-PAYOUTS.md` §9.4). Abrir y fondear
un balance USD es una gestión, no una tarea de código: el adaptador ya deja la transferencia viva en
`incoming_payment_waiting` y reintenta el fondeo en cada pasada del job.

**Dos hallazgos que no están en la documentación de Wise y que costaron un fallo cada uno:**

1. **El rechazo del fondeo es un 422, no un 201 con `status: REJECTED`.** Escrito según la
   documentación, `fondear()` lanzaba y «no hay saldo» se clasificaba como error transitorio en vez
   de `sin-fondos`. Corregido leyendo el cuerpo del error (`wise-provider.ts`).
2. **Colombia exige «abono automático»** activado en la cuenta del beneficiario. Wise rechaza el
   destinatario con `NOT_VALID` sobre `accountNumber` si el banco no lo tiene puesto. Es un
   requisito del tutor y **hoy la pantalla no se lo dice**.

**El ruteo, verificado contra dev con un escenario colombiano** (insertado y borrado):

| Escenario | `banco` | `banco_wise` | Riel |
| :-- | :-- | :-- | :-- |
| Bancolombia, sin dirección ni teléfono | `true` | `false` | cobra por la vía de siempre |
| Los mismos datos + dirección y teléfono | `true` | `true` | **Wise** |
| Con dirección, pero banco Itaú (que Wise no cubre) | `true` | `false` | cobra por la vía de siempre |

Es el filtro que impide repetir el fallo del tutor venezolano con Zinli: que un riel *pueda* pagar
y que pueda pagarle *a esta persona* son dos preguntas distintas.

**Lo que queda antes de dar el riel por cerrado:**

- [ ] **Abrir y fondear un balance USD** en el perfil `136151426`. Sin esto no paga, y punto.
- [x] **`WISE_API_TOKEN` en Vercel Production — 10-sep.** ⚠️ **En Preview NO, y a propósito:** Wise
      no tiene split sandbox/producción y `WISE_API_URL` cae a producción por defecto, al revés que
      dLocal y PayPal. Preview sin token es lo único que impide que un PR pague de verdad.
      *(Lo que decía antes, y era cierto hasta el 10-sep: solo estaba en `.env.local`, así que en
      producción `missingPayoutConfig()` devolvía que faltaba y el resolvedor **saltaba el riel en
      silencio** — el fallo seguro, pero un riel apagado.)*
- [ ] **Un payout real a un tutor con `wise_account_type`**, con `outgoing_payment_sent` y NTF-12.
      ⚠️ La cobertura ya no son cinco países: `payout_country_rules` llega a **55**, y lo que decide es
      el **formato de cuenta** de cada uno (IBAN, ABA, sort code, BSB, IFSC, SWIFT), no una lista de
      proveedores. Los que siguen en `null` y por qué, en el comentario de esa columna
      (`20260910150000`). **Venezuela no está ni estará**: no figura entre las 229 opciones de
      `address.country` de Wise.
- [ ] **Avisar del «abono automático»** en la pantalla del tutor colombiano.
- [ ] **Seguir mirando los `paid`.** Ningún estado de Wise es irreversible: los rebotes llegan
      «hasta varias semanas después» y `charged_back` puede venir desde cualquier estado. Hoy no hay
      webhook de cambio de estado, así que un payout marcado `paid` que rebote no se entera nadie.

---

### 4.10 Dos cosas que no son bugs de código y hay que atender igual

**1 · 🔴 La purga de grabaciones NUNCA se ha ejercitado, y vence el 13-sep-2026.**

`recordings_purged_at` está en `null` en las 12 sesiones con sala, y **eso es lo correcto**: la sala
más antigua terminó el **14-ago**, así que con la retención de 30 días la primera purga vence el
**13-sep**. Hasta entonces `/api/cron/recordings-purge` no ha tenido nunca nada que borrar, y su 200
diario no demuestra nada. Mentir en esa columna —que es la prueba de que la política se cumple— sería
peor que no tener sello.

Lo que hay que hacer, y **el día exacto en que hay que hacerlo**:

- [ ] **El 13-sep-2026, mirar la corrida.** Que la sesión del 14-ago salga con `recordings_purged_at`
      puesto, que `GET api.daily.co/v1/recordings` ya no la devuelva, y que el job no marque nada que
      no haya borrado de verdad.
- [ ] Si devuelve `sin-daily`, es `DAILY_API_KEY` y no el job: sin credencial no marca nada a propósito.

**Por qué esto no es cosmético:** esos 30 días son la retención que **prometen las páginas legales**
(`/privacy`, `/cookies`). Es la única línea de este documento donde un job sin ejercitar se convierte
en un incumplimiento con texto publicado detrás.

**2 · 🟡 NTF-10 avisa cuando el reembolso se PIDE, no cuando el dinero se mueve.**

El aviso lo encola un trigger sobre `payments` (`20260716170000`) que salta cuando `status` pasa a
`refunded` / `partially_refunded`. Y quien pone ese estado es **el camino de cancelación**
(`20260817170000`), que en la misma transacción marca el pago y encola la petición de reembolso. **El
job no encola nada**: cuando `refunds-process` mueve el dinero de verdad, el alumno ya recibió el
correo que decía «procesado».

Medido en la pasada del 30-ago: a dos alumnos se les avisó el 17 y el 27-ago, y el dinero salió el 30.

- Con el cron corriendo la ventana baja de días a horas, así que **el desfase no es urgente**.
- **Pero sigue siendo un desfase**, y no se cierra en QA: cambiar cuándo se avisa —al pedirlo, al
  ejecutarlo, o las dos veces con textos distintos— es **decisión de producto**. Aquí queda anotado
  para que nadie lo lea como un bug del job.

---

*Se actualiza en cada pasada de QA. Última edición: **2026-09-11** — Referidos v2: §4.5 marcada como
superada (la atribución **existe** desde hoy y se pinta desde nuestra base; tres campañas en RF, no
una; **S-32.2 resuelto y desmentido** — `POST users` con correo repetido devuelve el mismo usuario,
no un 422), §4.2 con `REFERRAL_FACTORY_API_KEY` ascendida de «no la lee nadie» a interruptor único
—y con el aviso de que su ausencia deja el cron en **200 verde sin hacer nada**—, las cuatro
`NEXT_PUBLIC_REFERRAL_*` fuera, el recuento de endpoints programados corregido de cinco a **siete**,
y §4.8 acotada (hay tablas `referr*`, pero el veredicto de EY-209 sigue en pie). Edición previa el
**2026-09-09** — §2 reescrita sobre el dictado de
pagos (cómo se rutea el cobro y el payout, fail-closed de los cinco endpoints con secreto y de los dos
webhooks), **§2.5 nueva con las doce filas de cobro y payout que hay que ejercitar y que hoy están
vacías** —incluido el riel rechazado, que no baja al siguiente candidato—, §1 con la declaración de que
la matriz de RLS va 18 tablas por detrás y la lista de cuáles, §4.3 rehecha con los nueve `pg_cron` y
los cinco endpoints HTTP y su reloj real, §4.4 convertida en la tabla de escrito / probado /
desplegado, y §4.10 nueva con la purga que vence el 13-sep y el desfase de NTF-10. Edición previa el
**2026-09-07** — §4.9 nueva con el riel de Wise ejercitado contra la API real (los ocho pasos, la idempotencia despejada y los dos hallazgos que no están en su documentación), y lo que falta para cerrarlo. Edición previa el **2026-09-01** — §4.5 rehecha (la atribución de
referidos no existe: `ref_email` era falso, mapa fichero:línea de lo que sí hay y verificación contra
la campaña real de RF), §4.2 con `REFERRAL_FACTORY_API_KEY` degradada a «no la lee nadie», y §4.8
nueva desmintiendo los splits de referidos de `EY-209`. Edición previa el **2026-08-31** — §4.7 con el ciclo de la baja de cuenta con dinero en vuelo ejercitado de punta a punta (recolección, ensayo, barrido real, desactivación y cancelación), el mapa de privilegios de `service_role` por operación, y el hueco de cobertura que deja la regla de oro 2. Edición previa el **2026-08-17** — superficies nuevas del día
(contacto, aceptación de términos, alumnos del tutor, cobro tardío, cola de reembolsos), tercer job
programado, §4.6 para vaciar la cola vieja de correo, y el checklist al día (30 migraciones
pendientes de prod, variables repartidas, Stripe de test mode ya en producción). Edición previa el
2026-08-07 con la pasada del 5-6 de agosto: grants de `service_role` y su mínimo privilegio,
`confirm_payment` fuera del alcance del cliente, fail-closed de los crons y del webhook, y Stripe de
punta a punta contra la preview. Creado el 2026-07-29 con la tanda 6 del plan de los sprints 6 AC /
7 / 8.*
