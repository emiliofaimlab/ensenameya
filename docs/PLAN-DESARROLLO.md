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
| **C-01** | Proveedor de pago | Pago real (S2/prod) | [ ] pendiente | Proveedor **simulado** |
| ~~C-03~~ | ~~Reembolsos~~ | — | ✅ **resuelto** (RN-37: 100/50/100) | — |
| **C-07** | Ventana de pago | US-605 | [ ] pendiente | **20 min** |
| **C-08** | Ventana de sala | US-801 | [ ] pendiente | 10/10 min |
| **C-09** | %s de tiers | US-1103 | [ ] pendiente | 75/85/90 seed |
| **C-13** | Mercado/Venezuela | Payouts/corredores | [ ] pendiente | 1 corredor demo |
| **C-14** | Docs para aprobar tutor | US-203 KYC | [ ] pendiente | Set provisional (id/título) |
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
- [ ] **US-203 · KYC Tutor** `/tutor/verification` — subir `id_document, degree, certificate, diploma, transcript, cv, social_media` → `identity: pending`; NTF-06 (stub). _SCR-TU02 · [!] C-14 (set final de docs)_

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
- [~] **Seed demo:** tutores aprobados + productos activos → `supabase/seed/ep03-demo.sql` (**dev-only**, fuera de migrations); **pendiente aplicar a dev** (SQL Editor / psql — necesita service_role o password de BD)

**Pantallas:**
- [x] **US-301 · Explorar Tutores** `/tutors` — solo `approved`; **filtro por categoría** + paginación; orden por rating. Verificado en dev con seed. _(rating/precio como filtro → diferido; rating ya se muestra)_ _SCR-P04_
- [x] **US-302 · Explorar Productos/Categorías** `/classes` + `/categories` + `/categories/{slug}` — activos por categoría N–M; filtro por categoría + paginación. Verificado en dev. _(filtros precio/modelo/duración → diferidos)_ _SCR-P05/P06_
- [x] **US-303 · Búsqueda** `/search?q=` — full-text en `products` (`search_vector` tsvector `spanish`); sin `q`/sin resultados → sugerencias por categoría. Verificado (`app`→"Tu primera app web"). _(tutor/categoría como resultado → diferido)_ _SCR-P09_
- [x] **US-304 · Perfil Tutor / Detalle Producto** `/tutors/{id}` + `/products/{id}` — headline, bio, rating, clases con categorías, precio por modelo, CTA Reservar (→ login sin sesión). Verificado en dev. _Diferido a su épica: reseñas (US-902/S3), disponibilidad (EP-05/S2), checkout real (EP-06/S2)._ _SCR-P07/P08_
- [ ] **P01 · Landing** `/` — hero + buscador + destacados (hoy hay home-esqueleto neutra). _SCR-P01_

### EP-14 · Seguridad / RLS (transversal)
- [~] **US-1401 · RLS default-deny** — ya en `profiles`/`user_roles`; **aplicar a cada tabla nueva** de EP-03 al crearla.
- [ ] **US-1402 · Escritura financiera solo service_role** — sin tablas financieras aún; guarda al llegar EP-06/07.
- [x] **US-1403 · Anti-escalada de privilegios** — roles sin escritura de cliente (default-deny); `tutor_profiles` con **column-grants**: el tutor no puede tocar `approval_status`/tier. **Verificado**: PATCH `approval_status` → 403; `headline` → 200. `tier_id` (S3) hereda el patrón.

### EP-16 · Ambientes (adelanto en S1)
- [x] **US-1603 · dev + prod cloud** — proyecto Supabase por ambiente; Vercel preview por PR + prod desde `main` (`ensenameya.vercel.app`); CI de migraciones + lint/typecheck; Auth. → **`docs/ENTORNOS.md`**.

---

## Sprint 2 — Catálogo tutor · Disponibilidad · Reserva · Pagos · Webhooks

> **74 SP.** Cierra el flujo del dinero (proveedor **simulado**) y deja el esqueleto andando.

- [ ] **EP-04** US-401 crear/editar productos · US-402 publicar/pausar/archivar (RN-23) · US-403 política única de plataforma (RN-37)
- [ ] **EP-05** US-501 horarios recurrentes (`end>start`) · US-502 excepciones `block`/`open`
- [ ] **EP-06** US-601 elegir slot · US-602 checkout (card-on-file RN-43) · US-603 confirmación · US-604 cancelar (reembolso RN-37) · US-605 autocancelar 20 min · **US-606 aceptar/rechazar 24h (`pending_acceptance`, RN-38)** · US-607 card-on-file
- [ ] **EP-07** US-701 routing por geografía · US-702 split por tier (snapshot) · US-703 webhooks idempotentes · US-705 nuevos proveedores sin tocar el core · [!] **C-01** (proveedor real → post-MVP)

> **Hito visible:** registro → descubrir → reservar → "pagar" (simulado) → tutor acepta → reserva confirmada con sesiones. 🦴

---

## Sprint 3 — Sala en vivo · Reseñas · Payouts · Admin · Notificaciones · Chat

> **83 SP.**

- [ ] **EP-08** US-801 entrar a sala (Daily, token server-side) · US-802 ciclo de sesión · US-803 sala móvil · [!] C-08
- [ ] **EP-09** US-901 dejar reseña (solo `completed`) · US-902 ver reseñas
- [ ] **EP-10** US-1001 ver ingresos/payouts · US-1002 liquidación lote semanal (7d) · US-1003 gestión admin · US-1004 retiro self-service (RN-40)
- [ ] **EP-11** US-1101 aprobar tutores+KYC · US-1102 categorías · US-1103 tiers (75/85/90, [!] C-09) · US-1104 supervisar pagos/reservas · US-1105 estadísticas
- [ ] **EP-12** US-1201 emails transaccionales (puerto `EmailProvider` + stub, [!] C-11) · US-1202 registro idempotente
- [ ] **EP-07** US-704 reembolso manual admin
- [ ] **EP-17** US-1701 chat 1:1 (Realtime, RLS participantes, 2d antes/30d) · US-1703 purga pg_cron

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

*Documento vivo. Se actualiza con cada rebanada cerrada y se empareja con Jira. Última edición: 2026-07-06.*
