# Enséñame Ya — Plan de Desarrollo (checklist vivo)

> **Qué es esto.** El mapa de construcción del MVP: las **49 pantallas** + su backend,
> en **rebanadas verticales** ordenadas como un **esqueleto andante** (un flujo delgado
> end-to-end primero, luego ensanchar). Es un **documento vivo**: se marca a medida que se
> construye. El "qué" vive aquí; el "cómo" lo ejecutan los skills `/nueva-migracion` y
> `/nueva-pantalla`, y se cierra con `/verify` o `/run`.
>
> **Fuente de verdad funcional:** Docs 0–9 + `APROBACION-CLIENTE-FAIMLAB.md` en `docs/context/`.
> **Reglas que no se rompen:** ver `CLAUDE.md` (RLS default-deny, dinero server-side, UTC, etc.).

---

## Cómo trabajamos (el loop de vibecode)

Cada sesión = **una rebanada** (lo más pequeña que deje algo funcionando):

1. **Elegir** la siguiente casilla `[ ]` no bloqueada, respetando el orden de los hitos.
2. **Backend** (si aplica): `/nueva-migracion` → tabla + RLS + funciones → `npm run db:reset` → `npm run db:types`.
3. **Frontend:** `/nueva-pantalla` → página App Router (server vs client según convención), cliente Supabase correcto, locale `es`, responsive, UTC→hora local.
4. **Verificar:** `/run` o `/verify` con la app corriendo; `npm run lint` + `npx tsc --noEmit` en verde.
5. **Marcar** la casilla `[x]` y anotar lo relevante (PR, decisión, deuda).

### Definición de "Hecho" (aplica a toda rebanada)
- Migración aplicada con `db:reset` y `db:types` regenerado (sin editar `database.types.ts` a mano).
- **RLS probada por rol** (anon / alumno / tutor / admin): nadie ve lo que no debe.
- Fechas en **UTC** en BD, render en **hora local** del usuario.
- Escritura financiera **solo server-side** (Edge Function `service_role`); el cliente solo lee.
- `lint` + `tsc` verdes; verificado en la app real (no solo en tests).

### Leyenda de estado
`[ ]` pendiente · `[~]` en curso · `[x]` hecho · `[!]` **bloqueado** por una decisión C-xx.

---

## Decisiones que bloquean (tracker)

El código **no espera** estas decisiones: se construye con *stub* y se cablea lo real en **M10**.
Marcar la fecha/respuesta cuando el cliente confirme.

| Dec. | Tema | Bloquea de verdad | Estado | Mientras tanto (default operable) |
| :-- | :-- | :-- | :-- | :-- |
| **C-01** | Proveedor de pago | M10 (pago real) | [ ] pendiente | Proveedor **simulado** en M4 |
| **C-03** | Política de reembolsos | M10 (%s/plazos) | [ ] pendiente | Mecanismo listo (M6); %s desde config |
| **C-13** | Mercado/Venezuela | M10 (corredores) | [ ] pendiente | 1 corredor demo |
| **C-14** | Requisitos para aprobar tutor | UI de KYC (M2/M3) | [ ] pendiente | Set mínimo (cédula/título) provisional |
| C-02/C-04 | Retención / agrupación payout | M7 (payout real) | [ ] pendiente | Parámetro de config |
| C-05 | No-show | M6 | [ ] pendiente | Default Doc 2 §2.13 |
| C-07/C-08 | Ventana de pago / sala | M4 / M5 | [ ] pendiente | 30 min / 10-10 min |
| C-09 | %s de tiers | M3 | [ ] pendiente | 3 tiers placeholder |
| C-10 | Reglas de referidos | M9 | [ ] pendiente | Solo captura `?ref=` |
| C-11 | Email transaccional | M8 (envío real) | [ ] pendiente | Puerto `EmailProvider` + stub |

---

## M0 · Cimientos (auth + plataforma)

