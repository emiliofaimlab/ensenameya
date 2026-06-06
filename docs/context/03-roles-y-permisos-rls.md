# DOC 3 — Matriz de Roles y Permisos (RLS)

> **Enséñame Ya — MVP Web.** Control de acceso por rol sobre cada tabla, implementado con Row Level Security de Supabase/Postgres.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 3 — Matriz de Roles y Permisos (RLS) |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Doc 0 (roles, RN-19), Doc 1 (tablas, RLS por tabla), Doc 2 (quién dispara transiciones) |
| **Alimenta a** | Doc 5 (qué puede hacer cada pantalla), Doc 6 (escrituras vía service role), Doc 8 (criterios de aceptación de seguridad) |
| **Estado** | Borrador para revisión |
| **Fecha** | 2026-06-03 |

---

## 3.1 Propósito y alcance

Define la **matriz CRUD por rol** para cada tabla del Doc 1 y cómo se implementa con **RLS** en Supabase (RN-19). Es la fuente de verdad de "quién puede ver/crear/editar/borrar qué", y la autorización de **quién puede disparar cada transición** de estado (Doc 2). El detalle de cada política a nivel SQL es orientativo (la implementación final vive en migraciones), pero las **reglas de acceso** aquí son normativas.

---

## 3.2 Modelo de roles

| Rol (actor) | Origen | Descripción |
| :-- | :-- | :-- |
| `anon` (público) | Sin sesión | Visitante no autenticado. Solo lee superficies públicas de descubrimiento. |
| `alumno` | `user_roles` | Usuario autenticado con rol alumno. |
| `tutor` | `user_roles` | Usuario autenticado con rol tutor (puede además ser alumno). |
| `admin` | `user_roles` | Operador de la plataforma. Acceso amplio. |
| `service_role` | Clave de servicio (servidor) | Backend/Edge Functions/webhooks. **No** sujeto a RLS; única vía de escritura financiera (S-15). |

- **Multi-rol (S-14):** un usuario puede tener varios roles (p. ej. alumno + tutor). Los permisos se **acumulan**.
- **Helper de rol:** función `public.has_role(uid uuid, r user_role) returns boolean` con `SECURITY DEFINER` para evaluar roles **sin recursión** de políticas.
- **Identidad:** `auth.uid()` identifica al usuario autenticado dentro de las políticas.

```sql
-- Helper de rol (evita recursión en políticas que consultan user_roles)
create or replace function public.has_role(uid uuid, r user_role)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = uid and ur.role = r
  );
$$;
```

> **RN-31:** el alta del rol `admin` se realiza **fuera del cliente** (seed/migración o acción de otro admin vía service role). La UI nunca permite auto-asignarse `admin` (S-31).

---

## 3.3 Leyenda de la matriz

| Símbolo | Significado |
| :-- | :-- |
| **C** | Create (insert) |
| **R** | Read (select) |
| **U** | Update |
| **D** | Delete |
| **—** | Sin acceso |
| **(p)** | Público: lectura sin sesión (subconjunto/columnas públicas) |
| **(o)** | Solo filas **propias** (`owner`) |
| **(c)** | Condicionado por estado/guarda (ver nota de la tabla) |
| **(svc)** | Solo `service_role` (servidor) |

> El borrado físico se evita en favor de `status`/`is_active` (Doc 1). "D" se reserva a tablas puente/configuración donde aplica.

---

## 3.4 Matriz CRUD maestra

| Tabla (Doc 1) | anon | alumno | tutor | admin | service_role |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `profiles` | — | R/U (o) | R/U (o) | R/U | C/R/U |
| `user_roles` | — | R (o) | R (o) | C/R/U/D | C/R/U/D |
| `tutor_tiers` | — | — | R (c, su tier) | C/R/U | R |
| `tutor_profiles` | R (p, aprobados) | R (p) | R/U (o, sin `approval_status`/`tier_id`) | C/R/U | R/U |
| `categories` | R (p, activas) | R (p) | R (p) | C/R/U/D | R |
| `products` | R (p, activos) | R (p) | C/R/U/D (o) | R/U/D | R |
| `product_categories` | R (p) | R (p) | C/R/D (o, su producto) | R/D | R |
| `availability_rules` | R (p, tutor aprobado) | R (p) | C/R/U/D (o) | R | R |
| `availability_exceptions` | R (p) | R (p) | C/R/U/D (o) | R | R |
| `bookings` | — | C/R (o) | R (c, sus productos) | R/U | C/R/U |
| `sessions` | — | R (o) | R (o) | R/U | C/R/U |
| `payments` | — | R (o, su reserva) | R (c, sus reservas) | R/U | C/R/U **(svc)** |
| `payouts` | — | — | R (o) | R/U | C/R/U **(svc)** |
| `payout_items` | — | — | R (c, vía su payout) | R | C/R/U **(svc)** |
| `reviews` | R (p) | C/R/U (o, c) | R (o) | R/U/D | R |
| `verification_documents` | — | — | C/R (o) | R/U | R |
| `payment_routing_rules` | — | — | — | C/R/U/D | R **(svc)** |

