# Enséñame Ya — QA y checklist de lanzamiento (US-1602 · `EY-83`)

> **Qué es esto.** Lo que hay que comprobar antes de abrir la plataforma, y el resultado de la última
> pasada. No es una lista de buenas intenciones: cada tabla de abajo se **ejecutó** contra dev y se
> pegó su salida real. Cuando algo no se pudo verificar, lo dice.
>
> Última pasada completa: **2026-07-29** (dev, `lbtpnszjjsxbeileqsja`).
>
> Repaso puntual del **2026-08-04**, por lo que se movió después: la vista `tutors_public` (DD-04,
> migración `20260804120000`) y el filtro de precio de `/tutors`. Lo demás sigue siendo la salida
> del 29-jul y así está marcado.
>
> Pasada del **2026-08-06**, sobre lo que entró después de mergear el PR #11 a `dev` (`1a36da2`):
> los grants de `service_role`, el cierre de `confirm_payment`, el fail-closed de los dos crons y
> del webhook, y el checkout de Stripe probado de punta a punta en test mode. La matriz por rol de
> §1 **no** se re-ejecutó y no hacía falta: nada de esto cambia políticas de RLS — cambia **grants**
> y **quién puede invocar qué**, que es la otra barrera y hasta ahora no estaba en este documento.
>
> Añadidos del **2026-08-17**, que **no son una pasada de QA** y conviene no confundirlos con una:
> el inventario de las cinco superficies nuevas del día (§1, con lo que se comprobó de cada una al
> escribirla), el **tercer job programado** (reembolsos, §4.3) y el procedimiento para **vaciar la
> cola vieja de correo** antes de encender Actions (**§4.6**, lo único de este documento con un orden
> obligatorio). La matriz por rol de §1 sigue siendo la del 29-jul y **hay que re-ejecutarla antes de
> abrir**: desde entonces han entrado el dinero real, los datos del alumno visibles para su tutor y
> la constancia de aceptación de términos.

---

## 1. RLS por rol — la barrera de verdad

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

## 2. Webhooks y endpoints de servidor

### Idempotencia de `confirm_payment` (29-jul)

`confirm_payment` con `p_event_id`, sobre una reserva de prueba (cancelada al terminar):

| Llamada | Resultado |
| :-- | :-- |
| 1ª con `evt_qa_…` | `pending_acceptance`, pago `paid` 18,00 US$ |
| 2ª con **el mismo** `evt_qa_…` | `pending_acceptance` — **no-op**, sin segundo cobro |
| 3ª con **otro** id sobre la misma reserva | `pending_acceptance` — **no-op** por estado |

Doble idempotencia (por id de evento **y** por estado), que es la que salva cuando el proveedor
reintenta con un id nuevo.

### Stripe de punta a punta, contra la preview (6-ago)

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

La fila de `payment_routing_rules` **en dev está ya en `'stripe'`**. Volver a `simulated` —o cambiar
a cualquier otro— ya **no es una migración**: es un `UPDATE`, gracias a los grants de §1.

### Fail-closed: sin secreto no corre nada (6-ago)

Los tres endpoints nuevos que un atacante querría disparar responden igual ante una configuración a
medias: **no procesar**. Lo contrario —seguir adelante sin verificar— convierte un despliegue mal
configurado en un endpoint público que borra datos de usuarios, manda correos o marca reservas como
pagadas.

| Endpoint | Sin secreto configurado | Con credencial incorrecta |
| :-- | :-- | :-- |
| `/api/cron/recordings-purge` (Vercel Cron, 04:00) | **503** | **401** |
| `/api/cron/notifications-send` (GitHub Actions, `*/5`) | **503** | **401** |
| `/api/webhooks/stripe` | **503** | **400** (firma inválida o ausente) |

Y una distinción que importa cuando lo que falta es el **proveedor** y no el secreto: ninguno de los
dos crons miente en la base de datos. Sin credenciales de Daily la purga no marca nada como purgado
(`sin-daily`) — sellar una sesión sin haber borrado sería peor que no sellarla. Sin clave de Resend
el job de correo no toca la cola: los avisos quedan **`pending`, no `failed`**, así que el día que
se ponga la clave sale todo lo acumulado en la primera pasada.

### ⚠️ `POST /api/checkout/invitado` — lo que NO garantiza (31-ago)

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

