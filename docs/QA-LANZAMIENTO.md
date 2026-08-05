# Enséñame Ya — QA y checklist de lanzamiento (US-1602 · `EY-83`)

> **Qué es esto.** Lo que hay que comprobar antes de abrir la plataforma, y el resultado de la última
> pasada. No es una lista de buenas intenciones: cada tabla de abajo se **ejecutó** contra dev y se
> pegó su salida real. Cuando algo no se pudo verificar, lo dice.
>
> Última pasada completa: **2026-07-29** (dev, `lbtpnszjjsxbeileqsja`).
>
> Repaso puntual del **2026-08-04**, por lo que se movió después: la vista `tutors_public` (DD-04,
> migración `20260804120000`) y el filtro de precio de `/tutors`. Lo demás sigue siendo la salida
> del 29-jul y así está marcado.

---

## 1. RLS por rol — la barrera de verdad

Ejecutado con las tres cuentas fixture + `anon`. Lo que importa no es que la app funcione: es que
**nadie vea lo que no debe**, aunque llame a la API a pelo.

### Lectura (filas visibles por rol)

| Tabla | anon | alumno | tutor | admin | Correcto porque |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `categories` | 10 | 10 | 10 | 10 | catálogo público |
| `products` (activos) | 10 | 10 | 10 | 10 | catálogo público (RN-24) |
| `tutor_profiles` (aprobados) | 15 | 15 | 15 | 15 | solo aprobados salen |
| `profiles` | **401** | 1 | 1 | 43 | privada: cada uno el suyo, admin todos |
| `bookings` | **401** | 21 | 21 | 54 | solo las propias |
| `payments` | **401** | 21 | 21 | 49 | ídem |
| `payouts` | **401** | 0 | 0 | 4 | el alumno no tiene; este tutor tampoco |
| `messages` | **401** | 20 | 7 | **0** | **ni el admin lee el chat** (RN-41) |
| `notifications` | **401** | 34 | 11 | 90 | por destinatario |
| `verification_documents` | **401** | 0 | 1 | 13 | KYC: el suyo y el admin |
| `alert_acks` | **401** | 0 | 0 | 0 | solo admin (vacía tras la prueba) |
| `payment_webhook_events` | **401** | 0 | 0 | 1 | solo admin |
| `tutors_public` (vista, 4-ago) | 16 | n/v | n/v | n/v | catálogo público; hereda la RLS |

`n/v` = no re-ejecutado el 4-ago. La pasada por rol es del 29-jul, anterior a la vista; lo que se
comprobó ahora es la superficie que importa, `anon`.

**`tutors_public` (migración `20260804120000`, DD-04).** Vista nueva y **pública**: envuelve
`tutor_profiles` con el precio de la mentoría activa más barata, para que el rango de precio de P04
lo resuelva Postgres y no el cliente. No tiene RLS propia —las vistas no la tienen—: la hereda con
`security_invoker = true`, así que mandan `tutor_profiles_select_public` y `products_select_public`.
Sin ese flag correría con los privilegios de su dueño y publicaría tutores no aprobados y productos
en borrador; por eso entra en esta matriz y no de tapadillo. Como `anon`: **16 filas, las 16
`approved`, idéntico a `tutor_profiles`** (que hoy también da 16 — el 29-jul eran 15 porque hay una
cuenta fixture más, no un tutor sin aprobar colándose). Escribirla tampoco es opción: el grant es
solo `select` y Postgres la rechaza antes (`55000`, vista no auto-actualizable).

### Escritura que debe fallar (código HTTP / código Postgres)

| Intento | anon | alumno | tutor | admin |
| :-- | :-- | :-- | :-- | :-- |
| `INSERT payments` | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `INSERT payouts` | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `UPDATE tutor_profiles.approval_status` | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `INSERT user_roles` (auto-hacerse admin) | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `UPDATE notifications.status` | 401/42501 | 403/42501 | 403/42501 | 403/42501 |
| `INSERT bookings` directo | 401/42501 | 403/42501 | 403/42501 | 403/42501 |

**Incluido el admin**: el dinero y los roles se mueven por RPC `SECURITY DEFINER`, nunca por PATCH
(regla de oro 2 y 7). El script vive en el scratchpad de la sesión; re-crearlo es media hora.

## 2. Webhooks idempotentes

`confirm_payment` con `p_event_id`, sobre una reserva de prueba (cancelada al terminar):

| Llamada | Resultado |
| :-- | :-- |
| 1ª con `evt_qa_…` | `pending_acceptance`, pago `paid` 18,00 US$ |
| 2ª con **el mismo** `evt_qa_…` | `pending_acceptance` — **no-op**, sin segundo cobro |
| 3ª con **otro** id sobre la misma reserva | `pending_acceptance` — **no-op** por estado |

Doble idempotencia (por id de evento **y** por estado), que es la que salva cuando el proveedor
reintenta con un id nuevo.

## 3. Responsive (US-1601)

