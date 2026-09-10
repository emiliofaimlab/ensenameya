# DOC 7 — Matriz de Notificaciones y Correos

> **Enséñame Ya — MVP Web.** Catálogo de notificaciones transaccionales, sus disparadores (estados
> del Doc 2), las pantallas desde las que se ven (§7.3b) y el registro de envíos.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 7 — Matriz de Notificaciones y Correos |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Doc 2 (transiciones que disparan), Doc 4 (flujos), Doc 6 §6.11 (adaptador de correo) |
| **Alimenta a** | Doc 8 (backlog de notificaciones), plantillas de `src/lib/email-templates.ts` |

---

## 7.1 Propósito y alcance

Cataloga **todas las notificaciones** del MVP: qué evento las dispara, a quién llegan, por qué canal
y con qué plantilla. Define además el **registro de envíos** (`notifications`), que es a la vez la
cola de correo y la fuente de los avisos in-app.

**La herramienta de correo ya está decidida: Resend** (C-11 / DP-05, Doc 6 §6.11). El catálogo sigue
viviendo detrás de un puerto —`src/lib/email.ts`— así que cambiar de proveedor no toca ningún
disparador.

---

## 7.2 Canales y estrategia

| Canal | Alcance MVP | Nota |
| :-- | :-- | :-- |
| **Email transaccional** | Primario | Resend. Sin `RESEND_API_KEY` la cola se queda `pending`, nunca `failed`. |
| **In-app (campana/lista)** | Secundario, **construido** | Se derivan de la **misma** tabla `notifications` con `read_at` (S-50 confirmado). No hay tabla aparte. |
| **Push / SMS** | Fuera de alcance | — |

- **Localización y zona horaria:** el contenido va en español (S-38); las fechas se muestran en el
  `timezone` del destinatario (RN-02).
- **Idempotencia (RN-36):** la garantiza `notifications.idempotency_key`, que es `unique`, y la
  compone `enqueue_notification()` con el evento y el destinatario dentro. Un segundo intento del
  mismo evento no inserta nada.
- ⚠️ **Encolar no es enviar, y `process_notifications()` no envía.** Esa función **solo informa** del
  estado de la cola. Quien habla con Resend y mueve las filas a `sent` es el job
  `/api/cron/notifications-send`.
- ⚠️ **La cadencia real del reloj no es la que pide el `cron`.** Los programados de GitHub Actions
  piden minutos y entregan una corrida cada pocas horas. Un aviso de «te quedan 24 h» no se puede
  planificar al minuto.
- **Preferencias:** opt-out de no-esenciales = `SUPUESTO S-49`, **sin construir**.

---

## 7.3 Catálogo de notificaciones

> Disparador = transición de estado (Doc 2) o evento de flujo (Doc 4). La columna **Plantilla** es el
> valor real de `notifications.template`, y el **código** el de `notifications.type`.

| ID | Evento disparador | Destinatario | Canal | Plantilla | Estado |
| :-- | :-- | :-- | :-- | :-- | :-- |
| NTF-01 | Registro | alumno/tutor | email | *(Supabase Auth)* | **Fuera de la cola**: la manda Auth, no `notifications` |
| NTF-02 | Solicitud de reset | usuario | email | *(Supabase Auth)* | **Fuera de la cola**: la manda Auth |
| NTF-03 | M1/M2: aprobado · rechazado · suspendido · reactivado | tutor | email + in-app | `tutor_review_result` | ✅ en código |
| NTF-04 | M6 `→ paid` | alumno | email | `payment_receipt` | ✅ en código |
| NTF-05 | M4 `→ confirmed` | alumno | email + in-app | `booking_confirmed_student` | ✅ en código |
| NTF-06 | M2 `→ pending` (KYC recibido) | tutor | email | `identity_in_review` | ✅ en código |
| NTF-07 | M4 `→ confirmed` (lado tutor) | tutor | email + in-app | `booking_new_tutor` | ✅ en código |
| NTF-08 | Apertura de ventana de sala (RN-18, S-45) | alumno + tutor | email + in-app | `session_starting` | 🔴 **sin cablear** |
| NTF-09 | M4/M5 `→ cancelled` | afectado(s) | email + in-app | `cancellation` | ✅ en código |
| NTF-10 | Reembolso **pedido** (ver el aviso de abajo) | alumno | email | `refund_processed` | ✅ en código, con desfase |
| NTF-11 | Recordatorio 24 h antes | alumno + tutor | email + in-app | `session_reminder_24h` | 🔴 **sin cablear** |
| NTF-12 | M7 `→ paid` | tutor | email + in-app | `payout_paid` | ✅ en código |
| NTF-13 | Incidencias operativas (cobro fallido, payout `failed`/`on_hold`, disputa) | admin | email + in-app | `admin_alert` | 🔴 **sin cablear** |
| NTF-14 | M4 `→ completed` (RN-28) | alumno | email + in-app | `review_request` | ✅ en código |
| NTF-15 | M6 `→ failed` dentro de ventana (RN-27) | alumno | email + in-app | `payment_failed` | ✅ en código |
| NTF-16 | M7 `→ on_hold`/`failed` | tutor | in-app | `payout_issue` | ✅ en código |
| NTF-17 | M4 `→ pending_acceptance` (RN-38): «tienes 24 h para aceptar» | tutor | email + in-app | *(por definir)* | 🔴 **stub**: el camino existe (`respond_booking`) y no encola nada |
| NTF-18 | — | — | — | — | **Reservada** en el rango |
| NTF-19 | Grabación disponible para descarga (US-1802) | alumno + tutor | email | `recording_ready` | ✅ en código |
| NTF-20 | — | — | — | — | **Reservada** en el rango |
| NTF-21 | Mensaje nuevo en un hilo de chat (EY-151) | el otro participante | email + in-app | `new_message` | ✅ en código. Agrupa por hilo y hora UTC, así que una ráfaga de mensajes es **un** aviso |
| NTF-22 | El admin escribe a un alumno o a un tutor desde la bandeja de moderación (EY-189) | destinatario | email + in-app | `admin_message` | ✅ en código. No es un canal nuevo: sale por el remitente de siempre y deja rastro en `/admin/notificaciones` |
| NTF-23 | Payout reclamado y sin cerrar tras N días | tutor | email + in-app | `payout_unclaimed` | ✅ en código. Avisa **una** vez por payout |