**Backend / plataforma:**
- [x] Bootstrap Next.js 16 + TS + Tailwind v4 + React 19
- [x] Supabase local (Docker) + `config.toml`
- [x] Migración base: `profiles`, `user_roles`, enum `app_role`, `has_role()`, trigger `handle_new_user` (rol `alumno` automático), RLS en ambas tablas
- [x] Clientes Supabase (`client.ts` / `server.ts` / `middleware.ts`) + `proxy.ts` (refresco de sesión)
- [x] `database.types.ts` generado
- [x] **Layout base + design tokens**: shadcn/ui (Radix, base neutral) → capa de tokens en `globals.css`; primitivos en `src/components/ui/`; layout primitives (`Container`/`Section`/`PageHeader`); shell público (`SiteHeader`/`SiteFooter`) en route group `(public)`; dark mode (next-themes); home-esqueleto neutra. **Rediseño = tokens + `ui/`.** · _S-38 (es), responsive S-36_
  - [ ] ⚠️ Borrar `src/app/page.tsx` (temporal) para que `(public)/page.tsx` tome `/` nativo — pendiente recarga del permiso `rm`
- [ ] **Guardas de ruta por rol** (alumno/tutor/admin/anon) reutilizables · _Doc 3_

**Pantallas:**
- [ ] **AU01 · Login** `/login`
  - **UI:** email+password + Google OAuth; enlaces a reset/registro.
  - **✅ Listo:** login válido abre sesión → destino previo o dashboard por rol; error genérico sin revelar cuenta. _SCR-AU01 · US-102 · S-40_
- [ ] **AU02 · Registro** `/signup`
  - **UI:** email/Google + **elección de intención** (alumno/tutor, S-37); aceptar términos; captura `referral_code` si viene `?ref=` (S-18).
  - **✅ Listo:** crea cuenta → onboarding por rol; email duplicado se rechaza; dispara NTF-01 (stub en M8). _SCR-AU02 · US-101 · RN-31_
- [ ] **AU03 · Recuperar contraseña** `/reset`
  - **UI:** solicitar enlace + pantalla de nueva contraseña vía token.
  - **✅ Listo:** envía NTF-02 (stub); token vigente permite cambiar. _SCR-AU03 · US-103_
- [ ] **AU04 · Callback OAuth / verificación** `/auth/callback`
  - **UI:** procesa retorno de Google / confirmación de correo; crea `profiles` si es primera vez.
  - **✅ Listo:** éxito → onboarding/dashboard; error → login con mensaje. _SCR-AU04_
- [ ] **AL01 · Onboarding Alumno** `/onboarding`
  - **UI:** nombre, **`timezone`** (autodetectado, obligatorio RN-01), preferencias, avatar opcional.
  - **✅ Listo:** guarda `profiles`; `timezone` requerido; continúa al destino previo o `/app`. _SCR-AL01 · US-201_
- [ ] **G03 · Configuración de cuenta** `/account`
  - **UI:** perfil, `timezone`, seguridad (cambiar contraseña), **activar rol tutor** (S-37), cerrar sesión.
  - **✅ Listo:** edita `profiles`; puede iniciar onboarding tutor. _SCR-G03 · US-104_
- [ ] **G01 · Error (404/500)** + **G02 · Estado vacío** (componentes globales)
  - **✅ Listo:** mensajería clara + CTA de retorno; G02 con sugerencias contextuales. _SCR-G01/G02_

---

## M1 · Descubrimiento (catálogo, solo lectura pública)

**Backend del hito (migraciones + RLS pública):**
- [ ] `categories` — lectura pública (`is_active`), escritura admin; `slug` único; planas (S-13)
- [ ] `tutor_profiles` (1:1 con `profiles`) — lectura pública **solo si** `approval_status='approved'`
- [ ] `products` — lectura pública si `status='active'` y tutor aprobado (RN-24); índice de texto en `title/description`
- [ ] `product_categories` (puente N–M, RN-09)
- [ ] `availability_rules` + `availability_exceptions` (S-03) — lectura pública de tutores aprobados
- [ ] **Seed demo**: tutores aprobados + productos activos + categorías (para que el catálogo se vea)