- [ ] **Migraciones aplicadas a prod** por CI al mergear a `main` (`supabase/migrations/`). Al
      **30-ago** faltan **7** (prod tiene 111 de 118), de `20260827200000_m02_retira_el_auto_aceptar_global`
      a `20260828183000_cierre_automatico_de_sesiones_nunca_corrio`. Las 30 que listaba este punto
      entraron con el merge del **26-ago** (`3fca8b2`): vuelve a ser un merge de una semana.
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
      cliente no mandó esos dos. ⚠️ **En prod siguen siendo 404**: `main` no tiene ni las páginas, y
      el pie de producción las enlaza igual. Se arregla con el merge de arriba y con nada más.
- [x] **Constancia de aceptación de términos** (`terms_acceptances`, `20260817130000`): quién, cuándo,
      qué versión y qué idioma. ⚠️ **Las cuentas anteriores al 17-ago no tienen fila** — aceptaron una
      casilla que no dejaba rastro, y de un texto distinto. Decidir antes de abrir si se les vuelve a
      pedir (lo contempla el §34) o se da por buena la anterior.
- [ ] **Fila de `payment_routing_rules` en prod** apuntando al proveedor que toque. En dev está en
      `'stripe'`; cambiarla es un `UPDATE`, no una migración. ⚠️ Desde el 17-ago **producción ya tiene
      `STRIPE_API_KEY`, y es de *test mode*** — si esa fila entrara en `'stripe'` sin cambiar la clave,
      producción aceptaría tarjetas de prueba y no cobraría ni una real.
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
| `NEXT_PUBLIC_REFERRAL_URL` | el bloque de referidos no se pinta |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | sin monitoreo de errores |
| `STRIPE_API_KEY` | el checkout ruteado a Stripe responde **503** (no cae al simulado: regalaría clases) |
| `STRIPE_WEBHOOK_SECRET` | el webhook no procesa **nada**: 503 |
| `CRON_SECRET` | los **tres** crons responden **503** y no corren |
| `RESEND_API_KEY` | el job de correo no toca la cola (los avisos se quedan `pending`) y el formulario de contacto guarda pero no entrega → **DL-01 sin cumplir** |
| `REFERRAL_FACTORY_API_KEY` | sin atribución de referidos |

Detalle en `docs/ENTORNOS.md`. **`service_role` jamás en `NEXT_PUBLIC_*`** (regla de oro 3).

**Estado real al 30-ago.** Quedan por poner:

- [x] ~~`CRON_SECRET` en Vercel~~ — **ya estaba**. Comprobado el 30-ago sin abrir el panel: sin la
      variable el endpoint responde 503 y con ella 401, y un `curl` sin cabecera a
      `https://ensenameya.vercel.app/api/cron/notifications-send` devuelve **401**.
- [ ] `NEXT_PUBLIC_REFERRAL_URL` y `REFERRAL_FACTORY_API_KEY` en Vercel (la URL de campaña es
      `https://vercel.referral-factory.com/cXr65Wou/signup`).

**Y en GitHub**, que es donde viven los relojes del correo y de los reembolsos
(`.github/workflows/notifications-cron.yml` y `refunds-cron.yml`, que comparten las dos):

- [x] variable `APP_BASE_URL` = `https://ensenameya.vercel.app` — **30-ago**
- [x] secret `CRON_SECRET`, el mismo valor que en Vercel — **30-ago**
- [ ] *(opcional)* secret `VERCEL_PROTECTION_BYPASS`, solo si `APP_BASE_URL` apunta a una preview

⚠️ **Estas dos faltaron durante cuatro días con los workflows ya en `main`, y el resultado fue
exactamente el diseñado: 30 corridas en rojo (15 y 15) entre el 27 y el 30-ago, el 100 % de las que
hubo.** El fallo cerrado hizo su trabajo; lo que no había era nadie leyendo los correos de GitHub.
Si algún día vuelve a pasar, el diagnóstico son diez segundos: `gh variable list` y `gh secret list`
sobre el repo — si salen vacías, es esto y no el endpoint.

### 4.3 Jobs de `pg_cron` (verificar que existen en prod)

