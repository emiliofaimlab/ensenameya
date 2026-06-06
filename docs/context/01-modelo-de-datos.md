# DOC 1 — Modelo de Datos y Diccionario de Campos

> **Enséñame Ya — MVP Web.** Esquema físico PostgreSQL/Supabase derivado del Doc 0.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 1 — Modelo de Datos y Diccionario de Campos |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Base** | Supabase (PostgreSQL) + RLS |
| **Depende de** | Doc 0 (entidades, RN, supuestos) |
| **Estado** | Aprobado |
| **Fecha** | 2026-06-02 |

---

## 1.1 Propósito y alcance

Define el **esquema físico** del MVP: tablas, campos (tipo, nulabilidad, llaves, índices), relaciones y **consideraciones de RLS por rol**. Es la traducción del modelo conceptual del Doc 0 a PostgreSQL/Supabase. La **matriz CRUD completa** va en el Doc 3; las **transiciones de estado** (valores de los `enum` de estado) se detallan en el Doc 2. El **ERD visual** se agrega en la pasada final.

---

## 1.2 Convenciones de modelado

| Convención | Decisión |
| :-- | :-- |
| **Esquema** | Tablas de negocio en `public`; autenticación en `auth.users` (gestionado por Supabase Auth). |
| **PK** | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (salvo tablas puente / extensiones 1:1). |
| **Auditoría** | `created_at timestamptz NOT NULL DEFAULT now()` y `updated_at timestamptz NOT NULL DEFAULT now()` (trigger de actualización) en toda tabla mutable. |
| **Fechas/horas** | Siempre `timestamptz` en **UTC** (RN-02). Horas locales de plantilla de disponibilidad como `time` + `timezone` del tutor. |
| **Dinero** | `bigint` en **unidades menores** (centavos) + `currency char(3)` ISO-4217. SUPUESTO S-12. |
| **Estados** | Tipos `enum` de Postgres (ver 1.3); las transiciones están en Doc 2. |
| **Proveedor de pago** | Campo `text` (no `enum`) para no acoplar y permitir alta sin migración (RN-16 / DP-01). SUPUESTO S-16. |
| **Borrado** | Preferimos `status`/`is_active` sobre borrado físico, para conservar historial transaccional. |

---

## 1.3 Tipos enumerados (enum)

*Valores; las transiciones están en Doc 2.*

| Enum | Valores |
| :-- | :-- |
| `user_role` | `alumno`, `tutor`, `admin` |
| `tutor_approval_status` | `pending`, `approved`, `rejected`, `suspended` |
| `identity_verification_status` | `not_submitted`, `pending`, `approved`, `rejected` |
| `pricing_model` | `per_session`, `per_hour`, `per_package` |
| `product_status` | `draft`, `active`, `paused`, `archived` |
| `booking_status` | `pending_payment`, `confirmed`, `in_progress`, `completed`, `cancelled`, `refunded` |
| `session_status` | `scheduled`, `in_progress`, `completed`, `cancelled`, `no_show` |
| `payment_status` | `pending`, `authorized`, `paid`, `failed`, `refunded`, `partially_refunded` |
| `payout_status` | `pending`, `scheduled`, `processing`, `paid`, `failed`, `on_hold` |
| `document_status` | `pending`, `approved`, `rejected` |
| `availability_exception_type` | `block`, `open` |

---

## 1.4 Diccionario de tablas

> Formato: **Campo | Tipo | Restricciones | Descripción**. "RLS" resume el acceso por rol (detalle en Doc 3).