**Pantallas:**
- [ ] **P01 · Landing / Home** `/` — hero + buscador + destacados (tutores/productos); CTAs a explorar y registro. _SCR-P01 · S-53 (destacados básicos)_
- [ ] **P02 · Sobre Nosotros** `/about` + **P03 · ¿Cómo funciona?** `/how-it-works` — contenido institucional (estático/CMS ligero S-39). _SCR-P02/P03_
- [ ] **P04 · Explorar Tutores** `/tutors` — filtros (categoría, rating, precio), grid de tarjetas, paginación; solo aprobados. _SCR-P04 · US-301_
- [ ] **P05 · Explorar Productos** `/classes` — filtros por modelo de precio/duración; tarjetas de oferta. _SCR-P05 · US-302_
- [ ] **P06 · Categoría** `/categories/{slug}` — lista de categorías + catálogo filtrado. _SCR-P06_
- [ ] **P07 · Perfil del Tutor** `/tutors/{id}` — bio, categorías, productos, reseñas, disponibilidad resumida, CTA "Reservar" (→ login si sin sesión, S-35). _SCR-P07 · US-304_
- [ ] **P08 · Detalle de Producto** `/products/{id}` — outcome, precio, modelo, duración, política, CTA "Reservar"; oculto/410 si no `active`+aprobado. _SCR-P08 · RN-24_
- [ ] **P09 · Búsqueda** `/search?q=` — resultados agrupados (tutores/productos/categorías); sin resultados → sugerencias. _SCR-P09 · US-303_

> **Hito visible:** al cerrar M1 hay un sitio público navegable con datos seed. 🎉

---

## M2 · Tutor crea su catálogo (escritura del tutor)

**Backend del hito:**
- [ ] `verification_documents` (KYC, S-10) — bucket **privado** Storage (S-19); RLS dueño + admin
- [ ] RLS de escritura del tutor en `products`/`product_categories`/`availability_*` (CRUD de lo suyo)
- [ ] Guarda: producto solo `active` si tutor `approved` (RN-23/24)

**Pantallas:**
- [ ] **TU01 · Onboarding Tutor** `/tutor/onboarding` — headline, bio, categorías (multi), `timezone`, primera oferta (atajo a TU04); queda `approval: pending`. _SCR-TU01 · US-202 · M1_
- [ ] **TU02 · Verificación de Identidad** `/tutor/verification` — subir docs (`id_front/back/selfie`), estado por doc (M8) y global (M2); NTF-06 (stub). _SCR-TU02 · US-203 · [!] C-14 (qué docs)_
- [ ] **TU03 · Mis Productos** `/tutor/products` — listado con estado (M3), publicar/pausar/archivar; bloquea publicar si no aprobado (RN-23). _SCR-TU03 · US-402_
- [ ] **TU04 · Crear/Editar Producto** `/tutor/products/new|{id}` — modelo de precio (`per_session/per_hour/per_package`), precio+moneda, duración ≥30, `package_num_sessions` ≥1, categorías N–M, política override. _SCR-TU04 · US-401 · RN-03/09/10/22_
- [ ] **TU05 · Disponibilidad** `/tutor/availability` — reglas recurrentes + excepciones `block`/`open` (S-03), todo en `timezone` del tutor; `end>start`. _SCR-TU05 · US-501/502_
- [ ] **TU06 · Dashboard Tutor** `/tutor` — próximas sesiones, total ganado/neto, estado de aprobación (banner "en revisión" si `pending`). _SCR-TU06_

---

## M3 · Admin mínimo (desbloquea tutores)

> Sin admin no hay tutores aprobados → sin catálogo real. Por eso entra temprano.

**Backend del hito:**
- [ ] `tutor_tiers` (split %, `is_default` único H-6) — escritura admin (RN-07) · [!] C-09 (%s)
- [ ] Máquinas **M1** (aprobación), **M2** (identidad), **M8** (documentos) vía funciones controladas
- [ ] Primer `admin` sembrado por migración/seed (RN-31, S-31) — nunca auto-asignable

