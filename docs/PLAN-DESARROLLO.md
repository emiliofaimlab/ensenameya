# Enséñame Ya — Plan de Desarrollo (checklist vivo)

> **Qué es esto.** El mapa de ejecución del MVP. Nació organizado por los **4 sprints** del backlog
> v1.0, pero el proyecto lleva ya **al menos 8**: S1–S4, el plan de la reunión del 24-jul, y los
> sprints **6 AC · 7 · 8** que siguen abiertos en Jira. Las secciones de abajo son **cronológicas**,
> no una lista cerrada de cuatro.
> El **"qué y cuándo"** manda en **`docs/BACKLOG.md`** (espejo de Jira); aquí llevamos el **estado
> real de construcción** (hecho / en curso / pendiente) rebanada a rebanada. El **"cómo"** lo ejecutan
> los skills `/nueva-migracion` y `/nueva-pantalla`, y se cierra con `/verify` o `/run`.
>
> - **Alcance y sprints:** `docs/BACKLOG.md` + Jira.
> - **Deltas sobre los docs técnicos:** `docs/context/ADENDA-BACKLOG-v1.md`.
> - **Cómo (técnico):** Docs 00–09 en `docs/context/`. **Reglas que no se rompen:** `CLAUDE.md`.
>
> ⚠️ **Nota histórica:** este plan estaba organizado por hitos `M0–M10`. Migró a **sprints S1–S4**,
> y de ahí a los que se fueron abriendo después (24-jul → **6 AC · 7 · 8**). Los "S1–S4" de los
> títulos son los **sprints originales**, no el proyecto entero.
> Los `M1/M2/M4…` que aparecen en los Docs 00–09 son **máquinas de estado** (Doc 2), no hitos.

> ⚠️ **ESTE DOCUMENTO DEJÓ DE SER LA ÚNICA FUENTE EL 7 DE AGOSTO.** Del **17-ago en adelante**
> el plan vive en los documentos numerados, y esos mandan:
>
> | Doc | Cubre | Fiabilidad |
> | :-- | :-- | :-- |
> | `docs/22-LISTA-VERONICA-21AGO.md` | la lista consolidada del 21-ago | **la más alta** |
> | `docs/21-DECISION-CONSULTAS-PREVENTA.md` | la decisión del cliente sobre el chat de preventa | alta |
> | `docs/20-PLAN-MINUTA-17AGO.md` | la minuta del 17-ago y las respuestas `D-x` / `P-x` | alta |
> | `docs/23-EVALUACION-EPICAS-PENDIENTES.md` | las nueve fichas de `To Do`, medidas contra el código | alta |
> | `docs/19-PLAN-DE-EJECUCION.md` | el plan de ejecución previo | media |
> | **este doc** y `docs/BACKLOG.md` | hasta el 7-ago | **desfasados a partir de ahí** |
>
> Entre el **8 y el 25 de agosto hay un hueco** en este relato: ese trabajo (M-12, MN-06, N-33, la
> ventana de sala, el hold de 7 minutos) está en los docs de arriba y en el `git log`, no aquí.
> **No se ha reconstruido a posteriori a propósito**: inventar la cronología es peor que admitir el
> hueco. Lo del **26-ago sí está**, al final, porque se escribió el mismo día.
>
> ⚠️ Y `docs/BACKLOG.md` **ya no es espejo de Jira**: ninguna de las nueve fichas de EP-25/EP-26/EP-27
> aparece en él.
>
> 🔵 **Repaso de variables y crons, 30-ago.** Las tablas de variables de este doc (y las de
> `ENTORNOS.md`, `QA-LANZAMIENTO.md` y `BACKLOG.md`) daban por ausentes en Vercel `CRON_SECRET` y
> `RESEND_API_KEY`, que **llevaban semanas puestas**. Lo que de verdad faltaba era el lado GitHub, y
> su ausencia dejó **30 corridas en rojo** en los dos crons de Actions. Corregido en línea donde
> tocaba; el relato completo, con la cadencia real medida, está en **`docs/ENTORNOS.md` §4**.

---

## Cómo trabajamos (el loop de vibecode)

Cada sesión = **una rebanada** (lo más pequeño que deje algo funcionando):

1. **Elegir** la siguiente historia `[ ]` no bloqueada del sprint activo (empareja con su tarjeta de Jira).
2. **Backend** (si aplica): `/nueva-migracion` → tabla + RLS + grants + funciones → `npm run db:push` (a dev cloud) → `npm run db:types`.
3. **Frontend:** `/nueva-pantalla` → App Router (server vs client), cliente Supabase correcto, locale `es`, responsive, UTC→hora local.
4. **Verificar:** `/run` o `/verify` con la app corriendo; `npm run lint` + `npx tsc --noEmit` en verde.
5. **Marcar** `[x]` aquí, mover la tarjeta en Jira, y anotar lo relevante (PR, decisión, deuda).

### Definición de "Hecho" (toda rebanada)
- Migración aplicada a **dev cloud** (`db:push`) y `db:types` regenerado (sin editar `database.types.ts` a mano).
- **RLS probada por rol** (anon / alumno / tutor / admin): nadie ve lo que no debe.
- Fechas **UTC** en BD, render en **hora local** del usuario.
- Escritura financiera **solo server-side** (`service_role`); el cliente solo lee.
- `lint` + `tsc` verdes; verificado en la app real (no solo en tests).

### Leyenda
`[ ]` pendiente · `[~]` en curso · `[x]` hecho · `[!]` **bloqueado** por decisión C-xx.

---

## Decisiones que bloquean (tracker)

El código **no espera**: se construye con *stub* y se cablea lo real cuando el cliente responda.

| Dec. | Tema | Bloquea | Estado | Default operable |
| :-- | :-- | :-- | :-- | :-- |
| ~~C-01~~ | ~~Proveedor de pago~~ | EP-20 | ✅ **resuelto: DLocal + Stripe** — ahora bloqueado por **credenciales**, no por decisión | Proveedor **simulado** (hecho) |
| ~~C-03~~ | ~~Reembolsos~~ | — | ✅ **resuelto** (RN-37: 100/50/100) | — |
| **C-07** | Ventana de pago | US-605 | [ ] pendiente | **20 min** |
| ~~C-08~~ | ~~Ventana de sala~~ | US-801 | ✅ **resuelto** (el AC fija 10/10, constante nombrada) | 10/10 min |
| **C-09** | %s de tiers | US-1103 | [ ] pendiente | 75/85/90 seed |
| **C-13** | Mercado/Venezuela | Payouts/corredores | [ ] pendiente | 1 corredor demo |
| ~~C-14~~ | ~~Docs para aprobar tutor~~ | US-203 KYC · US-1101 | ✅ **resuelto por UX-203 (EY-100): 7 documentos** — implica migración (hoy hay 3) | Set provisional (id_front/id_back/selfie) |
| C-02/C-04 | Retención / agrupación payout | US-1002 | [ ] pendiente | Config |
| C-05 | No-show | US-604/802 | [ ] pendiente | Default Doc 2 |
| C-10 | Reglas de referidos | US-1301 | [ ] pendiente — ⚠️ **el default dejó de ser operable** (6-ago): la campaña de RF no manda código, ver la sección del 5–6 de agosto | ~~Solo captura `?ref=`~~ → atribución **por email** contra la API de RF |
| ~~C-11~~ | ~~Email transaccional~~ | US-1201 | ✅ **resuelto: Resend** (6-ago, `58fd62e`) — el único de los tres candidatos (SendGrid/Mailgun/Resend) que envía y se **prueba sin dominio verificado**, y el dominio propio sigue bloqueado. Ahora falta la **cuenta + `RESEND_API_KEY`**, no la decisión | Cola en `notifications` (el stub ya **no** la vacía) |
| C-06 | Checkout invitado | US-602 | [ ] pendiente | Reservar exige sesión (`requireUser`) |
| C-12 | Opt-out de notificaciones | EP-12 | [ ] pendiente | Sin opt-out: todo se encola |
| C-15 | Moneda de liquidación / FX | Payouts cross-border | [ ] pendiente | Moneda del producto, sin conversión (`payments.settlement_currency` existe y no se usa) |

---

## Sprint 1 — Fundaciones · Auth · Onboarding · Descubrimiento · RLS · Ambientes

> **Objetivo:** un usuario se registra, completa su perfil (alumno/tutor + KYC), y un visitante explora
> tutores y productos. **63 SP.** El grueso de las fundaciones ya está de la etapa previa (bootstrap M0).

### Fundaciones ya listas (base técnica)
- [x] Bootstrap Next.js 16 + TS + Tailwind v4 + React 19 · Supabase CLI + `config.toml`
- [x] Migración base: `profiles`, `user_roles`, enum `app_role`, `has_role()`, trigger `handle_new_user` (rol `alumno`), RLS en ambas tablas
- [x] Clientes Supabase (`client`/`server`/`middleware`) + `proxy.ts` · `database.types.ts` generado
- [x] Layout base + design tokens (shadcn/ui, primitivos `ui/`, shell público, dark mode)
- [x] Guardas de ruta por rol (`requireUser`/`requireGuest`/`requireRole`/`pickHome`)

### EP-01 · Autenticación y Cuentas
- [x] **US-102 · Login** `/login` — email+password + Google OAuth; error genérico. _SCR-AU01_
- [x] **US-101 · Registro** `/signup` — email/Google + intención alumno/tutor + términos. _SCR-AU02, NTF-01 (stub)_
  - [x] **AU04 · Callback OAuth** `/auth/callback` — crea `profiles` en primer login; enruta por rol.
  - [x] Captura `?ref=` → `profiles.referral_code` (US-1302 / `EY-79`) — **cerrada el 29-jul** (`cefb805`, migración `20260729130000`): lo copia `handle_new_user` (con la confirmación de correo activa el alta no devuelve sesión y el `update` del cliente nunca corría), viaja en la vuelta de Google y hay cookie `ey-ref` de respaldo para los enlaces que no apuntan a `/signup`. Detalle en la tanda 1.
- [x] **US-103 · Recuperar contraseña** `/reset` (+`/reset/update`) — solicitar enlace + nueva contraseña vía token; respuesta genérica (S-40); NTF-02 = email por defecto de Supabase Auth. _SCR-AU03_
- [x] **US-104 · Cuenta / logout** `/account` (SCR-G03) — editar perfil (nombre, `timezone` IANA), cambiar contraseña, CTA rol tutor (→ `/tutor/onboarding`, US-202), cerrar sesión. _(S)_

### EP-02 · Onboarding (Alumno/Tutor)
- [x] **US-201 · Onboarding Alumno** `/onboarding` — nombre, `timezone` (IANA, autodetectada) + teléfono E.164 (RN-01/44) obligatorios → `onboarding_complete=true` (migración `20260706130000` añade `phone`+flag). Verificado E2E. _SCR-AL01_
  - _Gancho:_ ✅ cableado — signup→`/onboarding` **y gate en `requireUser`**: fuerza el onboarding en cualquier entrada (email/OAuth/login) antes del área autenticada. Nombre espejado a `user_metadata` para header/saludo.
- [x] **US-202 · Onboarding Tutor** `/tutor/onboarding` — headline, bio, **redes** (jsonb) → `approval: pending`; escritura acotada por **column-grants** (el rol `tutor` se otorga al aprobar, US-1101). Intent "Quiero enseñar" enrutado desde US-201. Verificado E2E. _Diferidos: foto (Storage), categorías (al crear productos); teléfono ya en US-201._ _SCR-TU01, RN-44_
- [x] **US-203 · KYC Tutor** `/tutor/verification` — bucket privado `kyc-documents` (S-42: 10MB, tipos) + `verification_documents` + trigger `identity: pending` + **column-grants** anti-escalada + RLS de Storage (carpeta=uid). Set provisional `id_front/id_back/selfie` **configurable** → C-14 lo amplía. NTF-06 stub. Verificado E2E (upload 200, trigger, auto-aprobar→403). _SCR-TU02_

### EP-03 · Descubrimiento (catálogo público, solo lectura)
**Backend del sprint (migraciones + RLS pública):**
> Migración `20260706120000_ep03_catalog.sql` **aplicada a dev** (`db:push` ✅) + `db:types` ✅ + RLS
> pública **verificada por lectura anon** (categories=8; products/tutor_profiles=`[]` sin seed → default-deny OK).
> Falta la matriz por rol (alumno/tutor/admin), que se cierra con el seed + pantallas. `availability_*`
> **diferido a EP-05/S2** (lo pide la reserva, no el catálogo).
- [x] `categories` (lectura pública `is_active`, escritura admin, `slug` único, planas S-13) — + seed de 8 categorías reales en la migración
- [x] `tutor_profiles` (1:1 con `profiles`; lectura pública solo si `approval_status='approved'`) — sin `tier_id`/`payout_*` (diferidos a S3)
- [x] `products` (lectura pública si `active` + tutor aprobado, RN-24; `search_vector` tsvector `spanish` + GIN)
- [x] `product_categories` (puente N–M, RN-09) · ~~`availability_rules` + `availability_exceptions`~~ → **EP-05/S2**
- [x] **Seed demo:** tutores aprobados + productos activos → `supabase/seed/ep03-demo.sql` (**dev-only**, fuera de migrations); **aplicado a dev** (verificado: 3 tutores `approved` + productos activos públicos, p.ej. `b0000000-…-0001`)

**Pantallas:**
- [x] **US-301 · Explorar Tutores** `/tutors` — solo `approved`; **filtro por categoría** + paginación; orden por rating. Verificado en dev con seed. _(rating/precio como filtro → diferido; rating ya se muestra)_ _SCR-P04_
- [x] **US-302 · Explorar Productos/Categorías** `/classes` + `/categories` + `/categories/{slug}` — activos por categoría N–M; filtro por categoría + paginación. Verificado en dev. _(filtros precio/modelo/duración → diferidos)_ _SCR-P05/P06_
- [x] **US-303 · Búsqueda** `/search?q=` — full-text en `products` (`search_vector` tsvector `spanish`); sin `q`/sin resultados → sugerencias por categoría. Verificado (`app`→"Tu primera app web"). _(tutor/categoría como resultado → diferido)_ _SCR-P09_
- [x] **US-304 · Perfil Tutor / Detalle Producto** `/tutors/{id}` + `/products/{id}` — headline, bio, rating, clases con categorías, precio por modelo, CTA Reservar (→ login sin sesión). Verificado en dev. _Diferido a su épica: reseñas (US-902/S3), disponibilidad (EP-05/S2), checkout real (EP-06/S2)._ _SCR-P07/P08_
- [x] **P01 · Landing** `/` — hero + buscador + destacados. **Ya no es la home-esqueleto**: la construyó IV-03 (`8a186a7`, 21-jul) y la afinó el repaso nodo a nodo del 23-jul (~25 desviaciones, ver el track de EP-22 más abajo). Los bloques viven en `src/components/home/` (hero, cifras, destacados, 3 pasos, garantías, FAQ, testimonios, CTA); el buscador del hero con sugerencias es `640c7f1` (28-jul). _SCR-P01_

### EP-14 · Seguridad / RLS (transversal)
- [x] **US-1401 · RLS default-deny** — en todas las tablas (profiles/user_roles/categorías/tutor_profiles/products/product_categories/verification_documents) **y Storage**; grants explícitos por rol. Verificado por rol esta sesión (anon `[]` en lo privado, tutor `403` anti-escalada, admin por `has_role`). Práctica transversal: cada tabla nueva nace con ella.
- [x] **US-1402 · Escritura financiera solo service_role** — con EP-06 Fase 1/3: `payments`/`bookings`/`sessions` sin grant de escritura de cliente (403 verificado); todo cambio por RPC `SECURITY DEFINER` (create_booking/confirm_payment). El cliente solo lee lo suyo.
  - 🐞 **La RPC no era tan "solo server-side" como decía esta línea** → ✅ arreglado el 6-ago (`ab0b1bf`, migración `20260806120000`): `confirm_payment` estaba concedida a `authenticated`. Se parte en `confirm_payment` (solo `service_role`, para el webhook) y `confirm_simulated_payment` (`authenticated`, dueño **y** proveedor `simulated`). Detalle en la sección del 5–6 de agosto.
- [x] **US-1403 · Anti-escalada de privilegios** — roles sin escritura de cliente (default-deny); `tutor_profiles` con **column-grants**: el tutor no puede tocar `approval_status`/tier. **Verificado**: PATCH `approval_status` → 403; `headline` → 200. `tier_id` (S3) hereda el patrón.

### EP-16 · Ambientes (adelanto en S1)
- [x] **US-1603 · dev + prod cloud** — proyecto Supabase por ambiente; Vercel preview por PR + prod desde `main` (`ensenameya.vercel.app`); CI de migraciones + lint/typecheck; Auth. → **`docs/ENTORNOS.md`**.

---

## Sprint 2 — Catálogo tutor · Disponibilidad · Reserva · Pagos · Webhooks

> **74 SP.** Cierra el flujo del dinero (proveedor **simulado**) y deja el esqueleto andando.

- [x] **EP-04** Catálogo del tutor
  - _Backend (migración `20260709120000_ep04_product_write.sql`, aplicada a dev):_ RLS de escritura del tutor sobre SUS `products` + `product_categories`; trigger `products_publish_guard` (RN-23: publicar exige tutor aprobado). Sirve a US-401 y US-402.
  - [x] **US-401 · Crear/editar productos** `/tutor/products` (+`/new`, `/[id]/edit`) — form con modelo de precio, duración ≥30 (RN-03), paquete ≥1 (RN-22), categorías N–M (RN-09); alta como `draft`. Guard `requireTutorProfile` (borradores permitidos antes de aprobación). Moneda USD única (ponytail → C-13). **Verificado E2E** (signup→onboarding→tutor→crear/editar draft). _SCR-TU04_
  - [x] **US-402 · Publicar/pausar/archivar** — `<ProductStatusActions>` en la lista con la máquina M3 (Doc 2 §2.6): `draft`→Publicar/Descartar · `active`→Pausar/Archivar · `paused`→Reanudar/Archivar · `archived` terminal. Publicar/Reanudar gated en UI por aprobación + respaldado por el trigger `products_publish_guard` (RN-23). **Verificado E2E** (tutor pending): Publicar disabled con tooltip, Descartar→archived, terminal sin acciones. _Boundary: publish/pause/reanudar happy-path exigen tutor aprobado → se cierra al llegar US-1101 (admin, S3)._ _SCR-TU03_
  - [x] **US-403 · Política de cancelación** — única de plataforma (RN-37: ≥24h=100%, <24h alumno=50%, tutor=100%). Fuente única `src/lib/policy.ts` (`CANCELLATION_POLICY`) + `<CancellationPolicy>` (compacta / tarjeta), consumible por US-604. Visible en detalle de producto y perfil de tutor (checkout la reusa en EP-06). Reemplaza el stub inline incompleto de US-304. **Verificado** en dev con seed. _SCR-TU04, RN-11/37_
- [x] **EP-05** Disponibilidad
  - _Backend (migración `20260709130000_ep05_availability.sql`, aplicada a dev + `db:types`):_ `availability_rules` (weekday 0=dom, `end_time>start_time`, `is_active`) + `availability_exceptions` (enum `availability_exception_type` block/open, rango parcial opcional con check both-or-neither) + RLS (lectura pública si tutor aprobado, tutor gestiona los suyos, admin lee). Doc 1 §1.4.8/1.4.9.
  - [x] **US-501 · Horarios recurrentes** `/tutor/availability` — `<AvailabilityManager>`: alta (día/desde/hasta, `end>start` en cliente + BD), lista agrupada por día, pausar/activar, eliminar; en hora local del tutor. Enlace cruzado con productos. **Verificado E2E** (alta, validación end≤start, toggle, delete). _SCR-TU05_
  - [x] **US-502 · Excepciones puntuales** — `<ExceptionsManager>` en la misma página: alta (fecha `<input type=date>`, tipo block/open, rango opcional both-or-neither = check de BD, motivo), lista futura ordenada por fecha, eliminar. Fecha formateada sin desfase de tz. **Verificado E2E** (bloqueo día completo, open con rango, validación both-or-neither, orden). _SCR-TU05, S-03_
