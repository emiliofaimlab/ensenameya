# DOC 2 — Máquinas de Estado

> 🔀 **Delta v1.0:** la máquina de **reserva (M4)** ahora incluye **`pending_acceptance`** — tras el
> pago el tutor **acepta/rechaza en 24h** antes de `confirmed` (RN-38, US-606, NTF-17). Ver el diagrama
> actualizado en `docs/context/ADENDA-BACKLOG-v1.md` §2 hasta que se reescriba este doc.

> **Enséñame Ya — MVP Web.** Estados y transiciones de las entidades con ciclo de vida, derivadas de los `enum` del Doc 1.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 2 — Máquinas de Estado |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Doc 0 (entidades, RN), Doc 1 (enums, tablas) |
| **Alimenta a** | Doc 3 (quién puede disparar transiciones), Doc 5 (acciones de pantalla), Doc 6 (pagos/payouts), Doc 7 (notificaciones por evento) |
| **Estado** | Borrador para revisión |
| **Fecha** | 2026-06-03 |

---

## 2.1 Propósito y alcance

Este documento define, para cada entidad con ciclo de vida, **qué estados existen, cómo se pasa de uno a otro, quién lo dispara, bajo qué condiciones (guarda) y qué efectos colaterales produce**. Es la fuente de verdad del comportamiento dinámico del sistema y la base para:

- Las **acciones y CTAs** de cada pantalla (Doc 5).
- La **matriz de permisos** sobre quién puede ejecutar cada transición (Doc 3).
- Los **eventos que disparan notificaciones/correos** (Doc 7).
- La **orquestación de pagos y payouts** (Doc 6).

Cubre las 8 máquinas de estado correspondientes a los `enum` del Doc 1 (§1.3) y una sección de **orquestación** que explica cómo se mueven en conjunto durante el flujo de compra.

> **Marcadores** (igual que Doc 0/1): `SUPUESTO:` / `S-xx`, `DECISIÓN PENDIENTE:` / `DP-xx`, `RN-xx` reglas de negocio. Las decisiones pendientes **no se resuelven**; se diseña sin acoplarse a ellas.

---

## 2.2 Convenciones de las máquinas de estado

| Concepto | Convención |
| :-- | :-- |
| **Estado inicial** | Marcado como *(inicial)*; es el valor `DEFAULT` del `enum` en el Doc 1. |
| **Estado terminal** | Marcado como *(terminal)*; no admite más transiciones (salvo reapertura explícita). |
| **Actor** | Quién dispara la transición: `alumno`, `tutor`, `admin`, `sistema` (job/cron), `webhook` (proveedor de pago), `daily` (evento de sala). |
| **Guarda** | Condición que debe cumplirse para permitir la transición. |
| **Efectos** | Cambios colaterales (crear filas, abrir/cerrar ventanas, notificar, disparar otra máquina). |
| **Mutación segura** | `payments`/`payouts`/`payout_items` solo se mutan vía **service role / webhooks** (S-15, RN-26). El cliente nunca cambia esos estados directamente. |
| **Idempotencia** | Toda transición disparada por `webhook` debe ser idempotente (reintentos del proveedor no deben duplicar efectos). Ver Doc 6. |

> Las transiciones de negocio se implementan mediante **funciones controladas** —RPC de Postgres y **Route Handlers** de Next con `service_role`— y no como `UPDATE` libres del `status`, para garantizar guardas y efectos atómicos. **No hay Edge Functions** en este proyecto: todo el código server-side son Route Handlers y Server Components.

---

## 2.3 Inventario de máquinas de estado

| # | Entidad / `enum` | Tabla (Doc 1) | Estado inicial | Estados terminales |
| :-- | :-- | :-- | :-- | :-- |
| M1 | `tutor_approval_status` | `tutor_profiles` | `pending` | — (reversible) |
| M2 | `identity_verification_status` | `tutor_profiles` | `not_submitted` | `approved` |
| M3 | `product_status` | `products` | `draft` | `archived` |
| M4 | `booking_status` | `bookings` | `pending_payment` | `completed`, `cancelled`, `refunded` |
| M5 | `session_status` | `sessions` | `scheduled` | `completed`, `cancelled`, `no_show` |
| M6 | `payment_status` | `payments` | `pending` | `refunded` |
| M7 | `payout_status` | `payouts` | `pending` | `paid` |
| M8 | `document_status` | `verification_documents` | `pending` | `approved`, `rejected` |