### 1.4.1 `profiles` — Usuario (extensión 1:1 de `auth.users`)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK, FK -> `auth.users.id` | Mismo id que el usuario de Auth. |
| `full_name` | text | NOT NULL | Nombre para mostrar. |
| `email` | text | NULL | Espejo de `auth.users.email` (canónico en Auth). S-17. |
| `avatar_url` | text | NULL | Foto (Supabase Storage). |
| `timezone` | text | NOT NULL | Zona IANA, obligatoria (RN-01). |
| `country` | char(2) | NULL | ISO-3166-1; país del alumno (corredor de cobro). |
| `preferences` | jsonb | NOT NULL DEFAULT `'{}'` | Atributos ligeros del alumno (S-01). |
| `referral_code` | text | NULL | Atribución capturada del frontend (Referral Factory); sin lógica interna (S-11/S-18). |
| `created_at` / `updated_at` | timestamptz | NOT NULL | Auditoría. |

**RLS:** el usuario lee/edita su propia fila; `admin` todo. No es pública (los datos públicos del tutor viven en `tutor_profiles`). **Índices:** PK; `country`.

### 1.4.2 `user_roles` — roles (un usuario puede tener varios)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `user_id` | uuid | FK -> `profiles.id` | Usuario. |
| `role` | user_role | NOT NULL | Rol asignado. |
| `created_at` | timestamptz | NOT NULL | — |
| — | — | UNIQUE(`user_id`,`role`) | Evita duplicados. |

**RLS:** el usuario lee sus roles; solo `admin` inserta/borra (alta de `admin` restringida). Helper `public.has_role(uid, role)` `SECURITY DEFINER` para usar en políticas. SUPUESTO S-14.

### 1.4.3 `tutor_tiers` — niveles de tutor / split

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `name` | text | NOT NULL | Ej. "Tier 1". |
| `split_pct` | numeric(5,2) | NOT NULL, CHECK 0–100 | % que recibe el tutor (RN-06). |
| `is_default` | boolean | NOT NULL DEFAULT false | Tier asignado al aprobar. |
| `description` | text | NULL | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** lectura `admin` (y el tutor puede leer su tier); escritura solo `admin` (RN-07). Los cambios aplican a reservas nuevas (S-08): el `split_pct` se congela en `bookings`/`payments`.

### 1.4.4 `tutor_profiles` — Tutor (extensión 1:1 de `profiles`)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `profile_id` | uuid | PK, FK -> `profiles.id` | Tutor = usuario con rol `tutor`. |
| `tier_id` | uuid | FK -> `tutor_tiers.id`, NULL | Tier asignado (al aprobar). |
| `headline` | text | NULL | Titular corto. |
| `bio` | text | NULL | Biografía. |
| `approval_status` | tutor_approval_status | NOT NULL DEFAULT `pending` | Aprobación manual (RN-04). |
| `identity_verification_status` | identity_verification_status | NOT NULL DEFAULT `not_submitted` | KYC manual (RN-05). |
| `payout_country` | char(2) | NULL | País donde cobra el tutor -> decisivo para el ruteo (RN-15). |
| `default_cancellation_policy` | jsonb | NULL | Política por defecto del tutor (RN-11); valores sujetos a DP-03. |
| `rating_avg` | numeric(3,2) | NULL | Agregado de reseñas (trigger). |
| `rating_count` | integer | NOT NULL DEFAULT 0 | — |
| `approved_at` | timestamptz | NULL | — |
| `approved_by` | uuid | FK -> `profiles.id`, NULL | Admin que aprobó. |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** lectura pública solo si `approval_status='approved'` (perfil público); el tutor lee/edita campos propios (no `approval_status`/`tier_id`, que son de `admin`); `admin` todo. **Índices:** `tier_id`, `approval_status`, `payout_country`.

### 1.4.5 `categories` — categorías (admin)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `name` | text | NOT NULL | — |
| `slug` | text | NOT NULL, UNIQUE | Para URLs de descubrimiento. |
| `description` | text | NULL | — |
| `is_active` | boolean | NOT NULL DEFAULT true | — |
| `sort_order` | integer | NOT NULL DEFAULT 0 | Orden de despliegue. |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** lectura pública (`is_active`); escritura solo `admin`. **Índices:** `slug` único. SUPUESTO S-13: categorías planas (sin jerarquía) en MVP.

