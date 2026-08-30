# Enséñame Ya — Ambientes dev / prod (US-1603)

> **Objetivo:** dos entornos **100% cloud e independientes** — **dev** y **prod** — cada uno con su
> proyecto Supabase y su deploy en Vercel, con migraciones aplicadas por CI.
> **No hay stack local**: se desarrolla directamente contra **dev cloud** (vibe coding al máximo).
> Cabe en el free tier de Supabase (2 proyectos/org).
> Este doc trae (a) la arquitectura y **qué variable va en qué entorno**, (b) el flujo sin local,
> (c) el checklist de setup, (d) los **trabajos programados** y (e) el montaje del **webhook de Stripe**.

---

## 1. Arquitectura

```
Rama git         Vercel (1 proyecto)       Supabase
─────────        ───────────────────       ────────────────────
main       ───▶  Production          ───▶  ensenameya-prod  (nrzsyysqanbrcgtslfte)
dev / PRs  ───▶  Preview             ───▶  ensenameya-dev   (lbtpnszjjsxbeileqsja)
```

- **Un proyecto Vercel** conectado al repo; separa ambientes por **env vars con scope** (Production vs Preview).
- **Dos proyectos Supabase** (dev y prod), aislamiento real de datos. Sin Docker, sin `supabase start`.
- **Migraciones = git** (fuente de verdad). CI: push a `main` → prod; push a `dev` → dev.

**Valores por ambiente (no secretos — URL y ref son públicos):**

| | dev | prod |
| :-- | :-- | :-- |
| Project ref | `lbtpnszjjsxbeileqsja` | `nrzsyysqanbrcgtslfte` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lbtpnszjjsxbeileqsja.supabase.co` | `https://nrzsyysqanbrcgtslfte.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable dev | publishable prod |
| `SUPABASE_SERVICE_ROLE_KEY` | secret dev | secret prod |

> Claves `secret`/`service_role`, DB passwords y connection strings **solo** como secrets de
> Vercel/GitHub o en `.env.local` (gitignored). Nunca en el repo ni en `NEXT_PUBLIC_*`. Regla de oro 3.

**Interruptores por variable.** Varias integraciones se encienden poniendo su variable, sin tocar
código; ausentes, la función se apaga sola en vez de romper:

| Variable | Enciende | Si falta |
| :-- | :-- | :-- |
| `DAILY_API_KEY` | Sala de video real (EP-08) · borrado de grabaciones (§4) | Sala simulada; la purga responde `sin-daily` y no marca nada |
| `NEXT_PUBLIC_REFERRAL_URL` | Bloque "Invita y gana" del **alumno** (US-1301) | El bloque **no se pinta** para alumnos |
| `NEXT_PUBLIC_REFERRAL_URL_TUTOR` | Bloque "Invita y gana" del **tutor** (B1.11) — campaña DISTINTA en Referral Factory | El bloque **no se pinta** para tutores. ⚠️ **No se cae a la del alumno**: eso lo daría de alta en el programa equivocado |
| `NEXT_PUBLIC_REFERRAL_EMBED_URL` · `..._TUTOR` | El widget de Referral Factory **embebido** en `/referidos` (28-ago), en vez de mandar al usuario fuera. Es el `src` del `<iframe>` que da RF en *Share / Embed*, que **no tiene por qué ser** la URL pública de la campaña | `/referidos` sigue existiendo y cae al enlace externo de arriba con un aviso discreto — nunca un iframe vacío. Falla cerrado por rol igual que las dos de arriba |
| `SENTRY_DSN` · `NEXT_PUBLIC_SENTRY_DSN` | Monitoreo de errores (US-1501) | El SDK ni se inicializa |
| `STRIPE_API_KEY` | Cobro real con Stripe (EP-20) · **reembolsos reales** (X-01, §4) | No se instancia el cliente, el checkout sigue por el camino simulado y la cola de reembolsos **no se toca** (queda `pending`) |
| `RESEND_API_KEY` | Envío real de correo (US-1201) y del formulario de contacto (DL-01) | La cola se queda en `pending` (no `failed`) y el mensaje de contacto se guarda en `contact_messages` pero no sale |
| `EMAIL_FROM` | Remitente propio | `Enséñame Ya <onboarding@resend.dev>`, que funciona sin dominio verificado |
| `NEXT_PUBLIC_SITE_URL` | Base absoluta de `success_url`/`cancel_url` de Stripe | Desde EX-07 (17-ago) se deduce por entorno: producción → `VERCEL_PROJECT_PRODUCTION_URL`, preview → `VERCEL_BRANCH_URL` (alias fijo de rama). En local, `http://localhost:3000` |