| Job | Cadencia | Qué pasa si no corre |
| :-- | :-- | :-- |
| `expire-stale-bookings` | `*/5` | reservas sin pagar bloquean el hueco para siempre |
| `close-expired-sessions` | `*/5` | sesiones vivas eternamente, sin `no_show` |
| `process-notifications` | `*/2` | nada: desde `20260806150000` esta función **solo informa** |
| `process-payouts` | `*/10` | los payouts no pasan de `scheduled` |
| `run-payout-batch` | lunes 03:00 | nadie cobra |
| `purge-expired-messages` | 04:00 diario | el chat no caduca (RN-41) |

⚠️ **`process-notifications` ya no envía, y antes tampoco.** Marcaba **toda** la cola como `sent`
cada 2 minutos sin mandar un solo correo, así que cualquier remitente externo habría llegado siempre
a una cola vacía, corriera cuando corriera. Se apagó el stub siguiendo el precedente de la pausa de
la purga del chat (`20260722200000`): la función no se borra ni se desprograma el cron —"si se
desprograma, se olvida"— sino que pasa a **informar**. `select public.process_notifications();` dice
ahora cuánto hay encolado, así que si el remitente se cae la cola se ve **crecer** en vez de
desaparecer.

**Jobs que NO son `pg_cron`.** Postgres no puede llamar a APIs externas aquí (no está `pg_net`, no
hay Vault y el repo es público, así que no tiene dónde guardar una clave), de modo que estos **tres**
son HTTP y su reloj vive fuera de la base de datos:

| Job | Reloj | Cadencia | Qué pasa si no corre |
| :-- | :-- | :-- | :-- |
| `/api/cron/recordings-purge` | Vercel Cron (`vercel.json`) | 04:00 diario | las grabaciones no se borran en Daily (RN-42) |
| `/api/cron/notifications-send` | GitHub Actions (`notifications-cron.yml`) | `*/5` | los avisos se quedan en `pending` |
| **`/api/cron/refunds-process`** | GitHub Actions (`refunds-cron.yml`) | **`7,22,37,52`** (cada 15 min) | **el dinero no vuelve**: la base de datos y el correo dicen "reembolsado" y el alumno no recibe nada (X-01) |

Los dos de Actions no están en Vercel Cron porque **el plan Hobby limita los crons a uno al día** y
ese hueco lo gasta la purga. Aunque quedara sitio, la cadencia diaria no sirve para ninguno: un aviso
de "tienes 24 h para aceptar esta reserva" que llega mañana no vale, y un reembolso pedido a las
04:05 esperaría un día entero cuando el §13 de los Términos promete devolver "al método de pago
original". El de reembolsos va cada **15** y no cada 5 porque, una vez pedido a Stripe, el dinero
tarda 5-10 días hábiles en llegar a la tarjeta: lo que importa no es adelantar diez minutos el envío,
es que un 429 del PSP no cueste un día de espera hasta el reintento.

El peaje de Actions está escrito en los propios workflows: los programados se retrasan cuando la cola
va cargada (10-15 min es normal, aceptable para un correo y para un reembolso, **no** para un cobro),
GitHub los **desactiva tras 60 días sin actividad** en el repo, y **solo programa los de la rama por
defecto** — mientras vivan únicamente en `dev`, ninguno de los dos tiene reloj. Si los correos o los
reembolsos dejan de salir sin motivo aparente, mirar esas tres cosas por ese orden.

⚠️ **La trampa de Deployment Protection también aplica aquí**, y es la misma que ya mordió con el
webhook de Stripe (§2): apuntado a una **preview**, el job se come un **302** antes de que corra una
línea nuestra. Con un webhook se nota (el evento sale como no entregado); con un cron **no se nota
nada**, porque un cron que no llega a ninguna parte se parece a un cron que no tenía trabajo.
`refunds-cron.yml` distingue el 3xx y lo dice con todas las letras, y acepta un secret opcional
`VERCEL_PROTECTION_BYPASS` que manda por cabecera; `notifications-cron.yml` todavía no.

### 4.4 Lo que sigue simulado

- **Cobros** — **ya no del todo**: Stripe funciona de punta a punta en **test mode** (§2) y la fila
  de ruteo de dev está en `'stripe'`. Falta el salto a `sk_live_`, que sí exige KYC. **DLocal sigue
  entero sin empezar** —no hay cuenta, la solicitud fue **rechazada**— y **los payouts también**,
  porque Connect exige verificación.