**Pantallas:**
- [ ] **AD01 · Login Admin** `/admin/login` + **AD02 · Dashboard Admin** `/admin` — colas de pendientes (tutores, pagos, incidencias) + KPIs. _SCR-AD01/AD02_
- [ ] **AD03 · Tutores por Aprobar** `/admin/tutors?status=pending` + **AD04 · Aprobados** `?status=approved` — listas + filtros. _SCR-AD03/AD04_
- [ ] **AD05 · Detalle de Tutor** `/admin/tutors/{id}` — visor seguro de KYC, aprobar/rechazar/suspender (M1), aprobar/rechazar identidad (M2/M8), asignar tier; NTF-03 (stub). _SCR-AD05 · US-1101 · RN-29 · [!] C-14_
- [ ] **AD11 · Categorías** `/admin/categories` — CRUD (`slug` único, `sort_order`, `is_active`). _SCR-AD11 · US-1102_
- [ ] **AD12 · Comisión / Tiers** `/admin/tiers` — editar `split_pct`, `is_default`, crear tiers; aplica a reservas nuevas (S-08, no retroactivo). _SCR-AD12 · US-1103 · [!] C-09_

---

## M4 · Reserva + pago (esqueleto del dinero, proveedor *simulado*)

**Backend del hito:**
- [ ] `bookings`, `sessions`, `payments` (snapshots financieros congelados; `payments` UNIQUE por reserva)
- [ ] **Edge Function `create-booking`** — crea reserva + snapshot de split/montos/corredor server-side (cierra **H-2**; regla de oro 7)
- [ ] **Proveedor de pago STUB** + **webhook simulado** → marca `payment: paid` idempotente (RN-26/34); al `paid`: `booking: confirmed`, crea `sessions`, devenga `payout_item` (M7)
- [ ] Job de **autocancelación** por ventana de pago vencida (RN-27, 30 min S-25) · [!] C-07
- [ ] [!] **C-01**: proveedor real → M10

**Pantallas:**
- [ ] **AL04 · Agendar** `/products/{id}/book` — slots = reglas + excepciones `open` − `block` − ocupadas (H-8), en hora local; paquete = N sesiones; sin doble-reserva (S-41). **✅ Listo:** crea `booking: pending_payment` → checkout. _SCR-AL04 · US-601 · RN-12_
- [ ] **AL05 · Checkout / Pago** `/app/checkout/{id}` — resumen (producto/sesiones/total/moneda), checkout **alojado** (stub, S-28), aviso de política. **✅ Listo:** "pago" (webhook stub) → `paid` → confirmación; NTF-04 (stub). _SCR-AL05 · US-602 · M6_
- [ ] **AL06 · Confirmación** `/app/bookings/{id}/confirmed` — confirmación + horario bloqueado + próximos pasos; sesiones creadas; NTF-05 (stub). _SCR-AL06 · US-603_
- [ ] **AL02 · Dashboard Alumno** `/app` — próximas/pasadas sesiones, acceso a sala cuando esté habilitada, CTA descubrir; empty state. _SCR-AL02_
- [ ] **AL03 · Detalle de Reserva** `/app/bookings/{id}` — estado (M4), sesiones (M5) en hora local, recibo, CTA sala/cancelar/reseña según guardas. _SCR-AL03_
- [ ] **TU07 · Reservas del Tutor** `/tutor/bookings` — listado + filtros + detalle; NTF-07 (stub) al confirmarse. _SCR-TU07_
- [ ] **TU08 · Detalle de Sesión (Tutor)** `/tutor/sessions/{id}` — datos, alumno, CTA sala, "marcar completada" (M5), cancelar. _SCR-TU08_

> **Hito visible:** flujo completo registro → descubrir → reservar → "pagar" (simulado) → reserva confirmada con sesiones. **El esqueleto anda.** 🦴

---

## M5 · Sala en vivo (Daily)