### 1.4.6 `products` — Producto / "Tutoría"

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `tutor_id` | uuid | FK -> `profiles.id`, NOT NULL | Tutor dueño. |
| `title` | text | NOT NULL | — |
| `slug` | text | NULL | — |
| `description` | text | NULL | — |
| `outcome` | text | NULL | Resultado que promete (propuesta de valor). |
| `pricing_model` | pricing_model | NOT NULL | Por sesión / hora / paquete (RN-10). |
| `price_amount` | bigint | NOT NULL, CHECK >= 0 | Unidades menores; significado según `pricing_model`. |
| `currency` | char(3) | NOT NULL | ISO-4217. |
| `session_duration_min` | integer | NULL, CHECK >= 30 | Duración por sesión (RN-03). |
| `package_num_sessions` | integer | NULL, CHECK >= 1 | Solo `per_package` (N sesiones, 1 participante). |
| `status` | product_status | NOT NULL DEFAULT `draft` | Visibilidad. |
| `cancellation_policy` | jsonb | NULL | Override de la política del tutor (RN-11). |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**Reglas:** un producto solo puede estar `active` si el tutor está `approved` (RN-04; trigger/política). **RLS:** lectura pública si `status='active'` y tutor aprobado; el tutor hace CRUD de los suyos; `admin` todo. **Índices:** `tutor_id`, `status`; índice de texto en `title`/`description` para búsqueda (RN-20). SUPUESTO S-20: en `per_hour`, la duración concreta se elige al reservar (múltiplos de 30 min).

### 1.4.7 `product_categories` — puente Producto↔Categoría (N—M, RN-09)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `product_id` | uuid | FK -> `products.id` | — |
| `category_id` | uuid | FK -> `categories.id` | — |
| — | — | PK(`product_id`,`category_id`) | — |

**RLS:** lectura pública (según visibilidad del producto); escritura tutor (de su producto) / `admin`. **Índices:** PK compuesta; `category_id` (descubrimiento por categoría).

### 1.4.8 `availability_rules` — disponibilidad recurrente (S-03)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `tutor_id` | uuid | FK -> `profiles.id`, NOT NULL | — |
| `weekday` | smallint | NOT NULL, CHECK 0–6 | 0=domingo. |
| `start_time` | time | NOT NULL | En timezone del tutor. |
| `end_time` | time | NOT NULL, CHECK > `start_time` | — |
| `is_active` | boolean | NOT NULL DEFAULT true | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** lectura pública (tutores aprobados, para mostrar horarios); el tutor gestiona los suyos; `admin` todo. **Índices:** `tutor_id`.

### 1.4.9 `availability_exceptions` — excepciones puntuales (S-03)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `tutor_id` | uuid | FK -> `profiles.id`, NOT NULL | — |
| `date` | date | NOT NULL | Día afectado. |
| `type` | availability_exception_type | NOT NULL | `block` (bloquea) u `open` (abre extra). |
| `start_time` / `end_time` | time | NULL | Rango parcial (si aplica). |
| `reason` | text | NULL | — |
| `created_at` | timestamptz | NOT NULL | — |

**RLS:** igual que `availability_rules`. **Índices:** (`tutor_id`,`date`).

### 1.4.10 `bookings` — Reserva

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `student_id` | uuid | FK -> `profiles.id`, NOT NULL | Alumno. |
| `product_id` | uuid | FK -> `products.id`, NOT NULL | — |
| `tutor_id` | uuid | FK -> `profiles.id`, NOT NULL | Denormalizado (RLS/consultas). |
| `status` | booking_status | NOT NULL DEFAULT `pending_payment` | — |
| `pricing_model` | pricing_model | NOT NULL | Snapshot. |
| `num_sessions` | integer | NOT NULL, CHECK >= 1 | 1 (sesión/hora) o N (paquete) (RN-12). |
| `session_duration_min` | integer | NOT NULL, CHECK >= 30 | Snapshot. |
| `currency` | char(3) | NOT NULL | — |
| `subtotal_amount` | bigint | NOT NULL | Snapshot de precio. |
| `total_amount` | bigint | NOT NULL | Total cobrado. |
| `tier_split_pct` | numeric(5,2) | NOT NULL | Snapshot del split (S-08). |
| `cancellation_policy` | jsonb | NULL | Snapshot de la política efectiva. |
| `payer_country` / `payee_country` | char(2) | NULL | Snapshot para ruteo (RN-15). |
| `completed_at` / `cancelled_at` | timestamptz | NULL | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** el alumno lee/crea las suyas; el tutor lee las de sus productos; `admin` todo. Cambios de `status` vía funciones controladas (Doc 2). **Índices:** `student_id`, `tutor_id`, `product_id`, `status`.

