# Enséñame Ya — Manual del proyecto

> MVP web: marketplace de tutorías **1:1 en vivo** (alumno ↔ tutor) con reservas,
> pagos (**capa agnóstica** por geografía; proveedor **decidido: DLocal + Stripe** —
> **Stripe ya cobra en *test mode***, DLocal sigue sin cuenta), videollamada (Daily)
> y panel admin. **Monorepo:** frontend Next.js + backend Supabase en este mismo repo.

## Planificación — qué construir y en qué orden

- **`docs/BACKLOG.md`** — backlog vigente (24 épicas / 87 historias), **espejo de Jira**. Manda en *qué y cuándo*.
- **`docs/PLAN-DESARROLLO.md`** — estado de ejecución (hecho / en curso / pendiente). **El más fiel al día de hoy.**
- **`docs/QA-LANZAMIENTO.md`** — matriz de RLS **ejecutada**, idempotencia de webhooks, barrido responsive y checklist de lanzamiento (US-1602).
- **`docs/context/ADENDA-BACKLOG-v1.md`** — deltas del backlog v1.0 sobre los Docs 00–09 (RN-37..44, NTF-17..20, EP-17/18, `pending_acceptance`).
- **`docs/ENTORNOS.md`** — ambientes dev + prod cloud (sin local) en Supabase + Vercel, flujo de trabajo y checklist (US-1603).
- **`docs/PAGOS-Y-PAYOUTS.md`** — mapa de rutas de pago por país, coste real de cada tramo y
  quién asume cada comisión (2026-09-02). **Manda en todo lo de pagos y payouts**: sustituye al
  PDF «Infraestructura de Pagos» (jun-2026), cuyo eje de análisis es incorrecto.

### Dónde estamos (2026-08-07)

**Sprints abiertos: 6 AC · 7 · 8** (los cuatro originales S1–S4 hace tiempo que se
quedaron cortos; el marco actual salió de la reunión del 24-jul). En Jira: **95 Done ·
15 In Review · 10 To Do** sin contar épicas.

- **El PR #11 ya se mergeó** (`1a36da2`): Sprint 7 completo y Sprint 8 casi, las 15
  historias están en `dev` aunque en Jira sigan en `In Review`. El detalle, tanda a tanda
  y con SHA, está en `docs/PLAN-DESARROLLO.md`.
- ~~**Queda UN merge: `dev` → `main`.**~~ ✅ **Se hizo el 26-ago** (`main` = `3fca8b2`): las
  legales, Stripe, el correo y la purga están desplegados. Al **30-ago** `dev` va **52 commits**
  y **7 migraciones** por delante (prod tiene 111 de 118) — un merge de una semana, no de dos
  meses. ⚠️ Ese merge fue también lo que dio **reloj** a los dos crons de Actions, que a partir
  del 27 fallaron en rojo cada pocas horas hasta el 30 (ver más abajo).
- **Sprint 6 AC:** la pata de **Stripe** está hecha (PAC-01 y PAC-03 en *test mode*, aunque
  en Jira sigan `To Do`). La premisa de la épica —"no empezar hasta tener AMBAS cuentas"—
  era falsa: el sandbox de Stripe da Sessions, webhooks firmados y reembolsos con solo
  registrar el email; el KYC solo bloquea *live mode*. Siguen bloqueados **DLocal** entero
  (sin cuenta) y los payouts (Connect exige KYC).
- Quedan 5 historias nuevas sin empezar: `EY-148` (RF-03) en Sprint 8, y sin sprint
  `EY-149` (RF-04), `EY-150` (RF-05), `EY-151` (NTF-21) y `EY-153` (SUP-01).