**Backend del hito:**
- [ ] Integración **Daily**: provisión de sala por sesión al `confirmed`; token **server-side al unirse** (no se almacena)
- [ ] Ventana de acceso `access_opens_at/closes_at` (RN-18, S-45) · [!] C-08
- [ ] Ciclo de sesión **M5**: `scheduled→in_progress→completed`; cierre por fin de ventana (S-26); job de `no_show`

**Pantallas:**
- [ ] **LV01 · Sala de Clase 1:1** `/room/{sessionId}` — video/audio Daily, controles (mute, cámara, salir, compartir pantalla S-43), temporizador; fuera de ventana → bloqueado con cuenta regresiva; móvil con controles táctiles. **✅ Listo:** une si `now()` en ventana; al salir/fin → progreso/`completed`; NTF-08 (stub). _SCR-LV01 · US-801/802/803 · RN-18_

---

## M6 · Reseñas + cancelación/reembolso

**Backend del hito:**
- [ ] `reviews` (una por compra, solo si `booking: completed`, RN-28; trigger recalcula `rating_avg/count`)
- [ ] **Mecanismo de reembolso** total/parcial (M6) leyendo %s de **config** (no hardcode) · [!] C-03
- [ ] FL-05: cuatro disparadores (alumno/tutor/no-show/admin); ajuste de `payout_item` si no liquidado (S-29) · [!] C-05 (no-show)

**Pantallas:**
- [ ] **AL07 · Cancelación** `/app/bookings/{id}/cancel` — muestra política aplicable + reembolso estimado (lee config, **sin** hardcodear DP-03); confirma → `cancelled` + reembolso (M6); NTF-09/10 (stub). _SCR-AL07 · US-604 · RN-11_
- [ ] **AL08 · Dejar Reseña** `/app/bookings/{id}/review` — 1–5 estrellas + comentario, solo si `completed`; una sola (UNIQUE); editable en ventana corta (S-32); NTF-14 dispara el pedido. _SCR-AL08 · US-901 · RN-28_

---

## M7 · Payouts + admin financiero

**Backend del hito:**
- [ ] `payouts` + `payout_items` (puente DP-06; soporta 1:1 o lote sin migración)
- [ ] Máquina **M7**: retención (DP-02) → `scheduled` → `processing` → `paid`; resuelve proveedor por `payee_country` (RN-15)
- [ ] Jobs: retención/agendado, ejecución de payout, **conciliación** proveedor↔BD · [!] C-02/C-04
- [ ] Escritura financiera **solo `service_role`** en todas estas tablas (S-15)

**Pantallas:**
- [ ] **TU09 · Payout / Cobros** `/tutor/payouts` — saldo en retención, próximos (`scheduled_for`), historial, detalle de items; **solo lectura** (S-15); NTF-12 al `paid`. _SCR-TU09 · US-1001_
- [ ] **AD06 · Pagos Pendientes** `/admin/payments?status=pending` + **AD07 · Historial** `/admin/payments` — listas + filtros (estado, proveedor, corredor) + totales. _SCR-AD06/AD07_
- [ ] **AD08 · Detalle de Pago** `/admin/payments/{id}` — bruto/comisión/neto, `tier_split_pct`, proveedor/corredor; **iniciar reembolso** total/parcial (ejecuta service role); NTF-10. _SCR-AD08 · US-704 · [!] C-03_
- [ ] **AD09 · Reservas (Admin)** `/admin/bookings` + **AD10 · Detalle** `/admin/bookings/{id}` — lista/detalle, pago asociado, sesiones, logs; soporte. _SCR-AD09/AD10_
- [ ] **AD13 · Estadísticas Globales** `/admin/stats` — KPIs (GMV, comisiones, reservas, conversión) por periodo (vistas materializadas S-44). _SCR-AD13 · US-1105_
- [ ] **AD14 · Alertas / Incidencias** `/admin/alerts` — fallas de pago, payouts `failed`/`on_hold`, disputas; NTF-13. _SCR-AD14 · US-1106_
- [ ] **AD15 · Payouts a Tutores** `/admin/payouts` — lista + filtros (M7), **hold/release**, reintentar `failed`, ver corredor; ejecuta service role. _SCR-AD15 · US-1003_