### 1.4.11 `sessions` — Sesión / Clase

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `booking_id` | uuid | FK -> `bookings.id`, NOT NULL | — |
| `tutor_id` / `student_id` | uuid | FK -> `profiles.id`, NOT NULL | Denormalizado. |
| `sequence_no` | integer | NULL | Orden 1..N dentro del paquete. |
| `start_at` | timestamptz | NOT NULL | UTC (RN-02). |
| `end_at` | timestamptz | NOT NULL, CHECK >= start+30min | Duración mínima 30 (RN-03). |
| `status` | session_status | NOT NULL DEFAULT `scheduled` | — |
| `daily_room_name` | text | NULL | Sala Daily. |
| `daily_room_url` | text | NULL | — |
| `access_opens_at` / `access_closes_at` | timestamptz | NULL | Ventana de acceso (S-07, RN-18). |
| `completed_at` / `cancelled_at` | timestamptz | NULL | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** solo participantes (alumno/tutor de la sesión) leen; `admin` todo. El token de Daily se genera server-side al unirse (no se almacena). **Índices:** `booking_id`, `start_at`, `status`, `tutor_id`, `student_id`.

### 1.4.12 `payments` — Pago (1:1 con Reserva, S-04)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `booking_id` | uuid | FK -> `bookings.id`, UNIQUE, NOT NULL | Un pago por reserva (S-04). |
| `status` | payment_status | NOT NULL DEFAULT `pending` | — |
| `currency` | char(3) | NOT NULL | Moneda de cobro. |
| `gross_amount` | bigint | NOT NULL | Cobrado al alumno. |
| `platform_fee_amount` | bigint | NOT NULL | Comisión plataforma (RN-08/13). |
| `tutor_net_amount` | bigint | NOT NULL | Neto del tutor. |
| `tier_split_pct` | numeric(5,2) | NOT NULL | Snapshot. |
| `payer_country` / `payee_country` | char(2) | NULL | Snapshot de ruteo. |
| `provider` | text | NULL | Proveedor resuelto (DP-01); no enum (S-16). |
| `provider_payment_id` | text | NULL | Referencia externa. |
| `provider_metadata` | jsonb | NULL | Payload del proveedor. |
| `settlement_currency` | char(3) | NULL | Moneda de liquidación si difiere (DP-07). |
| `fx_rate` | numeric | NULL | Tipo de cambio aplicado (DP-07). |
| `refunded_amount` | bigint | NOT NULL DEFAULT 0 | Acumulado de reembolsos (DP-03). |
| `paid_at` / `failed_at` | timestamptz | NULL | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** el alumno lee el de su reserva; el tutor lee montos de las suyas; `admin` todo. Escrituras solo vía service role / webhooks (no desde el cliente) — S-15. **Índices:** `booking_id` único, `status`, `provider`, `provider_payment_id`.

### 1.4.13 `payouts` — Payout (liquidación)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `tutor_id` | uuid | FK -> `profiles.id`, NOT NULL | — |
| `status` | payout_status | NOT NULL DEFAULT `pending` | — |
| `currency` | char(3) | NOT NULL | — |
| `amount` | bigint | NOT NULL | Suma de `payout_items`. |
| `provider` | text | NULL | Elegido por `payee_country` (DP-01). |
| `provider_payout_id` | text | NULL | Ref. externa. |
| `provider_metadata` | jsonb | NULL | — |
| `retention_until` | timestamptz | NULL | Fin de retención (DP-02: 15/30 d). |
| `scheduled_for` | timestamptz | NULL | Fecha programada. |
| `paid_at` / `failed_at` | timestamptz | NULL | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** el tutor lee los suyos; `admin` todo; escritura service role (S-15). **Índices:** `tutor_id`, `status`, `scheduled_for`.