**EP-22 · Integración Visual** (`EY-102` / IV-01…06) — el Figma aplicado sobre el frontend
ya construido. **Las 6 en producción desde el 2026-07-22** (PR #6→dev, #7→main) y **en
`Done` en Jira desde el 27-jul**. Detalle en `docs/BACKLOG.md` §4.2. Ojo: el Figma **no
tiene design system ni diseño móvil**; el responsive de tablet/escritorio sigue esperando
diseños de Diana (decisión 24).

**Acuerdos del 17-jul aplicados**: chat de Daily apagado (`enable_chat:false`, su chat se
cobra aparte), prefijo `chat_` en adjuntos y **switch de panel** alumno/tutor/admin.
La **purga del chat volvió a estar activa** (decisión 22 del cliente: 30 días + descarga
previa) — migración `20260729180000`, junto con `US-1702`, que es la descarga.

**EP-23 · Datos que el diseño necesita** (`EY-110` / DD-01…08) — de los 8 huecos **queda
uno**: DD-07 (bandeja de mensajería). DD-01/02 cerradas el 23-jul, DD-03 y DD-04 el
29-jul (DD-04 rehecho el 4-ago como rango continuo sobre la vista `tutors_public`), DD-05
resuelta por la decisión 26, DD-06 (legales) el 29-jul —aunque las páginas no dejaron de
ser 404 hasta el 5-ago— y DD-08 con su seed.

**Legales** — `/terms`, `/privacy` y `/cookies` (texto compartido en
`src/components/legal/legal-doc.tsx`) describen lo que la plataforma hace de verdad: plazos
sacados de las migraciones, reembolsos de `lib/policy.ts`. Ojo: **el cliente ya tenía**
términos publicados en `ensenameya.com` (GoDaddy, marzo-2026), de donde salen el buzón
oficial **info@ensenameya.com** y su §8 de responsabilidad. Divergimos a propósito en dos
puntos: el suyo nombra "Stripe o Mercado Pago" y deja los reembolsos vagos, cuando **RN-37
ya es código**. En prod siguen siendo 404.

⚠️ **`EY-109` (buscar sin tildes) se arregló DOS veces.** El intento del 21-jul no
funcionó; el bueno es del **27-jul** (commit `b032cc5`, migraciones `20260727120000` y
`20260727130000`). Si lees "corregido el 21-jul" en algún doc viejo, es esto.

⚠️ **La atribución de referidos NO EXISTE, y la explicación que daba este párrafo era
falsa.** La observación se mantiene y es correcta: Referral Factory **no manda al referido a
la app con un código** — lo lleva a una **página de oferta alojada por RF** y no ofrece
parámetro de código. Lo que era mentira es lo que venía después: **`ref_email` no existe ni
existió nunca**, y esa frase la repetían cuatro documentos. `grep -rn "ref_email" src/
supabase/` devuelve **cero**, y `REFERRAL_FACTORY_API_KEY` **no se lee en ninguna línea de
código** — solo aparece en docs. Lo único implementado es exactamente el mecanismo que este
párrafo declaraba inviable: el proxy guarda el `?ref=` en la cookie `ey-ref`
(`src/lib/supabase/middleware.ts:76-83`), que viaja al metadata del alta y la aterriza
`handle_new_user` en `profiles.referral_code` (`20260817130000`). Y **ese `?ref=` no llega
nunca**: verificado el 1-sep contra la campaña real (50297) — ni su config de API ni la
página que ve el referido mencionan `ensenameya` por ningún lado, así que no hay redirección
de vuelta que pueda traer nada. Se ve en los dos extremos: **0 de 39 perfiles de dev** tienen
`referral_code`, y en RF los únicos dos referidos con `referrer_id` se dieron de alta a mano
por su API (`source: "Api"`), ninguno `qualified`. Remate: `referral_code` **no lo lee nadie**
— se escribe en tres sitios, se anula en la baja de cuenta y no entra en ningún cálculo.
Atribuir referidos está **entero por hacer**, no a medias (`EY-79`/US-1302 está `In Review`
contra una premisa que no se cumple). Su integración nativa con Stripe sí califica y
descalifica sola → **`EY-148` (RF-03) probablemente sobra**; comprobarlo antes de escribir
nada.

## Stack

- **Frontend:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · React 19 → deploy en **Vercel**.
- **Backend:** **Supabase** — Postgres + RLS, Auth (email + Google OAuth), Storage. El código server-side propio vive en **Route Handlers** de Next (`src/app/api/`), no en Edge Functions: se decidió así en `20260717120000` y todo lo nuevo lo sigue.
- **Sin stack local:** la app corre en local (`npm run dev`) contra la **BD de dev cloud**; deploy en Vercel (`main`→prod, `dev`/PR→preview). Detalle y flujo en `docs/ENTORNOS.md`.

## Comandos (rutina diaria)

```bash
npm run dev        # frontend → http://localhost:3000 (contra dev cloud)
```

| Comando | Para qué |
| :-- | :-- |
| `npm run db:push` | Aplica migraciones al proyecto **dev** enlazado |
| `npm run db:types` | Regenera `src/lib/database.types.ts` (requiere link) |
| `npm run lint` · `npm run typecheck` | Lint y typecheck |

Enlace único del CLI a dev (pide access token): `npx supabase link --project-ref lbtpnszjjsxbeileqsja`.
Tras cambiar el esquema: `npm run db:push` **y** `npm run db:types`. A **prod** llega por **CI** al mergear a `main`.

## Integraciones — la credencial es el interruptor

Ninguna falta de clave rompe la app: el camino se cae al simulado o la cola se queda
`pending` (nunca `failed`). **Poner la variable es el despliegue.**

| Integración | Hoy | Interruptor |
| :-- | :-- | :-- |
| **Stripe** (`lib/stripe.ts`) | *test mode*, probado de punta a punta contra la preview: Session creada → expirada desde la API → webhook firmado → reserva `cancelled`. API fijada a mano a `2026-07-29.dahlia`. | `STRIPE_API_KEY` + `STRIPE_WEBHOOK_SECRET`, y la fila de `payment_routing_rules` — ⚠️ **que se toca con una MIGRACIÓN, no con un `UPDATE`**: aquí ponía lo contrario y esa frase es la causa de que dev y producción llevaran semanas ruteando distinto (`20260904190000`) |
| **DLocal** (`lib/dlocalgo.ts`) | ✅ **cuenta APROBADA: sandbox y producción, las dos operativas** (confirmado por el cliente el 4-sep-2026). Adaptador de cobro, webhook firmado y payout escritos y verificados contra sandbox. ⚠️ Esta fila dijo durante un mes «sin cuenta — rechazada»: era un rechazo viejo, ya resuelto, y lo repetían seis documentos | `DLOCALGO_API_KEY` + `DLOCALGO_SECRET_KEY` (+ `DLOCALGO_API_BASE` para apuntar a producción) y su fila de `payment_routing_rules` |
| **PayPal** (`lib/payments/paypal-provider.ts`) | ✅ riel de **payout**, verificado de punta a punta contra sandbox (lote `FR6E6SEVN4A5E`; y un destinatario domiciliado en VE en `SUCCESS`). No cobra: `payment_routing_rules` no lo nombra en ningún `charge_providers` | `PAYPAL_CLIENT_ID` + `PAYPAL_SECRET` (+ `PAYPAL_API_URL` para producción) |
| **Wise** | ⏳ **lo único que sigue esperando cuenta.** KYB en curso; el sandbox V2 no es autoservicio (se pide a `api@wise.com`). Sin credenciales no hay adaptador | — |
| **Correo** (`lib/email.ts` → **Resend**) | plantillas y job listos; sin clave la cola ni se toca | `RESEND_API_KEY` |
| **Grabación de Daily** | ⚠️ **contratada y funcionando** — esta fila decía «add-on sin contratar → hoy no hay nada que borrar» y era falso: `GET api.daily.co/v1/recordings` devuelve **2 grabaciones `finished`** (14-ago, 13 s y 33 s). No hay tabla ni URL guardada **a propósito**: se consultan a Daily en el momento (`lib/daily.ts`). ⚠️ **Y la regla cambió el 2-sep: se graba SIEMPRE.** Esta fila decía que RN-42 exigía el sí de las dos partes y que «lo normal es que una sesión no tenga vídeo». El cliente lo reformuló —**obligatoria y notificada**— y por eso la casilla de la sala pasó de «Acepto» a «Entiendo». `recording_allowed()` devuelve `true` desde `20260902100000`. ⚠️ Y el fallo que tapaba esa premisa: `enable_recording:"cloud"` solo enciende el BOTÓN de grabar, no graba — por eso había 12 salas y 2 grabaciones. Quien arranca es `start_cloud_recording` en el token (`mintToken`); Daily no tiene propiedad de sala para esto. El nombre de sala se **lee** de `sessions.daily_room_name`; derivarlo otra vez es lo que hacía fallar a US-1802 en silencio | `DAILY_API_KEY` |
| **Referral Factory** | ⚠️ campaña viva (**50297, la única**) pero **SIN atribución de ninguna clase** — esta fila decía «atribución por email» y era falso: esa vía no existe en el código y `REFERRAL_FACTORY_API_KEY` **no se lee en ninguna línea**. Lo único que hace la app es **pintar el enlace/embed** de la campaña (`lib/referral.ts`); quién trajo a quién se queda entero en RF, y ni siquiera eso: sus dos únicos referidos se metieron a mano por API. La cookie `ey-ref` existe y funciona, pero espera un `?ref=` que RF no manda | `NEXT_PUBLIC_REFERRAL_URL` · `NEXT_PUBLIC_REFERRAL_EMBED_URL` — el interruptor real es la **URL**, no la clave |

**TRES jobs y dos sitios**, los tres exigen `CRON_SECRET` y fallan cerrado (503) sin ella:
`/api/cron/recordings-purge` por **Vercel Cron** (`vercel.json`, diario 04:00), y
`/api/cron/notifications-send` y `/api/cron/refunds-process` por **GitHub Actions** — Vercel
Hobby limita los crons a uno al día, y un aviso de "te quedan 24 h para aceptar" que llega
mañana no sirve.
⚠️ `process_notifications()` **ya solo informa**; antes marcaba toda la cola como `sent` sin
enviar nada. El envío real es el job.

⚠️ **`recordings_purged_at` a `null` en las 12 sesiones con sala NO es un job roto.** Es lo
correcto: la sala más antigua terminó el **14-ago**, así que con la retención de 30 días la
primera purga vence el **13-sep** y `recordings-purge` no ha tenido nunca nada que hacer.
Lo que sigue sin demostrarse es que funcione **cuando le toque** — el día que empiece a haber
vencimientos hay que mirarlo, porque esa retención es la que prometen las páginas legales.

⚠️ **La cadencia de los programados de GitHub es una ficción.** Los dos `cron` piden 5 y 15
minutos; lo que GitHub entrega, medido sobre las corridas reales del 27 al 30-ago, es **una cada
2-6 horas** (15 corridas en 3,5 días, no ~1.000). Sigue siendo mejor que el único cron diario de
Vercel Hobby, que es el motivo por el que están aquí, pero no se puede planificar con "5 minutos":
los comentarios de cabecera de `notifications-cron.yml` y `refunds-cron.yml` lo dicen y se
quedaron cortos.

**Configurado el 2026-08-30, tras 30 corridas en rojo:** en GitHub la variable `APP_BASE_URL`
(`https://ensenameya.vercel.app`) y el secret `CRON_SECRET`. Faltaban SOLO ahí — no en Vercel: la
pasada de verificación devolvió `status:"ok"` en los dos endpoints, o sea que prod ya tenía
`CRON_SECRET`, `STRIPE_API_KEY` **y** `RESEND_API_KEY` (si faltaran, la respuesta sería
`sin-stripe` / `sin-proveedor`). Este párrafo decía lo contrario y mandaba a buscar donde no era.
Sin verificar siguen `NEXT_PUBLIC_REFERRAL_URL` y `REFERRAL_FACTORY_API_KEY`.

⚠️ **Verde no es lo mismo que útil.** Los dos relojes apuntan a **producción**, donde las dos
colas están **vacías**. Y la de correo de **dev** también, desde el 30-ago: eran **336** avisos
`pending` del 11-ago en adelante y se cerraron como `failed` (`docs/QA-LANZAMIENTO.md` §4.6).
✅ **Y X-01 se ejercitó el 30-ago**: los 2 `refund_requests` que esperaban en dev se ejecutaron
contra Stripe *test mode* — $47,50, 50 % y 100 % de RN-37, cuadrando cola / `refunds_backlog()` /
Stripe / `payments`. El dinero **sí se mueve**. Lo que sigue sin pasar es que **nadie ha visto
llegar un correo de la cola**. ⚠️ Y salió un desfase al hacerlo: **NTF-10 avisa cuando el reembolso
se PIDE, no cuando el dinero se mueve** (lo encola `20260716170000` en el camino de cancelación; el
job no encola nada). A esos dos alumnos se les dijo «procesado» el 17 y el 27-ago y el dinero salió
el 30. Con el cron corriendo la ventana baja a horas; cambiar cuándo se avisa es decisión de
producto. ⚠️ **La cola de dev volverá a llenarse**: el
seed usa `@ensenameya.dev`, un dominio sin MX, y 187 de las 336 iban ahí. Hasta que eso cambie,
§4.6 hay que repetirlo antes de apuntar un reloj a dev.
El endpoint de Stripe apunta a la preview con `?x-vercel-protection-bypass=…`: sin eso
Deployment Protection devuelve 302 antes de que corra nuestro código.

## Reglas de oro (no romper)

1. **RLS default-deny.** Toda tabla nueva nace con `enable row level security` + políticas explícitas. Sin política = nadie ve nada (a propósito). Olvidarla "falla abierto" → fuga (RISK-13).
2. **El dinero es server-side.** Escritura en `payments`/`payouts`/etc. solo con `service_role`, desde los Route Handlers. Nunca desde el cliente: `confirm_payment` es **solo del webhook**, y lo que le queda a `authenticated` es `confirm_simulated_payment`, que exige ser dueño **y** `payments.provider = 'simulated'`. El importe sale siempre de `payments.gross_amount`, jamás del navegador. (S-15 / RN-26)
3. **`service_role` jamás en el cliente** ni en variables `NEXT_PUBLIC_*`. El navegador usa la ANON/publishable key (sujeta a RLS).
4. **Fechas en UTC** en la BD; se renderizan en la **hora local** del usuario. (RN-01 / RN-02 → RISK-12)
5. **Migraciones = fuente de verdad** del esquema (`supabase/migrations/`). No se cambia el esquema a mano en la nube; se versiona en git.
6. **Tipos generados:** tras tocar el esquema, `npm run db:types`. No editar `database.types.ts` a mano.
7. **Operaciones con snapshots financieros** (p. ej. crear `booking`) van por **función controlada / Route Handler**, no por insert directo del cliente. (cierra H-2)
8. **Nada de inventar decisiones pendientes** (DP-xx): se consumen como configuración, no como código acoplado. Ver Doc 9.
9. ⚠️ **`service_role` se salta la RLS, pero NO los `grant` de tabla.** Con "auto-expose new tables" OFF, un job con `service_role` come `permission denied` **en tiempo de ejecución** —no en el build, no en el typecheck— hasta que su migración declare `grant … to service_role`. Mordió **tres veces el 6-ago**: `sessions` (`20260806140000`), `payments`/`profiles` (`20260806170000`) y `payment_routing_rules` (`20260806180000`). Tabla que toque un job = grant explícito, en la misma migración.
10. ⚠️ **Una tabla puente nueva vuelve AMBIGUOS los embeds de PostgREST entre las dos tablas que une**, y la consulta entera se cae con `PGRST201` — no se degrada. `tutor_views` (EY-186, `20260827140000`) une `profiles` y `tutor_profiles`, que ya tenían FK directa: desde ese día `.select("…, profiles(full_name)")` sobre `tutor_profiles` **devolvía error**, y la cola de aprobación del admin enseñaba «(0)» en los tres chips con 11 tutores esperando (28-ago). Se nombra la FK: `profiles!tutor_profiles_profile_id_fkey(…)`. Y **si la consulta alimenta una cola, se mira el `error`**: `const { data } = …` convierte el fallo en una lista vacía, que es una mentira creíble.
11. ⚠️ **Un job de `pg_cron` que falla no se lo dice a nadie.** No hay build en rojo, ni 500 en Vercel, ni fila en `notifications`: el error se queda en `cron.job_run_details`, y hay que ir a mirarla. `close_expired_sessions()` acumuló **12.446 fallos seguidos y cero éxitos entre el 16-jul y el 28-ago** por un `case` sin `::session_status` —el enum no acepta `text`— mientras el cierre manual del tutor seguía funcionando y tapaba el agujero. Y de esa función cuelga `bookings.completed_at`, o sea el payout. **Tras tocar una función que corre por cron, se mira su última corrida**: `select j.jobname, d.status, d.return_message from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 5;` — y ojo, escribirla bien no basta: `create or replace` valida la sintaxis, no ejecuta el cuerpo (el fallo sobrevivió a una reescritura entera de la función en `20260820190000`). Y los jobs no viven todos en el mismo sitio: `vercel.json`, `.github/workflows/` y **dentro de la propia BD** — antes de dar uno por inexistente, `grep -rn "cron.schedule" supabase/migrations/`
   — que devuelve **ocho** jobs de pg_cron, no uno.
   ⚠️ **Y «arreglado» significa arreglado en `dev`.** El mismo fallo corría en **producción**, donde
   llegó a **12.778** corridas rojas: siguió cayendo dos días después de que la migración existiera
   en `dev`, hasta el merge del 30-ago (último fallo 19:25, migración 19:28, cinco éxitos seguidos
   después). Un `pg_cron` roto se arregla cuando la migración **aterriza en su ambiente**, no cuando
   se escribe.
   ⚠️ **Y no basta con leer las últimas N filas** de `cron.job_run_details`: solo salen los jobs
   frecuentes. Los cuatro diarios/semanal (`run-payout-batch` es dinero; `purge-expired-messages`
   sostiene la retención que prometen los legales) quedan fuera de la ventana y pueden llevar semanas
   rotos. Agregar por `jobname` y `status`, no leer las diez últimas.

## Dónde está cada cosa

```
src/app/                      rutas y páginas (App Router)
src/app/api/                  todo el código server-side (Route Handlers)
src/app/api/pagos/checkout    crea la Checkout Session de Stripe
src/app/api/webhooks/stripe   webhook firmado (cuerpo crudo, 400 si la firma falla)
src/app/api/cron/             jobs: recordings-purge (Vercel) · notifications-send (Actions)
src/app/(public)/terms|privacy|cookies  páginas legales (DD-06)
src/components/legal/legal-doc.tsx      texto legal compartido + buzón oficial
src/proxy.ts                  refresco de sesión (convención Next 16)
src/lib/supabase/client.ts    cliente navegador (ANON + RLS)
src/lib/supabase/server.ts    cliente Server Components (ANON + RLS, async)
src/lib/supabase/admin.ts     cliente `service_role` — solo server, ojo regla de oro 9
src/lib/supabase/middleware.ts helper de sesión usado por proxy.ts
src/lib/stripe.ts             cliente de Stripe (server-only, versión de API fijada)
src/lib/email.ts              adaptador de correo — cambiar de proveedor es esta función
src/lib/policy.ts             reembolsos RN-37 (los legales leen de aquí)
src/lib/database.types.ts     tipos generados (no editar a mano)
supabase/migrations/          esquema versionado (fuente de verdad)
supabase/config.toml          config del CLI de Supabase (link, migraciones)
vercel.json                   Vercel Cron (purga de grabaciones)
.github/workflows/            CI, migraciones a prod y cron de notificaciones
docs/BACKLOG.md               backlog vigente (sprints, espejo de Jira)
docs/PLAN-DESARROLLO.md       estado de ejecución por sprint (el más fiel)
docs/QA-LANZAMIENTO.md        matriz de RLS ejecutada + checklist de lanzamiento
docs/ENTORNOS.md              ambientes dev + prod cloud (Supabase + Vercel), sin local
docs/PAGOS-Y-PAYOUTS.md       rutas de pago por país, fees reales y quién asume qué
docs/context/                 docs técnicos (Docs 0–9 + adenda + revisión + aprobación cliente)
```

## Patrón RLS (referencia rápida)

- Propiedad: `using ( (select auth.uid()) = <owner_col> )` (el `select` ayuda al planner).
- Rol admin: helper `public.has_role('admin')` (SECURITY DEFINER, evita recursión).
- Alta de perfil + rol `alumno` automática al registrarse (trigger `handle_new_user`).
- **Grants:** los proyectos tienen "auto-expose new tables" **OFF** → cada tabla expuesta al cliente declara sus `grant` (públicas→`anon`, privadas→`authenticated`) junto a sus políticas. RLS sigue siendo la barrera default-deny. Y esos `grant` hacen falta **también para `service_role`** → regla de oro 9.
- ⚠️ **Vistas: `with (security_invoker = true)` SIEMPRE.** Una vista corre por defecto con los privilegios de **su dueño**, así que sin eso se salta la RLS de las tablas que envuelve y publica lo que esas políticas tapaban. Con el invoker puesto, mandan las políticas de siempre. Precedente: `tutors_public` (`20260804120000`). Y columnas explícitas, no `tabla.*`: lo que se añada mañana a la tabla no debe colarse solo en una superficie pública.
- **Docs vs código:** los Docs 0–9 son el **objetivo** (p. ej. nombran el enum `user_role` y `has_role(uid, role)` de dos args); el **código manda** en nombres concretos (enum real `app_role`, `has_role('admin')` de un arg). Ante divergencia, gana la migración.

## Contexto profundo (lee el doc relevante, no los 12)

| Doc | Cubre |
| :-- | :-- |
| 00 | Glosario y modelo conceptual (**manda en lo conceptual**) |
| 01 / 02 / 03 | Modelo de datos / máquinas de estado / roles y RLS |
| 04 / 05 | Mapa de pantallas y flujos / spec por pantalla |
| 06 / 07 | Arquitectura de pagos e integraciones / matriz de notificaciones |
| 08 / 09 | Backlog (⚠️ superado por `docs/BACKLOG.md`; conserva la matriz de trazabilidad §8.4) / riesgos y decisiones pendientes |
| `REVISION-docs-1-3.md` → **Anexo A** | Arquitectura del proyecto |

Todos en `docs/context/`.

**Visión comercial / aprobación del cliente:** `APROBACION-CLIENTE-FAIMLAB.md`
(v1 · 2026-06-09) — resumen **completo y no técnico** para firma del cliente:
perfiles, ~49 pantallas, flujos FL-01…05, procesos de pago por geografía y
**15 decisiones a confirmar `C-01…C-15`**. **Resueltas: C-01** (proveedor → DLocal +
Stripe; Stripe ya opera en *test mode*, DLocal no), **C-03** (reembolsos → RN-37:
≥24h=100%, <24h alumno=50%, tutor=100%; ver adenda §6), **C-11** (correo → **Resend**: es el
único de los tres candidatos que deja enviar y probar **sin dominio verificado**, y el
dominio propio sigue bloqueado) y **C-14** (7 documentos de KYC, migración
`20260715130000`). El bloqueante de negocio que queda es **C-13** (mercado/Venezuela y
métodos de pago); el resto tienen default operable — ver el tracker de
`docs/PLAN-DESARROLLO.md`.

Los `C-xx` son la cara-cliente de las `DP-xx`/supuestos (C-01→DP-01, C-02→DP-02,
C-03→DP-03, C-04→DP-06, C-05→DP-08, C-10→DP-04, C-11→DP-05, C-15→DP-07); cuando el
cliente responda se consumen como **configuración** (regla de oro 8), no como código.
El **detalle técnico** sigue viviendo en los Docs 0–9, que **mandan en lo técnico**.

⚠️ **Dos webs de la misma marca sin conectar.** `ensenameya.com` es una landing de GoDaddy
que **no enlaza a la app** (vive en `ensenameya.vercel.app`), cada una con su juego de
términos. Se resuelve con la **migración de dominio**, que es DNS y negocio, no un merge.
✅ **Ya no bloquea a ningún PSP**: dLocal aprobó la cuenta (sandbox y producción). Aquí ponía
que la había rechazado y llevaba semanas siendo falso.

⚠️ **Nada está en producción y nadie conoce el sitio.** Todo el trabajo —pagos incluidos— se
hace y se prueba contra **dev**. Lo que haya en las tablas de prod no es una medida de nada;
se enciende después de la migración de dominio.

## Skills del proyecto

- `/nueva-migracion` — migración + RLS siguiendo el patrón del proyecto.
- `/nueva-pantalla` — página Next.js con las convenciones de arriba.