Barrido automático de scroll horizontal —el síntoma que delata un layout roto— en **17 rutas** a
**360** y **768** px: públicas, panel de alumno y panel de tutor.

Dos fallos reales, los dos corregidos:

- **`/search` a 360 px** — las cuatro pestañas del *segmented control* sumaban 411 px y sacaban scroll
  a toda la página. Ahora envuelven y su padding se reduce en móvil.
- **Footer a 768 px** — el bloque de texto se quedaba con sus 592 px y dejaba las tres columnas de
  enlaces a ~18 px, con "Privacidad" saliéndose de la pantalla. Ahora los enlaces no encogen y cede el
  párrafo. **Afectaba a todas las páginas**, porque el footer es global.

Tras el arreglo: **17/17 rutas limpias a 360 y 768**, y `/`, `/tutors`, `/search` también a 1024 y 1280.

**Repaso del 4-ago.** `/tutors` cambió después del barrido: el filtro de precio dejó de ser cuatro
tramos fijos y es un deslizador de rango continuo (commits `cccb566` y `96f4e0b`). Re-medido a **360
y 768 px**: sin scroll horizontal (`scrollWidth` = `clientWidth`) y el control se pinta entero
("Inversión por clase", 10,00–120,00 US$). Las otras 16 rutas no se han tocado desde el 29-jul.

⚠️ **Esto no es "el responsive del diseño"**: es que nada se rompa. El diseño de tablet/escritorio
sigue pendiente de Diana (decisión 24) y el panel de **admin es desktop-first** por AC, así que no
entró en el barrido.

---

## 4. Checklist de lanzamiento

### 4.1 Antes de abrir

- [ ] **Migraciones aplicadas a prod** por CI al mergear a `main` (`supabase/migrations/`). Hoy
      faltan **12** por aplicar: de `20260729130000_us1302_referral_code` a
      `20260804120000_dd04_vista_precio_tutor`. Y son **dos** merges hasta prod (`dev` y luego
      `main`), no uno.
- [ ] **`npm run db:types` regenerado** y sin cambios pendientes en el PR.
- [ ] **`lint` + `typecheck` + `build`** en verde.
- [ ] **Cuenta de admin sembrada** en prod (`supabase/seed/admin-bootstrap.sql`) — y **completar su
      onboarding**: el gate de `requireUser` (RN-44) también aplica al admin.
- [ ] **Categorías reales** cargadas (las 10 del seed son de dev).
- [ ] **Páginas legales con texto definitivo** (hoy dicen "documento en preparación", DD-06).

### 4.2 Variables de entorno (Vercel: Production **y** Preview)

| Variable | Sin ella |
| :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | la app no arranca |
| `DAILY_API_KEY` | sala de video **simulada** |
| `NEXT_PUBLIC_REFERRAL_URL` | el bloque de referidos no se pinta |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | sin monitoreo de errores |

Detalle en `docs/ENTORNOS.md`. **`service_role` jamás en `NEXT_PUBLIC_*`** (regla de oro 3).

### 4.3 Jobs de `pg_cron` (verificar que existen en prod)

| Job | Cadencia | Qué pasa si no corre |
| :-- | :-- | :-- |
| `expire-stale-bookings` | `*/5` | reservas sin pagar bloquean el hueco para siempre |
| `close-expired-sessions` | `*/5` | sesiones vivas eternamente, sin `no_show` |
| `process-notifications` | `*/2` | los avisos se quedan en `pending` |
| `process-payouts` | `*/10` | los payouts no pasan de `scheduled` |
| `run-payout-batch` | lunes 03:00 | nadie cobra |
| `purge-expired-messages` | 04:00 diario | el chat no caduca (RN-41) |

### 4.4 Lo que sigue simulado

- **Cobros y payouts** — proveedor simulado; el real es EP-20 (bloqueada por cuentas/API keys).
- **Correo** — `process_notifications` marca `sent` sin enviar nada; el proveedor real es C-11.
- **Grabación** — cableada, pero el add-on de Daily no está activo (falta go de coste).

> **Ninguna de las tres se cae sola**: las tres siguen el patrón credencial-interruptor. El día que
> haya credenciales, se encienden sin tocar código.

### 4.5 Decisiones del cliente que siguen abiertas

C-13 (mercado/Venezuela y métodos) · C-07 (ventana de pago) · C-02/C-04 (retención y agrupación de
payout) · C-05 (no-show) · C-06 (checkout invitado) · C-09 (%s de tiers) · C-11 (email) · C-12
(opt-out) · C-15 (FX) · C-10 (reglas de referidos) · C-14 ✅ resuelta.

Ninguna bloquea el despliegue: todas tienen default operable (ver el tracker de
`docs/PLAN-DESARROLLO.md`).

---

*Se actualiza en cada pasada de QA. Última edición: **2026-08-04** (vista `tutors_public` en la
matriz de RLS, `/tutors` re-medido a 360/768 tras el deslizador de precio, y 12 migraciones
pendientes de prod). Creado el 2026-07-29 con la tanda 6 del plan de los sprints 6 AC / 7 / 8.*