> **Nota transversal:** escritura de `payments`, `payouts`, `payout_items` **solo** vía `service_role` (webhooks/jobs) — S-15, RN-26. `admin` puede leer todo y disparar acciones (reembolso, hold) que el `service_role` ejecuta; no escribe esas tablas desde el cliente.

---

## 3.5 Notas y condiciones por tabla

- **`profiles`** — cada usuario lee/edita su fila (`id = auth.uid()`); no es pública. Datos públicos del tutor viven en `tutor_profiles`.
- **`tutor_tiers`** — el tutor lee **su** tier (join por `tutor_profiles.tier_id`); crear/editar tiers y `split_pct` solo `admin` (RN-07). Cambios no retroactivos (S-08): el split se congela en `bookings`/`payments`.
- **`tutor_profiles`** — lectura pública **solo** si `approval_status = 'approved'`. El tutor edita campos de presentación, **no** `approval_status` ni `tier_id` (admin).
- **`products` / `product_categories`** — lectura pública solo si `status='active'` y tutor `approved` (RN-24). El tutor hace CRUD de los suyos; `admin` puede moderar (U/D).
- **`bookings`** — el alumno crea/lee las suyas (`student_id = auth.uid()`); el tutor lee las de sus productos (`tutor_id = auth.uid()`). El cambio de `status` va por funciones controladas (Doc 2), no por `update` libre.
- **`payments` / `payouts` / `payout_items`** — lectura por pertenencia; **escritura solo `service_role`**. El tutor ve montos de sus reservas y sus payouts; el alumno ve el pago de su reserva.
- **`reviews`** — `(c)`: el alumno crea la reseña **solo si** su `booking.status='completed'` (RN-28) y no existe ya una (UNIQUE `booking_id`); lectura pública (perfil del tutor). Edición acotada a una ventana (S-32).
- **`verification_documents`** — el tutor inserta/lee los suyos; `admin` lee y cambia `status`; nunca público. Almacenamiento en bucket privado (S-19).
- **`payment_routing_rules`** — solo `admin` administra; el runtime la consulta vía `service_role`. Mantiene `DP-01` abierta sin tocar el core (RN-16).

---

## 3.6 Plantillas de política RLS (orientativas)

Patrón general: `enable row level security` en toda tabla y políticas separadas por operación.

```sql
-- Lectura pública de productos activos de tutores aprobados (descubrimiento)
create policy products_public_read on public.products
for select to anon, authenticated
using (
  status = 'active'
  and exists (
    select 1 from public.tutor_profiles tp
    where tp.profile_id = products.tutor_id
      and tp.approval_status = 'approved'
  )
);

-- El tutor administra sus propios productos
create policy products_owner_all on public.products
for all to authenticated
using (tutor_id = auth.uid() and public.has_role(auth.uid(), 'tutor'))
with check (tutor_id = auth.uid() and public.has_role(auth.uid(), 'tutor'));
```

```sql
-- El alumno crea reseña solo si su reserva está completada y no existe otra
create policy reviews_student_insert on public.reviews
for insert to authenticated
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.bookings b
    where b.id = reviews.booking_id
      and b.student_id = auth.uid()
      and b.status = 'completed'
  )
);

-- Lectura pública de reseñas (perfil del tutor)
create policy reviews_public_read on public.reviews
for select to anon, authenticated using (true);
```

```sql
-- Acceso del admin (patrón reutilizable en tablas operativas)
create policy admin_all on public.bookings
for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

-- payments: el cliente solo lee por pertenencia; escritura = service_role
create policy payments_read_owner on public.payments
for select to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = payments.booking_id
      and (b.student_id = auth.uid() or b.tutor_id = auth.uid())
  )
  or public.has_role(auth.uid(), 'admin')
);
-- (sin política de insert/update/delete para authenticated => solo service_role escribe)
```

---

## 3.7 RLS de Storage (buckets)