> 🔴 **NTF-10 avisa cuando el reembolso se PIDE, no cuando el dinero se mueve.** Lo encola el camino
> de cancelación (`cancel_booking` / `refund_payment`, `20260716170000`); quien habla con el PSP es el
> job `/api/cron/refunds-process`, y **ese no encola nada**. Entre las dos cosas hay una cola,
> `refund_requests`. El correo dice «procesamos tu reembolso» antes de que sea verdad. Con el cron
> corriendo la ventana es de horas, pero **mover el aviso al job es decisión de producto**, no un
> arreglo técnico: hay que elegir si el alumno recibe un acuse al pedirlo, un aviso al cobrarlo, o
> los dos.

> ⚠️ **NTF-23 solo puede decir «reclámala» en PayPal.** El barrido que la encola no filtra por riel,
> y a un tutor con cuenta bancaria nadie le ha pedido que reclame nada. El texto se decide por el
> `provider` del payload; sin él cae al texto neutro, que es cierto en cualquier riel.

> **No-show:** el aviso por inasistencia y su contenido dependen de **DP-08**; se reutilizan
> NTF-09/NTF-10 según se resuelva. No se fija aquí.

---

## 7.3b Cruce pantalla → notificación

> Absorbido del Doc 5 §5.4–§5.7 (retirado), que era donde vivía este cruce. Los IDs de pantalla son
> los del Doc 4 §4.2.

| Pantalla | Notificación que se dispara desde ahí, o que explica lo que se ve |
| :-- | :-- |
| SCR-AU02 · Registro | **NTF-01** bienvenida / verificación de correo |
| SCR-AU03 · Recuperar contraseña | **NTF-02** reset, con la pantalla de nueva contraseña detrás del token |
| SCR-AL05 · Checkout / Pago | **NTF-04** recibo, al `paid` |
| SCR-AL06 · Confirmación de Reserva | **NTF-05** al alumno y **NTF-07** al tutor. ⚠️ Entre el pago y esta pantalla está `pending_acceptance` (RN-38): el aviso de que el tutor tiene 24 h es **NTF-17**, y hoy no se manda |
| SCR-AL07 · Flujo de Cancelación | **NTF-09** cancelación y **NTF-10** reembolso, si aplica |
| SCR-TU02 · Verificación de Identidad | **NTF-06** «recibimos tus documentos»; al re-subir tras un rechazo, otra vez |
| SCR-TU07 · Reservas del Tutor | **NTF-07** nueva reserva (viene de FL-01) |
| SCR-TU09 · Payout / Cobros | **NTF-12** liquidación pagada · **NTF-16** incidencia · **NTF-23** payout que no ha llegado |
| SCR-LV01 · Sala en vivo | **NTF-08** «tu clase está por comenzar» (sin cablear) y **NTF-19** grabación disponible |
| Bandeja de mensajería / chat de reserva | **NTF-21** mensaje nuevo |
| SCR-AD05 · Detalle de Tutor | **NTF-03** resultado de aprobación / identidad al tutor |
| SCR-AD08 · Detalle de Pago | **NTF-10** reembolso |
| SCR-AD14 · Alertas / Incidencias | **NTF-13** alertas internas (sin cablear) |
| SCR-AD15 · Payouts a Tutores | Internas; **NTF-12** al tutor cuando pasa a `paid` |
| Bandeja de moderación del admin | **NTF-22** mensaje del admin al usuario |

---

## 7.4 Cobertura por máquina de estado

