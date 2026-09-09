# Enséñame Ya — Manual del proyecto

> MVP web: marketplace de tutorías **1:1 en vivo** (alumno ↔ tutor) con reservas, pagos,
> videollamada (Daily) y panel admin. **Monorepo:** frontend Next.js + backend Supabase
> en este mismo repo.

⚠️ **Este fichero describe cómo se construye, no qué se ha construido.** El relato de
ejecución vive en `docs/PLAN-DESARROLLO.md` y el qué/cuándo en `docs/BACKLOG.md`. Si aquí
aparece una fecha o un estado, sospecha: este repo tiene un historial de repetir la misma
afirmación falsa en media docena de documentos durante semanas. **Ante cualquier duda manda
el código**, y en el esquema, la migración.

## Stack

- **Frontend:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · React 19 → **Vercel**.
- **Backend:** **Supabase** — Postgres + RLS, Auth (email + Google OAuth), Storage.
  **No hay Edge Functions**: todo el código server-side propio son **Route Handlers** de
  Next (`src/app/api/`) y Server Components. Se decidió en `20260717120000`.
- **Sin stack local:** `npm run dev` corre contra la **BD de dev cloud**; deploy en Vercel
  (`main`→prod, `dev`/PR→preview). Detalle en `docs/ENTORNOS.md`.

## Comandos

```bash
npm run dev        # → http://localhost:3000 (contra dev cloud)
```

| Comando | Para qué |
| :-- | :-- |
| `npm run db:push` | Aplica migraciones al proyecto **dev** enlazado |
| `npm run db:types` | Regenera `src/lib/database.types.ts` (aborta sin tocar el fichero si falla) |
| `npm run lint` · `npm run typecheck` | Lint y typecheck |
| `npm run check:*` | **Diez comprobaciones ejecutables** sin red ni credenciales: `email`, `terms`, `ics`, `chat`, `cadena`, `paypal`, `wise`, `stripe-payout`, `metodo`, `riel` |

Enlace del CLI a dev: `npx supabase link --project-ref lbtpnszjjsxbeileqsja`.
Tras tocar el esquema: `npm run db:push` **y** `npm run db:types`. A prod llega por **CI**
al mergear a `main`.

## Reglas de oro (no romper)

1. **RLS default-deny.** Toda tabla nueva nace con `enable row level security` + políticas
   explícitas. Sin política = nadie ve nada, a propósito. Olvidarla "falla abierto" (RISK-13).
2. **El dinero es server-side.** Escritura en `payments`/`payouts` solo con `service_role`
   desde Route Handlers. `confirm_payment` es **solo del webhook**; a `authenticated` le queda
   `confirm_simulated_payment`, que exige ser dueño **y** `provider = 'simulated'`. El importe
   sale de `payments.gross_amount`, jamás del navegador. (S-15 / RN-26)
3. **`service_role` jamás en el cliente** ni en `NEXT_PUBLIC_*`. Vive en
   `src/lib/supabase/admin.ts` y lo importan solo Route Handlers y Server Components. La regla
   no es "nunca en una pantalla": es **nunca en el navegador**.
4. **Fechas en UTC** en la BD; se renderizan en la hora local del usuario. Herramientas:
   `src/lib/tz.ts` y `getViewerTimezone()`/`getUserTimezone()` de `src/lib/auth/server.ts`.
   (RN-01 / RN-02 → RISK-12)
5. **Migraciones = fuente de verdad** del esquema. No se cambia el esquema a mano en la nube.
   ⚠️ **Tocar `payment_routing_rules` es una MIGRACIÓN, no un `UPDATE`**: hacerlo a mano es lo
   que tuvo a dev y prod ruteando pagos distinto durante semanas (`20260904190000`).
6. **Tipos generados:** tras tocar el esquema, `npm run db:types`. No editar
   `database.types.ts` a mano.
7. **Snapshots financieros** (crear `booking`) van por función controlada / Route Handler,
   no por insert directo del cliente. (cierra H-2)
8. **Nada de inventar decisiones pendientes** (DP-xx): se consumen como configuración.
9. ⚠️ **`service_role` se salta la RLS, pero NO los `grant` de tabla.** Con "auto-expose new
   tables" OFF, un job con `service_role` come `permission denied` **en tiempo de ejecución**
   —no en el build, no en el typecheck— hasta que su migración declare
   `grant … to service_role`. Mordió tres veces el 6-ago. Hoy lo hacen 61 de las 177
   migraciones. Tabla que toque un job = grant explícito, en la misma migración.