| Bucket | Visibilidad | Política |
| :-- | :-- | :-- |
| `avatars` | Público (lectura) | Lectura pública; escritura solo del dueño (`owner = auth.uid()`). |
| `verification` | **Privado** | Lectura/escritura solo del tutor dueño y `admin` (S-19). Nunca público. |
| `product-media` | Público (lectura) | Lectura pública; escritura del tutor dueño del producto. `SUPUESTO S-33`. |

> Las políticas de Storage se definen sobre `storage.objects` con el mismo helper `has_role()` y comprobación de `owner`/ruta (`{tutor_id}/...`).

---

## 3.8 Autorización de transiciones de estado (cruce con Doc 2)

Quién puede **disparar** cada transición (las financieras se ejecutan por `service_role` aunque las inicie el admin):

| Máquina (Doc 2) | Transición | Disparador autorizado |
| :-- | :-- | :-- |
| M1 Aprobación tutor | pending→approved/rejected, suspend, reactivar | `admin` |
| M2 Identidad | not_submitted→pending, rejected→pending | `tutor` (dueño) |
| M2 Identidad | pending→approved/rejected | `admin` |
| M3 Producto | draft→active, pausar, reanudar, archivar | `tutor` (dueño); `admin` puede pausar/archivar |
| M4 Reserva | crear (→pending_payment) | `alumno` (dueño) |
| M4 Reserva | →confirmed, →cancelled(pago) | `webhook`/`service_role` |
| M4 Reserva | cancelar (confirmed/in_progress) | `alumno`/`tutor` dueños, `admin` |
| M5 Sesión | scheduled→in_progress→completed | `sistema`/`daily`; `tutor` puede marcar completada |
| M5 Sesión | cancelar | `alumno`/`tutor` dueños, `admin` |
| M6 Pago | toda transición | `webhook`/`service_role` (reembolso lo inicia `admin`, ejecuta `service_role`) |
| M7 Payout | scheduled/processing/paid/failed | `sistema`/`webhook`/`service_role` |
| M7 Payout | on_hold / liberar | `admin` (ejecuta `service_role`) |
| M8 Documento | subir | `tutor` (dueño) |
| M8 Documento | approve/reject | `admin` |

---

## 3.9 Principios de seguridad transversales

- **Default-deny:** RLS habilitado en todas las tablas; sin política ⇒ sin acceso. Nada se expone por omisión.
- **Mínimo privilegio:** cada rol obtiene solo lo necesario; el cliente nunca escribe tablas financieras (S-15).
- **Sin escalada:** no hay vía de cliente para asignarse `admin`/`tutor.approval_status`/`tier_id` (RN-31).
- **`SECURITY DEFINER` controlado:** funciones con `search_path` fijo y validación interna; usadas para roles y transiciones.
- **Lectura pública mínima:** solo catálogos de descubrimiento y perfiles aprobados; datos personales y financieros nunca son públicos.
- **Trazabilidad:** acciones sensibles (aprobaciones, reembolsos, holds) registran actor y fecha (`approved_by`, `reviewed_by`, etc.); un log de auditoría ampliado es `SUPUESTO S-34` (a confirmar en Doc 9).

---

## 3.10 Reglas y supuestos introducidos en este documento

**Reglas de negocio nuevas**

| ID | Regla |
| :-- | :-- |
| RN-31 | El rol `admin` se asigna fuera del cliente (seed/otro admin vía service role); la UI no permite auto-asignación. |

**Supuestos nuevos**

| ID | Supuesto |
| :-- | :-- |
| S-31 | No existe flujo de cliente para auto-asignarse roles privilegiados; el primer admin se siembra por migración. |
| S-32 | La reseña es editable por el alumno dentro de una ventana corta tras crearla (valor en Doc 5); luego inmutable. |
| S-33 | Existe un bucket `product-media` público (lectura) para imágenes de producto; escritura del tutor dueño. |
| S-34 | Un log de auditoría ampliado (más allá de los campos `*_by`/`*_at`) queda como mejora a confirmar (Doc 9). |

**Sin nuevas decisiones pendientes** en este documento (las de pago/identidad ya están en DP-01..DP-08).

---

## 3.11 Nota sobre diagramas

Un **mapa visual de permisos** (matriz coloreada por rol) y el **diagrama de confianza** (cliente vs. service role vs. webhooks) se agregarán en la pasada final de diagramas. El `.md` es la fuente y el `.pdf` se regenerará entonces.

---

*Fin del Documento 3.*
