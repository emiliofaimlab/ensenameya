# DOC 7 — Matriz de Notificaciones y Correos

> **Enséñame Ya — MVP Web.** Catálogo de notificaciones transaccionales, sus disparadores (estados del Doc 2) y el registro de envíos.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 7 — Matriz de Notificaciones y Correos |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Doc 2 (transiciones que disparan), Doc 4/5 (pantallas), Doc 6 (`EmailProvider`, DP-05) |
| **Alimenta a** | Doc 8 (backlog de notificaciones), implementación de plantillas |
| **Estado** | Borrador para revisión |
| **Fecha** | 2026-06-03 |

---

## 7.1 Propósito y alcance

Cataloga **todas las notificaciones** del MVP: qué evento las dispara (cruzando con las máquinas de estado del Doc 2), a quién llegan, por qué canal, con qué contenido y cuándo. Define además el **registro de envíos** (`notifications`) que el Doc 1 dejó referenciado. La **herramienta de envío de email es `DECISIÓN PENDIENTE DP-05`**; aquí se diseña el catálogo **detrás del puerto `EmailProvider`** (Doc 6 §6.11), de modo que el proveedor sea intercambiable.

---

## 7.2 Canales y estrategia

| Canal | Alcance MVP | Nota |
| :-- | :-- | :-- |
| **Email transaccional** | Primario | Detrás de `EmailProvider` (DP-05). Plantillas por `templateKey`. |
| **In-app (banner/lista)** | Secundario | Estados y avisos en dashboards (SCR-AL02/TU06/AD02/AD14). `SUPUESTO S-48`. |
| **Push / SMS** | Fuera de alcance | Posible fase futura. |

- **Localización y zona horaria:** el contenido va en español (S-38); las fechas/horas se muestran en el `timezone` del destinatario (RN-02); los **recordatorios se calculan en hora local** del usuario (RN-35).
- **Idempotencia:** una notificación disparada por un evento de estado se envía **una sola vez** por (evento, destinatario), registrada en `notifications` (RN-36).
- **Preferencias:** opt-out de no-esenciales y respeto de transaccionales obligatorias = `SUPUESTO S-49`.

---

## 7.3 Catálogo de notificaciones

> Disparador = transición de estado (Doc 2) o evento de flujo (Doc 4). `templateKey` es la clave que consume `EmailProvider.send()` (Doc 6).

| ID | Evento disparador (estado / flujo) | Destinatario | Canal | `templateKey` | Asunto (ejemplo) | Variables clave |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| NTF-01 | Registro (SCR-AU02) | alumno/tutor | email | `welcome_verify` | "Confirma tu correo en Enséñame Ya" | nombre, verify_url |
| NTF-02 | Solicitud de reset (SCR-AU03) | usuario | email | `password_reset` | "Restablece tu contraseña" | reset_url, expiración |
| NTF-03 | M1/M2: aprobado·rechazado·suspendido·reactivado | tutor | email + in-app | `tutor_review_result` | "Actualización de tu cuenta de tutor" | estado, motivo, próximos_pasos |
| NTF-04 | M6 `→ paid` (SCR-AL05) | alumno | email | `payment_receipt` | "Recibo de tu pago" | monto, moneda, producto, ref |
| NTF-05 | M4 `→ confirmed` | alumno | email + in-app | `booking_confirmed_student` | "Tu reserva está confirmada" | producto, sesiones, fechas locales |
| NTF-06 | M2 `→ pending` (KYC recibido) | tutor | email | `identity_in_review` | "Recibimos tus documentos" | lista_docs, SLA estimado |
| NTF-07 | M4 `→ confirmed` (lado tutor) | tutor | email + in-app | `booking_new_tutor` | "Tienes una nueva reserva" | alumno, producto, fechas locales |
| NTF-08 | Apertura de ventana (RN-18, S-45) | alumno + tutor | email + in-app | `session_starting` | "Tu clase está por comenzar" | enlace_sala, hora local |
| NTF-09 | M4/M5 `→ cancelled` | afectado(s) | email + in-app | `cancellation` | "Se canceló tu reserva/sesión" | motivo, reembolso_estimado (DP-03) |
| NTF-10 | M6 `→ refunded/partially_refunded` | alumno | email | `refund_processed` | "Procesamos tu reembolso" | monto, moneda, ref |
| NTF-11 | Recordatorio 24h antes (job) | alumno + tutor | email + in-app | `session_reminder_24h` | "Recordatorio: clase mañana" | producto, hora local, enlace |
| NTF-12 | M7 `→ paid` | tutor | email + in-app | `payout_paid` | "Tu pago fue liquidado" | monto, moneda, periodo, ref |
| NTF-13 | Incidencias (pago fallido, payout `failed`/`on_hold`, disputa, conciliación) | admin | email + in-app | `admin_alert` | "Incidencia operativa" | tipo, entidad, severidad |
| NTF-14 | M4 `→ completed` (RN-28) | alumno | email + in-app | `review_request` | "¿Cómo estuvo tu clase?" | tutor, enlace_reseña |
| NTF-15 | M6 `→ failed` dentro de ventana (RN-27) | alumno | email + in-app | `payment_failed` | "No pudimos procesar tu pago" | motivo, reintentar_url, expiración |
| NTF-16 | M7 `→ on_hold`/`failed` | tutor | in-app (email opcional) | `payout_issue` | "Tu liquidación está en revisión" | motivo, contacto |