- **Correo** — **C-11 resuelta: Resend**, y el envío es real (`/api/cron/notifications-send`). Se
  eligió por un motivo operativo, no de gusto: es el único de los tres candidatos que deja enviar y
  probar **sin dominio verificado**, y el dominio propio sigue bloqueado. Lo que falta es la
  **cuenta** y su `RESEND_API_KEY`. Todo el acoplamiento vive en `sendEmail()` (`lib/email.ts`):
  cambiar de proveedor es reescribir una función.
- **Grabación** — el borrado a los 30 días **ya está automatizado** (RN-42): antes la retención se
  cumplía solo "al servir" —410 al pedir el enlace— y el fichero seguía en Daily para siempre. Pero
  ⚠️ **corregido el 31-ago:** decía que el add-on «sigue sin activarse». **Está activo**: hay dos
  grabaciones `finished` del 14-ago. Hoy no hay nada que borrar por otro motivo — a ninguna le ha
  vencido la retención, que empieza a caer el **13-sep**.

> **Ninguna de las tres se cae sola**: las tres siguen el patrón credencial-interruptor. El día que
> haya credenciales, se encienden sin tocar código.

**Un bug que hacía fallar US-1802 el 100% de las veces, en silencio.**
`/api/recordings/[sessionId]` derivaba el nombre de sala como `` `ey-${sessionId}` `` —con
guiones— y `join_session` la crea como `'ey-' || replace(id::text,'-','')` —sin ellos—, así que **no
coincidían nunca** y no se encontraba ninguna grabación. Ahora se lee `sessions.daily_room_name` en
vez de volver a derivar el nombre por segunda vez.

**Y el bloqueo de dLocal no lo arregla ningún merge.** Rechazaron la cuenta y no se sabe qué URL
presentó el cliente, pero el problema de fondo se ve a simple vista: `ensenameya.com` es una landing
de GoDaddy que **no enlaza a la app** —que vive en `ensenameya.vercel.app`—; dos webs de la misma
marca sin conectar, con dos juegos de términos. Eso es DNS y negocio, no código.

### 4.5 Decisiones del cliente que siguen abiertas

C-13 (mercado/Venezuela y métodos) · C-07 (ventana de pago) · C-02/C-04 (retención y agrupación de
payout) · C-05 (no-show) · C-06 (checkout invitado) · C-09 (%s de tiers) · C-12 (opt-out) · C-15
(FX) · C-10 (reglas de referidos) · **C-11 ✅ resuelta** (Resend) · C-14 ✅ resuelta.

Ninguna bloquea el despliegue: todas tienen default operable (ver el tracker de
`docs/PLAN-DESARROLLO.md`).

**C-10 ya no es solo una decisión pendiente: tiene un problema técnico encima.** La campaña de
Referral Factory **no** manda al referido a nuestra app con un código. Lo lleva a una página de
oferta **alojada por RF**, donde deja nombre y email, y solo después redirige a
`ensenameya.vercel.app`. RF **no ofrece un parámetro de código de referido**, así que la atribución
por cookie `ey-ref` + `profiles.referral_code` (EY-79 / US-1302, todavía en In Review) **no puede
funcionar** con este tipo de campaña: tiene que ser **por email** contra la API de RF. Se activó el
parámetro `ref_email` para eso — los tres que RF ofrece estaban apagados y el referido llegaba sin
nada. Aparte: los términos que RF le enseña al referido son **su plantilla sin rellenar**, con
corchetes tipo "[Insert link to Privacy Policy here]". Redactarlos antes de abrir.

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

---

*Se actualiza en cada pasada de QA. Última edición: **2026-08-31** — §4.7 con el ciclo de la baja de cuenta con dinero en vuelo ejercitado de punta a punta (recolección, ensayo, barrido real, desactivación y cancelación), el mapa de privilegios de `service_role` por operación, y el hueco de cobertura que deja la regla de oro 2. Edición previa el **2026-08-17** — superficies nuevas del día
(contacto, aceptación de términos, alumnos del tutor, cobro tardío, cola de reembolsos), tercer job
programado, §4.6 para vaciar la cola vieja de correo, y el checklist al día (30 migraciones
pendientes de prod, variables repartidas, Stripe de test mode ya en producción). Edición previa el
2026-08-07 con la pasada del 5-6 de agosto: grants de `service_role` y su mínimo privilegio,
`confirm_payment` fuera del alcance del cliente, fail-closed de los crons y del webhook, y Stripe de
punta a punta contra la preview. Creado el 2026-07-29 con la tanda 6 del plan de los sprints 6 AC /
7 / 8.*