---

## M8 · Notificaciones (transversal)

**Backend del hito:**
- [ ] Tabla `notifications` (idempotencia `UNIQUE(event_key, recipient_email)`, RN-36; escritura `service_role`)
- [ ] **Puerto `EmailProvider`** (adaptador stub ahora; real en M10) · [!] C-11 (Mailgun)
- [ ] Catálogo **NTF-01…16** cableado a las transiciones reales (Doc 7 §7.4)
- [ ] Jobs: recordatorio 24h (hora local RN-35) + aviso de inicio (S-45/S-51)

**Pantallas / UI:**
- [ ] Centro de avisos **in-app** (banners/lista) en AL02 / TU06 / AD02 / AD14, derivado de `notifications` (S-48/S-50). _US-1203_
- [ ] [!] **C-12**: opt-out de no-esenciales (transaccionales siempre, S-49)

---

## M9 · Pulido (referidos, observabilidad, responsive, UAT)

- [ ] **Referidos (FL-04)**: widget Referral Factory embebido en AL02/G03; captura `?ref=` → `profiles.referral_code` (S-18); **sin lógica interna** (RN-21). _US-1301/1302 · [!] C-10_
- [ ] **Sentry** (frontend + Edge Functions) (S-09). _US-1501_
- [ ] **Métricas de pago/payout/webhook** (tasa de fallo, latencia, conciliación) (S-47). _US-1502_
- [ ] **Responsive QA** D/T/M en todos los flujos alumno/tutor (S-36); admin prioriza desktop. _US-1601_
- [ ] Pulido de empty/error states (G01/G02) en todas las pantallas.
- [ ] **QA + UAT** multi-zona horaria (RISK-12) y revisión de seguridad RLS + idempotencia webhooks (RISK-13/14). _US-1602_
- [ ] Ambientes dev/staging/prod separados (README). _US-1603_

---

## M10 · Cablear las decisiones reales (cuando el cliente responda)

> Aquí se reemplazan los *stubs* por lo definitivo. Cada uno depende de su C-xx.

- [ ] **C-01** → adaptador(es) de pago real (DLocal principal + Stripe respaldo, a confirmar); poblar `payment_routing_rules`
- [ ] **C-03** → cargar %s/plazos de reembolso en config
- [ ] **C-13** → corredores del lanzamiento; decidir Venezuela (USDT, RISK-02)
- [ ] **C-14** → checklist real de documentos KYC + motivos de rechazo + reintentos
- [ ] **C-02/C-04** → retención y agrupación de payout definitivas
- [ ] **C-05** → política de no-show definitiva (DP-08)
- [ ] **C-07/C-08** → ventana de pago y de sala definitivas
- [ ] **C-09** → %s, nombres y ascenso de tiers
- [ ] **C-10** → reglas del programa de referidos (Referral Factory)
- [ ] **C-11** → adaptador de email real (Mailgun) detrás del puerto
- [ ] **C-15** → moneda de liquidación y FX (DP-07) para cross-border

---

## Mapa rápido pantalla → hito

| Zona | Pantallas | Hito |
| :-- | :-- | :-- |
| Auth | AU01–AU04 | M0 |
| Alumno | AL01 · G03 | M0 |
| Globales | G01–G03 | M0 |
| Público | P01–P09 | M1 |
| Tutor | TU01–TU06 | M2 |
| Admin | AD01–AD05, AD11, AD12 | M3 |
| Alumno · Tutor | AL02–AL06, TU07–TU08 | M4 |
| Sala | LV01 | M5 |
| Alumno | AL07, AL08 | M6 |
| Tutor · Admin | TU09, AD06–AD10, AD13–AD15 | M7 |

**49 pantallas:** Público 9 · Auth 4 · Alumno 8 · Tutor 9 · Sala 1 · Admin 15 · Globales 3.

---

*Documento vivo. Se actualiza con cada rebanada cerrada. Última edición: 2026-06-09.*