> **No-show (NTF condicional):** el aviso por inasistencia y su contenido dependen de **DP-08** (política) y **DP-03** (efecto financiero); se reutilizan NTF-09/NTF-10 según la resolución. No se fija aquí.

---

## 7.4 Cobertura por máquina de estado

| Máquina (Doc 2) | Transiciones con notificación |
| :-- | :-- |
| M1 Aprobación tutor | NTF-03 (aprobado/rechazado/suspendido/reactivado) |
| M2 Identidad | NTF-06 (recibido), NTF-03 (resultado) |
| M4 Reserva | NTF-05/07 (confirmada), NTF-09 (cancelada), NTF-14 (completada) |
| M5 Sesión | NTF-08 (inicio), NTF-11 (recordatorio), NTF-09 (cancelación) |
| M6 Pago | NTF-04 (recibo), NTF-10 (reembolso), NTF-15 (fallido) |
| M7 Payout | NTF-12 (pagado), NTF-16 (incidencia), NTF-13 (admin) |
| M8 Documento | (parte de NTF-06/NTF-03) |

---

## 7.5 Registro de envíos — tabla `notifications`

Resuelve la referencia diferida del Doc 1 (§1.4.17). Permite idempotencia, auditoría y reintentos.

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `recipient_id` | uuid | FK -> `profiles.id`, NULL | Destinatario (NULL si admin/externo). |
| `recipient_email` | text | NOT NULL | Email objetivo (espejo). |
| `ntf_code` | text | NOT NULL | `NTF-xx` (catálogo §7.3). |
| `template_key` | text | NOT NULL | Clave de plantilla (`EmailProvider`). |
| `channel` | text | NOT NULL | `email` / `in_app`. |
| `entity_type` | text | NULL | `booking`/`payment`/`payout`/... |
| `entity_id` | uuid | NULL | Entidad origen. |
| `event_key` | text | NOT NULL | Clave de idempotencia (evento+destinatario). |
| `status` | text | NOT NULL DEFAULT `queued` | `queued`/`sent`/`failed`/`skipped`. |
| `provider_message_id` | text | NULL | ID del proveedor (DP-05). |
| `payload` | jsonb | NULL | Variables usadas. |
| `error` | text | NULL | Causa de fallo. |
| `created_at` / `sent_at` | timestamptz | — | Auditoría. |
| — | — | UNIQUE(`event_key`,`recipient_email`) | Idempotencia (RN-36). |

**RLS:** lectura del usuario sobre sus propias notificaciones in-app; **escritura solo `service_role`** (S-15, igual que financiero). `admin` lee todo. **Índices:** (`recipient_id`,`status`), `ntf_code`, `event_key` único.

> `SUPUESTO S-50`: las notificaciones in-app se derivan de esta misma tabla (sin tabla aparte); el "no leído" se marca con un campo `read_at` opcional a confirmar en implementación.

---

## 7.6 Temporización (jobs)

| Notificación | Mecanismo | Disparo |
| :-- | :-- | :-- |
| NTF-04/05/07/10/12/15/03/06 | Reactivo (transición/webhook) | Inmediato al cambio de estado |
| NTF-08 | Job programado | Al abrir ventana de acceso (S-45) |
| NTF-11 | Job programado | 24 h antes (hora local del destinatario, RN-35) |
| NTF-13/16 | Reactivo | Al entrar a `failed`/`on_hold`/incidencia |
| NTF-14 | Reactivo | Al completar la reserva (RN-28) |

> `SUPUESTO S-51`: recordatorios adicionales (p. ej. 1 h antes) son configurables; el MVP incluye al menos 24 h + inicio. Cantidad/umbral a confirmar.

---

## 7.7 Reglas y supuestos introducidos en este documento

**Reglas de negocio nuevas**

| ID | Regla |
| :-- | :-- |
| RN-35 | Los recordatorios se calculan y muestran en la hora local (`timezone`) del destinatario. |
| RN-36 | Cada notificación se envía una sola vez por (evento, destinatario), garantizado por `notifications(event_key, recipient_email)`. |

**Supuestos nuevos**

| ID | Supuesto |
| :-- | :-- |
| S-48 | Canal in-app secundario (banners/lista) además del email transaccional. |
| S-49 | Opt-out de notificaciones no esenciales; transaccionales obligatorias siempre se envían. |
| S-50 | Las notificaciones in-app se derivan de la tabla `notifications` (campo `read_at` opcional). |
| S-51 | El MVP incluye recordatorio de 24 h + aviso de inicio; recordatorios extra configurables. |

**Decisiones pendientes referenciadas:** DP-05 (herramienta de email), DP-03/DP-08 (contenido de cancelación/no-show/reembolso). No se resuelven aquí.

---

## 7.8 Nota sobre diagramas

Un **mapa evento→notificación** (timeline por flujo) se agrega en la pasada final de diagramas. El `.md` es la fuente y el `.pdf` se regenerará entonces.

---

*Fin del Documento 7.*