10. ⚠️ **Una tabla puente nueva vuelve AMBIGUOS los embeds de PostgREST** entre las dos tablas
    que une, y la consulta se cae con `PGRST201` — no se degrada. `tutor_views`
    (`20260827140000`) dejó la cola de aprobación del admin enseñando "(0)" con 11 tutores
    esperando. Se nombra la FK: `profiles!tutor_profiles_profile_id_fkey(…)`. Y **si la
    consulta alimenta una cola, se mira el `error`**: `const { data } = …` convierte el fallo
    en una lista vacía, que es una mentira creíble.
11. ⚠️ **Un job de `pg_cron` que falla no se lo dice a nadie.** No hay build en rojo ni 500 en
    Vercel: el error se queda en `cron.job_run_details`. `close_expired_sessions()` acumuló
    **12.446 fallos seguidos** entre el 16-jul y el 28-ago por un `case` sin `::session_status`,
    mientras el cierre manual del tutor tapaba el agujero — y de esa función cuelga
    `bookings.completed_at`, o sea el payout. Tras tocar una función que corre por cron, se
    mira su última corrida. Y `create or replace` **valida la sintaxis, no ejecuta el cuerpo**:
    el fallo sobrevivió a una reescritura entera.
    ⚠️ **Agregar por `jobname` y `status`, no leer las diez últimas filas**: los jobs diarios
    y semanales quedan fuera de esa ventana y pueden llevar semanas rotos.
    ⚠️ **Y "arreglado" significa arreglado en su AMBIENTE**: el mismo fallo siguió cayendo en
    producción dos días después de existir la migración en `dev`.
12. ⚠️ **Añadir un argumento a una RPC es `drop function` + `create`, JAMÁS
    `create or replace`.** PostgreSQL crea una **sobrecarga** y PostgREST responde `PGRST203`.
    `20260910190000` lo hizo y rompió el formulario bancario del tutor **solo cuando el campo
    opcional iba vacío** (supabase-js no serializa `undefined` → menos argumentos → ambiguo),
    o sea justo al revés de lo que promete la pantalla. Lo arregla `20260910220000`. Y ojo:
    un `drop` se lleva por delante los `grant execute`, que hay que reponer.

## Patrón RLS

- Propiedad: `using ( (select auth.uid()) = <owner_col> )` — el `select` ayuda al planner.
- Rol admin: `public.has_role('admin')` (SECURITY DEFINER **de un argumento**, evita recursión).
- Alta de perfil + rol `alumno` al registrarse (trigger `handle_new_user`).
- **Grants:** "auto-expose new tables" está **OFF** → cada tabla declara sus `grant`
  (públicas→`anon`, privadas→`authenticated`) junto a sus políticas, **y también para
  `service_role`** (regla 9).
- ⚠️ **Vistas: `with (security_invoker = true)` SIEMPRE.** Sin eso una vista corre con los
  privilegios de su dueño y publica lo que las políticas tapaban. Precedente: `tutors_public`
  (`20260804120000`). Y **columnas explícitas, nunca `tabla.*`**: lo que se añada mañana a la
  tabla no debe colarse solo en una superficie pública.
- **El alta de `admin` va fuera del cliente** (RN-31/S-31): `user_roles` no tiene políticas de
  escritura a propósito.

## Convenciones de esquema

- **Dinero en `bigint`** (unidades mínimas) + `currency` ISO-4217 al lado. Nunca `float`.
- **`timestamptz` siempre**, en UTC.
- **`provider` es `text`, no un enum**, para no acoplar el esquema a la lista de PSPs.
- **Baja lógica sobre borrado físico** donde haya rastro financiero o legal.
- `comment on table` / `comment on column` es como este repo transporta el porqué: lo hacen
  85 de las 177 migraciones.

## Pagos — manda el dictado

🔴 **`docs/DICTADO-PAGOS.md` es la única verdad sobre cobro y payout** (aprobado por el
cliente, 9-sep-2026). Deroga los Docs 0–9, este fichero y los comentarios del código.
Las dos reglas que hay que tener presentes:

1. **El cobro lo decide el país del ALUMNO**
   (`ruta_de_pago(payer_country).charge_providers`); el payout, el del **TUTOR**
   (`ruta_de_pago(payee_country).payout_providers`). La misma fila responde a las dos
   preguntas: lo que cambia es la clave de búsqueda.