---

## 2.4 M1 — Aprobación del Tutor (`tutor_approval_status`)

Controla si un tutor puede **publicar productos y recibir reservas** (RN-04).

**Estados**

| Estado | Tipo | Descripción |
| :-- | :-- | :-- |
| `pending` | inicial | Perfil de tutor creado; a la espera de revisión manual del admin. No puede publicar. |
| `approved` | intermedio | Aprobado: puede activar productos y ser reservado. Se asigna tier por defecto. |
| `rejected` | intermedio | Rechazado por el admin (no cumple requisitos). Puede subsanar y reenviar. |
| `suspended` | intermedio | Suspendido por el admin (incidencia/política). Productos no reservables mientras dure. |

**Transiciones**

| Desde | Evento / disparador | Hacia | Actor | Guarda | Efectos |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `pending` | Aprobar tutor | `approved` | admin | Identidad `approved` (RN-29, recomendado) y datos de perfil completos | `approved_at`, `approved_by`; asigna `tier_id` por defecto (RN-06); notifica tutor (Doc 7) |
| `pending` | Rechazar | `rejected` | admin | — | Registra motivo; notifica tutor |
| `rejected` | Reenviar a revisión | `pending` | tutor / admin | Tutor corrige información | Notifica al admin (re-revisión) |
| `approved` | Suspender | `suspended` | admin | — | Productos dejan de ser reservables (guarda en M4); notifica tutor |
| `suspended` | Reactivar | `approved` | admin | — | Restaura visibilidad/reservabilidad; notifica tutor |

> **RN-23:** un tutor solo puede tener productos `active` y recibir reservas si su `approval_status = approved`. En `pending`/`rejected`/`suspended`, el catálogo del tutor no es reservable (guarda de M3 y de creación de `bookings`).
>
> **RN-29:** *(operativa)* el admin no aprueba a un tutor cuya **verificación de identidad** (M2) no esté `approved`. Aprobación e identidad son máquinas separadas pero la primera depende operativamente de la segunda. `SUPUESTO S-21`: si el negocio decide aprobar sin identidad verificada, se relaja esta guarda sin cambios de modelo.

---

## 2.5 M2 — Verificación de identidad (`identity_verification_status`)

KYC manual del tutor (RN-05). Se apoya en la máquina de documentos (M8).

**Estados**

| Estado | Tipo | Descripción |
| :-- | :-- | :-- |
| `not_submitted` | inicial | Aún no subió documentos de identidad. |
| `pending` | intermedio | Documentos subidos; en revisión del admin. |
| `approved` | terminal | Identidad verificada. |
| `rejected` | intermedio | Documentos insuficientes/ilegibles; debe re-subir. |

**Transiciones**

| Desde | Evento / disparador | Hacia | Actor | Guarda | Efectos |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `not_submitted` | Subir documento(s) | `pending` | tutor | ≥1 `verification_documents` creado (M8 en `pending`) | Notifica al admin (cola de revisión) |
| `pending` | Aprobar identidad | `approved` | admin | Documentos legibles y válidos | Habilita guarda de M1 (RN-29); notifica tutor |
| `pending` | Rechazar identidad | `rejected` | admin | — | Registra motivo; notifica tutor |
| `rejected` | Re-subir documento(s) | `pending` | tutor | Nuevo `verification_documents` | Notifica al admin |

> **SUPUESTO S-22:** la verificación de identidad es **independiente del tier**; no afecta el split. Su único efecto es habilitar la aprobación (M1).

---

## 2.6 M3 — Producto (`product_status`)

Visibilidad y reservabilidad de la oferta del tutor.

**Estados**

