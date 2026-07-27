# Enséñame Ya — Plan de Desarrollo (checklist vivo)

> **Qué es esto.** El mapa de ejecución del MVP, organizado por los **4 sprints** del backlog.
> El **"qué y cuándo"** manda en **`docs/BACKLOG.md`** (espejo de Jira); aquí llevamos el **estado
> real de construcción** (hecho / en curso / pendiente) rebanada a rebanada. El **"cómo"** lo ejecutan
> los skills `/nueva-migracion` y `/nueva-pantalla`, y se cierra con `/verify` o `/run`.
>
> - **Alcance y sprints:** `docs/BACKLOG.md` + Jira.
> - **Deltas sobre los docs técnicos:** `docs/context/ADENDA-BACKLOG-v1.md`.
> - **Cómo (técnico):** Docs 00–09 en `docs/context/`. **Reglas que no se rompen:** `CLAUDE.md`.
>
> ⚠️ **Nota histórica:** este plan estaba organizado por hitos `M0–M10`. Migró a **sprints S1–S4**.
> Los `M1/M2/M4…` que aparecen en los Docs 00–09 son **máquinas de estado** (Doc 2), no hitos.

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
| C-10 | Reglas de referidos | US-1301 | [ ] pendiente | Solo captura `?ref=` |
| C-11 | Email transaccional | US-1201 | [ ] pendiente | Puerto `EmailProvider` + stub |

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
  - [ ] Captura `?ref=` → `profiles.referral_code` (parte de US-1302, S4; capturar ya aunque la lógica sea externa)
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
- [ ] **P01 · Landing** `/` — hero + buscador + destacados (hoy hay home-esqueleto neutra). _SCR-P01_