2. **El tutor ve dos tarjetas: PayPal y Banco.** Detrás de Banco compiten **Wise, dLocal y
   Stripe** y él no ve a ninguno. Los canales manuales (Zinli, Zelle, Binance) son **solo
   Venezuela**, y lo son porque es el único país que ninguno de los tres alcanza.

El **coste** de cada tramo y quién asume cada comisión sigue mandándolo
`docs/PAGOS-Y-PAYOUTS.md`; su parte de ruteo está derogada.

## Integraciones — la credencial es el interruptor

Ninguna falta de clave rompe la app: el camino se cae al siguiente candidato o la cola se
queda `pending` (nunca `failed`). **Poner la variable es el despliegue.**

| Integración | Hoy | Interruptor |
| :-- | :-- | :-- |
| **Stripe** (`lib/stripe.ts`) | **Cobra y paga.** Cobra donde el país del alumno lo rutea (Venezuela y todo lo que quede fuera de los 18 de dLocal). Paga como **tercer riel de la tarjeta de Banco** —cuenta `recipient` creada por nosotros con los datos que teclea el tutor, nunca un onboarding de Connect—, siempre **después de Wise** en el orden. API fijada a `2026-07-29.dahlia` | `STRIPE_API_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PUBLISHABLE_KEY` (sin esta última **no se pinta el formulario de pago**) |
| **dLocal Go** (`lib/dlocalgo.ts`) | Cuenta aprobada en sandbox y producción. **Checkout transparente**: el formulario de tarjeta se monta DENTRO del sitio. La vía es `allow_transparent` en el `POST /v1/payments` y luego `GET /v1/checkout/{token}` → `POST /v1/checkout/prepare-confirm` → `POST /v1/checkout/confirm`, **en ese orden** (saltarse el primero da 500; el segundo, 406). ⚠️ La clave del tokenizador **no es nuestra**: está hardcodeada en el SDK de dLocal Go, y `DLOCALGO_SMARTFIELDS_KEY` no sirve para tokenizar. ⚠️ El cobro transparente **exige el país del pagador**: sin él, `400 5000 «Empty country not allowed»` | `DLOCALGO_API_KEY` + `DLOCALGO_SECRET_KEY` (+ `DLOCALGO_API_BASE` para producción) |
| **PayPal** (`lib/payments/paypal-provider.ts`) | Paga, con dinero moviéndose de verdad. ⚠️ **Se paga al identificador de la cuenta CONECTADA, no al correo**: al correo quedó `UNCLAIMED` 5 de 5 veces, con el lote informando `SUCCESS` igualmente. El correo sigue como respaldo y ahí ese fallo se puede repetir. **No cobra** | `PAYPAL_CLIENT_ID` + `PAYPAL_SECRET` (+ `PAYPAL_API_URL`) |
| **Wise** (`lib/payments/wise-provider.ts`) | Paga. Cuatro pasos —presupuesto, alta del destinatario, transferencia y fondeo— con idempotencia por UUIDv5 de (payout, intento) y mapeo en `lib/payments/wise-mapeo.ts` (`npm run check:wise`). Alcanza los países de `payout_country_rules`, hoy **55**, por formato de cuenta (iban, swift, sort_code, aba…). **No paga a Venezuela**; Brasil está apagado a propósito (sus códigos de banco no encajan). ⚠️ El fondeo falla si la cuenta no tiene saldo — eso **no es un límite del diseño**: operaciones fondea las cuentas antes de cada ciclo, y el adaptador aguanta (`incoming_payment_waiting` + reintento) | `WISE_API_TOKEN`. `WISE_PRIVATE_KEY` es **opcional**: esta cuenta no está sujeta a SCA, y si algún día lo estuviera `wiseFetch` lo dice por su nombre en vez de morir con un 403 mudo |
| **Correo** (`lib/email.ts` → **Resend**) | Plantillas y job listos; sin clave la cola ni se toca | `RESEND_API_KEY` |
| **Daily** (`lib/daily.ts`) | Grabación contratada y **obligatoria** (RN-42 reformulada el 2-sep: se graba siempre y se avisa; por eso la casilla de la sala dice "Entiendo", no "Acepto"). ⚠️ **`enable_recording:"cloud"` solo enciende el BOTÓN, no graba**: quien arranca es `start_cloud_recording` en el token (`mintToken`); Daily no tiene propiedad de sala para esto. El nombre de sala se **lee** de `sessions.daily_room_name` — derivarlo otra vez es lo que hacía fallar a US-1802 en silencio. No hay tabla de grabaciones a propósito: se consultan a Daily en el momento | `DAILY_API_KEY` |
| **Referral Factory** (`lib/referral.ts`) | ⚠️ Campaña viva (**50297**) pero **sin atribución de ninguna clase**. La app solo pinta el enlace/embed; quién trajo a quién se queda entero en RF. La cookie `ey-ref` existe y funciona, pero espera un `?ref=` que RF **no manda**: su página de oferta no redirige de vuelta. Atribuir referidos está **entero por hacer** | `NEXT_PUBLIC_REFERRAL_URL` · `NEXT_PUBLIC_REFERRAL_EMBED_URL` — el interruptor es la **URL**, no la clave |