| Estado | Tipo | Descripción |
| :-- | :-- | :-- |
| `draft` | inicial | En edición; no visible públicamente ni reservable. |
| `active` | intermedio | Publicado: visible en descubrimiento y reservable. |
| `paused` | intermedio | Oculto temporalmente; reservas existentes no se afectan. |
| `archived` | terminal | Retirado definitivamente; no se reactiva (se clona para reusar). |

**Transiciones**

| Desde | Evento / disparador | Hacia | Actor | Guarda | Efectos |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `draft` | Publicar | `active` | tutor | Tutor `approved` (RN-23); campos mínimos completos (precio, modelo, duración) | Aparece en descubrimiento (RN-20) |
| `active` | Pausar | `paused` | tutor / admin | — | Se oculta del catálogo; no admite nuevas reservas |
| `paused` | Reanudar | `active` | tutor | Tutor `approved` | Vuelve al catálogo |
| `active` | Archivar | `archived` | tutor / admin | — | Sale del catálogo; histórico conservado |
| `paused` | Archivar | `archived` | tutor / admin | — | Igual que arriba |
| `draft` | Descartar | `archived` | tutor | — | Descarta borrador |

> **RN-24:** un producto solo es reservable si `status = active` **y** el tutor está `approved`. Si el tutor pasa a `suspended`/`rejected` (M1), sus productos `active` dejan de ser reservables sin cambiar su `status` (la guarda se evalúa al crear la `booking`). `SUPUESTO S-23`: no se fuerza un cambio masivo de `product_status` al suspender al tutor; se filtra en consulta y en la creación de reservas.

---

## 2.7 M4 — Reserva (`booking_status`)

Núcleo del flujo de compra. Coordina pago (M6), sesiones (M5) y reseña (RN-17).

**Estados**

| Estado | Tipo | Descripción |
| :-- | :-- | :-- |
| `pending_payment` | inicial | Reserva creada; esperando confirmación de pago. |
| `pending_acceptance` | intermedio | **Pagada y esperando al tutor** (RN-38): tiene 24 h para aceptar o rechazar; el timeout cuenta como rechazo. |
| `confirmed` | intermedio | Aceptada por el tutor; sesiones agendadas y salas previstas. |
| `in_progress` | intermedio | El servicio comenzó (primera sesión iniciada). |
| `completed` | terminal | Todas las sesiones finalizaron; habilita reseña (RN-17). |
| `cancelled` | terminal | Cancelada (antes/durante); sin reembolso o con reembolso parcial según política. |
| `refunded` | terminal | Reembolsada (total); cierre financiero negativo. |

**Transiciones**

| Desde | Evento / disparador | Hacia | Actor | Guarda | Efectos |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `pending_payment` | Pago confirmado | `pending_acceptance` | webhook | `payments.status = paid` (M6) | Arranca las 24 h del tutor (RN-38). **Aquí todavía no se crean sesiones ni salas.** |
| `pending_acceptance` | El tutor acepta | `confirmed` | tutor | Dentro de las 24 h | Crea `sessions` 1..N (RN-12, RN-25); reserva slots; provisiona salas Daily (Doc 6); notifica alumno y tutor (NTF-05/07) |
| `pending_acceptance` | El tutor rechaza, o vencen las 24 h | `cancelled` | tutor / sistema | — | Reembolso del **100 %** (RN-38); libera el hold |
| `pending_payment` | Pago fallido / abandono / expiración | `cancelled` | webhook / sistema | Pago `failed` o ventana de pago vencida (RN-27) | Libera slots tentativos; notifica alumno |
| `confirmed` | Inicia primera sesión | `in_progress` | sistema / daily | Una `session` pasa a `in_progress` (M5) | — |
| `confirmed` | Cancelar antes de iniciar | `cancelled` | alumno / tutor / admin | Reembolso según **RN-37** (≥24 h 100 % · <24 h alumno 50 % · tutor 100 %) | Cancela `sessions` (M5); encola el reembolso (M6) |
| `in_progress` | Última sesión completada | `completed` | sistema | Todas las `sessions` en estado terminal con ≥1 `completed` (RN-25) | `completed_at`; abre ventana de reseña (RN-28); consolida neto del tutor para payout (M7) |
| `in_progress` | Cancelar a mitad de paquete | `cancelled` | alumno / tutor / admin | **RN-37** sobre las sesiones no tomadas | Cancela sesiones futuras; reembolso parcial (M6) |
| `confirmed` / `in_progress` / `completed` | Reembolso total ejecutado | `refunded` | job / admin | `payments.status = refunded` (M6) | Revierte el payout si no está liquidado (M7); notifica a alumno y tutor |