> ⚠️ **`RESEND_API_KEY` ya no basta, por sí sola, para vaciar la cola de correo** — y eso cambia un
> aviso que llevaba semanas escrito al revés. Desde `20260806150000` quien envía es el job
> `/api/cron/notifications-send`, así que hacen falta **las dos cosas**: la clave en Vercel **y** un
> reloj que llame al job. Con la clave puesta y sin reloj no sale nada; el día que se configure el
> reloj sale **todo lo acumulado de golpe**.
>
> 🟢 **El reloj se encendió el 30-ago y no salió ni un correo, porque apunta a producción.** Las dos
> variables de GitHub ya están puestas (abajo), pero `APP_BASE_URL` = `https://ensenameya.vercel.app`
> y la cola de **prod está vacía** (`revisadas: 0` en la pasada de verificación). ⚠️ **La mina sigue
> 🟢 **Y la mina de dev se desactivó el mismo 30-ago: la cola está VACÍA.** Eran **336**
> `pendientes_email` (la más antigua del 11-ago, no las 126 del censo del 17-ago); se cerraron las
> 336 como `failed` siguiendo `docs/QA-LANZAMIENTO.md` §4.6. Hoy `process_notifications()` en dev
> devuelve `pendientes_email: 0, fallidas: 336`. ⚠️ **Volverá a llenarse**: el seed usa
> `@ensenameya.dev`, un dominio sin MX — 187 de las 336 iban ahí.

**Y dos que fallan CERRADO**, al revés que las de arriba, porque su ausencia dejaría un endpoint
público: sin `CRON_SECRET` los **tres** jobs programados responden **503** y no corren (§4), y sin
`STRIPE_WEBHOOK_SECRET` el webhook responde **503** y no procesa ningún evento (§5).

**Stripe tiene dos interruptores y hacen falta los dos:** la clave de arriba **y** la fila de
`payment_routing_rules`, que es el dato que decide qué proveedor cobra. Desde
`20260806180000_routing_rules_grant_service_role.sql` esa fila se cambia con un `UPDATE` de
`service_role` (`select` + `update` de `charge_provider`, `payout_provider`, `is_active`; sin
`insert` ni `delete`), ya **no** escribiendo una migración. En **dev** ya está en `'stripe'`.

**Dónde está puesta cada variable (rev. 30-ago).** "falta" = hay que ponerla; el resto ya está.

| Variable | `.env.local` | Vercel Preview | Vercel Production | GitHub |
| :-- | :-- | :-- | :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` · `..._ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` | dev | dev | prod | — |
| `STRIPE_API_KEY` | sí (`sk_test_`) | sí | **sí (17-ago)** | — |
| `STRIPE_WEBHOOK_SECRET` | sí (el de `stripe listen`) | sí (el del endpoint) | **sí (17-ago)** | — |
| `STRIPE_PUBLISHABLE_KEY` | sí | — | — | — |
| `CRON_SECRET` | sí | ? sin comprobar | **sí** (comprobado 30-ago) | **sí (30-ago)** (secret) |
| `RESEND_API_KEY` | **sí (17-ago)** | **sí (17-ago)** | **sí (17-ago)** | — |
| `NEXT_PUBLIC_REFERRAL_URL` | sí | **falta** | **falta** | — |
| `NEXT_PUBLIC_REFERRAL_URL_TUTOR` | **falta** | **falta** | **falta** | — |
| `NEXT_PUBLIC_REFERRAL_EMBED_URL` · `..._TUTOR` | **falta** | **falta** | **falta** | — (pendiente: el cliente tiene que dar el snippet de embed de RF) |
| `REFERRAL_FACTORY_API_KEY` | sí | **falta** | **falta** | — |
| `APP_BASE_URL` | — | — | — | **sí (30-ago)**: `https://ensenameya.vercel.app` (variable, no secret) |
| `VERCEL_PROTECTION_BYPASS` | — | — | — | opcional (secret) — solo si `APP_BASE_URL` apunta a una preview |

- `STRIPE_PUBLISHABLE_KEY` está en local por simetría, pero hoy **no la lee nadie**: el checkout es
  el alojado de Stripe y el navegador solo recibe la URL a la que redirigir.
- **Producción ya tiene las de Stripe, y siguen siendo de *test mode*.** Repartirlas era el paso
  previo al merge —una clave puesta después del despliegue no la aplica Vercel hasta un *Redeploy*,
  ver el aviso de abajo—, no el salto a cobros reales: eso es `sk_live_` y exige el KYC que sigue
  bloqueado. ⚠️ **Producción cobrando en test mode es peor que producción sin cobrar**: acepta
  tarjetas de prueba y no cobra ninguna real. Antes de abrir a usuarios: o la clave pasa a `sk_live_`,
  o la fila de `payment_routing_rules` de **prod** se deja fuera de `'stripe'` — hoy sigue sin
  tocarse, y es un punto abierto del checklist (`docs/QA-LANZAMIENTO.md` §4.1).
- `APP_BASE_URL` es solo de **GitHub**: le dice a los workflows de correo y de reembolsos a qué
  despliegue llamar (§4). `CRON_SECRET` hace falta en **los dos lados y con el mismo valor** — GitHub
  lo manda en la cabecera, Vercel lo compara.