## Los jobs — cinco endpoints y tres sitios

Todos exigen `CRON_SECRET` y fallan cerrado (503) sin ella.

| Endpoint | Reloj | Cadencia pedida |
| :-- | :-- | :-- |
| `/api/cron/recordings-purge` | **Vercel Cron** (`vercel.json`) | `0 4 * * *` |
| `/api/cron/notifications-send` | GitHub Actions | `*/5 * * * *` |
| `/api/cron/refunds-process` | GitHub Actions | `7,22,37,52 * * * *` |
| `/api/cron/payouts-process` | GitHub Actions | `13 * * * *` — **esto es dinero** |
| `/api/cuenta/eliminar/barrido` | GitHub Actions | `37 5 * * *` — ⚠️ **no cuelga de `/api/cron/`**, al revés que sus tres hermanas |

⚠️ **La cadencia de GitHub es una ficción.** Medido sobre corridas reales: entrega **una cada
2-6 horas**, no cada 5 minutos. Sigue siendo mejor que el único cron diario que permite Vercel
Hobby —que es el motivo de que estén ahí—, pero no se puede planificar con "5 minutos".

**Y en la propia BD hay NUEVE jobs de `pg_cron`** que `grep` en el repo sí encuentra, pero solo
si lo buscas: `close-expired-sessions`, `expire-stale-bookings`, `process-notifications`,
`process-payouts`, `run-payout-batch`, `purge-expired-messages`, `purge-contact-messages`,
`purge-tutor-views`, `complete-pending-account-deletions`. Antes de dar uno por inexistente:
`grep -rn "cron.schedule" supabase/migrations/`.

⚠️ `process_notifications()` **ya solo informa**; antes marcaba toda la cola como `sent` sin
enviar nada. El envío real es el job HTTP.

## Dónde está cada cosa

```
src/app/                      rutas y páginas — TODAS dentro de un grupo:
                              (app) (auth) (checkout) (public) (recovery) (room)
src/app/api/                  todo el código server-side (Route Handlers)
src/app/api/pagos/checkout    abre el cobro por el riel que decide el país del ALUMNO
src/app/api/webhooks/stripe   webhook firmado (cuerpo crudo, 400 si la firma falla)
src/app/api/cron/             notifications-send · payouts-process · recordings-purge
                              · refunds-process
src/app/(public)/terms|privacy|cookies  páginas legales (DD-06)
src/proxy.ts                  refresco de sesión (convención Next 16)
src/lib/auth/server.ts        getSessionContext() · requireUser() · requireRole()
                              ⚠️ la vía ÚNICA de validar sesión en una pantalla
src/lib/supabase/client.ts    cliente navegador (ANON + RLS)
src/lib/supabase/server.ts    cliente Server Components (ANON + RLS, async)
src/lib/supabase/admin.ts     cliente `service_role` — solo server, ojo regla 9
src/lib/stripe.ts             cliente de Stripe (server-only, versión fijada)
src/lib/payments.ts           registro de RIELES: quién cobra y quién paga por país
src/lib/payments/             un adaptador por riel: stripe · dlocal · paypal · wise
                              · simulated
src/lib/payments/*-mapeo.ts   la parte PURA de tres de ellos (paypal, stripe-payout, wise),
                              con su comprobación al lado: `*-mapeo.check.ts`
src/lib/policy.ts             reembolsos RN-37 (los legales leen de aquí)
src/lib/company.ts            datos fiscales de la sociedad — fuente de verdad
src/lib/database.types.ts     tipos generados (no editar a mano)
supabase/migrations/          esquema versionado (fuente de verdad)
supabase/seed/                sembrado de dev
vercel.json                   Vercel Cron (purga de grabaciones)
.github/workflows/            CI · migraciones a prod · CUATRO relojes de cron
```

## Rendimiento — lo que ya se aprendió a golpes