- [x] **EP-06 / EP-07** Reserva · Checkout · Pagos (núcleo del dinero, PSP simulado)
  - [x] **Fase 1 · Modelo de datos** (migración `20260709140000_ep06_booking_core.sql`, aplicada + `db:types`): `bookings` (M4, con `pending_acceptance`), `sessions` (M5), `payments` (M6) — enums, snapshots financieros, RLS **solo-lectura de lo propio** y **grants sin INSERT/UPDATE/DELETE de cliente** → toda escritura será por RPC `SECURITY DEFINER`. **Verificado** (403 permission denied en POST bookings/payments; lectura propia `[]`). _Cierra el guard de **US-1402** cuando aterricen las RPC de escritura._ Diferidos a su historia: `payment_methods` (US-607), `payment_routing_rules` (US-701), payouts/reviews (S3).
  - [x] **US-601 · Elegir slot** — función controlada `get_available_slots` (migración `20260709150000`): reglas − excepciones(block)+open − sesiones ocupadas (S-41), tz del tutor → UTC vía `AT TIME ZONE` (DST correcto), solo futuro, ventana 21 días. Pantalla `/reservar/[productId]` + `SlotPicker` (agrupa por día local, single/N-select por RN-12) + `ReserveButton` habilitado. **Verificado E2E** con tutor aprobado real (Caracas UTC-4): Lun 09:00→13:00 UTC, Mié 14-16→2 slots, n=9 correcto, render en hora local, selección+gating. _Doble-reserva se ejercita en Fase 3 (crea sessions)._ _SCR-AL04, RN-12/32_
  - [x] **US-602 + US-701 + US-702 · Checkout simulado** (Fase 3, migración `20260709160000`): `payment_routing_rules` + corredor demo VE/simulated; RPC `create_booking` (valida slots S-41 con índice único anti-carrera, congela total/split 75%/provider, crea booking+payment+sessions-hold) y `confirm_payment` (webhook simulado idempotente → `pending_acceptance` | fallo → `cancelled`+libera hold). Pantalla `/reservar/[id]/checkout` + `CheckoutForm` (Pagar/Simular fallo). **Verificado E2E**: pago 18 US$ → split 13,50/4,50, `pending_acceptance`, S-41 (slot desaparece y re-reserva falla), idempotencia. _SCR-AL05, M6, RN-33/43, C-01 simulado._
  - [x] **US-606 + US-603 · Aceptar/rechazar + confirmación** (Fase 4, migración `20260709170000`): RPC `respond_booking` (tutor, solo desde `pending_acceptance`): aceptar→`confirmed` | rechazar→`cancelled` + **reembolso 100%** (RN-38) + libera sesiones. Pantalla tutor `/tutor/reservas` (acciones) + alumno `/reservas` (US-603, read-only) con `<BookingList>` compartido. Entradas desde hub tutor / panel alumno / éxito de checkout. **Verificado E2E**: aceptar→Confirmada, rechazar→Cancelada + payment `refunded` (1800=gross) + slot 13-jul liberado. NTF-05/17 stub. _Timeout auto-24h → job Fase 5._ _SCR-TU07b/AL06, M4._
  - [x] **US-604 · Cancelar + reembolso RN-37** (migración `20260709180000`): RPC `cancel_booking` (alumno o tutor; solo estados cancelables): tutor→100%, alumno ≥24h de la 1ª sesión→100%, <24h→50%; booking+sessions→cancelled, payment→refunded/partially_refunded. Botón Cancelar en `<BookingList>` (ambos modos). **Verificado**: 3 tramos por API (100/100/50, con 2ª cuenta de alumno) + botón E2E.
  - [x] **US-605 · Autocancelar por timeout** (migración `20260709190000`): `expire_stale_bookings()` (SECURITY DEFINER, cutoffs parametrizables) — pending_payment >20 min → cancelled + slot liberado (RN-27, C-07); pending_acceptance >24 h → cancelled + reembolso 100% (RN-38). `pg_cron` cada 5 min con cutoffs reales. **Verificado** (forzando cutoffs a 0): ambos caminos + release de slot + reembolso. ⚠️ _Ceiling: grant a `authenticated` para testabilidad → revocar antes de prod (solo cron/service_role)._
  - [x] **US-607 · Card-on-file** (migración `20260709200000`): tabla `payment_methods` (**sin columna de PAN**, solo `provider_token` + marca/últimos4, RN-43) + RLS del dueño. Gestión en `/account` (guardar/listar/eliminar tarjeta simulada). **Verificado E2E** (add "Visa •••• 4242" + delete). Token real → C-01.
  - [x] **US-703 · Webhooks idempotentes** (migración `20260709210000`): tabla `payment_webhook_events` (dedup por `event_id`) + `confirm_payment` v2 con `p_event_id` opcional → un evento repetido es no-op (doble idempotencia: por event-id y por estado). **Verificado** (evt_A procesa, evt_A repetido no-op). Firma RN-34 → endpoint HTTP del webhook con proveedor real (C-01).
  - [x] **US-705 · Proveedores sin tocar el core** — satisfecho por el diseño de US-701: `payment_routing_rules` (admin-writable) + `provider`/`charge_provider` como **texto** (S-16) → un proveedor nuevo = fila en la tabla (runtime) + su adaptador, sin migración ni cambio de negocio. `create_booking` resuelve el provider desde la tabla (verificado). Sin interfaz de un-solo-impl (llega con el 2º proveedor real, C-01).
- [x] **EP-07** — US-701/702/703/705 cerradas arriba junto a EP-06 (todas `Done` en Jira). Pendientes: US-704 (reembolso manual admin) → **S3**; el cableado con proveedor real → **EP-20** (bloqueada por credenciales).

> **Hito visible:** registro → descubrir → reservar → "pagar" (simulado) → tutor acepta → reserva confirmada con sesiones. 🦴

---

## Sprint 3 — Sala en vivo · Reseñas · Payouts · Admin · Notificaciones · Chat ✅ **CERRADO (2026-07-17)**