> **RN-25:** una `booking` pasa a `completed` cuando **todas** sus `sessions` están en estado terminal y al menos una se completó. El tratamiento de `no_show` (M5) en el cómputo de "completada" se rige por `DP-08` (ver §2.13). `SUPUESTO S-24`: si **todas** las sesiones son `no_show`/`cancelled`, la reserva no se marca `completed` (no habilita reseña) y entra a revisión de reembolso.
>
> **RN-27:** una `booking` en `pending_payment` se autocancela si el pago no se confirma dentro de la **ventana de pago**, que son **20 minutos**. La reserva del slot es tentativa hasta que el tutor acepta.
>
> **RN-28:** la reseña (1–5) solo puede crearse con `booking.status = completed` (refuerza RN-17 a nivel de estado).

---

## 2.8 M5 — Sesión / Clase (`session_status`)

Instancia agendada 1:1 (RN-03, RN-18). Se crean al confirmarse la reserva.

**Estados**

| Estado | Tipo | Descripción |
| :-- | :-- | :-- |
| `scheduled` | inicial | Agendada (fecha/hora UTC); sala prevista. |
| `in_progress` | intermedio | En curso (ventana de acceso abierta; participantes pueden unirse). |
| `completed` | terminal | Finalizada correctamente. |
| `cancelled` | terminal | Cancelada antes de iniciar. |
| `no_show` | terminal | No se realizó por inasistencia dentro de la ventana. |

**Transiciones**

| Desde | Evento / disparador | Hacia | Actor | Guarda | Efectos |
| :-- | :-- | :-- | :-- | :-- | :-- |
| — | Reserva confirmada | `scheduled` | sistema | `booking` → `confirmed` (M4) | Crea fila; calcula `access_opens_at`/`access_closes_at` (S-07); crea sala Daily |
| `scheduled` | Apertura de ventana / primer join | `in_progress` | sistema / daily | `now() ∈ [access_opens_at, access_closes_at]` (RN-18) | Habilita acceso a sala; si es la 1ª, mueve `booking` a `in_progress` |
| `in_progress` | Fin de sesión | `completed` | sistema / tutor | Fin de horario o marcado manual | `completed_at`; evalúa cierre de `booking` (RN-25) |
| `scheduled` | Cancelar | `cancelled` | alumno / tutor / admin | **RN-37** | Libera slot; encola el reembolso (M6) |
| `scheduled` | Nadie se unió en la ventana | `no_show` | sistema | Ventana cerrada sin asistencia (S-07) | Marca `no_show`; resolución `DP-08` (§2.13) |

> **SUPUESTO S-26:** el cierre de una sesión a `completed` lo hace el **sistema** al vencer la ventana de acceso; el tutor puede marcar "completada" antes para acelerar. La reprogramación (reschedule) de una sesión `scheduled` se modela como **cancelación + nueva sesión** dentro de la misma reserva (no hay estado `rescheduled` en el MVP). `SUPUESTO S-27`.

---

## 2.9 M6 — Pago (`payment_status`)

Cobro 1:1 con la reserva (S-04). **Solo muta vía webhook/service role** (S-15, RN-26).

**Estados**