### 1.4.14 `payout_items` — puente Pago↔Payout (compatible con DP-06)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `payout_id` | uuid | FK -> `payouts.id`, NOT NULL | — |
| `payment_id` | uuid | FK -> `payments.id`, UNIQUE, NOT NULL | Un pago entra en <= 1 payout. |
| `amount` | bigint | NOT NULL | Neto del tutor incluido. |
| `created_at` | timestamptz | NOT NULL | — |

**Nota de diseño:** esta tabla puente soporta ambas opciones de DP-06 sin migración (1:1 = payout con un solo ítem; lote = varios ítems). **RLS:** lectura vía payout del tutor; `admin` todo; escritura service role.

### 1.4.15 `reviews` — Reseña (por compra, RN-17)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `booking_id` | uuid | FK -> `bookings.id`, UNIQUE, NOT NULL | Una reseña por compra (RN-17). |
| `student_id` / `tutor_id` | uuid | FK -> `profiles.id`, NOT NULL | Denormalizado. |
| `product_id` | uuid | FK -> `products.id`, NOT NULL | Para rating por producto. |
| `rating` | smallint | NOT NULL, CHECK 1–5 | — |
| `comment` | text | NULL | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** el alumno crea la suya solo si la reserva está `completed` (política/trigger, RN-17); lectura pública (perfil del tutor); `admin` todo. Trigger actualiza `tutor_profiles.rating_avg/count`. **Índices:** `tutor_id`, `product_id`, `booking_id` único.

### 1.4.16 `verification_documents` — KYC manual (S-10)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `tutor_id` | uuid | FK -> `profiles.id`, NOT NULL | — |
| `doc_type` | text | NULL | Ej. `id_front`, `id_back`, `selfie`. |
| `storage_path` | text | NOT NULL | Ruta en bucket privado (S-19). |
| `status` | document_status | NOT NULL DEFAULT `pending` | — |
| `reviewed_by` | uuid | FK -> `profiles.id`, NULL | Admin revisor. |
| `reviewed_at` | timestamptz | NULL | — |
| `review_notes` | text | NULL | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**RLS:** el tutor gestiona los suyos (insert/select); `admin` lee y cambia `status`; no público. Bucket de Storage privado con políticas equivalentes. **Índices:** `tutor_id`, `status`.

### 1.4.17 `payment_routing_rules` — tabla de ruteo (RN-16, habilita DP-01)

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `payer_country` | char(2) | NULL | País del alumno (NULL = comodín). |
| `payee_country` | char(2) | NOT NULL | País del tutor (decisivo, RN-15). |
| `charge_provider` | text | NOT NULL | Proveedor de cobro. |
| `payout_provider` | text | NOT NULL | Proveedor de payout (puede diferir). |
| `priority` | integer | NOT NULL DEFAULT 100 | Menor = mayor precedencia. |
| `is_active` | boolean | NOT NULL DEFAULT true | — |
| `notes` | text | NULL | — |
| `created_at`/`updated_at` | timestamptz | NOT NULL | — |

**Nota:** es la configuración que mantiene DP-01 abierta sin tocar el core (RN-16). **RLS:** solo `admin` lee/escribe; el runtime la consulta vía service role. **Índices:** (`payee_country`,`payer_country`,`priority`), `is_active`.

> **Referidos:** no hay tabla. Solo `profiles.referral_code` como atribución capturada del frontend (Referral Factory). Sin lógica interna (RN-21, S-11/S-18).
>
> **Notificaciones/correos:** el registro de envíos se define en el Doc 7 (no se modela aquí).