> **19 historias / 83 SP · todas en `Done`** (+ US-203/EY-33, reabierta y cerrada con los 7 docs).
> Mergeado a prod (PR #4, commit `5aabce7`); migraciones aplicadas por CI. **Única cola de S3:**
> US-202 (EY-32, asistente de onboarding del tutor) queda `To Do` — el resto del onboarding vive,
> falta el wizard de 5 pasos. Abierto 2026-07-14, cerrado 2026-07-17.

**Orden sugerido.** `US-1101` primero: es la llave que abre el resto — sin tutor aprobable desde la
app, el happy-path de publicar producto (US-402) y el E2E de reserva siguen dependiendo de aprobar a
mano en la BD. Cierra además el *boundary* que S2 dejó abierto.

- [x] **EP-11 · Panel Admin** — `EY-68`…`EY-72` ✅ **completa** (5/5)
  - [x] **US-1101 · Aprobar/rechazar tutores + KYC** `EY-68` (migración `20260714120000`): RPC `review_document` (la identidad es el **agregado** de los documentos: uno rechazado la tumba, todos aprobados la aprueban — no se marca a mano) + `review_tutor` (RN-29: aprobar exige `identity='approved'`; **otorga el rol `tutor`** al aprobar y lo **retira** al rechazar). Ambas verifican `has_role('admin')` dentro; el cliente no escribe por PATCH. Pantallas `/admin` (cola, pendientes arriba) + `/admin/tutores/[id]` (SCR-AD05, enlaces firmados 5 min al bucket privado). **Verificado E2E en la app**: aprobar doc → identidad `approved` sola → se desbloquea "Aprobar tutor" → tutor `approved` + rol `tutor` + `reviewed_by`/`approved_at`. Anti-escalada re-probada (anon / auto-aprobarse / aprobar su propio doc / PATCH `approval_status` / INSERT de rol → todos 42501). NTF-03 stub. _Bootstrap del primer admin: `supabase/seed/admin-bootstrap.sql` (huevo-y-gallina, ver el archivo)._ _Lista los documentos de forma **genérica** → pasar a 7 (UX-203) no toca esta pantalla._
    - ⚠️ _Todo admin recién sembrado debe completar `/onboarding` antes de entrar al panel (gate de `requireUser`, RN-44). No es bug; tenerlo en cuenta en prod._
  - [x] **US-1102 · Gestionar categorías** `EY-69` (migración `20260715140000`): CRUD en `/admin/categorias` con slug único y categorías **planas** (S-13). **Sin RPC**: no hay dinero ni roles, así que basta RLS (`categories_insert/update/delete_admin`) + grants — que es justo para lo que está. **Baja lógica (AC)**: una categoría con productos no se borra, se desactiva; lo fuerza el trigger `categories_delete_guard` en BD, no la UI. _No es cosmético_: `product_categories.category_id` es `on delete cascade`, así que un DELETE habría borrado en silencio los enlaces de todos sus productos (RN-09). El slug se autogenera desde el nombre (sin acentos ni símbolos) y se puede editar. **Verificado**: crear/editar/desactivar/borrar, slug duplicado → 23505, borrar "Matemáticas" (6 productos) → rechazado y la categoría intacta, no-admin → 42501 en insert y 0 filas en update/delete, y al desactivar desaparece del catálogo público pero el admin la sigue viendo. _SCR-AD11_
    - _Nav del panel_ (`admin-nav.tsx`) al pasar de una a dos secciones: enlaces planos, sin layout. Las de US-1104/1105 se añaden a esa lista.
  - [x] **US-1103 · Comisión y tiers** `EY-70` (migración `20260715170000`): tabla `tutor_tiers` (RN-06) + `tutor_profiles.tier_id` (diferido en EP-03, aterriza aquí) + pantalla `/admin/tiers` (SCR-AD12) + selector de tier en la ficha del tutor. **`create_booking` deja de hardcodear el 75**: resuelve el split desde el tier del tutor → default → y si no hay ninguno **falla** en vez de inventar un número (es dinero). `review_tutor` asigna el tier por defecto al aprobar (Doc 1 §1.4.4). Índice parcial: **un solo tier por defecto** (dos harían del split una lotería). Escritura por RLS; `assign_tutor_tier` va por RPC porque `tier_id` está fuera de los column-grants del tutor (US-1403). **Verificado**: mismo producto de 18 US$ → Tier 1: tutor 13,50/plataforma 4,50 · Tier 3: 16,20/1,80; **S-08 por partida doble** (ni mover de tier ni editar `split_pct` tocan reservas creadas); dos defaults → 23505; tutor → 42501 en RPC y PATCH.
    - **C-09 ya no bloquea**: 75/85/90 entran como **seed** (configuración, regla de oro 8), no acoplados al código. Cuando el cliente responda se editan por el panel, sin tocar código ni migración.
    - ⚠️ _Migración **idempotente** a propósito_ (`if not exists` / `drop policy if exists`): hubo que reaplicarla en dev para corregir un `create_booking` que salió mal al recrearlo. Sigue siendo correcta en un ambiente limpio.
  - [x] **US-1104 · Supervisar pagos/reservas** `EY-71` (migración `20260715180000`, mínima): `/admin/payments` (SCR-AD06+AD07 en una: "pendientes" es el listado con el filtro puesto, como los agrupa el Doc 5) + `/admin/payments/[id]` (SCR-AD08) + `/admin/bookings` (AD09) + `/admin/bookings/[id]` (AD10). Filtros por estado/proveedor/corredor/fecha en la **query string** (la URL es la fuente → se comparte y se marca). Totales del **conjunto filtrado**, no de la página. **Solo lectura**: el reembolso es US-704. _Casi todo frontend_: `bookings/payments/sessions_select_admin` ya existían de EP-06; la única migración abre lectura de `payment_webhook_events` al admin — un pago `pending` **sin evento** significa que el webhook nunca llegó, que es la 1ª pregunta de soporte.
    - **"Logs básicos" sin tabla de auditoría**: la traza se deriva de los timestamps que las entidades ya guardan + los eventos de webhook. Una auditoría real (actor + diff) sería otra historia y otra tabla.
    - _Robustez de filtros_: estado y fecha vienen de la query string, o sea texto libre. Se **validan e ignoran** si no encajan: un `?status=basura` llegaba al enum (`invalid input value`) y `?from=basura` dejaba la lista en cero fingiendo que no había datos.
    - ⚠️ _Ceiling_: los totales se suman en el servidor sobre todas las filas filtradas (PostgREST no agrega sin vista/función). Sirve al volumen del MVP; si crece → RPC de agregación. Monedas distintas no se suman: se avisa.
  - [x] **US-1105 · Estadísticas globales** `EY-72` (migración `20260715190000`): `/admin/stats` (SCR-AD13) con KPIs filtrables por período — reservas creadas/pagadas, **conversión**, tutores activos, y por moneda GMV/comisión/neto/reembolsado. Los agrega la RPC `admin_stats(from, to)` — **una consulta**, no miles de filas a JS (al revés que US-1104: aquí agregar es SQL), y verifica `has_role('admin')` dentro. **S-44 (vistas materializadas) se pospuso a propósito**: es un supuesto de rendimiento, la matview obliga a `pg_cron` de refresco (más piezas, datos con retraso) para un problema que aún no existe; el día que el histórico pese, se cambia la función por un `select` sobre matview sin tocar el frontend. Filtra por `created_at` (consistente con US-1104); el dinero se agrupa por moneda (RN-13, no se suman distintas). **Verificado**: histórico completo (21 reservas, 15 pagadas, 71,4% conversión, 5 tutores, GMV 253/comisión 63,25/neto 189,75/reembolsado −193); período vacío → ceros + "sin ingresos"; presets 7/30/90d; no-admin y anon → 42501.
- [x] **EP-08 · Sala en vivo (Daily)** ✅ — Daily **cableado de verdad** (US-801, migración `20260717120000` + `src/lib/daily.ts` + `/api/room/[sessionId]`), con la **credencial como interruptor**: sin `DAILY_API_KEY` la sala va **simulada** (como el PSP); con la clave, Daily real, sin tocar código. **Cuenta de Daily con método de pago desde el 28-jul** (dominio `ensenameya.daily.co`, `allow_plan_free:false`); `DAILY_API_KEY` puesta en local, Preview y Production — **prod pasa a Daily real en el próximo deploy**. Validado contra la API real: crear sala privada con `exp`/`enable_chat:false`, firmar meeting-token owner y borrar sala. Pendiente el E2E por navegador con sala real. Para la grabación (US-1802) falta configurarla en el dashboard: `recordings_bucket` y `enable_auto_recording` siguen en `null`. Migración base `20260716120000`.
  - [x] **US-801 · Entrar a la sala** `EY-59`: RPC `join_session` (SECURITY DEFINER) — exige participante + reserva activa + `now()` dentro de la ventana **RN-18/S-45 (10 min antes / 10 después)**; nombre de sala determinista `ey-<sessionId>`. El **token de Daily lo firma el server** en `/api/room/[sessionId]` con `DAILY_API_KEY` (server-only), tras autorizar con la RPC — efímero, no almacenado (Doc 1 §1.4.11); el tutor entra como `owner`. Sin la clave, el endpoint devuelve sala simulada (**sin fallback silencioso**: un Daily configurado que falla se ve, no se disfraza de simulado). Pantalla `/room/[sessionId]` (SCR-LV01). **C-08 resuelto**: el propio AC fija 10/10, constante nombrada. **Verificado E2E**: por API (dentro de ventana → autoriza; no-participante → rechazado; anón → 28000; a-destiempo → "fuera de la ventana"; reserva no confirmada → "no está activa") y por navegador esta sesión (`POST /api/room → 200`, sala renderizada).
  - [x] **US-802 · Ciclo de vida** `EY-60`: primer join → sesión `in_progress` (y reserva `in_progress` si era la 1ª); el tutor cierra con `complete_session` → `completed` + reserva `completed` cuando no quedan sesiones abiertas; **cierre automático al vencer la ventana** por `close_expired_sessions()` en `pg_cron` cada 5 min (S-26), `no_show` si nadie entró. Grant revocado de PUBLIC → solo `service_role` (lección de US-605). **Verificado E2E**: join→in_progress→complete→completed; re-entrar tras cerrada → rechazado.
  - [x] **US-803 · Responsive/móvil** `EY-61`: sala mobile-first con controles táctiles grandes (mute/cámara/salir/completar); **verificado a 375px** + cuenta regresiva. La **reconexión automática ante caída de red** la aporta el SDK de Daily, ya cableado (US-801); en modo simulado se mantienen los controles locales para ejercitar los toques.
  - _Entrada "Ir a la sala"_ desde `/reservas`, `/tutor/reservas` y los paneles `/app` + `/tutor` (junto a "Chat"), en reservas confirmadas/en curso. **Happy-path en-vivo verificado E2E en navegador esta sesión** (sembrando una sesión con ventana abierta, `demo-open-room.sql`): "Entrar a la sala" → `POST /api/room → 200` (`join_session` autoriza) → sala renderizada. Estados verificados: cuenta regresiva (desktop+móvil), "sesión terminó", fuera de ventana.
- [x] **EP-09 · Reseñas** ✅ (migración `20260716130000`): tabla `reviews` (1 por reserva, RN-17) + trigger que mantiene `rating_avg`/`rating_count` del tutor (los creó vacíos EP-03).
  - [x] **US-901 · Dejar reseña** `EY-62`: RPC `submit_review` (SECURITY DEFINER) — **deriva** tutor/producto de la reserva para que el alumno no falsee a quién reseña; exige reserva **propia y `completed`** (RN-17); upsert por reserva (re-enviar edita, RN-17: una sola). Diálogo con estrellas clicables en `/reservas` (SCR-AL08), en completadas. **Verificado** por API (crear/editar, no-completada/ajena/fuera-de-rango → rechazadas) y por UI (editar 4→5★ → trigger recalcula rating).
  - [x] **US-902 · Ver reseñas** `EY-63`: lista en el perfil del tutor (SCR-P07) + rating agregado. RLS de lectura **pública** (anon incluido). **Anónimas a propósito**: el perfil es público (cliente anon) y `profiles.full_name` está protegido por RLS → no se puede atribuir nombre sin romper esa barrera; es además la opción privacy-friendly del MVP. **Verificado** en navegador (sección "Reseñas (1)", estrellas + comentario + fecha).
- [x] **EP-10 · Payouts a tutores** ✅ (migraciones `20260716140000` + `20260716150000`) — proveedor de payout **simulado** (como PSP/Daily); orquestación M7 completa, `provider.payout()` real es una Edge Function con credenciales. Todo el dinero server-side (S-15): `payouts`/`payout_items` sin escritura de cliente. Retención **default 7 d** (DP-02 real 15/30 → parámetro); agregación **por (tutor, moneda)** (DP-06, RN-13). S-29: reembolsado antes de liquidar no entra; clawback tras `paid` manual.
  - [x] **US-1001 · Ver ingresos/payouts** `EY-64`: `/tutor/payouts` (SCR-TU09) con disponible / en retención / ya pagado (RPC `tutor_balance`, misma elegibilidad que el lote → una fuente) + historial. **Verificado** (saldo y 2 payouts pagados 22,50 US$).
  - [x] **US-1002 · Liquidación lote semanal** `EY-65`: `run_payout_batch` (lunes 03:00 UTC, agrupa liquidable en payouts `scheduled`) + `process_scheduled_payouts` (cada 10 min, `scheduled`→`paid` vía proveedor simulado), ambas por `pg_cron`. Grants revocados de PUBLIC → solo `service_role` (lección US-605). **Verificado E2E**: retiro→scheduled (750=neto)→procesador→paid.
  - [x] **US-1003 · Gestión admin** `EY-66`: `/admin/payouts` (SCR-AD15) con filtros + `manage_payout` (hold/release/retry, guardas M7). **Verificado**: hold (scheduled→on_hold), release (on_hold→scheduled), retry-desde-scheduled → rechazado, hold-sobre-paid → rechazado.
  - [x] **US-1004 · Retiro self-service** `EY-67` (RN-40): `request_withdrawal` — el tutor adelanta su saldo disponible; botón en `/tutor/payouts`. **Verificado**: crea payout scheduled; sin saldo → rechazado.
  - _Seguridad re-probada_: anon→28000, admin-no-tutor retiro→42501, tutor manage_payout→42501, tutor run_payout_batch (solo cron)→42501, escritura directa de payouts→42501.
- [x] **EP-12 · Notificaciones** ✅ (migración `20260716170000`) — tabla `notifications` (puerto DP-05/C-11) + triggers reactivos + procesador stub.
  - [x] **US-1201 · Emails transaccionales** `EY-73`: el "puerto EmailProvider" es la tabla `notifications` (canal + plantilla + payload, Doc 7); el "stub" era `process_notifications` (cron cada 2 min, `pending`→`sent`). ✅ **El proveedor real aterrizó el 6-ago (Resend, `58fd62e`) y el stub dejó de vaciar la cola** — detalle en la sección del 5–6 de agosto. **Desestubea los NTF-xx**: se disparan por **triggers sobre las transiciones** (no desde las RPC de dinero → sin recrear funciones de pago), cubriendo el grueso de la matriz reactiva: NTF-03/06 (tutor), NTF-05/07/09/14 (booking), NTF-04/10/15 (payment), NTF-12/16 (payout). NTF-01/02 los cubre Supabase Auth.
  - [x] **US-1202 · Registro idempotente** `EY-74`: cada evento lleva `idempotency_key` determinista (UNIQUE) + `on conflict do nothing` → el mismo evento no se encola dos veces (parcial y total de un reembolso avisan una vez cada uno porque la clave incluye el acumulado). **Verificado**: reembolso→NTF-10 encolado con payload; sin claves duplicadas; stub `pending→sent`; tutor `process_notifications`→42501; RLS por destinatario (el tutor no ve las del alumno); anon→vacío.
  - _Follow-up (NTF programados, no reactivos)_: **NTF-08** (apertura de ventana, S-45) y **NTF-11** (recordatorio 24 h, RN-35) son jobs de cron, no transiciones → quedan para cuando se cablee el proveedor real o como historia aparte.
- [x] **EP-07 · US-704 · Reembolso manual admin** `EY-58` (migración `20260716160000`): RPC `refund_payment` (admin) total/parcial sobre un pago cobrado (M6, DP-03), en la pantalla de detalle de pago (SCR-AD08). Distinto de `cancel_booking` (política RN-37): es corrección financiera del admin. **S-29**: reembolso total antes de liquidar **excluye el `payout_item`** del payout no pagado y lo revierte (borra el payout si se queda vacío); si el payout ya está `paid` → **flag de clawback manual** (el reembolso al alumno igual procede). Total → reserva `refunded` (M4); parcial no toca la reserva. **Verificado**: parcial (por UI, 5/18)→`partially_refunded`; total→`refunded`+reserva `refunded`; sobre-reembolso→rechazado; clawback cuando el payout ya se pagó (flag + item no se auto-revierte); tutor/anon→42501. NTF-10 stub.
- [x] **EP-17 · Chat de la reserva** ✅ (migración `20260716180000`, RN-41) — Supabase Realtime nativo (sin dependencias nuevas); el chat de Daily no se usa (efímero).
  - [x] **US-1701 · Chat 1:1** `EY-75`: tabla `messages` (hilo 1:1 por reserva) + RLS **por participantes** (ni el admin lee) + RPC `send_message` (participante + **ventana 2 días antes** de la 1ª sesión) + Realtime sobre `messages`. Pantalla `/chat/[bookingId]` (SCR-AL03) con burbujas propias/ajenas y composer; enlace "Chat" en `/reservas` y `/tutor/reservas`. **Verificado E2E en navegador**: envío bidireccional, append optimista del emisor, y **entrega en vivo cross-participante** (el mensaje del tutor apareció en el navegador del alumno **sin recargar**). _Gotcha resuelto_: Realtime sobre tabla con RLS exige `realtime.setAuth(token)` o no entrega. RLS re-probada: no-participante/anon no leen ni escriben; vacío/ventana rechazados.
  - [x] **US-1703 · Purga automática** `EY-76`: `messages.expires_at = created_at + 30 días` + `purge_expired_messages()` en `pg_cron` diario (04:00 UTC). EXECUTE revocado de PUBLIC → solo `service_role` (lección US-605). **Verificado**: purga por service_role; alumno→42501. Descarga `.txt`/`.json` (US-1702) → S4.

### Deuda que S3 debe saldar (heredada de S2)

- [x] ✅ **US-605 saldada** (migración `20260715150000`): `expire_stale_bookings()` tenía `EXECUTE` a `authenticated` por testabilidad — **verificado explotable** (un tutor normal venció reservas ajenas con cutoff 0). Revocado de **`PUBLIC`** (no solo de `authenticated`: en Postgres `EXECUTE` es `PUBLIC` por defecto, revocar del rol no basta) → solo `service_role`/cron. Re-probado: tutor → 42501.
- ~~**US-402:** happy-path de publicar/pausar/reanudar sin ejercitar con tutor aprobado~~ → ✅ **desbloqueado por US-1101**: ya se puede aprobar un tutor desde la app (queda ejercitar el happy-path).
- [x] ✅ **US-203 (EY-33) cerrada** — set final de **7 documentos** (migración `20260715130000`, cierra **C-14**): `id_document` · `degree` · `certificate` · `diploma` · `transcript` · `cv` · `social_media`. Este último es un **enlace, no archivo**: entra por columna propia `link_url` (meterlo en `storage_path` habría reventado el `createSignedUrls()` de la pantalla admin), con check `num_nonnulls(storage_path, link_url) = 1`. Los 3 tipos provisionales (`id_front`/`id_back`/`selfie`) se **borran** en la migración: sin eso seguirían contando en el agregado de identidad y la dejarían clavada (el tutor ya no puede re-subirlos porque salen del formulario). Los archivos de Storage no se tocan; en prod es no-op. El trigger ahora también escucha `DELETE`. **Verificado**: 7 filas en orden en la UI, `social_media` como input de texto con validación de URL (basura → no guarda ni pisa la buena), XOR archivo/enlace rechaza ambos y ninguno, y el admin distingue enlace firmado vs externo (`rel="noreferrer"`).
- [x] 🐞 **US-203 (EY-33) · subida de KYC rota** → ✅ **arreglado** (migración `20260715120000`). El `.upsert()` de `verification-form.tsx` fallaba **siempre** con 42501 (PostgREST lo vuelve `ON CONFLICT DO UPDATE SET tutor_id…, doc_type…` y las column-grants solo dan `update (storage_path)`, a propósito por US-1403). Solución: RPC `submit_document` (**no** se ampliaron las grants del cliente — eso abriría la escalada que la migración evitaba); valida que la ruta sea `<uid>/<doc_type>` porque corre como SECURITY DEFINER. Cierra además "repostular sin límite" (UX-203): re-subir devuelve el doc a `pending` y limpia `reviewed_*`/`review_notes`. **Verificado por la UI real** (subida → toast + badge Aprobado→En revisión) y por API (1ª subida, re-subida, rechazo→re-subida, ruta ajena → rechazada, anon → rechazado).
  - _De paso:_ la identidad pasó a ser una columna **derivada** vía trigger `refresh_identity_status` (antes se recalculaba a mano en `review_document` y `mark_identity_pending` solo cubría el primer insert). Una sola fuente; `review_document` ya no la recalcula.
- ❓ **Decisión de producto pendiente (destapada al arreglar lo anterior):** un tutor **ya aprobado** que re-sube un documento —o al que le rechazan uno— baja su identidad a `pending`/`rejected` pero **conserva `approval_status='approved'` y el rol `tutor`**, así que sigue vendiendo. RN-29 solo gobierna el *momento* de aprobar; no dice si hay que revocar después. Hoy la revocación es **manual** (el admin rechaza al tutor, y eso sí le retira el rol). Si se quiere automática, el sitio es el trigger. **Preguntar al cliente.**

---

## Tracks paralelos (fuera de S1–S4) — sync Jira 2026-07-21

No consumen SP del sprint. Se filtran en Jira por label.

- **EP-19 · Diseño UI** (`EY-87`, label `Sprint-Diseño`) — DS-01…04 (`EY-88`…`EY-91`) **In Review**, asignadas a Diana Rivera. Entregable **Figma**, no código (mismo matiz que EP-00). ~~Historias de dev aún no creadas~~ → **ya existen: EP-22.**
- **EP-20 · Activación Comercial** (`EY-92`, label `Sprint-Activacion-Comercial`) — PAC-01…04 (`EY-93`…`EY-96`).
  ⚠️ **La premisa de la épica ("no iniciar hasta tener AMBAS cuentas") era falsa** y costó semanas de
  espera: el sandbox de Stripe da Sessions, webhooks **firmados**, rechazos, expiraciones y reembolsos
  con solo registrar un email — el KYC solo bloquea el *live mode*. ✅ **PAC-01 y PAC-03 hechas y
  verificadas de punta a punta en test mode el 6-ago** (`7b30768` + `3529655`). 🔒 Sigue bloqueado:
  **DLocal entero** (sin cuenta; su sandbox va detrás de contrato) y los **payouts** (Connect exige KYC).
  **C-01 está decidido** (DLocal + Stripe). Detalle en la sección del 5–6 de agosto.
- **EP-21 · UX Onboarding Tutor** (`EY-97`, label `Sprint-Mejoras-UX`) — UX-201…204 (`EY-98`…`EY-101`).
  ⚠️ **Redefine historias ya `Done`** (US-201/202/203). No es solo documentación:
  - **UX-203** (`EY-100`): **7 documentos** de KYC (`id_document`, `degree`, `certificate`, `diploma`, `transcript`, `cv`, `social_media`) vs los **3** construidos (`id_front`/`id_back`/`selfie`) → **resuelve C-14** y pide migración del set.
  - **UX-202** (`EY-99`): asistente **secuencial** de 5 pasos (contacto → headline/bio → **foto** → redes → **categorías**) vs el form único actual. Foto y categorías estaban **diferidas** en US-202 — aquí vuelven. ✅ **El asistente ya es secuencial y de 5 pasos** (IV-02 lo montó; R24-15/R24-16 lo dejaron en verificación como penúltimo paso y los materiales fuera → 6 pasos volvieron a 5, `39b40d5` + `3f6181d`).
  - **UX-204** (`EY-101`): gate "Enviar a revisión" exige ≥1 producto `draft`. ✅ **Hecho el 27-jul** (`66f70e0`): el asistente no se cierra sin una oferta creada.

  Están redactadas como *requisitos de pantalla* (entregable = documento), pero su AC implica **re-trabajo de código**. Decidir si se abren historias de dev derivadas o se reabren US-202/203.

- **EP-22 · Integración Visual** (`EY-102`, label `Sprint-Integracion-Visual`) — el **lado de código** de EP-19. **Las 6 IV en producción desde el 2026-07-22 (PR #6→dev, PR #7→main) y en `Done` desde el 27-jul.** Detalle y mapeo a páginas de Figma en `docs/BACKLOG.md` §4.2.
  - [x] **IV-01** (`EY-103`) · auth — AU01…AU04 + **header y footer globales** + tokens del Figma para toda la app. `95aacc6`.
  - [x] **IV-02** (`EY-104`) · onboarding — TU01 (5 pasos) + AL01 (3 pasos). Trajo **modelo nuevo** (migración `20260722160000`: `avatar_path` + bucket `avatars`, `tutor_categories`, `student_interests`, `tutor_materials` + bucket privado, `teaching_level`). `b68b20c` + `1b0efb6`. ⚠️ Paso 4 en **desencuentro con diseño** (KYC vs materiales de clase); **AL01 sin verificar en navegador**.
  - [x] **IV-03** (`EY-105`) · públicas — P01…P09, incluidas `/about` y `/how-it-works` como rutas **nuevas**. `8a186a7` + `676972f`.
  - [x] **IV-04** (`EY-106`) · dashboard alumno (AL02…AL08) + **LV01 sala en vivo**: chat lateral (reutiliza el hilo de EP-17) + "Subir documentos" (adjunto de `messages` + bucket `chat-attachments`). `dffa023`…`fa8bec9`.
  - [x] **IV-05** (`EY-107`) · dashboard tutor (TU03…TU09) · [x] **IV-06** (`EY-108`) · panel admin (AD02…AD15). Shell de panel compartido. `036a346` + `f521315`.
  - Rama `feat/iv01-auth-visual`: 25 commits, **mergeada y borrada** tras el release.
  - ~~**Techo de estado: `In Review`**~~ → **las 6 (`EY-103`…`EY-108`) pasaron a `Done` el 27-jul.** El techo que se había puesto (nada a `Done` sin aprobación del cliente y copy final) **se levantó sin que llegara esa aprobación**: primero se publicó a prod sin el go (decisión de negocio, reunión del 17-jul `00:28:40`) y después se cerraron las tarjetas. La deuda no desaparece porque el ticket esté cerrado — **el copy final y el visto bueno del cliente siguen sin llegar**.
  - De paso se cerraron criterios de **US-301** (filtro por rating) y **US-303** (búsqueda de tutores y categorías).
  - **Acuerdos del 17-jul aplicados** (migración `20260722200000` + `daily.ts`): chat de Daily apagado (`enable_chat:false`), prefijo `chat_` en adjuntos, **purga del chat PARADA** (`US-1703`/`EY-76` reabierta — retención sin decidir), y **switch de panel** alumno/tutor/admin en el menú de cuenta.
  - ⚠️ **No hay diseño móvil** (todo a 1280px). Afecta a **US-1601** (S4): decidir si se pide diseño responsive o US-1601 corre con criterio de dev. **Preguntar al cliente / a diseño.**
  - ⚠️ **IV-05 (tutor) e IV-06 (admin) no tienen DS-xx que las respalde.** IV-06 dejó además **trabajo funcional pendiente** de la reunión (panel de alertas con badges, detalle de tier, categoría desplegable, redirección de slug, log del tutor, subida por lotes).
  - ⚠️ **Pendiente de verificar en preview:** el alta con Google (provider no configurado en local) y el intercambio PKCE en cliente de AU04.
  - 🔁 **Revisión nodo a nodo de P01 (2026-07-23).** IV-03 se maqueteó "a ojo de frame"; comparando el JSON de P01 (`386:3`, 387 nodos, REST) contra el DOM salieron **~25 desviaciones**, todas corregidas. Lo estructural: contenedor a **1152px** (daba 1088 — afectaba a *toda* la app), cuerpo a `#4d4d4d`, títulos sin `tracking-tight`, banda de garantías con **degradado** `#0072ff→#49a9ff` e iconos naranjas, **chips solo-icono con etiqueta al hover** (el diseño no llevaba etiquetas fijas), tarjeta de tutor alineada a la izquierda, **imágenes de los 3 pasos**, FAQ abierta con chevron azul, tarjeta de cifras **cabalgando el borde** (99 de 199px) y testimonios como **carrusel de dos filas que se sale del bloque** (CSS puro, `prefers-reduced-motion` respetado). Detalle en `docs/BACKLOG.md` §4.2.
  - ✅ **Cerrado el `TODO` de contenido inventado de P01:** la banda de cifras sale de `home_stats()` y los testimonios de `home_testimonials()` — **datos reales**, con el nombre del alumno enmascarado en la propia RPC. Los **países** se derivan de la zona horaria (`country_from_timezone()`) porque el país de cobro sigue pendiente de **C-13** (`create_booking` lo tiene hardcodeado a `'VE'`). ⚠️ Publicar nombre + inicial de un alumno **es decisión del cliente**.


- **🎨 Repaso nodo a nodo del Figma (2026-07-23)** — pasada sobre **las 9 páginas públicas** (P01…P09)
  y el índice `/categories`. Método: JSON del nodo por REST (`FIGMA_API_KEY`) contra el DOM real
  medido en el navegador, no "a ojo de frame" como IV-03. Detalle por página en `docs/BACKLOG.md` §4.2.
  - [x] **P01 home** — ~25 desviaciones: rejilla a 1152 (afectaba a *toda* la app), `--muted-foreground`
    a `#4d4d4d`, degradado de la banda, chips que se despliegan al pasar el ratón, tarjeta de tutor,
    imágenes de los 3 pasos, FAQ abierta, tarjeta de cifras cabalgando el borde, carrusel de
    testimonios y logotipo del footer.
  - [x] **P02 about** — hero completo (degradado + ola + recorte), 2 badges flotantes, "En qué creemos"
    con fotos, testimonios y **FAQ propio** (salía el del home).
  - [x] **P03 cómo funciona** — hero con adornos, pasos como lista numerada **azul/naranja por rol**,
    frase de marca sobre negro, trust melocotón, FAQ a dos columnas.
  - [x] **P04 tutores** — tarjeta centrada con foto, paginación numerada, orden y filtro de
    disponibilidad (reglas de EP-05).
  - [x] **P05 clases** — tarjeta con miniatura + tutor, chips azules, orden por precio.
  - [x] **P06 categorías** — **una plantilla para `/categories` y `/categories/[slug]`**; filtros en
    fila; "Temas" cruza segunda categoría.
  - [x] **P07 perfil tutor** — **panel de reserva con calendario y horarios reales**, resumen de
    reseñas con histograma.
  - [x] **P08 detalle de producto** — imagen, "Cómo funciona", FAQ, resumen de reseñas y panel de
    compra con fecha/hora.
  - [x] **P09 búsqueda** — hero centrado, *segmented control*, tarjetas compactas, bloque "Explorar por
    categoría" con recuentos reales.
  - **Migraciones (4, aplicadas a dev):** `20260723120000` (DD-01/DD-02 + `home_stats` +
    `home_testimonials`), `20260723130000` (🐞 fix RLS), `20260723140000` (países desde la zona
    horaria), `20260723150000` (`get_available_slots` a `anon` para el calendario público).
  - ⚠️ **Decisiones para el cliente:** nombre + inicial del alumno en los testimonios (privacidad);
    publicar la **agenda del tutor** en la ficha pública; y que `/categories` use el diseño de P06 al
    no existir frame propio.

- **🎨 Repaso nodo a nodo de AL01 (2026-07-23)** — primera pantalla del **área con sesión**:
  `/onboarding` (US-201) contra `180:1275` / `149:2` / `150:2`.
  - [x] **Armazón del asistente** — el Figma parte la columna de **600 px** en cuatro bloques de 24:
    progreso, **título fuera de la tarjeta**, tarjeta blanca **solo con los campos** (r16, borde
    `#e6e6e6`, padding 28) y **botonera debajo**. Teníamos todo dentro de una tarjeta de 672 sin
    borde. Controles y botones a **45 px** (medían 32).
  - [x] **Header de onboarding** — sin "Panel" ni menú de cuenta, con **"Guardar y salir"** a la
    derecha. No era solo estético: `requireUser` rebota al asistente hasta terminarlo, así que el
    enlace al panel **no llevaba a ninguna parte**. `SiteHeader onboarding`, activado desde el layout
    de `(app)` leyendo `x-pathname`. Aplica también a **TU01**.
  - [x] **Zona horaria legible** — `(GMT-05:00) Lima` en vez de `America/Lima`, ordenada por offset y
    calculada con `Intl` (correcta con horario de verano, sin librería). Mejora también `/account`.
  - [x] **Teléfono con bandera y máscara** — `react-phone-number-input`, **única dependencia nueva**
    de todo el repaso: su `onChange` devuelve **E.164 puro**, que es lo que pide RN-44, mientras el
    campo muestra el formato de cada país. `<select>` nativo, 246 países en español, VE por defecto
    hasta cerrar **C-13**.
  - [x] **Detalle** — etiquetas 12.5/400, avatar de 64 con **iniciales** sin foto, "Subir foto"
    106×42, chips de intereses 38 px con azul sólido, y título neutro **"Te damos la bienvenida"**
    (el Figma dice "Bienvenida", en femenino).
  - ⚠️ **Para el cliente:** el Figma marca el teléfono **"(opcional)"** y **RN-44 lo exige** — se
    mantuvo la regla. Y "Tu objetivo principal" no existe en el modelo ni trae lista de opciones →
    hueco de EP-23. Sin ticket todavía.
  - **TU01 hereda el armazón** (`WizardShell` es compartido) pero sus pasos siguen con el maquetado
    viejo hasta su propia pasada.

- **🎨 Repaso nodo a nodo de AL02–AL08 (2026-07-24)** — las 7 pantallas del **panel del alumno**
  contra `155:2`/`159:2`/`165:2`/`169:2`/`173:2`/`174:2`/`177:2`. `PanelShell` compartido (menú
  lateral en las 7, tarjetas r16 con borde `#e0e0e0`, píldoras de estado, "Salir" rojo).
  - [x] **AL02 · 🐞 dos bugs de datos** — la reserva salía **duplicada** (lista armada desde
    `sessions`, no `bookings`) y una `pending_acceptance` mostraba **botón _Entrar a sala_**; y la
    fecha de las pendientes era `created_at` rotulada como hora de clase. Corregidos: una fila = una
    reserva, sala solo en `confirmed`/`in_progress`, fecha de la sesión.
  - [x] **AL03** — chat embebido en la columna derecha (antes enlace a `/chat/[id]`), tutor en
    cabecera, "Cancelar reserva" enlaza a la página AL07.
  - [x] **`/reservas` · 🐞 sin enlaces** — la lista no tenía **ni un `<a>`**; ahora cada fila enlaza a
    AL03. Hereda armazón y fila de AL02.
  - [x] **AL04** — calendario de **67×40** por celda (medía 103×103), tarjeta de horarios aparte con
    chips píldora, panel "Tu selección" con producto/tutor/total y "Continuar al pago".
  - [x] **AL05** — **tarjeta de crédito ilustrada** (degradado), columnas del Figma (360 | resto). Se
    mantiene **sin campos de tarjeta** (PCI-DSS: PAN nuestro = SAQ D; PAC-01/02 ya aprobadas).
  - [x] **AL06 confirmación** (`/reservas/[id]/confirmacion`) — **página nueva**, antes era un estado
    inline bajo el h1 "Confirmar pago". Redacción honesta: pendiente de aceptación, no "confirmada".
  - [x] **AL07 cancelación** (`/reservas/[id]/cancelar`) — **página nueva** con estimación de reembolso
    (RN-37) y motivo, sustituye al `window.confirm()`.
  - [x] **AL08 reseña** (`/reservas/[id]/resena`) — **página nueva** que sustituye al `ReviewDialog`.
  - ⚠️ **AL08 sin verificación viva**: el navegador integrado no completa el `signInWithPassword`
    cliente contra Supabase, así que no se pudo cambiar a una cuenta con reserva completada. Compila y
    el guard funciona; AL02–AL07 sí verificadas con DOM real a 1280.
  - ⚠️ **Para el cliente / EP-23:** el **motivo de cancelación** (AL07) no tiene columna en `bookings`
    → se captura pero no se persiste. Sin ticket todavía.
  - 🧹 **Huérfano:** `reservas/[id]/cancel-booking-button.tsx` ya no se usa (el sandbox bloqueó el
    `rm`; pendiente de borrar a mano).

- **🎨 Repaso nodo a nodo de TU01–TU09 (2026-07-24, nocturna autónoma)** — las 14 pantallas del
  área del tutor (TU01×5 pasos, TU02…TU09 + TU07b) contra sus frames. Todo el panel migró a
  `PanelShell`/`PanelCard`; `StatusPill` ganó los tonos de color del Figma. Verificado con la
  sesión real del tutor de prueba (TU01 p1 clava el Figma al píxel: columna y=178, tarjeta y=321,
  avatar 72). Detalle completo en `docs/BACKLOG.md` §4.2.
  - [x] **TU01** — 5 pasos con campos de 45 px, teléfono con bandera, nivel como select, CTA azul
    del paso 5.
  - [x] **TU02** — de página suelta a **dentro del panel**: filas de documento con píldoras de
    color y botones Subir/Reemplazar/Volver a subir; redes como tarjeta-enlace aparte.
  - [x] **TU03/TU04** — lista con miniatura + resultado + "Publicar" azul; form del panel con
    chips de modelo, nota azul de política única (RN-37) y doble acción Publicar/Guardar borrador.
  - [x] **TU05** — reglas agrupadas por día + **calendario del mes coloreado** (azul regla, ámbar
    excepción) server-rendered.
  - [x] **TU06** — 4 cifras en tarjeta con iconos, dos columnas, accesos rápidos como filas con
    flecha azul.
  - [x] **TU07+TU07b** — chips de filtro por URL y tarjetas con **cuenta atrás de 24 h** (RN-38)
    para las por-aceptar. Flujo Aceptar probado en vivo.
  - [x] **TU08 · ruta NUEVA** `/tutor/reservas/[id]` — datos, sala, **"Marcar completada"**
    (`complete_session`, US-802), cancelar y el chat con el alumno (RN-41).
  - [x] **TU09** — cifras, retiro, próximos payouts separados del historial, píldoras de color.
  - 🐞 **`/tutor/payouts` rebotaba a `/app`** para un tutor sin el ROL concedido: usaba
    `requireRole("tutor")` mientras el resto del panel usa `requireTutorProfile`. Alineado.
    (El fixture `tutor.us401` se aprobó a mano por SQL y nunca recibió el rol — así salió a la luz.)
  - ⚠️ **Huecos EP-23 nuevos** (tabla en BACKLOG §4.3): calendario de la clase y material por
    producto (TU04), cuenta de cobro (TU09), total bruto (TU06).

- **🎨 Repaso nodo a nodo de AD01–AD15 (2026-07-24, autónoma)** — el panel de administración
  completo. Detalle en `docs/BACKLOG.md` §4.2.
  - [x] **Chrome del admin** — píldora negra "Admin" en el header (modo por ruta) + `AdminFooter`
    claro "Panel interno". Menú reordenado al Figma.
  - [x] **AD02 · pantalla NUEVA** — `/admin` es ahora el dashboard (cifras del mes, colas de
    trabajo, reservas recientes); la cola de tutores se movió a **`/admin/tutores`** (AD03-04, con
    chips y conteos reales).
  - [x] **AD05/AD08/AD10** — detalles a dos columnas con logs derivados de timestamps reales.
  - [x] **AD13** — chips de período + **migración nueva de solo lectura**
    (`20260724120000_ad13_admin_charts`: `admin_gmv_weekly` + `admin_bookings_by_category`) para
    los dos gráficos del Figma, con barras CSS server-rendered. Aplicada a dev.
  - [x] **AD14 · pantalla NUEVA** — `/admin/alertas` **derivada de datos reales** (pagos fallidos,
    payouts en problema, cancelaciones). Sin "Marcar atendida" (no hay tabla de incidencias —
    hueco EP-23).
  - [x] **AD06-07/AD09/AD11/AD12/AD15** — reestiladas al patrón del panel (chips, cifras en
    tarjeta, filas con píldoras de color).
  - Decisiones documentadas: **AD01 no se construye** (el `/login` compartido ya enruta por rol,
    RN-31 se cumple) y **"Cancelar reserva" de AD10 tampoco** (no hay RPC de cancelación por
    admin; el camino de soporte es el reembolso US-704).
  - Verificado en vivo como admin fixture: AD02/AD05/AD13/AD14 con captura; el resto responde 200.

- 🐞 **`searchProducts` no traía el tutor** (EP-03, **sin ticket**). La tarjeta de P09 firma con
  "Tutor · ★ rating" y habría salido vacía en toda la búsqueda. ✅ Corregido extrayendo la hidratación
  a un helper compartido con el listado.

- **EP-23 · Datos que el diseño necesita y no existen** (`EY-110`) — DD-01…08 (`EY-111`…`EY-118`). **`EY-109` (buscar sin tildes) ✅ corregido y en prod.** `tutor_categories`/`student_interests`/`tutor_materials` (IV-02) son tablas nuevas que **no cierran ninguna DD**. **No bloquean el despliegue; bloquean la fidelidad al diseño.** Tabla completa en `docs/BACKLOG.md` §4.3.
  - [x] **DD-01** (`EY-111`) · nombre y foto públicos del tutor — migración `20260723120000`: `tutor_profiles.display_name` + `avatar_path`, copias **públicas** en la tabla que ya solo expone tutores `approved`. **`profiles` sigue privado**; el onboarding del tutor las vuelca y la migración siembra lo que ya había.
  - [x] **DD-02** (`EY-112`) · imagen del producto — misma migración: `products.image_path` + bucket público `product-images` con RLS por carpeta del tutor + campo de subida en el formulario.
  - [x] **DD-03…DD-08 · todas cerradas** (esta línea decía "siguen `To Do`" y se contradecía con el resto del documento):
    - **DD-03** (`EY-113`) · nivel + idioma por mentoría — migración `20260729190000`, commit `31a9ddd` (tanda 3).
    - **DD-04** (`EY-114`) · precio de entrada del tutor — `302ba82` (29-jul) y **rehecho el 4-ago** como vista `tutors_public` + rango continuo (`cccb566` + `96f4e0b`, migración `20260804120000`). Ver la tanda 1.
    - **DD-05** (`EY-115`) · nada que construir: el cruce con segunda categoría vive en `category-explorer.tsx` (decisión 26).
    - **DD-06** (`EY-116`) · `/terms`, `/privacy`, `/cookies` con armazón público — `8d8ddb2`. ✅ **Y con texto redactado desde el 6-ago** (`4cf2ca6` → `0b4ecdd` → `b957933`): describen la plataforma que existe, con los plazos leídos de las migraciones y los reembolsos importados de `lib/policy.ts`. Ver la sección del 5–6 de agosto.
    - **DD-07** (`EY-117`) · bandeja de mensajería — la cerró **R24-21** (`b09e518`): burbuja flotante solo con sesión (`chat-launcher.tsx` + `chat-bubble.tsx`).
    - **DD-08** (`EY-118`) · 🐞 seed de dev con ratings sin `reviews` — `211163a` (21-jul): `supabase/seed/ep09-demo-reviews.sql` inserta reservas completadas + reseñas y deja que el trigger calcule el rating.
  - ⚠️ **Semilla de dev sin aplicar:** `supabase/seed/p01-demo-images.sql` (miniaturas y fotos demo). Los ficheros ya están en los buckets; hay que **ejecutarlo a mano en el SQL Editor de dev** — los tutores demo no pueden iniciar sesión y la RLS impide que ni un admin escriba en el catálogo ajeno.

- 🐞 **Sin ticket todavía (EP-03) — el catálogo público de productos devolvía CERO sin sesión.** ✅ Corregido el 2026-07-23 (migración `20260723130000`); **falta abrirlo en Jira**. `products_select_booked` (migración del 22-jul) se creó **sin `to authenticated`**, así que también se evaluaba para `anon`, que no tiene grant sobre `bookings` → todo `select` anónimo sobre `products` moría con `permission denied for table bookings`. Home, `/classes`, `/search`, `/categories/[slug]` y el detalle salían vacíos **para quien no había iniciado sesión**; con sesión funcionaba, y por eso no se vio en IV-03. Verificado: `anon` pasa de 0 a 5 productos. **Llega a prod al mergear a `main`.**

- 🐞 **`EY-109` (en EP-03) — buscar sin tildes devolvía cero resultados.** ✅ **Corregido y en prod** (`Done`). **Hubo que arreglarlo dos veces:**
  - **1er intento (21-jul, migraciones `20260721120000` + `20260721130000`) — NO funcionó.** Indexó las dos ramas (con y sin tilde) en `products.search_vector`, pero el fallo no estaba en el índice sino en el **lado de la consulta**: el stemmer español de Snowball es sensible al acento, así que `programacion` nunca llegaba al stem `program` que sí produce `Programación`. En dev: `programacion` → 0 productos, `Programación` → 1.
  - **2ª vuelta (27-jul, `b032cc5`, migraciones `20260727120000` + `20260727130000`) — la buena.** Añade un camino **no-stemmed** en paralelo (texto sin acentos + `ilike` con índice de trigramas, el mismo patrón que ya usaban los tutores). El `search_vector` se queda como estaba: sigue dando la relevancia lingüística, esto solo cubre el tecleo sin tildes.
  - Al mergear a `main` con el resto (`57edfa9`) llegó a prod. Este documento acreditaba el arreglo al 21-jul: **no era ese**.

---

## Sprint 4 — Observabilidad · Responsive/QA · Grabación · Avisos · Lanzamiento

> **39 SP.** ⚠️ **Reordenado en la reunión del 17-jul** (`00:59:03` y `01:01:36`): los **referidos
> bajan a los dos últimos sprints** — el cliente aún no busca leads y el widget es trabajo *externo*
> (Referral Factory) que pararía el pulido de lo propio. Las **integraciones también van al final**.
> El sprint pasa a dedicarse a **pegar el desarrollo al diseño aprobado** y a los módulos backend ya
> validados, que son los que menos van a cambiar.

> ✅ **Las 8 historias están en código desde el 29-jul** — no se hicieron aquí sino en las **6 tandas**
> del plan de los sprints 6 AC · 7 · 8 (ver esa sección al final, que es donde está el detalle de
> ejecución). Se marcan aquí para que esta lista deje de contradecir al resto del documento.
> En Jira siguen en **`In Review`**, pero **la PR #11 ya está mergeada a `dev`** (`1a36da2`, 5-ago):
> para producción lo que falta es el merge `dev`→`main`.

- [x] **EP-12** US-1203 avisos in-app — `EY-77`, migración `20260729200000`, `ccb7058` (tanda 3)
- [x] **EP-15** US-1501 Sentry (`EY-80`, `eed746d`, **apagado hasta que haya DSN**) · US-1502 métricas pago/payout/webhook (`EY-81`, migración `20260729210000`, `ccb7058`)
- [x] **EP-16** US-1601 responsive (`EY-82`) · US-1602 QA + UAT (`EY-83`) — `6f84b45`, resultados en `docs/QA-LANZAMIENTO.md`. ⚠️ US-1601 es "que nada se rompa" a 360/768, **no el responsive del diseño**: los frames de tablet/escritorio siguen pendientes de Diana (decisión 24)
- [x] **EP-17** US-1702 descargar conversación — `EY-84`, `c53a949` (tanda 2)
- [x] **EP-18** US-1801 grabar con consentimiento (`EY-85`) · US-1802 ver/descargar 30 días (`EY-86`) — migraciones `20260729220000` + `20260729230000`, `bc35f9b`. [!] Sigue faltando el **go de coste**: el add-on de grabación de Daily no está activado
  - 🐞 **US-1802 no encontraba NINGUNA grabación** → ✅ `fffd4b5` (6-ago). Y **los 30 días ya se aplican de verdad** (`0722b64`, migraciones `20260806130000` + `20260806140000`): antes solo se cumplían "al servir". Ambos en la sección del 5–6 de agosto
- [x] ~~**EP-13** US-1301 widget Referral Factory · US-1302 captura `?ref=`~~ → se movió a los últimos
  dos sprints (17-jul) y **allí se cerró**: `EY-78` (`58161f2`) + `EY-79` (`cefb805`). Falta solo pegar
  `NEXT_PUBLIC_REFERRAL_URL`; la cuenta de Referral Factory ya está creada.

---

## Reunión 24-jul · Revisión con el cliente → Plan de acción (Sprints 4–7)

> **Qué es esto.** Ajustes y mejoras que salieron de la demo del **24-jul** (Emilio + Veronica + Jose).
> Fuentes: correo de Veronica *"AJUSTES [ENSÉÑAME YA] SESIÓN DESARROLLO"* (lista priorizada) + notas
> de Gemini (resumen + próximos pasos + detalles con timestamps).
> **Deadline duro:** demo al cliente **martes 2:30pm** — todo error visual/funcional resuelto para
> entonces. **Capacidad:** 50% Enséñame Ya / 50% BaileBen, **estabilidad primero**.
> **Marco de sprints de la reunión** (`01:17:46`): **S4 visual → S5 onboarding continuo (EP-21) →
> S6 activación comercial (EP-20) → S7 integraciones finales**.
> Handles `R24-xx` = trazabilidad interna; cada uno se abre como historia en su épica en Jira.

### Impacto en lo ya entregado (ojo antes de tocar)
- **Verificación de identidad entra al onboarding** (penúltimo paso, `00:38:38`) reutilizando el
  módulo TU02. El **borrador / enviar a revisión** que se construyó el 24-jul (migraciones
  `20260724130000` + `20260724130100`, estado `draft`) **encaja de una**: los pasos guardan borrador
  y el último envía a revisión. La página suelta `/tutor/verification` se queda para re-subir
  documentos rechazados. → **R24-15**.
- **Switch Aprender/Enseñar siempre visible** (commit `ac4604a`) **validado por el cliente**
  (`00:31:39`, "sale siempre" → "Buenísimo"). Solo se le antepone la **pantalla cero** (R24-11).
- **Materiales de clase** salen del onboarding y se mueven a la **creación de la oferta** (TU04) → R24-16.

### 🅐 Antes del martes — pulido visual + estabilidad (Sprint 4) · ✅ **COMPLETA (26-jul)**

> **12/12 hechas, verificadas en dev y en `main`/`dev`.** Commits abajo. Los dos
> sub-ítems que quedaban ya están cerrados: la disponibilidad **pública sin sesión**
> se resolvió con R24-22 (tz del visitante), y el "año/ñ cortado" de R24-02 se
> **descartó el 29-jul** — no se reprodujo en ninguna pantalla y Jose no lo
> reconoce: fue un apunte erróneo de la reunión. Su tarjeta (`EY-121`) se borró
> de Jira; el hover, que sí era real, quedó hecho en `e9813a4`.

| Handle | Estado | Commit | Nota de ejecución |
| :-- | :-- | :-- | :-- |
| **R24-01** | ✅ | `4bd2e51` | `Container` cap 1280→1664 (contenido fluido a 1536); fondos ya sangraban. Verificado 1920/1280. **Paneles quedan a 1280** (decisión B) |
| **R24-02** | ✅ | `e9813a4` | Realce naranja de `TrustCards` como hover, no fijo |
| **R24-03** | ✅ | `48f5b7c` | Componente `CategoryIconChips` (icono+hover+"Ver todas") en /tutors, /categories, /search y home (DRY) |
| **R24-04** | ✅ | `9adf34d` | 🐞 `search_text` del tutor incluye `display_name` (migración `20260724140000`, en prod) |
| **R24-05** | ✅ | `eb62987` | `suggestSearch` + `/api/search/suggest` + `SearchAutocomplete` en el header, orden por sección actual |
| **R24-06** | ✅ | `f47286f` | Precio grande + unidad debajo en `ProductCard` |
| **R24-07** | ✅ | `bd3801c` | "Mi cuenta" en `PanelShell` (sidebar por rol) + módulos foto/nombre/correo/contraseña. Pagos → R24-20 |
| **R24-08** | ✅ | `e0a459a` | Historial del tutor en orden inverso (AD05) |
| **R24-09** | ✅ | `e0a459a` | Crear/editar tiers en `Dialog` (AD12) |
| **R24-10** | ✅ | `0ec2aba` | "+ Añadir" por día en disponibilidad; fuera el form global |
| **R24-11** | ✅ | `05c2b47` | Pantalla cero "Conviértete en tutor YA" (`?start=1` → wizard) |
| **R24-12** | ✅ | `4acdbcf` | 🐞 Horas en la tz del usuario (`getUserTimezone` + `timeZone` en los pages server). Verificado México vs Caracas |

#### Backlog original (referencia)

| Handle | Ítem | Épica | Esf. | Nota |
| :-- | :-- | :-- | :-- | :-- |
| **R24-01** | **Full-width en TODO el sitio** (no solo Home/Nosotros) + video de fondo Home/Nosotros | EP-22/16 | **L** | ⚠️ **Validar antes de aplicar** — ver nota abajo. Hoy el `Container` (1152) encajona todo |
| **R24-02** | Hover roto en Nosotros ("tranquilidad garantizada") + márgenes | EP-22 | S | El acento naranja debe ser hover, no estático (`00:24:35`) |
| **R24-03** | Burbujas de categoría: colapsar a **solo íconos hasta hover/selección** (como el home) + límite / "ver más" / scroll | EP-03/22 | S/M | Evita 50 burbujas al crecer el catálogo (`00:10:14`) |
| **R24-04** | 🐞 **Buscar por nombre de tutor** (hoy solo por habilidad; "Emilio" no salía) | EP-03 | S/M | Medio bug medio mejora (`00:06:53`) |
| **R24-05** | **Buscador global con sugerencias** desplegables subdivididas (Tutores/Clases/Categorías), ~4, empezando por la sección actual | EP-03 | M | Estilo "Emilio \| Clases de Emilio" |
| **R24-06** | Tarjeta de mentoría: **título arriba, precio abajo** | EP-22 | S | El precio no destaca (`01:00:41`) |
| **R24-07** | **Página "Mi cuenta"** (estudiante): menú lateral izq. + módulos (nombre, correo, contraseña, foto). Hoy abre el panel viejo | EP-01 | M | Hueco real; perfil = "Mi cuenta" (`00:31:39`) |
| **R24-08** | Admin: **historial del tutor en orden inverso** | EP-11 | S | (`00:53:44`) |
| **R24-09** | Admin: **botón crear/editar tiers** que abra un modal | EP-11 | S | (`00:56:47`) |
| **R24-10** | **Edición rápida de disponibilidad**: botón "editar" al lado de cada día | EP-05 | S/M | En vez del módulo global (`00:48:09`) |
| **R24-11** | **Pantalla cero** "Todavía no tienes cuenta de tutor, conviértete en tutor YA" antes del onboarding | EP-21 | S | Cierra el flujo del switch |
| **R24-12** | 🐞 **Bug zona horaria**: las clases muestran la hora del servidor, no la del usuario (México vs Venezuela) | EP-05/16 | M | RN-01/02 · RISK-12. Estabilidad, no cosmético (`01:03:30`) |

### 🅑 Post-demo — estructural (Sprints 5–6) · ✅ **COMPLETA (27-jul)**

> **11/11 hechas y verificadas en dev.** Migraciones nuevas aplicadas a dev y a
> prod por CI: `20260724150000` (materiales por producto), `20260724160000`
> (auto-aceptar), `20260724170000` (fotos independientes), `20260724180000`
> (FAQ por producto).

| Handle | Estado | Commit | Nota de ejecución |
| :-- | :-- | :-- | :-- |
| **R24-13** | ✅ | `af02c7c` | Calendario global del tutor → día → **clase** (solo las que tienen hueco ese día) → horarios. CTA off hasta elegir clase |
| **R24-14** | ✅ | `af02c7c` | Sin precio fijo: "Reserva con este tutor"; el importe sale al elegir clase (verificado 22,00 vs 18,00 US$) |
| **R24-15** | ✅ | `39b40d5` | Verificación de identidad como **penúltimo paso** del onboarding, reusando TU02 + su borrador |
| **R24-16** | ✅ | `3f6181d` | Materiales por **producto** (fuera del onboarding); wizard de 6 → 5 pasos |
| **R24-17** | ✅ | `facf5a7` | `products.faqs`: FAQ por mentoría con editor en TU04; fallback a las genéricas |
| **R24-18** | ✅ | `013e6e7` | Banner "perfil aprobado" hasta 5 sesiones dictadas |
| **R24-19** | ✅ | `8fb18e4` | `auto_accept_bookings` + `confirm_payment` v3 (pagado → `confirmed`); toggle en TU07. ⚠️ **Superado por M-02**: el ajuste bajó a la mentoría (`products`), el toggle de TU07 se retiró y la columna `tutor_profiles.auto_accept_bookings` se borró (`20260827200000`) |
| **R24-20** | ✅ | `40b5e8a` | Módulo `/pagos` propio + entrada en el menú; fuera de "Mi cuenta" |
| **R24-21** | ✅ | `b09e518` | Bandeja flotante de chat **solo con sesión** (RN-41); reconcilia el FAB con la nota de diseño |
| **R24-22** | ✅ | `f15df19` | Horarios públicos en la tz del visitante (cookie `ey-tz` + `getViewerTimezone`). 🐞 `TZ_COOKIE` en `"use client"` → todo salía en UTC |
| **R24-23** | ✅ | `20554c1` | Fotos alumno/tutor independientes (fichero propio + se deshace la herencia DD-01) |

#### Backlog original (referencia)

| Handle | Ítem | Épica | Esf. | Nota |
| :-- | :-- | :-- | :-- | :-- |
| **R24-13** | **Selector de clase en el calendario** + reserva directa (clase → día → horario), disponibilidad atada a la clase | EP-05/06 | **L** | El grande: hoy la disponibilidad es por-tutor; ligarla por-producto (`00:12:49`) |
| **R24-14** | **Precios dinámicos**: quitar el precio fijo del calendario; calcular al elegir clase+horario | EP-06 | M | Acoplado a R24-13 (`00:17:43`) |
| **R24-15** | **Verificación como penúltimo paso del onboarding** (reutiliza TU02 + su borrador/envío) | EP-02/21 | M | Ya soportado por el `draft` del 24-jul |
| **R24-16** | **Materiales de clase**: de onboarding → creación de la oferta (TU04) | EP-04/21 | S/M | |
| **R24-17** | **FAQ por mentoría**: el tutor las define al crear la clase (hoy genéricas de plataforma) | EP-04/23 | M | Necesita modelo de datos (FAQ por producto) (`00:20:26`) |
| **R24-18** | **Notificación "perfil aprobado"** al tutor | EP-12 | S | ⚠️ Aclarar "las primeras 5 sesiones" (ambiguo) (`00:55:18`) |
| **R24-19** | **Aceptar clases automáticamente** (toggle por tutor, no solo manual) | EP-06 | S/M | Toca el accept de TU07 (`respond_booking`) |
| **R24-20** | **Módulo de métodos de pago** independiente de "Mi cuenta" | EP-07 | S/M | (`01:05:19`) |
| **R24-21** | **Chat como burbuja flotante** abrible | EP-17 | S/M | ⚠️ Reconciliar con `chat-fab-error-diseno` (solo con sesión, tipo bandeja) |
| **R24-22** | **Sin sesión: horario por ubicación** del usuario (IP/geo) | EP-03/16 | S/M | (`00:29:00`) |

### 🅒 Bloqueados / ops en paralelo (no gatean el dev)

| Ítem | Épica | Estado |
| :-- | :-- | :-- |
| Cuentas de prueba DLocal + Stripe del cliente | EP-20 | 🔒 Veronica las pide al cliente |
| Webhooks DLocal/Stripe (trazabilidad de órdenes, reclamos bancarios) | EP-07/20 | Tras las cuentas (`01:26:55`) |
| Métodos de pago Venezuela (tarjetas, cripto, Binance, PayPal) | EP-07 | Decisión C-01/C-13 (`01:22:55`) |
| Sentry (monitoreo de errores) | EP-15 | Se puede arrancar ya (US-1501) |
| Responsive tablet/escritorio | EP-16 | ⏳ Diana entrega diseños la próxima semana |
| Marcar inicio/cierre de sprints 4–7 en Jira | ops | Jose |
| Enviar enlace de dev a Emilio | ops | Jose |
| Selector de idioma (burbuja de traducción) | — | 💰 Costo extra, Emilio negocia con el cliente |

### ⚠️ Full-width (R24-01) — validar ANTES de aplicar a cada página
El cliente aclaró que el ancho completo es de **todo el sitio**, no solo Home/Nosotros — así está en
Figma. Pero **no es "quitar el `max-width` y ya"**: `src/components/layout/container.tsx` fija hoy
`max-w-[1280px]` (1152 de contenido, la rejilla del Figma) y lo importan ~10 páginas. El contenido de
lectura (formularios, texto largo) **debe conservar su columna**; solo van a sangre completa las bandas
que el diseño marca full-bleed (heros, secciones con fondo/vídeo).
**Tarea previa (bloquea la aplicación):** repaso del Figma **página por página** clasificando cada
sección `full-bleed` vs `contenida`, y decidir si el cambio es (a) un modo del `Container`
(`bleed`/`contained`) o (b) mover el `Container` hacia dentro de cada sección. Recién con esa matriz se
aplica. Es del mismo tipo que el repaso nodo a nodo que ya hicimos (medir Figma vs DOM), pero de layout.

### Decisiones cerradas — respuestas del cliente (24-jul)
> Respondidas por Jose el 24-jul. **Supersede** las notas sueltas "⚠️ Para el cliente" de S1–S3 y de
> los repasos nodo a nodo (teléfono opcional, motivo de cancelación, nombre en reseñas, revocación de
> tutor, responsive, agenda pública). Se consumen como **configuración** (regla de oro 8).

| # | Decisión | Respuesta | Acción / handle |
| :-- | :-- | :-- | :-- |
| 13 | Geolocalización de zona horaria | **SÍ, autodetección.** Zona horaria + país-teléfono automáticos al entrar (no bloqueados, editables). Y **convertir la hora de la sesión a la zona del que la ve**, incluso **sin sesión** | R24-12/R24-22. ⚠️ *Nota técnica abajo:* se logra con `Intl` del navegador + `country_from_timezone()`; geo-IP solo si se quiere más precisión de país |
| 14 | Burbujas de categoría | **Colapsar a íconos** (como el home) + **hover** que expande + botón **"ver más"**, en toda vista de categorías | R24-03 |
| 15 | Chat flotante | **Burbuja abrible SOLO con sesión**, tipo bandeja (LinkedIn): ver/abrir los chats con el tutor **sin entrar a la sesión** | R24-21 (alineado con `chat-fab-error-diseno`) |
| 16 | Notificación "aprobado" | **Banner en el dashboard del tutor**: al aprobar, banner "has sido aprobado" que se mantiene **hasta que dicte 5 sesiones**, luego desaparece (como el banner de "carga documentos" en pendiente) | R24-18 · condición `approved ∧ sesiones_dictadas < 5` |
| 17 | Foto estudiante/tutor | **Separadas y 100% independientes** (sin herencia): foto de alumno y foto de tutor por su lado; sin foto de tutor → **iniciales** | **R24-23 (nuevo)** · quitar el `coalesce` de DD-01 (`20260723120000`); el modelo ya tiene 2 columnas |
| 18 | Nombre del alumno en reseñas | **"Nombre + inicial" con consentimiento**; anónimo hasta tener el flujo de consentimiento | Nuevo · reseñas firmadas (DD) con gate de consentimiento |
| 19 | Agenda pública del tutor | **Se publica** la disponibilidad | ✅ ya cableado (P07) |
| 20 | Teléfono en onboarding | **Obligatorio** (RN-44 manda sobre el "(opcional)" del Figma) | ✅ ya cableado (RN-44) |
| 21 | Revocar tutor al re-subir/rechazar doc | **Manual** (el admin lo rechaza) | ✅ comportamiento actual; auto queda como opción futura |
| 22 | Retención del chat | **30 días + descarga** (`.txt`/`.json`) antes de purgar | Reactiva US-1702 + US-1703 |
| 23 | Motivo de cancelación (AL07) | **Persistir** en `bookings.cancel_reason` | Nuevo · EP-23 |
| 24 | Responsive | **Esperar a Diana** (tablet/escritorio la próxima semana) | EP-16 |
| 25 | Nivel e idioma del producto | **Añadir por mentoría** (distinto del nivel del tutor) | DD-03 |
| 26 | Subcategorías / "Temas" | **Cruce de 2+ categorías** (las categorías siguen **planas**, S-13) | DD-05 (reducida) |
| 27 | FAQ | **Por producto**: el tutor las define al crear la mentoría | R24-17 |
| 28 | Cuenta de cobro del tutor (TU09) | **Pendiente** (depende del PSP/EP-20) | 🔒 espera EP-20 |
| 29 | Incidencias / "marcar atendida" (AD14) | **Crear tabla de incidencias** | Nuevo · EP-23/AD14 |
| 30 | "Tu objetivo principal" (AL01) | **Campo con lista de opciones (confirmada)** | EP-23 · lista confirmada (ver abajo) |

**Ítems de trabajo nuevos que abren estas respuestas** (para Jira):
- **R24-23** · fotos **100% independientes** alumno/tutor (EP-01/02) · quitar el `coalesce` de DD-01
- Reseñas firmadas **nombre + inicial** + flujo de consentimiento (DD, EP-09)
- `bookings.cancel_reason` — persistir motivo (EP-23)
- Chat: retención **30 d + descarga** — reabre US-1702/US-1703
- Nivel + idioma **por producto** (DD-03) · "Temas" = cruce N–M (DD-05)
- **Tabla de incidencias** para "marcar atendida" (EP-23/AD14)
- Campo **"objetivo principal"** + su lista (EP-23) — lista confirmada (6 opciones, ver abajo)

> **⚠️ Nota técnica sobre 13 (geolocalizador):** todo lo que describes (zona horaria automática,
> +código de teléfono automático, y convertir la hora de la sesión a la del espectador **sin sesión**)
> se logra **sin permiso de ubicación ni API externa**: `Intl.DateTimeFormat().resolvedOptions().timeZone`
> da la zona del navegador y `country_from_timezone()` (ya existe) deriva el país para el teléfono. El
> **geo-IP real** solo añadiría precisión cuando una zona horaria mapea a varios países (p. ej. varias
> zonas de EE. UU.). **Confirmado (Jose, 24-jul): vía navegador** (cero fricción, sin popup de permiso);
> geo-IP queda como mejora futura opcional.

> **Lista confirmada para "Tu objetivo principal" (30):** Reforzar o aprobar una materia ·
> Prepararme para un examen o certificación · Aprender una habilidad nueva · Mejorar en mi trabajo o
> carrera · Practicar un idioma · Interés o hobby personal.

### Decisiones de pago pendientes (bloque 1–12)
Siguen abiertas las del **cliente** (tracker `C-xx`): C-13 mercado/Venezuela + métodos, C-07 ventana de
pago, C-02 retención, C-04 agrupación payout, C-05 no-show, C-06 checkout invitado, C-09 tiers, C-11
email, C-12 opt-out, C-15 FX, C-10 referidos. C-01 ✅ (DLocal+Stripe) — falta solo **cuentas/API keys**.
**C-14 también está cerrada** (7 documentos de KYC, migración `20260715130000`).

## Pulido del 27–28 de julio (fuera de R24 y de R29)

> **Qué es esto.** Entre cerrar la fila 🅑 (27-jul) y los comentarios del 29-jul entraron **16 commits**
> que no llevaban handle `R24-xx` ni `R29-xx` y que este documento no recogía. Van aquí para que el
> historial no tenga un hueco de dos días. Todos están en `main` desde el merge `57edfa9`.

| Commit | Fecha | Qué |
| :-- | :-- | :-- |
| `b032cc5` | 27-jul | 🐞 **`EY-109` de verdad** — camino no-stemmed + trigramas (migraciones `20260727120000` + `20260727130000`). El arreglo del 21-jul no funcionaba; detalle en EP-03 |
| `66f70e0` | 27-jul | **UX-204** (`EY-101`): el asistente del tutor no se cierra sin **≥1 oferta creada** |
| `8da5ab2` · `837c724` | 27-jul | Header: buscador centrado; peso de "Crear cuenta" y color del placeholder según Figma |
| `9179d29` | 27-jul | CI: **fijada la versión de la CLI de Supabase** — el job caía por rate limit al resolver "latest" |
| `640c7f1` | 28-jul | Buscador del **hero de P01** con sugerencias (+ realce y menú) |
| `68e21f0` · `2b893bc` · `14d8b52` | 28-jul | El buscador **acota al módulo desde el que buscas**: en `/classes` busca mentorías, en `/categories` busca categorías. Antes daba siempre lo mismo mirases donde mirases |
| `b3eaa21` | 28-jul | Filtro **por categoría en `/search`** |
| `143e108` | 28-jul | 🐞 Los desplegables se pisaban entre sí → **uno abierto a la vez** |
| `8e3a893` | 28-jul | El **prefijo del teléfono sigue a la zona horaria** en el onboarding (cierra el bucle de la decisión 13) |
| `23906bc` | 28-jul | Los **documentos del tutor, accesibles desde el panel** (TU02 estaba solo dentro del asistente) |
| `b758a7d` | 28-jul | 🐞 El header del asistente **se quedaba pegado** al volver al panel |
| `a22a0c1` | 28-jul | El menú de cuenta enseña **quién eres**, no con qué correo entraste |
| `125f3b7` | 28-jul | El menú lateral **sigue al panel del que vienes** + confirmación al salir |

## Comentarios de desarrollo 29-jul → Plan de acción (`R29-xx`)

> Cuatro observaciones sobre lo ya entregado. Analizadas contra el código el **29-jul**; las dos
> lecturas ambiguas quedaron resueltas por Jose en la misma sesión (ver 🔸 abajo).

| Handle | Ítem | Dónde toca | Esf. | Estado |
| :-- | :-- | :-- | :-- | :-- |
| **R29-01** | Precio **fuera del calendario** → abajo, junto al CTA; arriba el **título de la clase** | `components/catalog/booking-panel.tsx` (P07/P08 a la vez) | S | ✅ |
| **R29-02** | Redes + portafolio en **un solo módulo**: 1ª obligatoria con selector, hasta 5, links externos libres | `tutor/verification/verification-form.tsx` + quitar del paso 3 de `tutor-onboarding-form.tsx` | M | ✅ |
| **R29-03a** | "Métodos de pago" **fuera del menú del tutor** (es de alumno: yo cobro, no pago) | `components/layout/app-sidebar.tsx:64` | XS | ✅ |
| **R29-03b** | "Información de pago" del tutor = **cuenta de cobro** | `tutor/payouts` | S | 🔸 **Partido**: el **bloque informativo** ✅ hecho (`d03dd86`, tanda 1); la **cuenta de cobro real** aplazada a EP-20 |
| **R29-04** | Crear/editar categorías en **modal**, como tiers (R24-09) | `admin/categorias/category-manager.tsx` | S | ✅ |

**Detalle de ejecución**

- **R29-01** — hoy el importe es lo primero *dentro* de la tarjeta del calendario (`booking-panel.tsx:148-188`).
  Arriba pasa a ir `chosen.title`; el precio (+ `perSessionLabel` en paquetes) baja pegado al CTA
  (`:324-336`). No necesita estado: el panel se re-renderiza por URL (`?p=&d=`), así que el precio ya
  sigue a la clase elegida. Un solo componente ⇒ arregla `/products/[id]` y `/tutors/[id]` de una.
  🔸 **Decidido (Jose, 29-jul):** abajo del **panel**, junto al CTA — no una banda full-width al pie
  de la página, que duplicaría el botón.
- **R29-02** — los links se piden **en dos sitios**: paso 3 del asistente (LinkedIn + Instagram →
  `tutor_profiles.socials`) y el módulo de verificación (un enlace suelto → doc `social_media`).
  Se unifica en el módulo de verificación, que ya vive **en la carga de documentos y en el paso 4**
  del asistente: una implementación, dos sitios. Filas `plataforma + enlace`, la primera obligatoria,
  "Añadir otra" hasta 5, con opción **Sitio web / Portafolio** para links externos de cualquier tipo.
  **Sin migración:** `socials` ya es `jsonb` con sus grants; pasa de `{instagram, linkedin}` a
  `[{platform, url}]` con parser tolerante a la forma vieja. El admin ya pinta `socials`
  (`admin/tutores/[id]:99`), así que el doc `social_media` deja de usarse.
  ⚠️ **Pendiente de confirmar con el cliente:** se implementó bloqueando solo *"enviar a revisión"*;
  el paso 4 del asistente sigue siendo no bloqueante a propósito (borrador + continuar, R24-15).
  Cambiarlo al otro criterio es una condición en `next()`.
  **Sí hizo falta migración** (`20260729120000`), aunque no de esquema: `socials` pasa de objeto a
  lista, el enlace que vivía como documento `social_media` se copia dentro, y **se borran esas filas**.
  El borrado no es cosmético: `refresh_identity_status` agrega TODOS los documentos del tutor, así que
  un `social_media` en `rejected` dejaría su identidad clavada sin formulario donde re-enviarlo —
  el mismo motivo (y el mismo precedente) que la limpieza de C-14 en `20260715130000`.
- **R29-03** — `/pagos` es card-on-file del alumno (RN-43) y su copy lo dice; no tiene sentido en el
  panel del tutor. Quitándolo de `TUTOR_ITEMS` el tutor lo sigue viendo **desde el panel de alumno**
  gracias al switch (`lib/auth/panel-items.ts`), que es la semántica correcta.
  🔸 **Decidido (Jose, 29-jul): 3b se parte en dos.** La cuenta de cobro no existe en el esquema y su
  forma la define el PSP (C-01 ✅ DLocal+Stripe, pero **sin cuentas/API keys**). Así que:
  - ✅ **Hecho** (`d03dd86`, tanda 1): el bloque **"Información de pago"** en `/tutor/payouts` con el
    estado real, sin migración ni datos bancarios que el onboarding del PSP acabaría reemplazando.
  - 🔒 **Aplazado a EP-20**: la **cuenta de cobro de verdad** (dónde se le paga al tutor). Por eso
    `EY-147` sigue `To Do` en Jira aunque su mitad no bloqueada esté en código.
- **R29-04** — `category-manager.tsx` mantiene el formulario inline fijo que tiers ya jubiló en
  R24-09. Se copia el patrón de `tier-manager.tsx:52-69,176-250` (estado `open`, `openNew`/`openEdit`,
  cabecera con contador + "Nueva categoría", campos dentro del `DialogContent`). Sin dependencias nuevas.

**Orden:** R29-04 + R29-03a (un commit) → R29-01 → R29-02 (commit propio, toca datos) → R29-03b con EP-20.

**Verificado en dev (29-jul)** — R29-04: modal de alta con el borrador limpio, "Editar" precarga
(`Editar "Matemáticas"`, slug y orden), el slug sigue al nombre sin tildes ni ñ
(`Prueba Ñandú R29` → `prueba-nandu-r29`), alta real + toast + contador 10→11, y la fila de prueba
borrada después. R29-03a: el menú del tutor queda Dashboard · Mis mentorías · Disponibilidad ·
Reservas · Payouts · Verificación · Cuenta, y el **mismo** usuario sigue abriendo `/pagos` con el menú
de alumno. Sin errores de consola.

**Verificado en dev (29-jul) — R29-01:** el panel queda `título → calendario → clase → horarios →
Precio → CTA`. En P07 con dos clases (`portugues` 22 US$/hora ↔ `ingles` 18 US$/hora) el título y el
precio cambian juntos al cambiar de clase, sin estado de cliente. Sin clase elegida sigue sin haber
precio en ninguna posición (R24-14 intacto): "Reserva con este tutor" + la nota. En P08 el pie muestra
`120,00 US$ / paquete` + `Equivale a 15,00 US$ por sesión · 8 sesiones`; el desglose por sesión solo se
pinta en P08. Comprobado a 375 px. Sin errores de consola.

**Verificado en dev (29-jul) — R29-02:** migración aplicada a dev. Guardar con URL y sin plataforma
avisa «Elige la plataforma de cada enlace» (el selector es obligatorio de verdad); con LinkedIn +
«Sitio web / Portafolio» guarda, y los dos enlaces siguen ahí tras recargar. El tope de 5 aguanta
8 clicks seguidos en «Añadir otra» (el guard vive en el updater, no en el render). En el admin
conviven las dos procedencias: `Instagram: @fixture_us1101` (forma vieja) y
`Otro: https://instagram.com/tutor_demo` (el que era documento), y `social_media` ya no aparece entre
los documentos. Los handles legados sin `http` se muestran sin enlazar. El paso 3 del asistente ya no
pide enlaces; el paso 4 monta el mismo módulo (ambas cuentas tutor de dev están aprobadas, así que ese
paso queda cubierto por tipos + el módulo verificado en su otro punto de montaje, no en vivo).

---

## Sprints 6 AC · 7 · 8 — plan de ataque (29-jul)

> **Qué es esto.** Los tres sprints que quedan abiertos en Jira. Verificado contra Jira el 29-jul:
> **20 tickets abiertos en todo el proyecto**, y los 20 están en estos tres sprints. No hay nada
> suelto fuera de sprint — cerrar estos 20 es cerrar el MVP.
>
> ⚠️ **Foto del 29-jul.** Al 4-ago los 15 de los sprints 7 y 8 están en **`In Review`** (código hecho,
> esperando merge) y **han aparecido tickets nuevos** que no estaban en aquel inventario — ver
> "**Dónde está todo (4-ago)**" al final.

| Sprint | Tickets | Estado real |
| :-- | :-- | :-- |
| **6 AC** · Activación comercial | 5 (`EY-93…96`, `EY-147`) | 🔒 bloqueado por cuentas/API keys — **con un matiz, ver abajo** |
| **7** · Datos + observabilidad + chat + grabación | 11 (`EY-76,77,80,81,84,85,86,113…116`) | Todo ejecutable hoy; la grabación pide un go de coste |
| **8** · Referidos + responsive + QA | 4 (`EY-78,79,82,83`) | Referidos ✅ **desbloqueados** (cuenta RF creada); responsive espera diseños |

### 🔎 Lo que el inventario destapó

**1) Cuatro compromisos del 24-jul sin ticket y sin código** → ✅ **HECHOS (29-jul, `0b710b1`)**.
Las respuestas del cliente (decisiones 18/23/29/30) se anotaron "para Jira" y nunca se crearon.
**No se abrieron tickets: se resolvieron en código** (decisión de Jose, 29-jul).

| Compromiso | Dec. | Cómo quedó |
| :-- | :-- | :-- |
| Motivo de cancelación | 23 | `bookings.cancel_reason` (migración `20260729140000`), lo escribe `cancel_booking` con un parámetro opcional, y sale en el log de AD10. Sin enum: la lista es de producto |
| "Marcar atendida" en AD14 | 29 | `alert_acks` (`20260729170000`) — **el acuse, no una copia de la incidencia**: las alertas se derivan de pagos/payouts/reservas y duplicarlas daría dos versiones del mismo hecho. Se apartan de la lista, se revisan y se reabren |
| "Tu objetivo principal" | 30 | `profiles.primary_goal` con check de las seis opciones confirmadas (`20260729160000`) + select en AL01 p2 |
| Reseñas firmadas | 18 | `reviews.author_display` (`20260729150000`): copia enmascarada escrita por `submit_review` **solo con consentimiento**; `profiles` sigue cerrado y la consulta pública deja de tocarlo. Regla de enmascarado compartida en `mask_person_name()` |

⚠️ **Cambio visible en la home:** los testimonios firmaban con el nombre de cualquier alumno **sin
habérselo preguntado**. Ahora salen como "Alumno" hasta que alguien marque la casilla al reseñar —
que es justo lo que pedía la decisión 18, pero conviene saber que la home se ve distinta.

**2) `US-1302` ya está hecho.** `?ref=` se captura en `signup/page.tsx:25` y se persiste en
`signup-form.tsx:82-88`. Falta solo verificar la rama OAuth y la de confirmación por correo. El
ticket es de verificar y cerrar, no de construir.

