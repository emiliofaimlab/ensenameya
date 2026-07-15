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
| **C-08** | Ventana de sala | US-801 | [ ] pendiente | 10/10 min |
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

## Sprint 3 — Sala en vivo · Reseñas · Payouts · Admin · Notificaciones · Chat ← **SPRINT ACTIVO**

> **19 historias / 83 SP.** Todas `To Do` en Jira al abrir el sprint (2026-07-14).

**Orden sugerido.** `US-1101` primero: es la llave que abre el resto — sin tutor aprobable desde la
app, el happy-path de publicar producto (US-402) y el E2E de reserva siguen dependiendo de aprobar a
mano en la BD. Cierra además el *boundary* que S2 dejó abierto.

- [ ] **EP-11 · Panel Admin** — `EY-68`…`EY-72`
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
  - [ ] **US-1105 · Estadísticas globales** `EY-72`
- [ ] **EP-08 · Sala en vivo (Daily)** — US-801 entrar a sala (token server-side) `EY-59` · US-802 ciclo de sesión `EY-60` · US-803 sala móvil `EY-61` · [!] **C-08** (default 10/10 min)
- [ ] **EP-09 · Reseñas** — US-901 dejar reseña (solo `completed`) `EY-62` · US-902 ver reseñas `EY-63`
- [ ] **EP-10 · Payouts** — US-1001 ver ingresos `EY-64` · US-1002 liquidación lote semanal `EY-65` · US-1003 gestión admin `EY-66` · US-1004 retiro self-service (RN-40) `EY-67`
- [ ] **EP-12 · Notificaciones** — US-1201 emails transaccionales (puerto `EmailProvider` + stub, [!] C-11) `EY-73` · US-1202 registro idempotente `EY-74`
- [ ] **EP-07** — US-704 reembolso manual admin `EY-58`
- [ ] **EP-17 · Chat** — US-1701 chat 1:1 (Realtime, RLS participantes, 2d antes/30d) `EY-75` · US-1703 purga pg_cron `EY-76`

### Deuda que S3 debe saldar (heredada de S2)

- **US-605:** `expire_stale_bookings()` tiene grant a `authenticated` por testabilidad → **revocar antes de prod** (solo cron/service_role).
- ~~**US-402:** happy-path de publicar/pausar/reanudar sin ejercitar con tutor aprobado~~ → ✅ **desbloqueado por US-1101**: ya se puede aprobar un tutor desde la app (queda ejercitar el happy-path).
- [x] ✅ **US-203 (EY-33) cerrada** — set final de **7 documentos** (migración `20260715130000`, cierra **C-14**): `id_document` · `degree` · `certificate` · `diploma` · `transcript` · `cv` · `social_media`. Este último es un **enlace, no archivo**: entra por columna propia `link_url` (meterlo en `storage_path` habría reventado el `createSignedUrls()` de la pantalla admin), con check `num_nonnulls(storage_path, link_url) = 1`. Los 3 tipos provisionales (`id_front`/`id_back`/`selfie`) se **borran** en la migración: sin eso seguirían contando en el agregado de identidad y la dejarían clavada (el tutor ya no puede re-subirlos porque salen del formulario). Los archivos de Storage no se tocan; en prod es no-op. El trigger ahora también escucha `DELETE`. **Verificado**: 7 filas en orden en la UI, `social_media` como input de texto con validación de URL (basura → no guarda ni pisa la buena), XOR archivo/enlace rechaza ambos y ninguno, y el admin distingue enlace firmado vs externo (`rel="noreferrer"`).
- [x] 🐞 **US-203 (EY-33) · subida de KYC rota** → ✅ **arreglado** (migración `20260715120000`). El `.upsert()` de `verification-form.tsx` fallaba **siempre** con 42501 (PostgREST lo vuelve `ON CONFLICT DO UPDATE SET tutor_id…, doc_type…` y las column-grants solo dan `update (storage_path)`, a propósito por US-1403). Solución: RPC `submit_document` (**no** se ampliaron las grants del cliente — eso abriría la escalada que la migración evitaba); valida que la ruta sea `<uid>/<doc_type>` porque corre como SECURITY DEFINER. Cierra además "repostular sin límite" (UX-203): re-subir devuelve el doc a `pending` y limpia `reviewed_*`/`review_notes`. **Verificado por la UI real** (subida → toast + badge Aprobado→En revisión) y por API (1ª subida, re-subida, rechazo→re-subida, ruta ajena → rechazada, anon → rechazado).
  - _De paso:_ la identidad pasó a ser una columna **derivada** vía trigger `refresh_identity_status` (antes se recalculaba a mano en `review_document` y `mark_identity_pending` solo cubría el primer insert). Una sola fuente; `review_document` ya no la recalcula.