- `VERCEL_PROTECTION_BYPASS` no hace falta apuntando a producción, que no está protegida. Solo si se
  apunta un workflow a una **preview**: ahí Deployment Protection devuelve **302 antes de que corra
  una línea nuestra** y el job no falla, simplemente no hace nada. Es la misma trampa que el webhook
  de Stripe (§5), y el workflow de reembolsos la detecta y lo dice; el de correo, todavía no.
- **Lo que ya no vale como excusa:** hasta el 7-ago producción estaba vacía a propósito porque en
  `main` no había ni código que leyera estas variables. **Desde el merge del 26-ago sí lo hay**, y
  `main` va hoy solo 52 commits y 7 migraciones por detrás. El orden pasa a ser el contrario:
  primero las variables, luego el merge, para que el despliegue de producción nazca con todo puesto.

> **Vercel no aplica una variable nueva a un despliegue que ya existe.** Las env vars se inyectan al
> construir: añadirla en Settings y recargar la misma URL de preview devuelve **exactamente el mismo
> 503** de antes. Hay que **Redeploy** (Deployments → ⋯ → Redeploy) o empujar un commit. Se lee como
> "la clave está mal puesta" y no lo es.

---

## 2. Flujo de trabajo (sin local)

- **Correr la app:** `npm run dev` — usa `.env.local`, que apunta a **dev cloud**.
- **Cambiar el esquema:** escribe la migración en `supabase/migrations/`, luego aplícala a dev:
  ```bash
  npx supabase db push --db-url "postgresql://postgres.lbtpnszjjsxbeileqsja:<db-password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
  ```
  (o haz push a la rama `dev` y deja que el CI la aplique). A prod llega al mergear a `main`.
- **Regenerar tipos:** con el CLI ya enlazado, `npm run db:types`. Sin enlace, con **access token**
  explícito (sin Docker se genera vía API):
  ```bash
  export SUPABASE_ACCESS_TOKEN=<pat>
  npx supabase gen types typescript --project-id lbtpnszjjsxbeileqsja > src/lib/database.types.ts.tmp
  ```
- ⚠️ **`db:types` VACIABA `database.types.ts` cuando fallaba, y lo hacía en silencio.** El script
  redirigía con `>`, y la redirección **trunca el destino antes de que el comando arranque**: si el
  CLI devolvía un error —un 403 del Management API, un token caducado, la red— el fichero se quedaba
  en 0 líneas y el error se leía como "de repente no compila nada". **Pasó el 17-ago: 1704 líneas a
  1.** Desde ese mismo día el script escribe a `src/lib/database.types.ts.tmp`, comprueba que el
  resultado contiene `export type Database` y solo entonces lo mueve encima; si no, borra el temporal
  y **deja el bueno intacto**. Si alguna vez se regenera a mano, usar `.tmp` igual (arriba) o mirar
  `git diff --stat` justo después. Y la regla de siempre: `database.types.ts` **no se edita a mano**.
- ⚠️ **Si `db:push` o `db:types` responden `403 "your account does not have the necessary
  privileges"`, no es el proyecto: es la cuenta.** Es un permiso sobre el **Management API** de
  Supabase, no sobre la base de datos, y no se arregla reenlazando ni regenerando el token. Mordió el
  17-ago dejando una migración sin aplicar durante horas mientras el código ya la daba por buena.
  Salida de emergencia: aplicar la migración por `--db-url` (arriba) o por el CI empujando a `dev`.
- **Convención de grants (auto-expose OFF):** toda tabla expuesta al cliente declara sus `grant`
  junto a sus políticas RLS (ver `20260703120000_data_api_grants.sql`). Públicas → `anon`; privadas →
  `authenticated`. RLS sigue siendo la barrera default-deny; el grant solo deja al rol llegar a la tabla.
  Las **vistas** llevan además `with (security_invoker = true)`: por defecto una vista corre con los
  privilegios de su dueño y se saltaría la RLS de las tablas que envuelve (ver la vista `tutors_public`
  del filtro de precio, `20260804120000_dd04_vista_precio_tutor.sql`).
- **`service_role` se salta la RLS pero NO los grants de tabla.** Con auto-expose OFF, un job o un
  webhook que use la clave secreta se estrella con `permission denied for table …` — en **ejecución**,
  no en el build, así que lint y typecheck pasan tan contentos. Mordió tres veces en dos días:
  `sessions` (`20260806140000`), `payments`/`profiles` (`20260806170000`) y `payment_routing_rules`
  (`20260806180000`). Todo camino nuevo con `service_role` sobre una tabla que no lo declare va a
  repetirlo. Se concede acotado (columnas concretas), no en bloque.
- **Scripts (`package.json`):** ya son cloud — `db:push` (aplica al proyecto enlazado) y
  `db:types` (`--linked`). Requieren enlazar el CLI una vez: `npx supabase link --project-ref <ref>`
  (pide access token). Los antiguos `db:start`/`db:stop`/`db:reset` (Docker) se eliminaron.