| Estado | Tipo | Descripción |
| :-- | :-- | :-- |
| `pending` | inicial | Creado junto con la reserva; aún no cobrado. |
| `authorized` | intermedio | Autorizado por el proveedor (captura en 2 pasos); fondos retenidos. |
| `paid` | intermedio | Capturado/cobrado; confirma la reserva. |
| `failed` | intermedio | Rechazado por el proveedor; permite reintento. |
| `partially_refunded` | intermedio | Reembolso parcial (`0 < refunded_amount < gross_amount`). |
| `refunded` | terminal | Reembolso total. |

**Transiciones**

| Desde | Evento / disparador | Hacia | Actor | Guarda | Efectos |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `pending` | Autorización | `authorized` | webhook | Captura diferida | Retiene fondos; snapshot proveedor (`provider`, `provider_payment_id`) |
| `pending` / `authorized` | Captura / cobro confirmado | `paid` | webhook | Fondos capturados | `paid_at`; confirma `booking` (M4); crea `payout_item` y devenga payout (M7) |
| `pending` / `authorized` | Rechazo | `failed` | webhook | — | `failed_at`; permite reintento; puede autocancelar `booking` (RN-27) |
| `failed` | Reintento de pago | `pending` | alumno | Dentro de la ventana de 20 min (RN-27) | Nuevo intento de cobro |
| `paid` | Reembolso parcial | `partially_refunded` | job / admin | **RN-37**; `refunded_amount += x` | Ajusta neto del tutor / payout (M7); notifica |
| `paid` / `partially_refunded` | Reembolso total | `refunded` | job / admin | **RN-37**; `refunded_amount = gross_amount` | Revierte/retira payout no liquidado (M7); mueve `booking` a `refunded` (M4) |

> ⚠️ **Pedir un reembolso y ejecutarlo son dos pasos separados por una cola.** El camino de
> cancelación encola una fila en `refund_requests`; quien habla con el PSP y mueve este estado es el
> job `/api/cron/refunds-process`. El aviso al alumno (NTF-10) se manda al **pedirlo**, no al
> ejecutarlo — ver Doc 7 §7.3.

> **RN-26:** ninguna transición de M6 se origina en el cliente; todas provienen de **webhooks del proveedor** o de operaciones `admin` ejecutadas por el **service role**. El frontend solo lee.
>
> 🔴 **S-28 DEROGADO — el checkout NO es alojado.** El formulario de pago vive **dentro del sitio**
> (punto 2 de `docs/DICTADO-PAGOS.md`): Stripe con `ui_mode: 'form'` y dLocal con
> `allow_transparent`. Lo que sobrevive del supuesto es su consecuencia: **no se almacenan datos de
> tarjeta**, porque los campos siguen viviendo en iframes del proveedor. El alcance PCI no cambia.
> Dos excepciones inevitables sacan al alumno de la página y ninguna es evitable por código: el
> **3DS** del banco emisor, y los **medios locales** de dLocal (PIX, boleto, OXXO, efectivo), que solo
> existen en su formulario alojado.
>
> **Quién cobra lo decide el país del ALUMNO** (RN-15), y `payments.provider` se **congela al crear la
> reserva**: cambiar el ruteo después no cambia quién cobra una reserva ya vendida.
>
> La elección autorización-luego-captura vs. cobro inmediato depende del adaptador y no acopla esta
> máquina.

---

## 2.10 M7 — Payout / Liquidación (`payout_status`)

Liquidación del neto del tutor tras el periodo de retención: **7 días**, en lote **semanal**. **Solo service role** (S-15).

**Estados**

| Estado | Tipo | Descripción |
| :-- | :-- | :-- |
| `pending` | inicial | Neto devengado del tutor, aún en retención; no programado. |
| `scheduled` | intermedio | Programado para liquidar (fin de retención + fecha). |
| `processing` | intermedio | En ejecución contra el proveedor de payout. |
| `paid` | terminal | Liquidación confirmada por el proveedor. |
| `failed` | intermedio | Error del proveedor; reintenta o pasa a `on_hold`. |
| `on_hold` | intermedio | Retenido por el admin (disputa, KYC, fraude, reembolso pendiente). |

**Transiciones**