⚠️ **No valides la sesión con `auth.getUser()` en una pantalla.** Son 250-400 ms de viaje a
la API de Auth y se estaba haciendo hasta cuatro veces por pantalla: era la causa de la
lentitud que reportó el cliente. Usa `getSessionContext()` / `requireUser()` /
`requireRole()` de `src/lib/auth/server.ts`, que van por `getClaims()` + `cache()`.
Hoy 51 de los 79 `page.tsx`/`layout.tsx` lo hacen así.

⚠️ **Toda ruta con datos lleva su `loading.tsx`.** Su ausencia es lo que medía "~700 ms
congelado → 60 ms", y es lo que permite a Next prefetchear rutas dinámicas.

⚠️ **Perfila con `npm run build`, no con `next dev`**, que engaña. Y mira la **profundidad**
de la cascada de consultas, no cuántas hay.

## Legales

`/terms`, `/privacy` y `/cookies` (texto compartido en `src/components/legal/legal-doc.tsx`)
describen lo que la plataforma hace de verdad: plazos sacados de las migraciones, reembolsos
de `lib/policy.ts`, datos fiscales de `lib/company.ts`. **Los redacta el cliente**, no nosotros;
lo único que hacemos es avisar cuando el código los deja obsoletos.

El cliente ya tenía términos publicados en `ensenameya.com` (GoDaddy, marzo-2026), de donde
sale el buzón **info@ensenameya.com**. Divergimos a propósito en dos puntos: el suyo nombra
"Stripe o Mercado Pago" y deja los reembolsos vagos, cuando **RN-37 ya es código**.

⚠️ **Dos webs de la misma marca sin conectar.** `ensenameya.com` es una landing de GoDaddy
que **no enlaza a la app** (vive en `ensenameya.vercel.app`), cada una con su juego de
términos. Se resuelve con la migración de dominio, que es DNS y negocio, no un merge.

⚠️ **Producción no tiene usuarios**, pero **sí tiene código y migraciones desplegadas**. No es
lo mismo: el orden de las migraciones importa igual, y lo que se rompa ahí está roto de verdad.
El interruptor de cobrar dinero real son las claves de Vercel, no las tablas.

## Planificación

- **`docs/PLAN-DESARROLLO.md`** — estado de ejecución. El relato de qué se hizo y cuándo.
- **`docs/BACKLOG.md`** — el qué y el cuándo (espejo de Jira), con criterios de aceptación.
- **`docs/QA-LANZAMIENTO.md`** — matriz de RLS **ejecutada**, idempotencia de webhooks y
  checklist de lanzamiento.
- **`docs/ENTORNOS.md`** — ambientes dev + prod cloud, qué variable va en qué entorno.
- **`docs/DICTADO-PAGOS.md`** — 🔴 manda en cobro y payout.
- **`docs/PAGOS-Y-PAYOUTS.md`** — coste real de cada tramo y quién asume cada comisión.
- **`docs/ACCESO-ADMIN-DEV.md`** — cómo entrar como admin en dev.

## Contexto profundo (lee el doc relevante, no los diez)

| Doc | Cubre |
| :-- | :-- |
| `context/00` | Glosario y modelo conceptual (**manda en lo conceptual**) |
| `context/02` | Máquinas de estado |
| `context/04` | Mapa de pantallas y flujos |
| `context/06` | Arquitectura de integraciones (⚠️ su parte de pagos la deroga el dictado) |
| `context/07` | Matriz de notificaciones |
| `context/09` | Riesgos y decisiones pendientes |
| `context/ADENDA-BACKLOG-v1.md` | Deltas del backlog v1.0 (RN-37..44, NTF-17..20, `pending_acceptance`) |
| `context/APROBACION-CLIENTE-FAIMLAB.md` | Alcance comercial y las decisiones `C-01…C-15` |

⚠️ **El modelo de datos NO se lee en un `.md`**: está generado y siempre al día en
`src/lib/database.types.ts`. Y los permisos concretos se leen en las políticas de las
migraciones, no en prosa.

**Los `C-xx` son la cara-cliente de las `DP-xx`**; cuando el cliente responde se consumen como
**configuración** (regla 8), no como código acoplado. **C-14** quedó en **6 documentos de KYC**
—cv, título, identidad, certificado, diploma y corte de notas— no en 7.

## Skills del proyecto

- `/nueva-migracion` — migración + RLS siguiendo el patrón de la casa.
- `/nueva-pantalla` — página Next.js con las convenciones de arriba.