---

## 3. Checklist de setup

### A) Supabase — [x] hecho
- [x] Proyectos **`ensenameya-prod`** (`nrzsyysqanbrcgtslfte`) y **`ensenameya-dev`** (`lbtpnszjjsxbeileqsja`) creados (East US · automatic RLS on · auto-expose off).
- [x] Esquema base + grants Data API aplicados a **dev y prod**.

### B) Auth por proyecto (Supabase → Authentication) — [x] hecho en dev; prod por confirmar
- [x] **Site URL / Redirect URLs:** la URL de Vercel (prod → dominio de producción; dev → dominio de preview) **y** `http://localhost:3000` para `npm run dev`.
- [x] **Google OAuth en dev — encendido el 17-ago.** Era el bloqueante nº 1 del Doc 18 y **no era un
      bug**: el proveedor estaba apagado y Supabase devolvía `"Unsupported provider: provider is not
      enabled"` antes de tocar una línea nuestra. Client ID/Secret puestos y redirect
      `https://lbtpnszjjsxbeileqsja.supabase.co/auth/v1/callback` autorizado en Google Cloud. Login
      verificado de punta a punta: la sesión se crea y el callback redirige a `/onboarding?next=/app`.
- [ ] **Google OAuth en prod:** el proyecto `nrzsyysqanbrcgtslfte` necesita **su propio** Client
      ID/Secret y su propio redirect (`https://nrzsyysqanbrcgtslfte.supabase.co/auth/v1/callback`).
      Los de dev **no valen**: son credenciales por proyecto. Va antes del merge, o el botón de
      Google saldrá roto en producción el día del estreno.
- [x] **Dev:** **"Confirm email"** desactivado (Authentication → Providers → Email) para probar signup sin SMTP.
- [ ] **Mínimo de contraseña a 8 en el panel de Auth** (Authentication → Policies), dev y prod.
      RV-12 lo subió en el formulario el 17-ago, pero **el mínimo de verdad lo impone el servidor de
      Auth**: sin tocarlo, el navegador rechaza 6 caracteres y la API los sigue aceptando.

### C) Vercel (1 proyecto) — https://vercel.com — [x] hecho, salvo las variables nuevas
- [x] **Import Project** desde `github.com/emiliofaimlab/ensenameya` (Next.js autodetecta). Production Branch = **`main`**.
- [x] Env vars (Settings → Environment Variables), dos juegos con las claves
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`:
  - Scope **Production** → valores de **prod**.
  - Scope **Preview** → valores de **dev**.
- [x] Scope **Preview**: `STRIPE_API_KEY` y `STRIPE_WEBHOOK_SECRET` (test mode), 6-ago.
- [x] **Protection Bypass for Automation** (Settings → Deployment Protection) activado, para que
  Stripe pueda entregar el webhook a la preview (§5).
- [x] **`RESEND_API_KEY`, 17-ago** (local, Preview y Production). Es lo que hace que el formulario de
  contacto **entregue de verdad**, que es lo que dLocal prueba a mano (DL-01): un formulario que
  encola en silencio no cumple el requisito. ⚠️ El remitente sigue siendo `onboarding@resend.dev`
  mientras no haya dominio verificado.
- [x] Scope **Production**: las dos de Stripe, 17-ago. ⚠️ Siguen siendo **de test mode** — ver el
  aviso de §1 sobre producción cobrando en sandbox.
- [x] **`CRON_SECRET` en Production ya estaba** — comprobado el 30-ago, y este doc decía lo
  contrario desde el 17. La prueba no necesita el panel: sin la variable el endpoint responde **503**
  y con ella **401**, y `curl https://ensenameya.vercel.app/api/cron/notifications-send` (sin
  cabecera) devuelve **401**. Con la cabecera correcta, **200**.
- [ ] Scope **Preview y Production**: faltan `NEXT_PUBLIC_REFERRAL_URL`,
  `NEXT_PUBLIC_REFERRAL_URL_TUTOR` y `REFERRAL_FACTORY_API_KEY` (ver la matriz de §1).
- [ ] Tras dar de alta cualquiera: **Redeploy**. Vercel no las aplica al despliegue ya construido (§1).

### D) GitHub — Environments (CI de migraciones) — [x] hecho, salvo branch protection
- [x] Repo → Settings → **Environments** → **`production`** y **`development`** creados; en cada uno el
  *Environment secret* `SUPABASE_DB_URL` = connection string del **session pooler** (percent-encoded):
  `postgresql://postgres.<ref>:<pwd>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
- [x] Rama **`dev`** creada desde `main`.
- [ ] (Recomendado) Branch protection en `main`: PR + checks verdes. **Sin configurar** (la API de
  protección devuelve 404 el 5-ago): hoy nada impide un push directo a `main` → prod.
- [x] **Crons de correo y de reembolsos, 30-ago** (Settings → Secrets and variables → Actions):
  *variable* `APP_BASE_URL` = `https://ensenameya.vercel.app` y *secret* `CRON_SECRET`, el mismo
  valor que ya tenía Vercel. Los dos workflows pasaron a **verde** en la primera pasada manual.
  ⚠️ **Costó 30 corridas en rojo y otros tantos correos de GitHub**: los workflows llegaron a `main`
  el 26-ago y fallaron **el 100 % de las veces** (15 y 15) del 27 al 30 con
  `exit 1` en la primera línea. Están escritos para fallar en rojo a propósito, y funcionó — lo que
  no había era nadie mirando el rojo.