**3) `DD-05` está resuelta por la decisión 26.** Las categorías siguen planas (S-13) y "Temas" ya
cruza una segunda categoría en `CategoryExplorer`. Verificar y cerrar.

**4) Sprint 6 AC no está 100% bloqueado.** Los cuatro PAC tienen **una pata Stripe y otra DLocal**:
- **Stripe:** las claves de *test mode* son self-serve y gratuitas — no hace falta la cuenta comercial
  del cliente para construir y verificar checkout alojado, tokenización, firma de webhook y adaptador.
  Pasar a la cuenta real del cliente después es **cambiar variables de entorno**, no código.
- **DLocal:** su sandbox va detrás de contrato comercial. Esa pata sigue dura.
→ **Decisión para Jose:** si se abre una cuenta Stripe en test mode, Sprint 6 AC pasa de 0 a ~50%
ejecutable en paralelo. Si no, los 5 tickets se quedan quietos y no se toca nada (nada de adaptadores
especulativos "para cuando lleguen las claves": eso es la regla de oro 8).

### 📋 Orden de ejecución

**Tanda 1 · barrer lo barato** · ✅ **COMPLETA (29-jul)** — rama `feat/tanda1-cierres`,
6 commits, `lint` + `typecheck` + build de producción en verde. _(La rama siguió creciendo con las
tandas 2–6 y la limpieza de agosto: hoy son **25 commits**.)_