| Máquina (Doc 2) | Transiciones con notificación |
| :-- | :-- |
| M1 Aprobación tutor | NTF-03 (aprobado/rechazado/suspendido/reactivado) |
| M2 Identidad | NTF-06 (recibido), NTF-03 (resultado) |
| M4 Reserva | **NTF-17** (`pending_acceptance`, sin cablear), NTF-05/07 (`confirmed`), NTF-09 (`cancelled`), NTF-14 (`completed`) |
| M5 Sesión | NTF-08 (inicio, sin cablear), NTF-11 (recordatorio, sin cablear), NTF-09 (cancelación), NTF-19 (grabación) |
| M6 Pago | NTF-04 (recibo), NTF-10 (reembolso pedido), NTF-15 (fallido) |
| M7 Payout | NTF-12 (pagado), NTF-16 (incidencia), NTF-23 (reclamado y sin cerrar) |
| M8 Documento | (parte de NTF-06 / NTF-03) |
| Fuera de máquina | NTF-21 (chat), NTF-22 (mensaje del admin) |

---

## 7.5 Registro de envíos — tabla `notifications`

Es la cola de correo **y** la fuente de los avisos in-app. Columnas reales
(`20260716170000` + `20260729200000`):

| Campo | Tipo | Restricciones | Descripción |
| :-- | :-- | :-- | :-- |
| `id` | uuid | PK | — |
| `recipient_id` | uuid | NOT NULL, FK → `profiles.id` on delete cascade | Destinatario. **No admite NULL**: un aviso de admin va a una persona concreta. |
| `type` | text | NOT NULL | El código `NTF-xx` del catálogo §7.3. |
| `channel` | text | NOT NULL DEFAULT `'email'` | `email` / `in_app`. |
| `template` | text | NOT NULL | La plantilla (columna «Plantilla» de §7.3). |
| `payload` | jsonb | NOT NULL DEFAULT `'{}'` | Variables. **Nada de PII innecesaria**: NTF-21 manda solo el `conversation_id`. |
| `idempotency_key` | text | NOT NULL **UNIQUE** | Clave de idempotencia (RN-36). La compone `enqueue_notification()`. |
| `status` | `notification_status` | NOT NULL DEFAULT `'pending'` | `pending` / `sent` / `failed`. |
| `sent_at` | timestamptz | NULL | Cuándo lo aceptó Resend. |
| `read_at` | timestamptz | NULL | Del **destinatario**, no del sistema: es lo único que él escribe. |
| `created_at` | timestamptz | NOT NULL DEFAULT `now()` | Auditoría. |

**RLS:** el destinatario lee lo suyo (`auth.uid() = recipient_id`), el `admin` lee todo, y la
**escritura es server-side** (S-15). La única excepción es `grant update (read_at) to authenticated`:
marcar leído es del usuario y no toca nada más. Índices por `recipient_id`, `status` y un parcial
sobre `read_at is null` para la campana.

⚠️ **No hay `entity_type`/`entity_id`.** Lo que ata un aviso a su entidad va dentro del `payload` y
de la `idempotency_key`; consultar por entidad significa consultar el jsonb.

---

## 7.6 Temporización (jobs)

| Notificación | Mecanismo | Disparo |
| :-- | :-- | :-- |
| NTF-03/04/05/06/07/09/10/12/14/15/16/19/21/22 | Reactivo: trigger o función de la transición encola | Inmediato al cambio de estado; el **envío** lo hace el job |
| NTF-23 | Barrido dentro del job de payouts | Cuando la orden lleva N días reclamada y sin cerrar |
| NTF-08 · NTF-11 · NTF-13 · NTF-17 | — | **Sin cablear** |

El envío de todo lo encolado lo hace **`/api/cron/notifications-send`**, disparado por GitHub
Actions y protegido por `CRON_SECRET` (503 sin ella).

⚠️ **Nadie ha visto llegar todavía un correo de esta cola en producción**, porque las dos colas de
prod están vacías. Y la de dev se llena de basura sola: el seed usa `@ensenameya.dev`, un dominio
sin MX.

---

## 7.7 Reglas y supuestos introducidos en este documento

**Reglas de negocio**

| ID | Regla | Estado |
| :-- | :-- | :-- |
| RN-35 | Los recordatorios se calculan y muestran en la hora local (`timezone`) del destinatario. | Vigente; sin recordatorios cableados que la ejerciten. |
| RN-36 | Cada notificación se envía una sola vez por (evento, destinatario). | ✅ **En código**, por `notifications.idempotency_key` único. |

**Supuestos**

| ID | Supuesto | Estado |
| :-- | :-- | :-- |
| S-48 | Canal in-app además del correo. | ✅ **Construido** (campana + `/account`). |
| S-49 | Opt-out de no esenciales. | **Sin construir.** |
| S-50 | Los avisos in-app se derivan de `notifications` con un `read_at`. | ✅ **Confirmado tal cual.** |
| S-51 | Recordatorio de 24 h + aviso de inicio. | **Sin construir** (NTF-08/NTF-11). |

**Decisiones:** **DP-05 resuelta** (Resend), **DP-03 resuelta** (RN-37). Sigue abierta **DP-08**
(no-show), y con ella el contenido del aviso de inasistencia.

---

*Fin del Documento 7.*