- ❓ **Decisión de producto pendiente (destapada al arreglar lo anterior):** un tutor **ya aprobado** que re-sube un documento —o al que le rechazan uno— baja su identidad a `pending`/`rejected` pero **conserva `approval_status='approved'` y el rol `tutor`**, así que sigue vendiendo. RN-29 solo gobierna el *momento* de aprobar; no dice si hay que revocar después. Hoy la revocación es **manual** (el admin rechaza al tutor, y eso sí le retira el rol). Si se quiere automática, el sitio es el trigger. **Preguntar al cliente.**

---

## Tracks paralelos (fuera de S1–S4) — sync Jira 2026-07-14

No consumen SP del sprint. Se filtran en Jira por label.

- **EP-19 · Diseño UI** (`EY-87`, label `Sprint-Diseño`) — DS-01…04 (`EY-88`…`EY-91`) **In Review**, asignadas a Diana Rivera. Entregable **Figma**, no código (mismo matiz que EP-00). Al aprobarse, implica rediseño visual de pantallas ya construidas → historias de dev aún **no creadas**.
- **EP-20 · Activación Comercial** (`EY-92`, label `Sprint-Activacion-Comercial`) — PAC-01…04 (`EY-93`…`EY-96`) 🔒 **bloqueadas**: falta cuenta + API keys de **DLocal y Stripe**. El motor simulado ya está hecho y probado; esto es solo el cableado real. **C-01 está decidido** (DLocal + Stripe); el bloqueo ahora es administrativo.
- **EP-21 · UX Onboarding Tutor** (`EY-97`, label `Sprint-Mejoras-UX`) — UX-201…204 (`EY-98`…`EY-101`).
  ⚠️ **Redefine historias ya `Done`** (US-201/202/203). No es solo documentación:
  - **UX-203** (`EY-100`): **7 documentos** de KYC (`id_document`, `degree`, `certificate`, `diploma`, `transcript`, `cv`, `social_media`) vs los **3** construidos (`id_front`/`id_back`/`selfie`) → **resuelve C-14** y pide migración del set.
  - **UX-202** (`EY-99`): asistente **secuencial** de 5 pasos (contacto → headline/bio → **foto** → redes → **categorías**) vs el form único actual. Foto y categorías estaban **diferidas** en US-202 — aquí vuelven.
  - **UX-204** (`EY-101`): gate "Enviar a revisión" exige ≥1 producto `draft` — no existe hoy.

  Están redactadas como *requisitos de pantalla* (entregable = documento), pero su AC implica **re-trabajo de código**. Decidir si se abren historias de dev derivadas o se reabren US-202/203.

---

## Sprint 4 — Referidos · Observabilidad · Responsive/QA · Grabación · Avisos · Lanzamiento

> **39 SP.**

- [ ] **EP-12** US-1203 avisos in-app
- [ ] **EP-13** US-1301 widget Referral Factory · US-1302 captura `?ref=` ([!] C-10)
- [ ] **EP-15** US-1501 Sentry · US-1502 métricas pago/payout/webhook
- [ ] **EP-16** US-1601 responsive (360/768/1024/1280) · US-1602 QA + UAT (RLS por rol, webhooks idempotentes)
- [ ] **EP-17** US-1702 descargar conversación
- [ ] **EP-18** US-1801 grabar con consentimiento (RN-42, add-on Daily) · US-1802 ver/descargar 30 días · [!] decisión de negocio (coste)

---

*Documento vivo. Se actualiza con cada rebanada cerrada y se empareja con Jira. Última edición: 2026-07-14 (sync Jira + apertura de Sprint 3).*