---

## 1.5 Resumen de índices y unicidad clave

- **Únicos:** `categories.slug`, `user_roles(user_id,role)`, `product_categories(product_id,category_id)`, `payments.booking_id`, `payout_items.payment_id`, `reviews.booking_id`.
- **Búsqueda/descubrimiento:** índice de texto en `products(title,description)`; `product_categories.category_id`; `tutor_profiles.approval_status`.
- **Operación:** `sessions.start_at`, `bookings.status`, `payouts.scheduled_for`, `payments.status`.

---

## 1.6 Consideraciones de RLS por rol (visión general)

- **Patrón:** `RLS ENABLE` en todas las tablas. Función `public.has_role(uid uuid, r user_role) RETURNS boolean SECURITY DEFINER` para evaluar roles sin recursión de políticas. `auth.uid()` identifica al usuario.
- **Alumno:** CRUD de sus `bookings`/`reviews`; lectura de catálogos públicos (`products` activos, `tutor_profiles` aprobados, `categories`, `availability_*`); lectura de sus `payments`/`sessions`.
- **Tutor:** CRUD de sus `products`/`product_categories`/`availability_*`/`verification_documents`; lectura de `bookings`/`sessions`/`payments` de sus productos y de sus `payouts`; edición limitada de `tutor_profiles` (sin `approval_status`/`tier_id`).
- **Admin:** acceso total; única vía de cambio de `approval_status`, tiers, categorías y `payment_routing_rules`.
- **Service role (server):** única vía de escritura de `payments`/`payouts`/`payout_items` (webhooks/jobs) — S-15.
- La matriz CRUD completa por entidad está en el Doc 3.

---

## 1.7 Supuestos y decisiones pendientes nuevas

**Supuestos nuevos:**

| ID | Supuesto |
| :-- | :-- |
| S-12 | Montos en unidades menores (`bigint`) + `currency` ISO-4217; multi-moneda. |
| S-13 | Categorías planas (sin jerarquía) en el MVP. |
| S-14 | Roles vía `user_roles` (multi-rol) + helper `has_role()` `SECURITY DEFINER`. |
| S-15 | Escritura de `payments`/`payouts`/`payout_items` solo vía service role/webhooks; el cliente es de solo lectura sobre ellas. |
| S-16 | `provider` como `text` (no `enum`) para no acoplar (RN-16/DP-01). |
| S-17 | Email canónico en `auth.users`; `profiles.email` es espejo opcional. |
| S-18 | Atribución de referidos como `profiles.referral_code` (texto), sin lógica interna. |
| S-19 | Documentos de identidad en bucket privado de Supabase Storage. |
| S-20 | En `per_hour`, la duración se elige al reservar (múltiplos de 30 min). |

**Decisión pendiente nueva:**

| ID | Decisión | Opciones | Impacto |
| :-- | :-- | :-- | :-- |
| DP-07 | Moneda de liquidación y manejo de FX en corredores cross-border | (a) computar split en moneda de cobro; (b) en moneda de payout con `fx_rate`; (c) cobrar y liquidar en USD | Campos `settlement_currency`/`fx_rate` en `payments`; reportes del tutor. Ligado a DP-01. |

---

## 1.8 Nota sobre el ERD

El diagrama entidad-relación se generará en la pasada final de diagramas (Mermaid `erDiagram`), a partir de este diccionario. El `.md` es la fuente y el `.pdf` se regenerará entonces.

---

## 1.9 Decisiones de diseño confirmadas (2026-06-02)

- **Roles multi-valor** vía `user_roles` (S-14): confirmado.
- **`payout_items`** como puente para mantener DP-06 abierta sin re-trabajo: confirmado.
- **Disponibilidad** = reglas recurrentes + excepciones (S-03): confirmado.
- **DP-07** (FX/cross-border): se documenta como pendiente: confirmado.
- **Supuestos S-12..S-20:** aceptados.

---

*Fin del Documento 1.*
