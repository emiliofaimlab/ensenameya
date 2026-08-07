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

- [ ] **Migraciones aplicadas a prod** por CI al mergear a `main` (`supabase/migrations/`). Hoy
      faltan **20** por aplicar: de `20260729130000_us1302_referral_code` a
      `20260806180000_routing_rules_grant_service_role`. Y ya es **un solo** merge hasta prod
      (`dev` → `main`): el PR #11 se mergeó a `dev` en `1a36da2`.
- [ ] **`npm run db:types` regenerado** y sin cambios pendientes en el PR.
- [ ] **`lint` + `typecheck` + `build`** en verde.
- [ ] **Cuenta de admin sembrada** en prod (`supabase/seed/admin-bootstrap.sql`) — y **completar su
      onboarding**: el gate de `requireUser` (RN-44) también aplica al admin.
- [ ] **Categorías reales** cargadas (las 10 del seed son de dev).
- [x] **Páginas legales redactadas** (DD-06). `/terms`, `/privacy` y `/cookies` dejaron de ser 404 y
      describen lo que la plataforma hace **de verdad**: los plazos salen de las migraciones y los
      reembolsos se importan de `lib/policy.ts`, no se reescriben a mano. ⚠️ **En prod siguen siendo
      404**: `main` no tiene ni las páginas. Se arregla con el merge de arriba.
- [ ] **Fila de `payment_routing_rules` en prod** apuntando al proveedor que toque. En dev está en
      `'stripe'`; cambiarla es un `UPDATE`, no una migración.

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
| `CRON_SECRET` | los dos crons responden **503** y no corren |
| `RESEND_API_KEY` | el job de correo no toca la cola: los avisos se quedan `pending` |
| `REFERRAL_FACTORY_API_KEY` | sin atribución de referidos |

Detalle en `docs/ENTORNOS.md`. **`service_role` jamás en `NEXT_PUBLIC_*`** (regla de oro 3).

**Estado real al 6-ago.** Las seis variables nuevas (`CRON_SECRET`, `STRIPE_API_KEY`,
`STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `REFERRAL_FACTORY_API_KEY` y
`NEXT_PUBLIC_REFERRAL_URL`) existen **en local**. En **Vercel (scope Preview)** solo están las dos
de Stripe. Faltan por poner:

- [ ] `CRON_SECRET` en Vercel — sin ella el cron de grabaciones responde 503 en cada pasada.
- [ ] `RESEND_API_KEY` en Vercel — y antes, la **cuenta de Resend**, que tampoco existe todavía.
- [ ] `NEXT_PUBLIC_REFERRAL_URL` y `REFERRAL_FACTORY_API_KEY` en Vercel (la URL de campaña es
      `https://vercel.referral-factory.com/cXr65Wou/signup`).

**Y en GitHub**, que es donde vive el reloj del correo
(`.github/workflows/notifications-cron.yml`):

- [ ] variable `APP_BASE_URL`
- [ ] secret `CRON_SECRET`

Sin las dos el workflow **falla en rojo cada 5 minutos**, y es a propósito: el job trata el 503 ("no
hay `CRON_SECRET` en Vercel") y el 401 ("no coincide") como configuración a medias, que es
exactamente lo que son.

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
hay Vault y el repo es público, así que no tiene dónde guardar una clave), de modo que estos dos son
HTTP y su reloj vive fuera de la base de datos:

| Job | Reloj | Cadencia | Qué pasa si no corre |
| :-- | :-- | :-- | :-- |
| `/api/cron/recordings-purge` | Vercel Cron (`vercel.json`) | 04:00 diario | las grabaciones no se borran en Daily (RN-42) |
| `/api/cron/notifications-send` | GitHub Actions | `*/5` | los avisos se quedan en `pending` |

El de correo no está en Vercel Cron porque **el plan Hobby limita los crons a uno al día**, y un
aviso de "tienes 24 h para aceptar esta reserva" que llega mañana no sirve de nada. El peaje de
Actions está escrito en el propio workflow: los programados se retrasan cuando la cola va cargada
(10-15 min es normal, aceptable para un correo y no para un cobro) y GitHub los **desactiva tras 60
días sin actividad** en el repo. Si los correos dejan de salir sin motivo aparente, mirar eso
primero.

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
  el add-on de grabación de Daily **sigue sin activarse** (falta el go de coste), así que hoy no hay
  grabaciones que borrar.

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

---

*Se actualiza en cada pasada de QA. Última edición: **2026-08-07**, recogiendo la pasada del 5-6 de
agosto: grants de `service_role` y su mínimo privilegio, `confirm_payment` fuera del alcance del
cliente, fail-closed de los dos crons y del webhook, Stripe de punta a punta contra la preview, y el
checklist al día (20 migraciones pendientes de prod, un solo merge, variables que faltan en Vercel y
en GitHub). Creado el 2026-07-29 con la tanda 6 del plan de los sprints 6 AC / 7 / 8.*