| Ticket | Estado | Commit | Nota de ejecución |
| :-- | :-- | :-- | :-- |
| `EY-115` DD-05 | ✅ verificada | — | El cruce con segunda categoría vive en `category-explorer.tsx:83-90` (decisión 26). Nada que construir: **cerrar en Jira** |
| `EY-79` US-1302 | ✅ | `cefb805` | **Tenía dos agujeros de verdad**, no era solo verificar. Ver abajo |
| `EY-116` DD-06 | ✅ | `8d8ddb2` | Las 3 rutas responden 200 con el armazón público. Texto legal pendiente del cliente, dicho en pantalla |
| `EY-114` DD-04 | ✅ **rehecho el 4-ago** | `302ba82` → `cccb566` + `96f4e0b` | 1ª versión: tramos fijos del Figma (386:968), sin migración. **Incumplía la decisión que Jose dejó en el comentario del ticket el 29-jul** → rehecho como **rango continuo con escala logarítmica** sobre la vista `tutors_public` (migración `20260804120000`). Detalle en "**Dónde está todo (4-ago)**", al final |
| `EY-147` R29-03b | ✅ (la mitad no bloqueada) | `d03dd86` | "Información de pago" con estado real; la cuenta de cobro vuelve con EP-20. **El ticket sigue `To Do`** en Jira, con razón: le falta esa mitad |
| `EY-80` US-1501 | ✅ | `eed746d` | Sentry cableado y **apagado hasta que haya DSN** (credencial-interruptor, como Daily) |