| Desde | Evento / disparador | Hacia | Actor | Guarda | Efectos |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `pending` | Programar | `scheduled` | sistema | Retención de **7 días** vencida; o retiro pedido por el tutor (RN-40) | Calcula `retention_until`/`scheduled_for`; agrupa `payout_items` por **(tutor, moneda, balance de origen)** |
| `scheduled` | Ejecutar | `processing` | sistema | `now() ≥ scheduled_for`; el riel sale de `payout_providers` del **país del TUTOR**, filtrado por lo que este tutor tiene registrado | Llama `provider.payout()` (Doc 6 §6.7) |
| `processing` | Confirmación | `paid` | job / proveedor | El proveedor confirma la entrega | `paid_at`; escribe `provider` (quién ejecutó); notifica tutor (NTF-12) |
| `processing` | Rechazo del proveedor | `failed` | job | — | `failed_at`; `failure_reason`; NTF-16. 🔴 **No baja al siguiente riel**: hay que reintentar desde el panel |
| `failed` | Reintentar | `scheduled` | admin / sistema | Causa subsanada | Re-programa |
| `pending` / `scheduled` / `failed` | Retener | `on_hold` | admin | Disputa/KYC/reembolso | Bloquea liquidación; notifica interno |
| `on_hold` | Liberar | `scheduled` | admin | Incidencia resuelta | Re-habilita |

> **RN-30:** el devengo del neto del tutor (`tutor_net_amount`) ocurre al `paid` del pago (M6) mediante un `payout_item` (Doc 1 §1.4.14). La agregación es **por lote**, y la clave de agrupación incluye el **balance de origen** (`payouts.funding_provider`): un tutor con cobros de dos corredores recibe **dos** órdenes de retiro.
>
> ⚠️ **Hay un estado que la máquina no nombra: «en duda».** Cuando el adaptador no puede afirmar si el dinero salió, la fila **se queda en `processing`** y no se reintenta sola: la barre la pasada siguiente hasta poder afirmar algo. Es la única salida honesta de una API sin idempotencia, y es el motivo de que `processing` no sea un estado de paso rápido.
>
> ⚠️ **Un riel `manual` no tiene adaptador y no va a tenerlo.** Esas órdenes se quedan quietas y las cierra una persona con `manage_payout(id, 'mark_paid', referencia, canal)`. Solo Venezuela.
>
> **SUPUESTO S-29:** si un pago asociado a un `payout_item` se reembolsa **antes** de liquidar, el item se excluye/ajusta del payout `pending`/`scheduled`. Si se reembolsa **después** de `paid`, se gestiona como **clawback** manual del admin (no automatizado en MVP).

---

## 2.11 M8 — Documento de verificación (`document_status`)

Cada archivo de KYC subido por el tutor (S-10). Alimenta M2.

**Estados**

| Estado | Tipo | Descripción |
| :-- | :-- | :-- |
| `pending` | inicial | Subido; en revisión. |
| `approved` | terminal | Aceptado por el admin. |
| `rejected` | terminal | Rechazado; el tutor sube un documento nuevo (fila nueva). |

**Transiciones**

| Desde | Evento / disparador | Hacia | Actor | Guarda | Efectos |
| :-- | :-- | :-- | :-- | :-- | :-- |
| — | Subir documento | `pending` | tutor | Archivo en bucket privado (S-19) | Encola revisión; puede mover M2 a `pending` |
| `pending` | Aprobar | `approved` | admin | Documento válido | `reviewed_by`/`reviewed_at`; contribuye a M2 `approved` |
| `pending` | Rechazar | `rejected` | admin | — | `review_notes`; el tutor re-sube (nueva fila → M2 `pending`) |

> **SUPUESTO S-30:** los documentos no se "reactivan": un `rejected` permanece como histórico y la corrección es un **documento nuevo**. M2 pasa a `approved` cuando el conjunto requerido de documentos está `approved` (criterio operativo del admin).

---

## 2.12 Orquestación entre máquinas (camino feliz)

Secuencia coordinada de la compra de un producto (sesión simple o paquete):