- [ ] *(Opcional)* **secret `VERCEL_PROTECTION_BYPASS`**, solo si `APP_BASE_URL` va a apuntar a una
  **preview**: Deployment Protection responde 302 antes de llegar a nuestro código. El workflow de
  reembolsos lo manda por cabecera si existe y **dice qué pasa** si recibe un 3xx; el de correo
  todavía no, así que apuntado a una preview se queda en rojo sin explicar por qué.
- [x] ⚠️ **La cola vieja de notificaciones no se disparó** — porque `APP_BASE_URL` apunta a
  **producción** y allí la cola está vacía. Y el mismo 30-ago **se vació también la de dev**: 336
  avisos cerrados como `failed` (§4.6). Ya no hay mina que armar al repuntar un reloj a dev.

### E) Jira — [x] conectado (proyecto `EY`, `faimlab.atlassian.net`).

### F) Stripe (test mode) — [x] cableado y verificado; live sigue bloqueado
- [x] Cuenta en **sandbox**. Corrige la premisa de la épica EY-92 ("no iniciar hasta tener AMBAS
  cuentas"): con solo registrar el email hay Sessions, webhooks **firmados**, rechazos, expiraciones
  y reembolsos. El KYC solo bloquea **live mode**.
- [x] Endpoint del webhook registrado y probado de punta a punta (§5).
- [x] `payment_routing_rules` de **dev** en `'stripe'` — hoy es un `UPDATE`, no una migración (§1).
- [ ] `sk_live_`, KYC y **payouts** (Connect exige KYC): bloqueados por el cliente.
- [ ] **DLocal**: la cuenta fue **rechazada**, sin saber qué URL presentó el cliente. El problema de
  fondo no es de configuración: `ensenameya.com` es una landing de GoDaddy que **no enlaza a la app**
  (que vive en `ensenameya.vercel.app`), o sea dos webs de la misma marca con dos juegos de términos.
  Esto **no lo arregla ningún merge**: es DNS y negocio.

### G) Correo — Resend (C-11/DP-05) — [x] cuenta creada y clave puesta (17-ago)
- [x] Proveedor **decidido: Resend**, por un motivo operativo — es el único de los tres candidatos
  (SendGrid, Mailgun, Resend) que deja enviar y **probar sin dominio verificado**, y el dominio
  propio sigue bloqueado. El acoplamiento vive entero en `sendEmail()` (`src/lib/email.ts`):
  cambiar de proveedor es reescribir esa función.
- [x] Cuenta creada y `RESEND_API_KEY` puesta (local **y** Vercel), 17-ago. Sin ella el job responde
  `sin-proveedor` y la cola se queda en `pending`, no `failed`.
- [ ] **Verificar el dominio `ensenameya.com` en Resend.** Hoy el remitente es
  `onboarding@resend.dev`, que funciona, pero un correo de contacto que no llega desde
  `@ensenameya.com` es exactamente lo que un revisor de dLocal marca. El día que se verifique, se
  pone `EMAIL_FROM` y no hay que tocar código.
- [ ] ⚠️ **Cuidar la reputación de la cuenta desde el primer envío.** Es nueva y no tiene historial:
  una primera tanda con decenas de rebotes es la forma más rápida de que Resend limite el envío.
  Ver §4.6 de `docs/QA-LANZAMIENTO.md` — y no sembrar cuentas de prueba con dominios que no reciben.
- [ ] **Comprobar que llega un correo de verdad.** A día de hoy **nadie ha visto llegar ninguno**:
  la clave está puesta, el código está entero y ni el formulario de contacto ni la cola se han
  ejercitado contra un buzón real. No dar DL-01 por cerrado hasta que se vea el mensaje.

---

## 4. Trabajos programados (tres jobs, dos relojes distintos)

| Job | Ruta | Reloj | Cadencia |
| :-- | :-- | :-- | :-- |
| Purga de grabaciones (RN-42) | `/api/cron/recordings-purge` | **Vercel Cron** (`vercel.json`) | diaria, `0 4 * * *` |
| Envío de la cola de correo (US-1201) | `/api/cron/notifications-send` | **GitHub Actions** (`notifications-cron.yml`) | pide 5 min · **entrega ~2-6 h** |
| **Cola de reembolsos (X-01)** | `/api/cron/refunds-process` | **GitHub Actions** (`refunds-cron.yml`) | pide 15 min (`7,22,37,52`) · **entrega ~2-6 h** |

Los tres se autentican igual: `Authorization: Bearer $CRON_SECRET`. Sin la variable configurada
responden **503** y no corren (falla cerrado a propósito: son endpoints que borran datos, envían
correos y **mueven dinero**, y sin secreto serían públicos); con un valor que no coincide, **401**.

Ninguno es una Edge Function de Supabase, a propósito: el repo ya tomó esa decisión en
`20260717120000_us801_daily_real.sql` — Postgres no puede llamar a la API de Daily, y una función de
Deno necesitaría su propio cliente, su propia copia de la clave y un pipeline de despliegue que hoy
no existe. Van como Route Handlers y reutilizan `lib/daily.ts` y `lib/email.ts` tal cual.

**Por qué el correo y los reembolsos NO van en Vercel Cron.** El plan **Hobby limita los crons a uno
al día**, y ese único hueco ya lo gasta la purga de grabaciones. Aunque quedara sitio, la cadencia
diaria no sirve para ninguno de los dos: un aviso de "tienes 24 h para aceptar esta reserva" que
llega mañana no vale, y un reembolso pedido a las 04:05 esperaría un día entero a que alguien lo
mandara — cuando el §13 de los Términos promete devolver "al método de pago original". Actions da
granularidad de minutos, logs y reejecución manual (`workflow_dispatch`). El precio son tres peajes,
anotados también en los propios workflows para que nadie los descubra depurando:

- ⚠️ los programados de GitHub **se retrasan muchísimo más de lo que dice este párrafo**. La cifra
  de "10-15 min" era la del manual; la medida sobre las corridas reales del 27 al 30-ago es **una
  cada 2-6 horas** — 15 corridas de cada workflow en 3,5 días, cuando lo pedido eran ~1.000 y ~336.
  GitHub estrangula los `cron` de cadencia corta y no avisa. **Sigue siendo mejor que el único cron
  diario de Vercel Hobby, que es el motivo por el que están aquí**, pero no se puede planificar con
  "cada 5 minutos": un aviso de "te quedan 24 h" puede llegar con 6 h de retraso. Si algún día hace
  falta cadencia de verdad, el arreglo no es tocar el `cron:` — es Vercel Pro o un reloj externo;
- GitHub **desactiva los workflows programados tras 60 días sin actividad** en el repo — si los
  correos o los reembolsos dejan de salir sin más, mirar eso primero;
- GitHub solo programa los workflows de la **rama por defecto** (`main`): un workflow que solo vive
  en `dev` **no tiene reloj**, por muy bien escrito que esté.

Si algún día el proyecto pasa a Pro, los dos se mueven a `vercel.json` y los workflows se borran.

**Por qué los reembolsos van cada 15 min y el correo cada 5.** No es simetría rota: una vez pedido el
reembolso a Stripe, el dinero tarda **5-10 días hábiles** en aparecer en la tarjeta, así que
adelantar el envío diez minutos no le cambia la vida a nadie. Lo que sí importa es el **reintento**:
un 429 o un 5xx de Stripe deja la fila en `pending` a propósito —marcarla `failed` sería quedarse con
el dinero del alumno por un mal minuto del PSP— y con cadencia diaria ese mal minuto costaría un día.
Quince minutos dan tres reintentos por hora y dejan el peor caso, retraso de GitHub incluido, por
debajo de la media hora. Una pasada con la cola vacía no llama a Stripe: son dos consultas.

**🟢 Desde el 30-ago corren los tres.** Los dos motivos que lo impedían están resueltos: el merge a
`main` del 26-ago les dio reloj, y ese mismo día empezaron a fallar en rojo porque faltaban las dos
variables de GitHub, que se dieron de alta el 30. Pasada de verificación:

```
GET /api/cron/notifications-send   → 200 {"status":"ok","revisadas":0,"enviadas":0,...}
GET /api/cron/refunds-process      → 200 {"status":"ok","revisadas":0,"reembolsados":0,...,"lote":25}
```

⚠️ **Verde no es lo mismo que útil, y aquí la diferencia importa.** Los relojes apuntan a
**producción**, donde las dos colas están **vacías**. Lo que hay encolado está en **dev**, y a dev no
lo llama ningún reloj:

| Cola | prod | dev |
| :-- | :-- | :-- |
| `notifications` (`pendientes_email`) | 0 | **0** — eran 336; vaciada el 30-ago (§4.6) |
| `refund_requests` (`pending`) | 0 | **0** — eran 2; ejecutados contra Stripe el 30-ago ($47,50) |

Los **2 reembolsos de dev** eran el caso de prueba que X-01 nunca había ejercitado — y **se ejecutó
el 30-ago**: $47,50 contra Stripe *test mode*, cuadrando en la cola, en `refunds_backlog()`, en
Stripe y en `payments`. El job **sí mueve dinero**. Se corrió en **local** (`npm run dev` contra la
BD de dev) porque la preview está tras Deployment Protection y `APP_BASE_URL` apunta a prod. Los
**336 correos** que eran la mina de §1 tampoco están: se cerraron como `failed` el mismo día.

`status: "ok"` (en vez de `sin-proveedor` / `sin-stripe`) confirma de paso que producción ya tenía
`RESEND_API_KEY` **y** `STRIPE_API_KEY`: son las propias respuestas del endpoint las que lo dicen.

Y aunque corriera, la purga no tendría nada que borrar todavía: el **add-on de grabación de Daily
sigue sin contratar** (falta el visto bueno de coste), así que sin `DAILY_API_KEY` el job devuelve
`sin-daily` y no marca ninguna sesión — mentir en `sessions.recordings_purged_at`, que es la prueba
de que la política se cumple, sería peor que no tener sello.

---

## 5. Webhook de Stripe (EP-20 · PAC-03)

`POST /api/webhooks/stripe` es el **único** sitio donde un cobro pasa a `paid`. Montaje en test mode:

- **Endpoint registrado en el panel de Stripe** con el nombre `ensenameya-vercel` y **4 eventos**,
  todos de `checkout.session`: `completed`, `expired`, `async_payment_succeeded`,
  `async_payment_failed`.
- Apunta a la **preview** de Vercel, con el token del bypass en la query:
  `https://<preview>.vercel.app/api/webhooks/stripe?x-vercel-protection-bypass=<token>`.
- El `whsec_` que da ese endpoint es el `STRIPE_WEBHOOK_SECRET` del scope **Preview**.

**Por qué hace falta el Protection Bypass.** Deployment Protection deja los previews detrás del SSO
de Vercel, que responde **302 hacia la pantalla de login antes de que corra una línea de nuestro
código**. Stripe ve una redirección, no un 200, y se pone a reintentar durante tres días contra algo
que nunca va a procesar el evento. **Protection Bypass for Automation** (Settings → Deployment
Protection) da un token que, puesto en la query, salta esa puerta y deja llegar la petición a la ruta.
En producción no hará falta: el dominio de producción no está protegido.

**Verificado de punta a punta contra la preview**, con Stripe entregando el evento de verdad:
Session creada desde la preview → expirada desde la API de Stripe → webhook entregado a través del
bypass → reserva `cancelled`, pago `failed` y `pending_webhooks=0`.

> **Anotado por si acaso:** el endpoint quedó registrado con API version `2026-06-24.dahlia` y el
> código fija `2026-07-29.dahlia` (`src/lib/stripe.ts`, tomada del SDK instalado). Irrelevante para
> los campos que se leen —`client_reference_id`, `payment_status`, `payment_intent`—, pero conviene
> saberlo el día que uno de ellos cambie de forma.

**Probarlo en local.** No hay bypass que valga: `localhost` no está publicado, así que se usa la CLI
de Stripe como túnel.

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# imprime un whsec_… → ESE es el que va en .env.local
```

⚠️ **El `whsec_` de `stripe listen` no es el mismo que el del endpoint del panel.** Son secretos
distintos, uno por destino. Copiar el de Vercel a `.env.local` (o al revés) hace que la firma no
valide y la ruta responda **400 firma inválida** — que es justo lo que debe hacer, y que se confunde
con un bug del código. Cada entorno lleva el suyo.

Ojo también con los eventos sintéticos (`stripe trigger …`): llegan sin `client_reference_id`, así
que la ruta los da por no nuestros y responde 200 con `{"status":"ignorado"}` sin tocar nada. La
prueba de verdad es completar una Session abierta desde la app.

⚠️ **La misma trampa muerde a los crons, y ahí es más difícil de ver.** Cualquier cosa que llame por
HTTP a un despliegue de **preview** —el webhook de Stripe, los workflows de Actions, un `curl` desde
el portátil— se come el **302** de Deployment Protection antes de tocar nuestro código. Con Stripe se
nota porque el evento aparece como no entregado; con un cron no se nota nada, porque un cron que no
llega a ninguna parte se parece mucho a un cron que no tenía trabajo. `refunds-cron.yml` lo detecta y
lo dice con todas las letras; `notifications-cron.yml` **todavía no** —solo ve "no es 200"—. La
diferencia con el webhook: Stripe no puede poner cabeceras y usa el token en la query; los workflows
sí, y lo mandan como cabecera `x-vercel-protection-bypass` para que no acabe escrito en ningún log.

---

## 6. Estado actual

- [x] Repo `emiliofaimlab/ensenameya` · `gh` CLI autenticado · Jira `EY` conectado.
- [x] Supabase **dev** y **prod** creados; esquema base + grants aplicados a ambos.
- [x] `.env.local` apunta la app a **dev cloud**.
- [x] CI **activo y validado**: `main`→prod aplicado por Actions (no-op OK). Tolerante si falta el secret.
- [x] GitHub Environments (production/development) + secret `SUPABASE_DB_URL` + ramas `main`/`dev`.
- [x] Vercel: proyecto importado, **prod desplegado** (`ensenameya.vercel.app`); env vars Production→prod, Preview→dev.
- [x] Auth: Site URL + Redirect URLs en prod y dev; "Confirm email" **off** en dev.
- [x] CLI enlazado a **dev** (`supabase/.temp/linked-project.json`): `db:push` y `db:types` corren
  contra el proyecto enlazado — `db:types` usa `--linked` (package.json), sin Docker ni `--project-id`.
- [x] Stripe en **test mode** cableado y verificado de punta a punta contra la preview, con el
  endpoint del webhook registrado y el Protection Bypass activo (§5).
- [x] **Google OAuth encendido en dev** (17-ago) y login verificado de punta a punta. **Falta en
  prod**, con sus propias credenciales (§3B).
- [x] **Resend: cuenta creada y `RESEND_API_KEY` puesta** en local, Preview y Production (17-ago).
  Falta verificar el dominio y **ver llegar el primer correo** (§3G).
- [ ] Rotar secret keys antes del primer usuario real.
- [ ] Branch protection en `main` (ver §3D).
- [x] **`CRON_SECRET` en Vercel y en GitHub, y `APP_BASE_URL` en GitHub — 30-ago.** Los tres jobs
  corren y dan 200 (§4). En Vercel `CRON_SECRET` ya estaba desde antes; solo faltaba el lado GitHub.
- [x] ✅ **Cola vieja de notificaciones de dev vaciada, 30-ago**: 336 avisos a `failed` (§4.6).
- [ ] ⚠️ **Arreglar el seed para que no vuelva a llenarse**: usa `@ensenameya.dev`, dominio sin MX
  (187 de las 336 iban ahí). Mientras siga así hay que repetir §4.6 antes de cada encendido.
- [x] ✅ **X-01 ejercitado, 30-ago**: los 2 `refund_requests` de dev ejecutados contra Stripe *test
  mode* — $47,50 en dos reembolsos, cuadrando cola / `refunds_backlog()` / Stripe / `payments`.
  Se hizo **en local** (`npm run dev` contra la BD de dev), porque la preview de Vercel está tras
  Deployment Protection y `APP_BASE_URL` apunta a prod. `?simulacro=1` primero, pasada real después.
- [ ] `NEXT_PUBLIC_REFERRAL_URL` y `REFERRAL_FACTORY_API_KEY` en Vercel — solo están en local.
- [ ] `NEXT_PUBLIC_REFERRAL_URL_TUTOR` (B1.11) — **ni en local**: hace falta la URL de la segunda
      campaña de Referral Factory, la de tutores. Sin ella el tutor no ve el bloque.
- [ ] Mínimo de contraseña a 8 en el panel de Auth, dev y prod (§3B).

**Ramas y despliegue al 30-ago — el merge grande YA SE HIZO.** `main` está en **`3fca8b2`**
(**26-ago**), no en `57edfa9`: todo lo de agosto —Stripe, correo, legales, `/contacto`, reembolsos,
purga de grabaciones, `vercel.json` y los dos workflows de cron— está desplegado, y por eso los
crons empezaron a tener reloj (y a fallar en rojo) el 27. `dev` va hoy **52 commits por delante**
con **7 migraciones** sin aplicar en prod (111 aplicadas de 118):

```
20260827200000_m02_retira_el_auto_aceptar_global.sql
20260828120000_sala_cierra_al_marcar_completada.sql
20260828130000_ey189_acciones_sobre_los_usuarios.sql
20260828143000_requerimientos_de_sesion.sql
20260828150000_chat_previo_cinco_por_lado.sql
20260828161500_dl01_tipo_de_solicitud_y_adjuntos.sql
20260828183000_cierre_automatico_de_sesiones_nunca_corrio.sql
```

Es un merge de una semana, no de dos meses: sigue necesitando su repaso, pero ya no es el bloqueante
que describía este párrafo.

El merge **`dev` → `main`** es el que dispara el job de migraciones de prod. Ojo con el orden de
siempre: la app nueva contra el esquema viejo revienta.

**Migraciones por ambiente (30-ago).** **dev al día**: 118/118 aplicadas, la última
`20260828183000_cierre_automatico_de_sesiones_nunca_corrio.sql`. **prod tiene 111**: le faltan las 7
de arriba, porque el CI solo las aplica al mergear a `main`. El workflow de migraciones lleva
**22/22 corridas en verde**.

*Última edición: 2026-08-30 — `APP_BASE_URL` + `CRON_SECRET` dados de alta en GitHub tras 30
corridas en rojo; corregido que a Vercel le faltaba `CRON_SECRET` (ya estaba); cadencia real de los
programados de GitHub medida (~2-6 h, no 5/15 min); estado de ramas al día (`main` = `3fca8b2`,
7 migraciones pendientes, no 30); cola de dev recontada (336 avisos, no 126) **y vaciada** (§4.6).*