**`US-1302` no estaba hecho, estaba a medias — y fallaba en silencio.**

- Con **confirmación de correo activa** (que es como está la nube) el alta no devuelve sesión, así que
  el `update` del formulario **nunca corría**: el código se quedaba en el metadata del usuario y no
  llegaba al perfil. Ahora lo copia `handle_new_user` (migración `20260729130000`), que es donde se
  copian `full_name` y `timezone`.
- El alta **por Google** perdía el código: no viajaba en la URL de vuelta. Ahora va como `?ref=` y AU04
  lo graba sólo si el perfil no tiene uno (una atribución no se pisa en cada login).
- Y el enlace del referidor **rara vez apunta a `/signup`**: el proxy guarda el `?ref=` de cualquier
  página en la cookie `ey-ref` y el registro la lee de respaldo.

Verificado en dev por API (metadata con espacios → perfil recortado) y por navegador (entrar por
`/?ref=RF-COOKIE1`, registrarse desde `/signup` **sin query** → `referral_code=RF-COOKIE1`).

⚠️ **Dos cuentas de usar y tirar** quedaron en dev de la verificación (`ref.test.…` y
`ref.cookie.b@ensenameya.dev`): borrarlas pide `service_role`, que no tengo.

🔑 **El token REST de Figma sigue vivo.** Durante la pasada devolvió un `403 Invalid token` y se dio
por muerto; al reintentarlo responde 200 (`/v1/me` → Diana Rivera, y los nodos del archivo). **Fue un
corte pasajero, no una rotación.** Los dos caminos están abiertos: REST con `FIGMA_API_KEY` y el MCP
de Figma —por el que salieron los tramos de precio de DD-04 mientras el REST fallaba—. Si el REST
vuelve a dar 403, reintentar antes de pedirle un token nuevo a Diana.

**Tanda 2 · cerrar el chat** · ✅ **COMPLETA (29-jul, `c53a949`)** — la decisión 22 (**30 días +
descarga**) sacó a las dos del limbo en que las dejó el 17-jul.

- `EY-84` **US-1702 · descarga** — `GET /api/chat/[bookingId]/download?format=txt|json`. La
  autorización **es la RLS**: `messages_select_participant` solo devuelve el hilo a quien es parte de
  la reserva, así que el handler no comprueba nada a mano. Los mensajes se firman **por rol**
  ("Alumno"/"Tutor", con "(tú)" para quien descarga) porque `profiles` es privado y el tutor no puede
  leer el nombre del alumno. Fechas en la hora local del que descarga (RN-02). Sin librería y sin JS:
  son `<a download>`, y el enlace vive en `ChatThread`, así que sale en AL03, TU08 y la sala de una.
  **Los adjuntos no van dentro** (bucket privado; meterlos pediría un zip): se listan con nombre y peso.
- `EY-76` **US-1703 · purga** — restaurada la versión destructiva **con adjuntos** (`20260729180000`):
  borrar solo las filas dejaría el objeto huérfano en Storage, que es el dato personal que RN-41 quiere
  caducar. El cron de las 04:00 nunca se desprogramó, así que reemplazar la función basta.
  ⚠️ **El borrado en sí no se pudo ejecutar aquí** — `purge_expired_messages` es solo de `service_role`
  (lección de US-605) y no tengo esa clave. Corre en el próximo tick del cron; para comprobarlo antes,
  en el SQL Editor de dev: `select public.purge_expired_messages();`

**Tanda 3 · datos y avisos** · ✅ **COMPLETA (29-jul)**

- `EY-113` **DD-03 · nivel + idioma por mentoría** (decisión 25) — migración `20260729190000`. El nivel
  **reutiliza el enum `teaching_level`** (mismo vocabulario que el filtro del Figma, un tipo menos); el
  idioma es texto con check porque la lista la mueve producto. Dos selects en TU04, grupos "Nivel" e
  "Idioma" en P05, desplegables en la fila de P06 y chips en P08. **Y el "Idioma del tutor" de P04**
  (386:1006), que no necesita columna: se deriva de las clases que publica.
- ✅ **Los 4 huérfanos** (`cancel_reason`, `alert_acks`, `primary_goal`, reseñas firmadas) — ver arriba.
- `EY-77` **US-1203 · avisos in-app** (`20260729200000`) — una columna (`read_at`) y su índice; la tabla
  y los triggers ya existían de EP-12. Marcar leído por **RLS + grant de una columna**, no por RPC: sin
  dinero ni roles de por medio, y así el cliente no puede tocar `status` ni `payload`. La campana se
  sirve **desde el layout** (contador pintado en el primer render, sin ida y vuelta por página) y **sin
  Realtime**: los avisos los encolan triggers, no llegan al segundo.
  - 🐞 *Lección:* `listNotices` tuvo que salir a `notifications-server.ts`. Dentro del módulo que
    importa el componente de cliente, el bundler lo arrastraba al navegador y `next/headers` tumbaba la
    app entera — ni el `import()` dinámico lo evita.
- `EY-81` **US-1502 · métricas** (`20260729210000`) — las tres cifras dentro de `admin_stats`, que AD13
  ya llama con el mismo período. **"Latencia de webhook" con lo que hay**: `payment_webhook_events` solo
  guarda `processed_at`, así que se mide la mediana entre crear el pago y procesar su evento — y sobre
  todo los **cobros sin evento**, que es el webhook que nunca llegó. En dev: 16,7 % de fallo de cobro
  (8 de 48), 0 payouts en problema y **39 cobros sin evento** (esperable con el PSP simulado).

**Tanda 4 · grabación** · ✅ **COMPLETA (29-jul)** — `EY-85` US-1801 + `EY-86` US-1802.

- **Consentimiento (RN-42)** — `session_recording_consents` (`20260729220000`): la fila **es** el
  consentimiento; retirar es borrarla. Sin booleano que confunda "dijo que no" con "no ha contestado".
  La RLS impide lo importante: **cada uno consiente por sí mismo** — si no, el tutor aceptaría por el
  alumno y lo grabaría sin permiso, que es justo lo que la regla prohíbe. Los dos leen las dos filas
  porque la pantalla dice "falta que el otro acepte".
- **El permiso no se pide en la interfaz: se quita del proveedor.** La sala se crea con
  `enable_recording` solo si `recording_allowed()` da true, así que sin los dos síes Daily ni ofrece el
  botón. Si el consentimiento llega **después** de que el primero entrara, la sala se re-parchea — sin
  eso la grabación se quedaba apagada toda la clase.
- **Acceso (US-1802)** — `/api/recordings/[sessionId]`. Las grabaciones se preguntan a Daily en el
  momento, **sin copiarlas a una tabla nuestra**: el fichero vive allí y un espejo de sus metadatos
  sería otro sitio donde quedar desfasado. El enlace se firma al hacer clic (caduca). Botón "Ver
  grabación" en AL03 y TU08, en las sesiones completadas.
- **NTF-19** se encola al completar la sesión **si hubo consentimiento**: no existe evento de "el
  fichero ya subió" al que engancharse, y anunciar una grabación que RN-42 prohibió sería peor que
  callar.

⚠️ **Dos límites reales, no descuidos:**
- **Los 30 días se aplican al servir**, no en Daily. Borrar el fichero allí necesita la API key en un
  job (Edge Function), igual que el `provider.payout()` de EP-10.
- **El add-on de grabación de Daily sigue sin activar** (`enable_auto_recording` en `null`). Todo lo de
  arriba está cableado y verificado hasta donde llega la cuenta: cuando se active en el panel de Daily,
  la grabación empieza a existir sin tocar código. **Falta el go de coste.**

**Tanda 5 · referidos** · ✅ **COMPLETA (29-jul)** — `EY-78` US-1301, en AL02 y `/account`.

**Cero lógica interna (RN-21):** el programa entero vive en Referral Factory y el bloque no calcula ni
enseña saldo — eso lo dice el panel de ellos. **La URL de la campaña es el interruptor**
(`NEXT_PUBLIC_REFERRAL_URL`): sin ella el bloque no se pinta, porque un "Invita y gana" que no lleva a
ninguna parte es peor que no tenerlo.

Se **abre en pestaña nueva** en vez de embeberse: si la cabecera de la campaña prohíbe el iframe nos
quedaría un recuadro en blanco dentro del panel. Pasar a embebido después es sustituir el botón.
**No se le pasa el correo por la URL** — datos personales en query string hacia un tercero; si la
campaña necesita identificar al alumno, se configura de su lado.

Con US-1302 (captura del `?ref=`) ya cerrado, **los referidos quedan completos de nuestro lado**.
→ **Falta solo pegar la URL** de la campaña en Vercel (Preview y Production) y en `.env.local`.

⚠️ **Esa última frase se quedó vieja el 6-ago.** La URL ya está en `.env.local`
(`https://vercel.referral-factory.com/cXr65Wou/signup`) y sigue faltando en Vercel — pero al mirar la
campaña de verdad se descubrió que **la atribución por `?ref=` no puede funcionar con este tipo de
campaña**: US-1302 es código correcto que nunca va a recibir un código. Ver "**Referidos — la campaña
no funciona como creíamos**" en la sección del 5–6 de agosto.

**Tanda 6 · cierre** · ✅ **COMPLETA (29-jul)** — `EY-82` US-1601 y `EY-83` US-1602.
Resultados completos en **`docs/QA-LANZAMIENTO.md`**.

- **Responsive** — barrido automático de scroll horizontal (el síntoma que delata un layout roto) en
  **17 rutas** a 360 y 768. Dos fallos reales, corregidos: el *segmented control* de `/search` (411 px
  a 360) y **el footer a 768**, donde el párrafo se quedaba sus 592 px y dejaba las tres columnas de
  enlaces a ~18 px — "Privacidad" se salía de la pantalla **en todas las páginas**, porque el footer es
  global. Después: 17/17 limpias.
  ⚠️ **Esto no es "el responsive del diseño"**, es que nada se rompa. El diseño de tablet/escritorio
  sigue pendiente de Diana (decisión 24) y el **admin es desktop-first** por AC, así que no entró.
- **QA/UAT** — matriz de RLS por rol **ejecutada** (12 tablas × 4 roles + 6 escrituras que deben
  fallar): todas las escrituras dan 42501 **incluido el admin**, y `messages` devuelve 0 filas al admin
  — ni él lee el chat (RN-41). Idempotencia de webhook verificada por partida doble (mismo `event_id` →
  no-op; id distinto sobre reserva pagada → no-op por estado). Y el checklist de lanzamiento con los
  **6 jobs de `pg_cron`** y qué se rompe si alguno no corre.

---

## 🏁 Estado tras las 6 tandas (29-jul)

**Los 20 tickets que quedaban abiertos están en código.** Las tandas 1–6 cerraron Sprint 7 y Sprint 8
enteros, más los 4 compromisos del 24-jul que no tenían ni ticket. **Sprint 6 AC (5 tickets) sigue
esperando credenciales** — y se puede adelantar a medias en cuanto llegue la cuenta Stripe de test.

**Lo que falta es de fuera, no de código:**

> ⚠️ **Las dos tablas de abajo son la foto del 29-jul.** El 5–6 de agosto movieron cuatro filas
> (correos, páginas legales, Stripe y referidos); la lista al día está al final, en
> "**Qué falta para encender (7-ago)**".

| Para encender | Falta |
| :-- | :-- |
| Referidos (`EY-78`) | pegar la URL de la campaña en `NEXT_PUBLIC_REFERRAL_URL` — ⚠️ **y replantear la atribución** (6-ago) |
| Sentry (`EY-80`) | crear la cuenta y pegar el DSN |
| Grabación (`EY-85/86`) | activar el add-on en Daily (go de coste) |
| ~~Correos (EP-12)~~ | ~~proveedor real (C-11)~~ → ✅ **decidido: Resend** (6-ago); falta la cuenta y `RESEND_API_KEY` |
| Cobros y payouts reales | cuentas y API keys de Stripe/DLocal (EP-20) — ✅ **Stripe test ya cableado y probado** (6-ago) |
| Responsive "de diseño" (`EY-82`) | los frames de tablet/escritorio de Diana |
| ~~Páginas legales (`EY-116`)~~ | ~~el texto del cliente~~ → ✅ **redactado el 6-ago**; lo que queda es de negocio (dos webs, dos contratos) |

**En paralelo · Sprint 6 AC** — solo si se abre la cuenta Stripe de test: PAC-01 checkout alojado →
PAC-02 tokenización → PAC-03 firma de webhook → PAC-04 adaptador en el `PaymentRouter`. La pata DLocal
de los cuatro se queda `To Do` hasta que haya contrato.
→ ✅ **Ejecutado el 6-ago**: **PAC-01 y PAC-03 hechas y verificadas** en test mode (`7b30768` +
`3529655`). La pata DLocal sigue igual.

### ⏳ Lo que hace falta de fuera (no lo desbloquea el código)

| Necesito | Para | De quién |
| :-- | :-- | :-- |
| ~~¿Cuenta Stripe en **test mode**?~~ → ✅ **SÍ (Jose, 29-jul)**: la abre él y pasa las claves de test. **Cumplido**: las `sk_test_` están en local y en Vercel Preview (6-ago) | Sprint 6 AC entero | Jose |
| ~~**URL de la campaña** de Referral Factory~~ → ✅ **la hay** (`.../cXr65Wou/signup`, en `.env.local`); falta en Vercel, y la **atribución hay que rehacerla** | encender `EY-78` | Jose (cuenta ya creada ✅) |
| **DSN de Sentry** (cuenta gratuita) → `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` en Vercel | encender `EY-80` | Jose |
| ~~Token de Figma nuevo~~ → **no hace falta**: el 403 fue pasajero, el token responde | fidelidad al diseño | — |
| Go de coste de grabación en Daily + dónde se guardan | `EY-85/86` | Cliente / Emilio |
| Diseños responsive tablet/escritorio | `EY-82` | Diana |
| ~~Texto legal de términos, privacidad y cookies~~ → ✅ **redactado el 6-ago** contra lo que el código hace. Lo que falta ahora es una **decisión de negocio**: `ensenameya.com` publica otros términos desde marzo | `EY-116` | Cliente |
| Cuentas + API keys reales DLocal y Stripe | Cerrar Sprint 6 AC | Cliente (Veronica lo pide) — ⚠️ **dLocal rechazó la cuenta** (ver 5–6 de agosto) |

---

## 🧭 Dónde está todo (4-ago)

> **Qué es esto.** Foto verificada contra el repo y contra Jira el **2026-08-04**. La sección de
> arriba dice "está en código", que es cierto y **no es lo mismo que "está en producción"**.

### El cuello de botella no es código: es el merge

> ✅ **Medio resuelto el 5-ago**: la **PR #11 se mergeó** (`1a36da2`). Este bloque queda como la foto
> del 4-ago; el estado al día está justo debajo.

- `main` y `origin/dev` están en el **mismo commit** (`57edfa9`, 29-jul). Producción sigue siendo la
  foto de ese día.
- Todo lo de las 6 tandas + agosto vive en la rama **`feat/tanda1-cierres`** → **PR #11 hacia `dev`**:
  **25 commits, 148 ficheros**, `lint-typecheck` y Vercel en verde, `MERGEABLE`, **sin revisar por
  nadie**.
- Para llegar a producción hacen falta **dos merges** (`feat/tanda1-cierres`→`dev`, luego `dev`→`main`).
- Y hay **12 migraciones sin aplicar en prod** — las 11 del 29-jul (`20260729130000` … `20260729230000`)
  más la de DD-04 (`20260804120000`). En dev ya están; a prod llegan **por CI al mergear a `main`**.

**Al 7-ago:** la PR #11 se mergeó a `dev` el **5-ago** (`1a36da2`) y encima entraron dos días más de
trabajo. `dev` va **43 commits por delante de `main`**, que sigue clavado en `57edfa9`. Falta **UN
merge** (`dev`→`main`) y las migraciones pendientes de prod ya no son 12 sino **20**
(`20260729130000` … `20260806180000`).

### Jira (4-ago): 110 `Done` · 15 `In Review` · 10 `To Do` (sin contar épicas)

- Los **15 `In Review`** son exactamente lo que espera en la PR #11: **Sprint 7 entero** (`EY-76`,
  `77`, `80`, `81`, `84`, `85`, `86`, `113`, `114`, `115`, `116`) y **cuatro del Sprint 8** (`EY-78`,
  `79`, `82`, `83`).
- Los **10 `To Do`**: los 5 de Sprint 6 AC (`EY-93…96` + `EY-147`, bloqueados por cuentas y claves de
  Stripe/DLocal) y **cinco que este documento no tenía**:

  | Ticket | Qué | Estado |
  | :-- | :-- | :-- |
  | `EY-148` | **RF-03** · webhook de calificación de referido | Sprint 6 AC · sin empezar — ⚠️ **probablemente sobra**, ver 5–6 de agosto |
  | `EY-149` | **RF-04** · alta automática en Referral Factory | sin sprint |
  | `EY-150` | **RF-05** · aviso al referidor | sin sprint |
  | `EY-151` | **NTF-21** · email de mensaje nuevo en el chat | sin sprint |
  | `EY-153` | **SUP-01** · botón de soporte | sin sprint |

  Los tres `RF-xx` son el **lado nuestro del programa de referidos** que RN-21 dejaba fuera (el
  programa vive en Referral Factory): calificar, dar de alta y avisar. `EY-78`/`EY-79` cerraron el
  bloque y la captura del código; esto es la vuelta.
- **Sprints abiertos: tres a la vez.** 6 AC venció el **31-jul** y sigue abierto, 7 venció el
  **4-ago**, 8 vence el **7-ago**. El proyecto lleva **al menos 8 sprints**, no los 4 del backlog v1.0.
- ⚠️ **Dos épicas que los docs no recogen:**
  - **EP-24** (`EY-119`, "Ajustes reunión 24-jul") — el paraguas de los `R24-xx`, que aquí se
    ejecutaron sin épica.
  - `EY-152` ("EP-23 Soporte Técnico al Usuario (Post-MVP)") — **reusa el código `EP-23`, que ya es de
    `EY-110`** ("Datos que el diseño necesita"). Es un **duplicado real del tablero**: hay que
    renumerar una de las dos antes de que alguien lea "EP-23" y no sepa cuál.

### DD-04 rehecho (`EY-114`) — el filtro de precio de P04