| Paso | Disparador | M4 Reserva | M6 Pago | M5 Sesión(es) | M7 Payout |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | Alumno crea reserva y va a checkout | `pending_payment` | `pending` | — | — |
| 2 | Proveedor confirma cobro (webhook) | → `pending_acceptance` | → `paid` | — | — |
| 2b | El tutor acepta dentro de 24 h (RN-38) | → `confirmed` | `paid` | crea `scheduled` (1..N) | devenga `payout_item` (`pending`) |
| 3 | Llega la hora; abre ventana de acceso | `confirmed` → `in_progress` (1ª sesión) | `paid` | `scheduled` → `in_progress` | `pending` |
| 4 | Termina cada sesión | `in_progress` | `paid` | `in_progress` → `completed` | `pending` |
| 5 | Última sesión completada | → `completed` (abre reseña) | `paid` | `completed` | `pending` |
| 6 | Vence la retención de 7 días (lote semanal) | `completed` | `paid` | `completed` | `pending` → `scheduled` |
| 7 | Job ejecuta payout | `completed` | `paid` | `completed` | `scheduled` → `processing` → `paid` |

**Reglas de coordinación clave**

- **RN-25 / RN-28:** `completed` de la reserva ⇒ habilita reseña.
- **RN-30:** devengo de payout al `paid` del pago; liquidación al fin de retención.
- Los **slots** se reservan de forma tentativa en `pending_payment` y se confirman en `confirmed`; si expira la ventana (RN-27) se liberan.

---

## 2.13 Cancelaciones, reembolsos y no-show

La política de reembolsos **está cerrada: RN-37**, única de plataforma y no por tutor. Los
porcentajes viven en `src/lib/policy.ts`, que es de donde los leen también las páginas legales.

| Escenario | Estados resultantes | Reembolso |
| :-- | :-- | :-- |
| Cancelación del alumno con **≥24 h** de antelación | `booking → cancelled`, `payment → refunded`, `sessions → cancelled` | **100 %** |
| Cancelación del alumno con **<24 h** | `booking → cancelled`, `payment → partially_refunded` | **50 %** |
| Cancelación del **tutor**, en cualquier momento | `booking → cancelled`, `payment → refunded` | **100 %** |
| El tutor rechaza, o vencen sus 24 h en `pending_acceptance` | `booking → cancelled`, `payment → refunded` | **100 %** (RN-38) |
| `no_show` del alumno | `session → no_show`; la reserva puede contar como consumida | `DECISIÓN PENDIENTE DP-08` |
| `no_show` del tutor | `session → no_show`; reembolso al alumno | `DP-08` |

⚠️ **Y hay un hueco de ≤15 minutos**: la reserva deja de ser cancelable cuando pasa a `completed`,
que ocurre en `end_at + 10 min` más lo que tarde el cron. Entre el fin de la clase y ese cierre
todavía se puede cancelar al 50 %. Es un caso de borde conocido y cerrarlo es tocar
`cancel_booking`, que es dinero.

> **DECISIÓN PENDIENTE DP-08 (nueva — operativa, no estratégica de pagos):** política de **inasistencia (`no_show`)** — ventana de gracia, quién marca el no-show, y efecto financiero (¿se cobra al alumno?, ¿se reembolsa por no-show del tutor?). **No se resuelve aquí.** Se documenta como supuesto operable (S-24/S-29) y se consolida en el Doc 9. *Default operable mientras se resuelve:* no-show del alumno = sesión consumida (sin reembolso); no-show del tutor = reembolso de esa sesión.

---

## 2.14 Retención y agregación de payout

- **Inicio de retención:** al `paid` del pago (RN-30). **Fin: 7 días**, y el lote lo arma
  `run_payout_batch()` una vez por semana. El parámetro es un argumento de la función, así que
  cambiarlo no toca el modelo.
- **Agregación: por lote**, con clave **(tutor, moneda, `funding_provider`)**. La máquina M7 no
  cambia; lo que cambia es cuántas órdenes salen: un tutor que cobró por dos corredores recibe dos.