### EP-14 · Seguridad / RLS (transversal)
- [x] **US-1401 · RLS default-deny** — en todas las tablas (profiles/user_roles/categorías/tutor_profiles/products/product_categories/verification_documents) **y Storage**; grants explícitos por rol. Verificado por rol esta sesión (anon `[]` en lo privado, tutor `403` anti-escalada, admin por `has_role`). Práctica transversal: cada tabla nueva nace con ella.
- [x] **US-1402 · Escritura financiera solo service_role** — con EP-06 Fase 1/3: `payments`/`bookings`/`sessions` sin grant de escritura de cliente (403 verificado); todo cambio por RPC `SECURITY DEFINER` (create_booking/confirm_payment). El cliente solo lee lo suyo.
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
- [x] **EP-08 · Sala en vivo (Daily)** ✅ — Daily **cableado de verdad** (US-801, migración `20260717120000` + `src/lib/daily.ts` + `/api/room/[sessionId]`), con la **credencial como interruptor**: sin `DAILY_API_KEY` la sala va **simulada** (como el PSP); con la clave, Daily real, sin tocar código. En prod hoy corre simulada (la cuenta de Daily espera método de pago — ver PR #4). Migración base `20260716120000`.
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
  - [x] **US-1201 · Emails transaccionales** `EY-73`: el "puerto EmailProvider" es la tabla `notifications` (canal + plantilla + payload, Doc 7); el "stub" es `process_notifications` (cron cada 2 min, `pending`→`sent`). El proveedor real (SendGrid u otro, **C-11/DP-05**) será una Edge Function que lea las `pending` y envíe — sin tocar el negocio. **Desestubea los NTF-xx**: se disparan por **triggers sobre las transiciones** (no desde las RPC de dinero → sin recrear funciones de pago), cubriendo el grueso de la matriz reactiva: NTF-03/06 (tutor), NTF-05/07/09/14 (booking), NTF-04/10/15 (payment), NTF-12/16 (payout). NTF-01/02 los cubre Supabase Auth.
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
- **EP-20 · Activación Comercial** (`EY-92`, label `Sprint-Activacion-Comercial`) — PAC-01…04 (`EY-93`…`EY-96`) 🔒 **bloqueadas**: falta cuenta + API keys de **DLocal y Stripe**. El motor simulado ya está hecho y probado; esto es solo el cableado real. **C-01 está decidido** (DLocal + Stripe); el bloqueo ahora es administrativo.
- **EP-21 · UX Onboarding Tutor** (`EY-97`, label `Sprint-Mejoras-UX`) — UX-201…204 (`EY-98`…`EY-101`).
  ⚠️ **Redefine historias ya `Done`** (US-201/202/203). No es solo documentación:
  - **UX-203** (`EY-100`): **7 documentos** de KYC (`id_document`, `degree`, `certificate`, `diploma`, `transcript`, `cv`, `social_media`) vs los **3** construidos (`id_front`/`id_back`/`selfie`) → **resuelve C-14** y pide migración del set.
  - **UX-202** (`EY-99`): asistente **secuencial** de 5 pasos (contacto → headline/bio → **foto** → redes → **categorías**) vs el form único actual. Foto y categorías estaban **diferidas** en US-202 — aquí vuelven.
  - **UX-204** (`EY-101`): gate "Enviar a revisión" exige ≥1 producto `draft` — no existe hoy.

  Están redactadas como *requisitos de pantalla* (entregable = documento), pero su AC implica **re-trabajo de código**. Decidir si se abren historias de dev derivadas o se reabren US-202/203.

- **EP-22 · Integración Visual** (`EY-102`, label `Sprint-Integracion-Visual`) — el **lado de código** de EP-19. **Las 6 IV `In Review` y en producción (2026-07-22, PR #6→dev, PR #7→main).** Detalle y mapeo a páginas de Figma en `docs/BACKLOG.md` §4.2.
  - [x] **IV-01** (`EY-103`) · auth — AU01…AU04 + **header y footer globales** + tokens del Figma para toda la app. `95aacc6`.
  - [x] **IV-02** (`EY-104`) · onboarding — TU01 (5 pasos) + AL01 (3 pasos). Trajo **modelo nuevo** (migración `20260722160000`: `avatar_path` + bucket `avatars`, `tutor_categories`, `student_interests`, `tutor_materials` + bucket privado, `teaching_level`). `b68b20c` + `1b0efb6`. ⚠️ Paso 4 en **desencuentro con diseño** (KYC vs materiales de clase); **AL01 sin verificar en navegador**.
  - [x] **IV-03** (`EY-105`) · públicas — P01…P09, incluidas `/about` y `/how-it-works` como rutas **nuevas**. `8a186a7` + `676972f`.
  - [x] **IV-04** (`EY-106`) · dashboard alumno (AL02…AL08) + **LV01 sala en vivo**: chat lateral (reutiliza el hilo de EP-17) + "Subir documentos" (adjunto de `messages` + bucket `chat-attachments`). `dffa023`…`fa8bec9`.
  - [x] **IV-05** (`EY-107`) · dashboard tutor (TU03…TU09) · [x] **IV-06** (`EY-108`) · panel admin (AD02…AD15). Shell de panel compartido. `036a346` + `f521315`.
  - Rama `feat/iv01-auth-visual`: 25 commits, **mergeada y borrada** tras el release.
  - **Techo de estado: `In Review`.** Ninguna IV pasa a `Done` sin aprobación del cliente y copy final. ⚠️ **Se publicó a prod sin ese go** (decisión de negocio, reunión del 17-jul `00:28:40`).
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
  - [ ] DD-03…DD-08 siguen `To Do`.
  - ⚠️ **Semilla de dev sin aplicar:** `supabase/seed/p01-demo-images.sql` (miniaturas y fotos demo). Los ficheros ya están en los buckets; hay que **ejecutarlo a mano en el SQL Editor de dev** — los tutores demo no pueden iniciar sesión y la RLS impide que ni un admin escriba en el catálogo ajeno.

- 🐞 **Sin ticket todavía (EP-03) — el catálogo público de productos devolvía CERO sin sesión.** ✅ Corregido el 2026-07-23 (migración `20260723130000`); **falta abrirlo en Jira**. `products_select_booked` (migración del 22-jul) se creó **sin `to authenticated`**, así que también se evaluaba para `anon`, que no tiene grant sobre `bookings` → todo `select` anónimo sobre `products` moría con `permission denied for table bookings`. Home, `/classes`, `/search`, `/categories/[slug]` y el detalle salían vacíos **para quien no había iniciado sesión**; con sesión funcionaba, y por eso no se vio en IV-03. Verificado: `anon` pasa de 0 a 5 productos. **Llega a prod al mergear a `main`.**

- 🐞 **`EY-109` (en EP-03) — buscar sin tildes devolvía cero resultados.** ✅ **Corregido y en prod** (`In Review`, migraciones `20260721120000` + `20260721130000`). El primer intento indexó sobre texto ya sin tildes y rompió el stemmer español; la corrección indexa **las dos ramas** (con y sin tilde). `matematicas`/`Matemáticas`, `programacion`/`Programación`, `calculo`/`cálculo`, `ingles`/`inglés` devuelven ya el mismo conjunto.

---

## Sprint 4 — Observabilidad · Responsive/QA · Grabación · Avisos · Lanzamiento

> **39 SP.** ⚠️ **Reordenado en la reunión del 17-jul** (`00:59:03` y `01:01:36`): los **referidos
> bajan a los dos últimos sprints** — el cliente aún no busca leads y el widget es trabajo *externo*
> (Referral Factory) que pararía el pulido de lo propio. Las **integraciones también van al final**.
> El sprint pasa a dedicarse a **pegar el desarrollo al diseño aprobado** y a los módulos backend ya
> validados, que son los que menos van a cambiar.

- [ ] **EP-12** US-1203 avisos in-app
- [ ] **EP-15** US-1501 Sentry · US-1502 métricas pago/payout/webhook — *(integración: al final)*
- [ ] **EP-16** US-1601 responsive (360/768/1024/1280) · US-1602 QA + UAT (RLS por rol, webhooks idempotentes)
- [ ] **EP-17** US-1702 descargar conversación
- [ ] **EP-18** US-1801 grabar con consentimiento (RN-42, add-on Daily) · US-1802 ver/descargar 30 días · [!] decisión de negocio (coste)
- ~~**EP-13** US-1301 widget Referral Factory · US-1302 captura `?ref=`~~ → **movido a los últimos
  dos sprints** (17-jul). Necesita cuenta de Referral Factory con tarjeta del cliente, igual que Daily.

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

> **12/12 hechas, verificadas en dev y en `main`/`dev`.** Commits abajo. Quedan
> dos sub-ítems menores (no bloqueantes): R24-02 "año/ñ cortado" (falta el sitio
> exacto que vio el cliente) y la disponibilidad **pública sin sesión** →
> tz del navegador (follow-up de decisión-13, ligado a la lógica de día de
> `BookingPanel`).

| Handle | Estado | Commit | Nota de ejecución |
| :-- | :-- | :-- | :-- |
| **R24-01** | ✅ | `4bd2e51` | `Container` cap 1280→1664 (contenido fluido a 1536); fondos ya sangraban. Verificado 1920/1280. **Paneles quedan a 1280** (decisión B) |
| **R24-02** | ✅ hover | `e9813a4` | Realce naranja de `TrustCards` como hover, no fijo. ❓ "año/ñ cortado": headings no se recortan a 1920 (falta pinpoint) |
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
| **R24-02** | Hover roto en Nosotros ("tranquilidad garantizada") + márgenes + **bug ñ / caracteres especiales** | EP-22 | S | El acento naranja debe ser hover, no estático (`00:24:35`) |
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
| **R24-19** | ✅ | `8fb18e4` | `auto_accept_bookings` + `confirm_payment` v3 (pagado → `confirmed`); toggle en TU07 |
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

---

*Documento vivo. Se actualiza con cada rebanada cerrada y se empareja con Jira. Última edición: 2026-07-27 (**plan del 24-jul COMPLETO: 🅐 12/12 y 🅑 11/11** — `R24-01…23` en `dev`/`main`. Lo estructural del 27-jul: reserva día→clase→horario con precio dinámico, verificación dentro del onboarding, materiales y FAQ por producto, auto-aceptar, módulo de pagos, bandeja de chat, tz del visitante y fotos independientes. Quedan las **12 decisiones de pago (`C-xx`)** del cliente y el sub-ítem R24-02 "año/ñ cortado" sin pinpoint. Previo: **fila 🅐 COMPLETA — 12/12** en `dev`/`main`, commits `4bd2e51`→`bd3801c`: full-width fluido, hover, burbujas-ícono, buscar por nombre (migración `20260724140000`), buscador global, precio destacado, "Mi cuenta" con sidebar, admin historial/tiers, disponibilidad por día, pantalla cero, 🐞 zona horaria del usuario; pendientes menores R24-02 "año/ñ cortado" y tz de disponibilidad pública sin sesión. Previo 24-jul: plan de acción `R24-01…23` + decisiones 13–30 del cliente cerradas; revisión nodo a nodo COMPLETA del Figma **P01–P09, AL01–AL08, TU01–TU09, AD01–AD15**).*