La primera versión (`302ba82`, 29-jul) resolvía el mínimo **en el cliente**: traía los productos
activos, reducía en memoria y acotaba con `in(ids)`. Paginaba y contaba bien, pero **cargaba todo el
catálogo en cada visita** y el `in(ids)` tiene techo de longitud de URL. Además usaba los **cuatro
tramos fijos** del Figma, cuando Jose había pedido otra cosa en el comentario de `EY-114` el 29-jul.

Rehecho el 4-ago en dos commits:

- **`cccb566`** — vista **`tutors_public`** (migración `20260804120000`) con el precio de la mentoría
  activa más barata de cada tutor. El filtro pasa a ser un `gte`/`lte` normal y **el rango, la
  paginación y el `count` los resuelve Postgres**. Los cuatro tramos fijos se van: es un **rango
  continuo**.
  ⚠️ La vista lleva **`security_invoker = true`**, y no es opcional: una vista corre por defecto con
  los privilegios de su dueño, así que sin eso se saltaría la RLS de `tutor_profiles`/`products` y
  publicaría tutores no aprobados y borradores (regla de oro 1). Columnas explícitas y no `tp.*`, por
  lo mismo: es superficie pública.
  **Sin columna materializada**: no hay nada que mantener ni trigger que se desincronice. El día que
  el plan de ejecución lo pida se materializa, con datos reales y no por si acaso.
- **`96f4e0b`** — el deslizador pasa a **escala logarítmica** (`src/lib/catalog/log-scale.ts`). Con
  escala lineal, un catálogo con una clase cara deja todo el resto apelotonado en el primer 5% del
  recorrido: los precios se reparten por órdenes de magnitud, no linealmente.

### Limpieza de código muerto (3–4 ago)

Dos commits, **cero cambios de comportamiento**:

- **`9e56afb`** (3-ago) — borrados `booking-list.tsx`, `review-dialog.tsx`, `reserve-button.tsx`,
  `category-chips.tsx`, `lib/avatar.ts`, `lib/routes.ts` y **6 primitivos de shadcn sin usar**
  (`alert`, `select`, `separator`, `skeleton`, `table`, `tabs`). Todo eran restos del rediseño: las
  páginas nuevas de AL06/AL07/AL08 jubilaron el diálogo y la lista compartida, y el `PanelShell` los
  chips. **`AdminShell` y `TutorShell` se fundieron en `PanelShell`** — eran la misma cabecera dos
  veces. Neto: **−1188 líneas**. De paso salió del repo `graphify-out/` (y entró al `.gitignore`).
- **`63a7896`** (4-ago) — **los dos huérfanos** que quedaban: `reservas/[id]/cancel-booking-button.tsx`
  (el sandbox había bloqueado el `rm` el 24-jul, ver la nota 🧹 del repaso de AL02–AL08) y
  `admin/timeline.tsx`.

### Interruptores por variable (sin ellas la función se apaga sola, no rompe)

Es el mismo patrón en todos los sitios: **la credencial es el interruptor**. Sin ella el código no
falla, se desactiva — y ponerla no toca código. _(Ampliada el 6-ago con las cuatro nuevas.)_

| Variable | Qué enciende | Sin ella |
| :-- | :-- | :-- |
| `DAILY_API_KEY` | sala de Daily real | sala **simulada** (ya está puesta en local, Preview y Production) |
| `NEXT_PUBLIC_REFERRAL_URL` | bloque "Invita y gana" (`EY-78`) | el bloque **no se pinta** |
| `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` | monitoreo (`EY-80`) | Sentry **apagado** |
| `RESEND_API_KEY` | envío real de correo (`EY-73`) | el job **no toca la cola**: los avisos quedan `pending` (no `failed`) y salen todos en la primera pasada con clave |
| `CRON_SECRET` | los **tres** jobs HTTP (purga de grabaciones, envío de correo, **cola de reembolsos**) | **503 y no corre** — falla cerrado, a propósito: un endpoint que borra datos, dispara correos o **mueve dinero** sin secreto sería público. ✅ Puesta en Vercel y en GitHub (30-ago) |
| `STRIPE_API_KEY` | checkout de Stripe (`EY-93`) | `/api/pagos/checkout` responde `{simulated:true}` y sigue el camino simulado |
| `STRIPE_WEBHOOK_SECRET` | webhook firmado (`EY-95`) | **503** y no procesa nada |

⚠️ **`CRON_SECRET` no es como los demás.** Los otros interruptores apagan una función que nadie echa
de menos; este apaga **la purga que sostiene un compromiso de privacidad publicado** (RN-42, 30 días)
y **la cola de reembolsos**. Sin él en Vercel, el cron de las 04:00 responde 503 todos los días **en
silencio** y las grabaciones no caducan.

> 🟢 **Resuelto el 30-ago, y con una vuelta de tuerca.** En Vercel `CRON_SECRET` **ya estaba** —este
> documento y `ENTORNOS.md` decían lo contrario desde el 6-ago—; lo que faltaba era el lado **GitHub**
> (`APP_BASE_URL` + `CRON_SECRET`), y sin él los dos workflows de Actions llevaban **30 corridas en
> rojo** desde el 27-ago. Detalle y comprobación en `docs/ENTORNOS.md` §4.

---

## 🚀 5–6 de agosto — el merge, lo legal y el primer cobro de verdad

> **Qué es esto.** Los dos días posteriores a la foto del 4-ago, tanda a tanda y con SHA. Empiezan
> con el merge que este documento llevaba semanas pidiendo y terminan con un cobro de Stripe
> entrando por un webhook firmado de verdad. **Verificado contra el repo el 7-ago.**
>
> ⚠️ **Nada de esto está en producción todavía**: vive en `dev`, y `main` sigue en `57edfa9`.

### 0 · El merge (5-ago) — se acabó el "está en la PR #11"

`feat/tanda1-cierres` → `dev` en **`1a36da2`**. Con eso las 6 tandas del 29-jul, el DD-04 rehecho y
la limpieza de código muerto dejan de estar en una rama y pasan a ser `dev`. Encima entraron dos días
más de trabajo (16 commits), así que hoy **`dev` va 43 commits por delante de `main`**.

**Queda UN merge, no dos** (`dev`→`main`), y con él **20 migraciones** llegan a prod por CI —
`20260729130000` … `20260806180000`. Eran 12 en la foto del 4-ago; las ocho nuevas son las de estos
dos días.

### A · Pulido de lo que se veía mal (5-ago, 5 commits)

| Commit | Qué |
| :-- | :-- |
| **`836a573`** | 🐞 El modal de **cerrar sesión se quedaba clavado en "Cerrando…"**: `signOut()` ponía `busy=true`, navegaba y nunca cerraba el diálogo — y como `router.push` es navegación de cliente, la cabecera no se desmontaba. Ahora hace **recarga completa**: cerrar sesión es el momento de tirar *todo* el estado de cliente, incluidas las cachés RSC de rutas ya visitadas que se quedaban con contenido de la sesión anterior |
| **`b8e6709`** | Testimonios y FAQ del home llevaban **anchos fijos heredados del Figma de 1280** (`1221px` y `1016px`) que sobrevivieron al full-width de R24-01: quedaban encogidos entre bandas que sí crecen. Las 13 bandas del home miden ya lo mismo (111→1775 a 1900 px). Afecta igual a `/about`, que reusa los componentes |
| **`e3e2cf9`** | 🐞 **Regresión propia del día anterior**: mover el pomo **derecho** del precio invertía el filtro. Al normalizar el rango se ordenaban los extremos con `[min,max].sort(...)`, y `Array.prototype.sort` manda los `undefined` al final **sin llamar al comparador** — así lo manda la especificación —, así que un `?pmax=7500` suelto se volvía `[7500, undefined]`. Solo se notaba con el pomo derecho, que es el único gesto que deja `pmin` vacío; por eso parecía cosa del deslizador. Verificados los 8 casos |
| **`54f8abc`** | En el hero de `/classes`, "Paquete", "Sesión suelta", "Por hora" y "Categorías" eran **la misma píldora** — pero las tres primeras **filtran** esta pantalla y la cuarta **navega** a otra, y nada lo delataba. Filtros rotulados y agrupados con `aria-labelledby`; la navegación, al otro lado de un separador y con forma de enlace |
| **`794d0c7`** | 🐞 **Un admin veía las categorías desactivadas en el sitio público.** `listActiveCategories` no filtraba `is_active`: se apoyaba en la RLS, y `categories_select_admin` se las enseña **todas**. Lo que se muestra no puede depender de quién mira. **Y el icono deja de estar en el código**: pasa a `categories.icon` (migración `20260805120000`) con backfill del mapa `slug→icono` que había, elegible desde el modal en una rejilla de 22. La paleta de `category-icons.ts` sigue siendo **lista blanca y menú a la vez** — la columna es texto libre, así que un valor inesperado cae al genérico |

### B · Las páginas legales dejan de ser un armazón (6-ago)

DD-06 (`EY-116`) había dejado `/terms`, `/privacy` y `/cookies` respondiendo 200 con un
"Documento en preparación". Ahora llevan **texto redactado que describe la plataforma que existe**:
ventana de pago de 20 min, 24 h para que el tutor acepte, sala abierta 10/10, chat desde 2 días
antes, retención de 7 días y lote de liquidación los lunes, los 7 documentos de verificación. Los
**porcentajes de reembolso se importan de `lib/policy.ts`**, así que no pueden divergir de lo que
aplica `cancel_booking`.

Tres commits, y el segundo es el interesante:

- **`4cf2ca6`** — la redacción, escrita contra lo que hay **en producción** (no contra la rama de los
  sprints 7-8): por eso decía que las clases no se graban y que la purga del chat estaba en pausa.
- **`0b4ecdd`** — 🔎 **el hallazgo: el cliente ya tenía términos y privacidad publicados.**
  `ensenameya.com` (la landing de GoDaddy) los sirve desde el **23-mar-2026**, enlazados desde su
  footer, y nadie los había mirado antes de escribir los nuestros. De ahí salen dos cosas que se
  incorporan: el **buzón oficial es `info@ensenameya.com`** (no el marcador que se había dejado) y su
  **§8 de limitación de responsabilidad**, que es texto que el cliente ya asume.
- **`b957933`** — puesta al día contra `dev`, donde grabación, purga del chat y referidos **sí**
  existen: el texto cauto escrito contra `main` pasaba de prudente a **falso** en el mismo merge.
  Se declaran los terceros (Sentry sin PII, Referral Factory solo si llegas por invitación) y la
  cookie `ey-ref`.

⚠️ **Dos divergencias deliberadas con el texto del cliente**, anotadas en la cabecera del componente:
el suyo nombra **"Stripe o Mercado Pago"** (C-01 no está cerrado del todo de cara a fuera) y deja los
reembolsos en "puede variar según cada caso" cuando **RN-37 ya es código**. Mientras los dos sitios
estén publicados hay **dos contratos distintos vivos** — eso lo decide negocio, no el código.

⚠️ **En producción siguen siendo 404**: `main` no tiene ni el armazón.

### C · Grabaciones: el bug que las hacía invisibles y la purga que faltaba

**🐞 `fffd4b5` · US-1802 no encontraba NINGUNA grabación.** `join_session` bautiza la sala como
`'ey-' || replace(id::text,'-','')` — **sin guiones** — y `/api/recordings/[sessionId]` la buscaba
como `ey-${sessionId}`, **con guiones**. No coincidían nunca: `listRecordings` volvía vacío y la
pantalla decía "Esta clase no se grabó" aunque Daily estuviera bien configurado y los dos hubieran
consentido. **Fallo del 100 % de las veces, en silencio.**
El arreglo no es replicar el `replace` en la ruta: es **dejar de derivar el nombre por segunda vez** y
leer `sessions.daily_room_name`, que la BD ya guarda. Si la columna es `null` nadie entró nunca a la
sala, que es un "no hay grabación" legítimo.

**`0722b64` · los 30 días ahora borran de verdad (RN-42).** Hasta aquí la retención se cumplía solo
**al servir**: el endpoint devolvía 410 pasada la fecha y **el fichero seguía en Daily para siempre**.
Un dato personal que no caducaba, y la política de privacidad tenía que decirlo en voz alta porque
callarlo habría sido peor. Piezas:

- **`/api/cron/recordings-purge`** en **Vercel Cron a las 04:00**. **No es una Edge Function a
  propósito**: el repo ya tomó esa decisión en `20260717120000` ("Postgres no puede llamar a la API de
  Daily"), y una función de Deno querría su propio cliente de Daily, su copia de la API key y un
  pipeline de despliegue que no existe. Va como route handler y reutiliza `lib/daily.ts`.
- **`sessions.recordings_purged_at`** (`20260806130000`) — sin la marca el job tendría dos opciones
  malas: repasar cada sesión vencida **todos los días para siempre**, o mirar solo una ventana
  reciente y dejar escapar en silencio lo que caiga fuera si el job se para una temporada. Además deja
  constancia de **cuándo** se borró, que es la prueba de que la política se cumple.
- **`lib/supabase/admin.ts`** — el **primer camino con `service_role` del proyecto**, con
  `server-only` para que importarlo desde el cliente rompa el build en vez de filtrar la clave.
- **Falla cerrado**: sin `CRON_SECRET` responde **503** y no corre.

⚠️ **Sigue bloqueado el add-on de grabación de Daily** (`recordings_bucket` en `null`): falta el **go
de coste**. O sea que hoy no hay grabaciones que borrar — esto quita el bug y cierra la promesa, no el
bloqueo de EP-18.

### D · Seguridad: `confirm_payment` sale del alcance del cliente (S-15 / RN-26)

**`ab0b1bf`** + migración **`20260806120000`**. La función que marca un pago como cobrado estaba
concedida a `authenticated` y su único control era "eres el dueño de la reserva": **cualquier alumno
con sesión podía marcarse el pago como cobrado desde la consola del navegador**. Hoy no roba nada
porque el proveedor ruteado es `simulated`; el agujero se abría el día que entrase Stripe.

Y había un problema de fondo: comprobaba `student_id = auth.uid()`, y **un webhook no tiene usuario**.
La función que existe para que la llame el proveedor de pago era literalmente **imposible de llamar
por el proveedor de pago**. Revocar a secas la habría dejado inservible para todos, así que se parte:

- **`confirm_payment`** → solo `service_role`. Se le quita el check de `auth.uid()`, que era justo lo
  que le impedía cumplir su función; **la autorización pasa a ser el grant**, que es donde debe estar.
- **`confirm_simulated_payment`** → `authenticated`. Es el camino del checkout de hoy y ahora lo dice
  su nombre. Exige **dos** cosas: ser dueño de la reserva **y** que `payments.provider = 'simulated'`.

Lo importante del diseño: **el camino del cliente se desarma solo.** En cuanto `payment_routing_rules`
deje de rutear a `'simulated'`, el snapshot que `create_booking` congela en `payments.provider`
(RN-33) dejará de serlo y esta función empezará a rechazar sin que nadie toque nada. El día del
lanzamiento no hay que **acordarse** de revocar: lo impide el dato.

Se revoca de **PUBLIC** primero — el mismo gotcha de US-605 (`20260715150000`): en Postgres `EXECUTE`
se concede a PUBLIC por defecto y revocar solo de `authenticated` no cierra nada.

### E · Correo de verdad — C-11 resuelta con **Resend** (`58fd62e`)

**La decisión.** Los docs se contradecían (el Doc 9 proponía SendGrid; la aprobación del cliente,
Mailgun) y ninguno estaba elegido. Se elige **Resend por un motivo operativo, no de gusto**: es el
único de los tres que permite **enviar y probar sin dominio verificado** (`onboarding@resend.dev`).
SendGrid exige verificar remitente antes del primer envío y el sandbox de Mailgun solo entrega a
cinco destinatarios pre-autorizados. Como **el dominio propio sigue bloqueado** —`ensenameya.com`
sirve otra web—, esa diferencia es la que decide. Todo el acoplamiento vive en `sendEmail()`
(`lib/email.ts`): **cambiar de proveedor es reescribir una función**.

**🔑 El detalle que habría hecho inútil todo lo demás.** `process_notifications()` marcaba **la cola
entera como `sent` cada 2 minutos** sin enviar nada. Cualquier remitente externo habría llegado
**siempre** a una cola vacía, corriera cuando corriera. Por eso lo primero de la migración
(`20260806150000`) es **apagar el stub**, no añadir el envío. Se sigue el precedente de la pausa de la
purga del chat (`20260722200000`): la función no se borra ni se desprograma el cron —"si se
desprograma, se olvida"— sino que pasa a **informar**. Ahora `select process_notifications();` dice
cuánto hay encolado, así que si el remitente se cae **la cola se ve crecer** en vez de desaparecer.

**El envío** lo hace **`/api/cron/notifications-send` vía GitHub Actions**, y no Vercel Cron: **Hobby
limita los crons a uno al día**, y un aviso de "tienes 24 h para aceptar esta reserva" que llega
mañana no sirve de nada. El workflow documenta los dos peajes de Actions (retrasos con la cola
cargada; GitHub desactiva los programados tras 60 días sin actividad en el repo). ⚠️ **El `cron:`
pide 5 minutos y GitHub entrega una corrida cada 2-6 horas** — medido sobre las corridas reales del
27 al 30-ago, no es el "10-15 min" del manual.

- **Dos RPC y ningún grant de tabla**: el correo del destinatario vive en `auth.users`, que no está
  expuesto por la Data API. En vez de abrir `notifications` a `service_role` se le dan dos verbos —
  leer el lote pendiente con el correo resuelto y marcar el resultado.
- **Reintento honesto**: 429/5xx dejan el aviso `pending` para la pasada siguiente; solo dirección o
  plantilla inválidas lo marcan `failed`. Un mal minuto del proveedor no pierde un aviso.
- **`npm run check:email`** (`email-templates.check.ts`): el job trata "no renderiza" y "el proveedor
  rechazó" como el mismo fallo permanente, así que desde fuera no se distinguen — sin esta
  comprobación, una plantilla mal escrita se vería igual que una API key caducada.

**🐞 Y un defecto que salió al probarlo: NTF-07 avisaba tarde.** "Tienes una reserva nueva por
aceptar" se encolaba en la transición a `confirmed`, que es **después** de que el tutor acepte: el
aviso que le concede 24 h para responder le llegaba una vez respondido, y el único a quien servía era
el tutor con auto-aceptar, que no lo necesita. **Con el stub marcando todo como enviado, era
invisible** — no hay forma de notar que falta un correo que nunca se manda. Corregido en
`20260806160000`: se añade la rama de `pending_acceptance` y **no** se quita la de `confirmed` (el
tutor con auto-aceptar nunca pasa por el primer estado). Sin riesgo de duplicado: la clave de
idempotencia es la misma y `enqueue_notification` hace `on conflict do nothing` (US-1202).

⚠️ **Falta la cuenta de Resend y `RESEND_API_KEY`.** Sin ella el job **no toca la cola**: los avisos
quedan `pending` (no `failed`) y saldrán todos en la primera pasada con clave. Lo que no se ha podido
probar es que Resend acepte el payload.

### F · Stripe de punta a punta en test mode — PAC-01 y PAC-03 (`7b30768` + `3529655`)

**⚠️ La premisa de la épica era falsa.** `EY-92` decía "no iniciar hasta tener **ambas** cuentas".
No hacía falta: con solo registrar un email, el sandbox de Stripe da **Sessions, webhooks firmados de
verdad, rechazos, expiraciones y reembolsos**. El KYC solo bloquea el *live mode*. Lo único que
esperaba al cliente era el cambio a `sk_live_`.

**Lo construido:**

- **`lib/stripe.ts`** — singleton **perezoso** (instanciarlo en el top-level rompe `next build` cuando
  la clave no está en el entorno de build, que es hoy). **Versión de API fijada a `2026-07-29.dahlia`**
  y leída del paquete instalado: heredarla del panel significa que el día que Stripe la mueva cambian
  las formas de los objetos del webhook sin que nadie toque una línea.
- **`POST /api/pagos/checkout`** — el importe sale de **`payments.gross_amount`**, el snapshot que
  congeló `create_booking` (RN-33), **nunca del navegador**. `create_booking` se queda en el cliente a
  propósito: usa `auth.uid()` y con `service_role` fallaría.
- **`POST /api/webhooks/stripe`** — `req.text()` y no `req.json()`, porque **Stripe firma el cuerpo
  crudo** y un parse+stringify reordena claves y rompe el HMAC. Firma inválida → **400, nunca 500**, o
  Stripe reintenta tres días un payload que jamás va a validar. Sin `STRIPE_WEBHOOK_SECRET` → 503.
- **`profiles.stripe_customer_id`** (`20260806170000`) — **un Customer por persona**. Sin esto, cinco
  compras de 20 USD son cinco fichas distintas y la integración de Referral Factory, que sigue el
  **gasto acumulado de UN Customer**, no alcanza nunca el umbral: el referidor no cobra y nadie
  entiende por qué. En `payments.provider_payment_id` se guarda el **`pi_`** (PaymentIntent) y no el
  `cs_` (Session): los eventos de reembolso y disputa traen el PaymentIntent.

**Dos decisiones que parecen detalles y no lo son:**
- **`payment_intent.payment_failed` no se escucha**: una tarjeta rechazada deja la Session abierta y
  el alumno reintenta con otra; cancelar ahí le liberaría el horario a alguien que estaba a punto de
  pagar. Los únicos fallos terminales son `expired` y `async_payment_failed`.
- **🐞 Un bug propio que salió probando**, y que en producción habría sido feo: se guardaba
  `stripe_customer_id` y luego se reutilizaba **a ciegas**. Cuando ese Customer deja de existir en
  Stripe (datos de prueba borrados, cuenta cambiada), esa persona se queda con un **500 en cada
  intento de pago, para siempre**, hasta que alguien mire la BD. Ahora el checkout reconoce ese error
  concreto (`resource_missing` sobre `param: customer`), **rehace el Customer y reintenta una vez** —
  con una clave de idempotencia **distinta** a propósito: repetir la misma con parámetros distintos es
  un error de la API de Stripe, no la respuesta cacheada.

**✅ Verificado de punta a punta contra la PREVIEW, con Stripe entregando el evento de verdad:**
Session creada desde la preview (importe leído del snapshot, `client_reference_id` y metadata,
Customer reutilizado) → **expirada desde la API de Stripe** → webhook entregado a través del
**Protection Bypass de Vercel** → reserva `cancelled`, pago `failed`, `pending_webhooks=0`. También:
firma inválida → 400; el mismo `event_id` reenviado **no reprocesa** (`paid_at` no se mueve).

**Config nueva en Vercel (scope Preview):** `STRIPE_API_KEY` y `STRIPE_WEBHOOK_SECRET`. Endpoint
registrado en Stripe (**`ensenameya-vercel`**, 4 eventos de `checkout.session`) apuntando a la preview
con `?x-vercel-protection-bypass=…`, porque **Deployment Protection devuelve 302 antes de que corra
nuestro código**.

**La regla de `payment_routing_rules` en dev está ahora en `'stripe'`** — y cambiarla ya **no es una
migración, es un `UPDATE`**, gracias a los grants acotados de `20260806180000` (`select` + `update` de
`charge_provider`/`payout_provider`/`is_active` para `service_role`; **sin `insert` ni `delete`**:
inventar o borrar un corredor sigue exigiendo una migración revisada, que es donde debe estar esa
decisión).

**Fuera de alcance a propósito:** los **reembolsos por webhook**. `refund_payment` arrastra el mismo
bug que tenía `confirm_payment` esa misma mañana —guarda `has_role('admin')`, inalcanzable para un
webhook— pero arreglarlo bien exige decidir **quién es la fuente de verdad del reembolso**, y hoy no
se registran esos eventos, así que no hay bucle de reintentos presionando.

**🔒 Sigue bloqueado:** **DLocal entero** (sin cuenta) y los **payouts** (Connect exige KYC).

⚠️ **Anotado por si acaso:** el endpoint quedó registrado con API version `2026-06-24.dahlia` y el
código fija `2026-07-29.dahlia`. Irrelevante para los campos que se leen hoy; si algún día un campo
del webhook aparece vacío sin explicación, mirar esto primero.

### 🔎 Referidos — la campaña no funciona como creíamos

**Esto invalida parte de lo construido**, así que va con detalle.

La campaña de Referral Factory **no manda al referido a nuestra app con un código**. Lo lleva a una
**página de oferta alojada por RF**, donde deja nombre y email, y **solo después** lo redirige a
`https://ensenameya.vercel.app`. Los tres parámetros de URL que RF ofrece (Nombre, Email, Referrer
First Name) estaban **apagados**, así que llegaba sin nada — y **RF no ofrece un parámetro de código
de referido** para este tipo de campaña.

→ **La atribución por cookie `ey-ref` + `profiles.referral_code` (`EY-79` / US-1302, hoy en
`In Review`) no puede funcionar así.** Es código correcto que nunca va a recibir un código. Se activó
el parámetro **`ref_email`**; la atribución tiene que pasar a ser **por email contra la API de RF**.

**Y hay más:** la integración **Stripe ↔ Referral Factory** de la propia herramienta ya califica
referidos siguiendo el **gasto acumulado de un Customer de Stripe** y los **descalifica al
reembolsar**. O sea que **`EY-148` (RF-03, "webhook de calificación de referido") probablemente
sobra**. ⚠️ **Hay que mirarlo antes de escribirlo** — es justo el tipo de trabajo que la regla de oro
8 dice que no se adelanta.

**Estado de la campaña:** URL `https://vercel.referral-factory.com/cXr65Wou/signup`, ya en
`NEXT_PUBLIC_REFERRAL_URL` **en local** (falta en Vercel). `REFERRAL_FACTORY_API_KEY` también está en
local.
⚠️ **Los términos que RF le enseña al referido son SU PLANTILLA SIN RELLENAR**, con corchetes del tipo
`[Insert link to Privacy Policy here]`. Pendiente de redactar — y ahora hay tres juegos de términos
en juego (los nuestros, los de `ensenameya.com` y estos).

### 🎓 La lección que mordió tres veces

**`service_role` se salta la RLS pero NO los grants de tabla.** Son dos barreras distintas:
`bypassrls` es un atributo del rol, los privilegios son del objeto; saltarse una no te da la otra. En
este proyecto se nota más que en otros porque **"auto-expose new tables" está en OFF**, así que cada
tabla declara a mano a quién expone.

| Tabla | Migración | Se descubrió |
| :-- | :-- | :-- |
| `sessions` | `20260806140000` | `permission denied for table sessions` al probar la purga de grabaciones |
| `payments` · `profiles` | `20260806170000` | al estampar la referencia externa de Stripe |
| `payment_routing_rules` | `20260806180000` | al querer mover el ruteo a `'stripe'` sin escribir una migración |

**Falla en tiempo de ejecución, no en el build.** Cualquier trabajo nuevo con `service_role` sobre una
tabla que aún no lo tenga se va a estrellar igual hasta que declare sus grants. En los tres casos se
concedió **mínimo privilegio** (`update` acotado a columnas, nunca `all`), siguiendo el patrón de
column-grants que el proyecto ya usaba.

### 🔧 Variables de entorno — dónde está cada una

| Variable | Local | Vercel | GitHub |
| :-- | :-- | :-- | :-- |
| `CRON_SECRET` | ✅ | ✅ **sí** (comprobado 30-ago; este doc la daba por ausente desde el 6-ago) | ✅ **sí (30-ago)** (secret) |
| `STRIPE_API_KEY` | ✅ | ✅ (Preview) | — |
| `STRIPE_PUBLISHABLE_KEY` | ✅ | — | — |
| `STRIPE_WEBHOOK_SECRET` | ✅ | ✅ (Preview) | — |
| `RESEND_API_KEY` | ❌ (falta la cuenta) | ✅ **sí (17-ago)** — comprobado el 30-ago: el cron devuelve `status:"ok"`, no `sin-proveedor` | — |
| `NEXT_PUBLIC_REFERRAL_URL` | ✅ | ❌ **falta** | — |
| `REFERRAL_FACTORY_API_KEY` | ✅ | ❌ **falta** | — |
| `APP_BASE_URL` | — | — | ✅ **sí (30-ago)**: `https://ensenameya.vercel.app` (variable) |

⚠️ **Esto se cumplió al pie de la letra, y nadie lo miró.** El workflow está escrito para fallar en
rojo (`exit 1`) porque una configuración a medias en verde es peor que una en rojo — y desde que
llegó a `main` (26-ago) falló **el 100 % de las veces**: **30 corridas rojas** entre los dos crons
hasta que el 30-ago se dieron de alta las dos variables. La alarma funcionó; el destinatario era una
bandeja de entrada. Segunda cosa que se aprendió midiendo: **la cadencia de "cada 5 minutos" es
ficción** — GitHub entrega una corrida cada **2-6 horas** (`docs/ENTORNOS.md` §4).
⚠️ De paso: `.env.example` **no documenta `STRIPE_WEBHOOK_SECRET` ni `RESEND_API_KEY`**, aunque el
código las usa.

### 🚫 dLocal rechazó la cuenta

Sin saber qué URL presentó el cliente. El problema de fondo no es el formulario: **`ensenameya.com` es
una landing de GoDaddy que no enlaza a la app**, que vive en `ensenameya.vercel.app`. Dos webs de la
misma marca sin conectar, con **dos juegos de términos**. Ningún merge lo arregla: es DNS y negocio.

### 📌 Qué falta para encender (7-ago)

| Para | Falta | De quién |
| :-- | :-- | :-- |
| ~~**Que todo esto llegue a producción**~~ | ✅ **el merge se hizo el 26-ago** (`3fca8b2`). Hoy `dev` va 52 commits y **7** migraciones por delante, no 20 | Jose |
| ~~Correos (`EY-73`)~~ | ✅ `RESEND_API_KEY` (17-ago) + `APP_BASE_URL` y `CRON_SECRET` en GitHub (30-ago). ⚠️ Queda **ver llegar un correo**: el reloj apunta a prod y allí la cola está vacía | Jose |
| ~~Purga de grabaciones (RN-42)~~ | ✅ `CRON_SECRET` en Vercel ya estaba. Sigue sin haber nada que purgar: falta el add-on de Daily | Jose |
| **Vaciar la cola de correo de dev** | 336 avisos `pending` (~89 a buzones muertos) desde el 11-ago — `QA-LANZAMIENTO.md` §4.6 | Jose |
| **Ejercitar X-01** | 2 `refund_requests` `pending` en dev; el job **no ha movido un euro** todavía | Jose |
| Referidos (`EY-78`/`EY-79`) | `NEXT_PUBLIC_REFERRAL_URL` + `REFERRAL_FACTORY_API_KEY` en Vercel, **y rehacer la atribución por email** | Jose |
| Términos de la campaña de RF | están sin rellenar (plantilla con corchetes) | Cliente / Jose |
| Cobro real (live mode) | `sk_live_` — o sea el KYC de Stripe del cliente | Cliente |
| DLocal + payouts | cuenta (rechazada) y contrato; Connect exige KYC | Cliente / Veronica |
| Grabación (`EY-85/86`) | el add-on de Daily (go de coste) | Cliente / Emilio |
| Un solo contrato legal | decidir qué pasa con los términos de `ensenameya.com` (marzo) y con `ensenameya.com` → app | Negocio |
| Sentry (`EY-80`) | el DSN | Jose |
| Responsive "de diseño" (`EY-82`) | los frames de Diana | Diana |

---

## 🤖 26 de agosto — la jornada de los agentes, y lo que enseñó probar de verdad

**46 commits · 10 migraciones · 72 ficheros · +7.909 líneas.** Nueve fichas movidas a `In Review`.
Nada de esto está en producción: sigue pendiente el único merge `dev`→`main`.

### Lo que se cerró

| Ficha | Qué |
| :-- | :-- |
| `EY-194` | El **mix** que pidió el cliente: vuelve el chat de preventa (marcha atrás sobre P-1) **y** el tutor escribe FAQ que se heredan en todas sus mentorías |
| `EY-151` | NTF-21 — un mensaje nuevo por fin avisa por correo, agrupado a 1/hora por hilo |
| `EY-182` | Ya estaba hecho en `fee79f9`; solo quedaba arrastre de numeración |
| `EY-183` | La disponibilidad entra como paso 4 de 6 del asistente, **después** de la zona horaria |
| `EY-180` | El CTA de reserva deja de esconderse bajo el pliegue |
| `EY-181` | El resumen del pedido se lee; la tarjeta ilustrada **no** se borra (contradice a D-1) |
| `EY-153` | Soporte en los dos paneles, reusando `/contacto` |
| `EY-179` | Las tarjetas y los chips pasan a `<select>` |
| `EY-188` | Feed `.ics` **por suscripción**, con token opaco |
| `EY-189` | Reportar desde la sala + bandeja de admin que alguien lee |
| `EY-192` | La baja borra la identidad y conserva la contabilidad |
| `EY-148` | Cerrada **sin código**: la integración nativa de RF con Stripe ya hace lo que pedía |

### ⚠️ La lección de la jornada: el código verde no es código que funcione

Tres fallos serios pasaron `typecheck`, `lint` y `build`, y **solo aparecieron al ejecutar**:

1. **`anonymize_account` falló dos veces seguidas.** Primero con `42501` — Supabase **prohíbe
   `delete from storage.objects`**, y con razón: borrar la fila deja el fichero físico huérfano y,
   en el bucket público, servible por URL. Y en cuanto se arregló, `428C9` — `tutor_profiles.search_text`
   es una **columna generada** y el `update` intentaba escribirla. Causa común: enumerar columnas en
   un `update` sin mirar cuáles aceptan escritura. Ni `typecheck` mira dentro del SQL ni `db:push`
   llama a la función: **una función solo se prueba llamándola**.
2. **El «arreglo» de escritorio de `EY-180` se apoyaba en una premisa falsa.** `lg:sticky` **nunca
   tuvo recorrido** en ese panel —el hijo del grid es el `div#reservar` que lo envuelve y mide lo
   mismo, 0 px de holgura—, así que el CTA nunca fue inalcanzable. Y el `max-h`+`overflow` que se
   añadió para «arreglarlo» convertía el panel en contenedor de scroll y hacía que la barra opaca
   tapara **11 de 15 chips de hora**, comiéndose sus clics. Medido antes y después.
3. **Un `replace` de tres líneas tocó tres sitios en vez de uno**, y `faqs` acabó viajando en el
   typeahead del catálogo —una consulta por pulsación de cualquier anónimo— para que el código la
   tirara.

Los tres los encontró una **revisión adversarial** posterior o el navegador. Ninguno el CI.

### 🔴 Lo que salió de rebote y pesa más que varias fichas

- **`purge_expired_messages` hace el mismo `delete` prohibido sobre `storage.objects`.** Es el cron
  que aplica la **retención de 30 días del chat que publican las páginas legales**. Lleva así desde
  el 22-jul, arrastrado por siete migraciones. Hoy no salta porque no ha caducado ningún adjunto;
  el día que caduque el primero, el `42501` **tumba la transacción entera** y dejan de borrarse
  también los mensajes. Y es un cron: nadie mira si falla.
- **No existe ninguna vía que mueva `sessions.start_at`.** Auditados los 23 `update public.sessions`:
  ninguno toca la hora. **No se puede reprogramar**, solo cancelar y volver a reservar. El §14 de los
  Términos se cubre («sujeto a las funcionalidades de la Plataforma»); la **FAQ pública no**: responde
  «Por supuesto» a «¿puedo reprogramar?» y a continuación describe la política de reembolso.
- **`home_testimonials` no filtraba por estado**: la portada publica reseñas de mentorías en borrador
  y de tutores sin aprobar. Preexistente, arreglado de paso en `EY-192`.
- **La campana tiene 8 huecos y no prioriza.** NTF-21 es el primer aviso cuya frecuencia depende del
  tráfico de chat, así que puede desplazar a los que tienen plazo. Decisión de producto, sin tomar.
- ⚠️ **`grant select, update on public.profiles to authenticated` es de TABLA ENTERA**
  (`20260703120000:16`). Cualquier columna nueva en `profiles` nace escribible por el propio usuario
  vía PostgREST, y un `revoke update (columna)` **no lo arregla** mientras el privilegio de tabla siga
  puesto. Si hace falta guardar algo por usuario: **tabla aparte**.

### 🛠️ Y una lección de método

Los agentes con worktree **se crean desde `main`**, que iba entonces 141 commits y 44 migraciones por
detrás. ⚠️ **Ya no**: tras el merge del 26-ago (`3fca8b2`), `main` está a 52 commits y 7 migraciones
de `dev` — el `git merge dev` previo sigue haciendo falta, pero ya no es una base fantasma.
Quien no hace `git merge dev` antes de leer nada escribe sobre una base fantasma. De cinco agentes,
uno perdió su ejecución entera diagnosticando el git en vez de su ficha.

---

*Documento vivo. Se actualiza con cada rebanada cerrada y se empareja con Jira. Última edición: **2026-08-30** (**repaso de variables y trabajos programados**: `APP_BASE_URL` + `CRON_SECRET` dados de alta en GitHub tras **30 corridas en rojo** de los dos crons de Actions —el 100 % de las que hubo desde el merge del 26-ago—; comprobado que a **Vercel no le faltaba nada**: `CRON_SECRET`, `RESEND_API_KEY` y `STRIPE_API_KEY` ya estaban, y las tablas de este doc llevaban desde el 6-ago diciendo lo contrario; **la cadencia de los `cron` de GitHub es ficción** —pide 5 y 15 min, entrega una cada **2-6 h**, medido sobre 3,5 días—; los dos jobs quedan en **verde pero apuntando a producción, donde las colas están vacías**: los **336** avisos de correo y los **2** reembolsos `pending` viven en **dev** y ahí no llega ningún reloj, así que **X-01 sigue sin mover un euro**; estado de ramas al día: `main` = `3fca8b2`, `dev` +52 commits y **7** migraciones, no 141/44). Previo: **2026-08-26** (la jornada de los agentes: 46 commits, 10 migraciones y nueve fichas a `In Review`; y sobre todo **tres fallos que pasaron typecheck, lint y build y solo aparecieron al ejecutar** — los dos de `anonymize_account` (42501 de Storage y 428C9 de columna generada) y el panel de reserva, cuyo «arreglo» tapaba 11 de 15 chips de hora sobre una premisa falsa. De rebote: **`purge_expired_messages` hace el mismo `delete` prohibido sobre Storage** y es el cron de la retención que publican los legales; **no existe forma de reprogramar** aunque la FAQ lo prometa; `home_testimonials` publicaba borradores. ⚠️ Entre el 8 y el 25 de agosto hay un hueco deliberado en este relato — ver el aviso del encabezado. Previo: 2026-08-07 (**relato del 5–6 de agosto, tanda a tanda**: la **PR #11 se mergeó** (`1a36da2`, 5-ago) — se acabó el "dos merges", queda **uno** (`dev`→`main`) y las migraciones pendientes de prod pasan de **12 a 20**; `dev` va **43 commits** por delante de `main`. Pulido del 5-ago (5 commits, con la regresión del filtro de precio y el catálogo que dependía de quién miraba); **páginas legales redactadas** y el hallazgo de que el cliente ya tenía términos publicados en `ensenameya.com` desde marzo (buzón real `info@ensenameya.com`); 🐞 **US-1802 no encontraba ninguna grabación** (nombre de sala) y **la retención de 30 días ya borra de verdad**; 🔒 **`confirm_payment` sale del alcance del cliente** y se parte en dos; **C-11 RESUELTA → Resend**, con el stub que vaciaba la cola apagado y 🐞 **NTF-07 avisaba después de aceptar**; **Stripe PAC-01/PAC-03 verificados de punta a punta en test mode** contra la preview con webhook firmado — la premisa de `EY-92` ("esperar a ambas cuentas") era falsa; 🔎 **la campaña de Referral Factory no manda código**, así que la atribución de US-1302 hay que rehacerla por email y **RF-03 (`EY-148`) probablemente sobra**; lección repetida tres veces: **`service_role` no se salta los grants de tabla**; **dLocal rechazó la cuenta** y el fondo son los dos dominios sin conectar. Previo: 2026-08-04 (**pasada de veracidad contra el repo y Jira**: el proyecto lleva **8 sprints**, no 4; **DD-04 rehecho** como vista `tutors_public` + rango logarítmico (`cccb566`/`96f4e0b`, migración `20260804120000`); limpieza de código muerto (`9e56afb`/`63a7896`) y `AdminShell`+`TutorShell`→`PanelShell`; recuperado el bloque de commits del **27–28 jul**; **`EY-109` se arregló dos veces** y la buena es la del 27-jul (`b032cc5`), no la del 21; las 6 IV de EP-22 están en `Done` desde el 27-jul; Sprint 4, P01 y la captura de `?ref=` marcados como lo que son —hechos—; DD-03…DD-08 todas cerradas; C-06/C-12/C-15 añadidas al tracker. **El código está en la PR #11, no en producción**: `main` y `dev` siguen en `57edfa9` y hay **12 migraciones sin aplicar en prod**. Previo: 2026-07-29 (**las 6 tandas del plan, COMPLETAS**: los 20 tickets abiertos de los sprints 7 y 8 en código, más los 4 compromisos del 24-jul que no tenían ticket; 12 migraciones nuevas; QA con matriz de RLS ejecutada en `docs/QA-LANZAMIENTO.md`. Sprint 6 AC sigue esperando credenciales. Previo: **plan de los sprints 6 AC / 7 / 8**: inventario contra Jira — 20 tickets abiertos y todos en estos tres sprints; 4 compromisos del 24-jul sin ticket; `US-1302` y `DD-05` ya cumplidos a falta de verificar; Sprint 6 AC ejecutable a medias vía Stripe test mode). Previo: 2026-07-27 (**plan del 24-jul COMPLETO: 🅐 12/12 y 🅑 11/11** — `R24-01…23` en `dev`/`main`. Lo estructural del 27-jul: reserva día→clase→horario con precio dinámico, verificación dentro del onboarding, materiales y FAQ por producto, auto-aceptar, módulo de pagos, bandeja de chat, tz del visitante y fotos independientes. Quedan las **12 decisiones de pago (`C-xx`)** del cliente. Previo: **fila 🅐 COMPLETA — 12/12** en `dev`/`main`, commits `4bd2e51`→`bd3801c`: full-width fluido, hover, burbujas-ícono, buscar por nombre (migración `20260724140000`), buscador global, precio destacado, "Mi cuenta" con sidebar, admin historial/tiers, disponibilidad por día, pantalla cero, 🐞 zona horaria del usuario. Previo 24-jul: plan de acción `R24-01…23` + decisiones 13–30 del cliente cerradas; revisión nodo a nodo COMPLETA del Figma **P01–P09, AL01–AL08, TU01–TU09, AD01–AD15**).*