- **Moneda/FX (`DP-07`, abierta):** si la moneda de liquidación difiere de la de cobro, M7 usa
  `settlement_currency`/`fx_rate` del pago sin cambiar estados. Lo que falta es la **política** de
  quién asume la diferencia.
- ⚠️ **`run-payout-batch` es un job de pg_cron semanal, y un pg_cron que falla no avisa a nadie.**
  Se cae de la ventana si se leen las últimas filas de `cron.job_run_details`: hay que agregar por
  `jobname`.

---

## 2.15 Reglas y supuestos introducidos en este documento

**Reglas de negocio nuevas**

| ID | Regla |
| :-- | :-- |
| RN-23 | Un tutor solo tiene productos `active`/reservables si `approval_status = approved` (M1→M3/M4). |
| RN-24 | Un producto es reservable solo si `status = active` **y** el tutor está `approved`; la guarda se evalúa al crear la reserva. |
| RN-25 | Una reserva pasa a `completed` cuando todas sus sesiones están en estado terminal y ≥1 se completó. |
| RN-26 | Las transiciones de `payment`/`payout` se originan solo en webhooks/service role; el cliente solo lee (S-15). |
| RN-27 | Una reserva en `pending_payment` se autocancela al expirar la ventana de pago. |
| RN-28 | La reseña solo puede crearse con `booking.status = completed`. |
| RN-29 | *(operativa)* El admin no aprueba a un tutor con identidad no verificada (M2 `approved`), salvo relajación por negocio (S-21). |
| RN-30 | El neto del tutor se devenga al `paid` del pago (`payout_item`); la liquidación se programa al vencer la retención de **7 días**. |

**Supuestos nuevos**

| ID | Supuesto |
| :-- | :-- |
| S-21 | La guarda "identidad aprobada antes de aprobar tutor" (RN-29) es relajable por decisión de negocio sin cambios de modelo. |
| S-22 | La verificación de identidad es independiente del tier y no afecta el split. |
| S-23 | Al suspender a un tutor no se cambian masivamente los `product_status`; se filtra en consulta/creación de reserva. |
| S-24 | Si todas las sesiones de una reserva son `no_show`/`cancelled`, la reserva no se marca `completed` ni habilita reseña. |
| S-25 | ~~Ventana de checkout de 30 min~~ → **20 min** en código (RN-27); el slot se reserva tentativamente hasta que el tutor acepta. |
| S-26 | El cierre de sesión a `completed` lo hace el sistema al vencer la ventana; el tutor puede adelantarlo. |
| S-27 | La reprogramación se modela como cancelación + nueva sesión (sin estado `rescheduled` en el MVP). |
| S-28 | 🔴 **Derogado**: el checkout vive **dentro del sitio**, no alojado. Lo que sigue en pie es que no se guardan datos de tarjeta. Ver §2.9. |
| S-29 | Reembolso previo a liquidar excluye/ajusta el `payout_item`; reembolso posterior a `paid` = clawback manual del admin. |
| S-30 | Documentos KYC no se reactivan; la corrección es un documento nuevo; M2→`approved` con el conjunto requerido aprobado. |

**Decisión pendiente nueva**

| ID | Decisión | Opciones | Impacto |
| :-- | :-- | :-- | :-- |
| DP-08 | Política de inasistencia (`no_show`): ventana de gracia, quién marca, efecto financiero | (a) no-show alumno = consumido / no-show tutor = reembolso; (b) ventana de gracia con reprogramación; (c) penalizaciones configurables | Estados M5/M4, reembolsos, reportes. **Sigue abierta** — es la única DP de este documento que no se ha cerrado |

---

## 2.16 Nota sobre diagramas

Los **diagramas de estado (Mermaid `stateDiagram-v2`)** de cada máquina (M1–M8) y el **diagrama de secuencia** de la orquestación (§2.12) se agregarán en la **pasada final de diagramas**, una vez aprobado el contenido textual, conforme a la metodología acordada (contenido primero, diagramas al final). El `.md` es la fuente y el `.pdf` se regenerará entonces.

---

*Fin del Documento 2.*
