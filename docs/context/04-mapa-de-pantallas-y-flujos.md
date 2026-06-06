# DOC 4 — Mapa de Pantallas y User Flows

> **Enséñame Ya — MVP Web.** Inventario de pantallas, mapa de navegación y flujos de usuario end-to-end.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 4 — Mapa de Pantallas y User Flows |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Propuesta §6, §12; Doc 0–2 |
| **Alimenta a** | Doc 5 (spec por pantalla), Doc 7 (notificaciones por paso), Doc 8 (trazabilidad) |
| **Estado** | Borrador para revisión |
| **Fecha** | 2026-06-03 |

---

## 4.1 Propósito y alcance

Inventaria **todas las pantallas** del MVP (con un ID estable por pantalla, base de trazabilidad del Doc 8), describe la **navegación** entre ellas y traza los **flujos de usuario** principales paso a paso, cruzando cada paso con su pantalla, los **estados** que provoca (Doc 2) y las **notificaciones** que dispara (Doc 7). El **detalle de cada pantalla** (componentes, datos, validaciones) va en el Doc 5; los **diagramas de flujo** visuales se agregan en la pasada final.

**Convención de IDs de pantalla:** `SCR-{grupo}{nn}` — grupos `P` (público), `AU` (auth), `AL` (alumno), `TU` (tutor), `LV` (sala en vivo), `AD` (admin), `G` (global).

---

## 4.2 Inventario de pantallas

### 4.2.1 Públicas (sin login)

| ID | Pantalla | Propósito | Acceso |
| :-- | :-- | :-- | :-- |
| SCR-P01 | Landing / Home | Propuesta de valor + accesos a descubrimiento; destacados/populares | anon |
| SCR-P02 | Sobre Nosotros | Información institucional | anon |
| SCR-P03 | ¿Cómo funciona? | Explicación del modelo alumno/tutor | anon |
| SCR-P04 | Explorar Tutores | Grid/listado de tutores aprobados + búsqueda | anon |
| SCR-P05 | Explorar Clases/Productos | Listado de ofertas disponibles (enfoque reservar) | anon |
| SCR-P06 | Explorar/Resultados por Categoría | Navegación y listado filtrado por categoría | anon |
| SCR-P07 | Perfil público del Tutor | Bio, categorías, productos, rating, CTA "Reservar" | anon |
| SCR-P08 | Detalle de Producto (Tutoría) | Descripción, resultado, precio, modelo, CTA "Reservar" | anon |
| SCR-P09 | Resultados de Búsqueda | Búsqueda simple por palabra clave (materia/tutor/categoría) | anon |

### 4.2.2 Autenticación

| ID | Pantalla | Propósito | Acceso |
| :-- | :-- | :-- | :-- |
| SCR-AU01 | Login | Email + Google OAuth | anon |
| SCR-AU02 | Registro | Email + Google OAuth; selección de intención (alumno/tutor) | anon |
| SCR-AU03 | Recuperar contraseña | Reset por email | anon |
| SCR-AU04 | Callback OAuth / Verificación email | Retorno de proveedor; confirmación de correo | anon→auth |

### 4.2.3 Alumno (logged in)

| ID | Pantalla | Propósito | Acceso |
| :-- | :-- | :-- | :-- |
| SCR-AL01 | Onboarding Alumno | Perfil: nombre, `timezone` (RN-01), preferencias | alumno |
| SCR-AL02 | Dashboard Alumno | Sesiones activas y pasadas | alumno |
| SCR-AL03 | Detalle de Reserva / Sesión | Estado, sesiones, acceso a sala, acciones | alumno |
| SCR-AL04 | Agendar (selección de horario) | Elegir slot(s) disponibles del tutor | alumno |
| SCR-AL05 | Checkout / Pago | Resumen + pago por proveedor (DP-01) | alumno |
| SCR-AL06 | Confirmación de Reserva | Resumen + horario bloqueado | alumno |
| SCR-AL07 | Flujo de Cancelación | Cancelar reserva/sesión según política | alumno |
| SCR-AL08 | Dejar Reseña | Rating 1–5 + comentario (RN-28) | alumno |

### 4.2.4 Tutor (logged in)

| ID | Pantalla | Propósito | Acceso |
| :-- | :-- | :-- | :-- |
| SCR-TU01 | Onboarding Tutor | Bio, categorías, oferta inicial, `timezone` | tutor |
| SCR-TU02 | Verificación de Identidad | Subir documentos (KYC manual, M2/M8) | tutor |
| SCR-TU03 | Mis Productos | Listado/gestión de tutorías (M3) | tutor |
| SCR-TU04 | Crear/Editar Producto | Modelo de precio, duración, categorías, política | tutor |
| SCR-TU05 | Disponibilidad / Calendario | Reglas recurrentes + excepciones (S-03) | tutor |
| SCR-TU06 | Dashboard Tutor | Sesiones realizadas + total ganado | tutor |
| SCR-TU07 | Reservas del Tutor | Listado + detalle de reservas | tutor |
| SCR-TU08 | Detalle de Sesión (Tutor) | Ver estado / marcar completada | tutor |
| SCR-TU09 | Payout / Cobros | Estado de retiro, montos, historial (M7) | tutor |

### 4.2.5 Sala en vivo (compartida)

| ID | Pantalla | Propósito | Acceso |
| :-- | :-- | :-- | :-- |
| SCR-LV01 | Sala de Clase en Vivo 1:1 | Videollamada Daily; habilitada por ventana (RN-18, S-07) | alumno + tutor de la sesión |

### 4.2.6 Admin (panel)

| ID | Pantalla | Propósito | Acceso |
| :-- | :-- | :-- | :-- |
| SCR-AD01 | Login Admin | Acceso al panel | admin |
| SCR-AD02 | Dashboard Admin | Resumen de pendientes y KPIs | admin |
| SCR-AD03 | Tutores por Aprobar | Lista + filtros | admin |
| SCR-AD04 | Tutores Aprobados | Lista + filtros | admin |
| SCR-AD05 | Detalle de Tutor | Aprobar / rechazar / suspender / solicitar info; revisar KYC | admin |
| SCR-AD06 | Pagos Pendientes | Cobros en proceso/incidencias | admin |
| SCR-AD07 | Historial de Pagos | Lista + filtros | admin |
| SCR-AD08 | Detalle de Pago | Monto, comisiones, referencia, estado; reembolso | admin |
| SCR-AD09 | Reservas (Admin) | Lista + filtros | admin |
| SCR-AD10 | Detalle de Reserva (Admin) | Estado, pago asociado, logs básicos | admin |
| SCR-AD11 | Gestión de Categorías | CRUD de categorías | admin |
| SCR-AD12 | Comisión / Tiers | Editar split, crear tiers (RN-07) | admin |
| SCR-AD13 | Estadísticas Globales | KPIs filtrables por periodo | admin |
| SCR-AD14 | Alertas / Incidencias | Fallas de pago, cancelaciones, disputas | admin |
| SCR-AD15 | Payouts a Tutores | Lista, detalle, hold/release (M7) | admin |

### 4.2.7 Globales / transversales

| ID | Pantalla | Propósito | Acceso |
| :-- | :-- | :-- | :-- |
| SCR-G01 | Error (404 / 500) | Errores de ruta/servidor | todos |
| SCR-G02 | Estado vacío genérico | Sin datos en listados | todos |
| SCR-G03 | Configuración de cuenta | Perfil, `timezone`, seguridad, cerrar sesión | auth |

> **Referidos:** no es una pantalla propia. Es un **widget/integración de frontend** de Referral Factory embebido (p. ej. en SCR-AL02/SCR-G03) que captura `referral_code` (S-11/S-18). Sin lógica interna (RN-21).

---

## 4.3 Mapa de navegación (textual)

- **Entrada anónima:** SCR-P01 → (P04/P05/P06/P09 descubrir) → SCR-P07/P08 → CTA "Reservar" → si no hay sesión, SCR-AU01/AU02 → vuelve al flujo de reserva.
- **Post-login alumno:** SCR-AU0x → SCR-AL01 (onboarding, primera vez) → SCR-AL02 (home alumno) ↔ SCR-AL03/AL04/AL05/AL06/AL07/AL08, y SCR-LV01 desde SCR-AL03.
- **Post-login tutor:** SCR-AU0x → SCR-TU01 → SCR-TU02 (identidad) → (espera aprobación) → SCR-TU06 (home tutor) ↔ SCR-TU03/04/05/07/08/09, y SCR-LV01 desde SCR-TU08.
- **Admin:** SCR-AD01 → SCR-AD02 ↔ resto del panel AD.
- **Global:** SCR-G03 accesible desde el menú de usuario; SCR-G01/G02 según contexto.

> **SUPUESTO S-35:** no hay *checkout como invitado*; reservar/pagar exige sesión iniciada (se solicita login/registro antes del checkout). La navegación pública permite descubrir y ver detalle sin sesión.

---

## 4.4 FL-01 — Flujo del Alumno (descubrir → reservar → clase → reseña)

| Paso | Pantalla | Acción del usuario | Respuesta del sistema | Estado (Doc 2) | Notif (Doc 7) |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | SCR-AU02/AU01 | Registro/Login (email o Google) | Crea/abre sesión | — | NTF bienvenida |
| 2 | SCR-AL01 | Completa onboarding (`timezone`, prefs) | Guarda perfil (RN-01) | — | — |
| 3 | SCR-P04/05/06/09 | Descubre tutores/productos/categoría | Lista resultados (solo activos/aprobados, RN-24) | — | — |
| 4 | SCR-P07/P08 | Abre perfil/producto y "Reservar" | Muestra disponibilidad del tutor | — | — |
| 5 | SCR-AL04 | Selecciona slot(s) (paquete → N) | Valida disponibilidad; crea reserva tentativa | `booking: pending_payment` | — |
| 6 | SCR-AL05 | Paga (checkout del proveedor) | Resuelve proveedor (RN-15); procesa cobro | `payment: pending→paid` (webhook) | NTF recibo |
| 7 | SCR-AL06 | Ve confirmación | Confirma reserva; crea sesiones y salas | `booking: confirmed`; `session: scheduled` | NTF reserva confirmada (alumno+tutor) |
| 8 | SCR-AL02/AL03 | Revisa próximas sesiones | Muestra agenda; recordatorios programados | `confirmed` | NTF recordatorio (24h/1h, S-07) |
| 9 | SCR-LV01 | Entra a la sala en su horario | Habilita acceso por ventana (RN-18) | `session: in_progress`; `booking: in_progress` | NTF "sala lista" |
| 10 | SCR-LV01 | Toma la clase; finaliza | Cierra sesión | `session: completed` | — |
| 11 | SCR-AL03 | (al completar todas) | Marca reserva completada | `booking: completed` (RN-25) | NTF "deja tu reseña" |
| 12 | SCR-AL08 | Deja reseña 1–5 | Crea reseña (RN-28); recalcula rating | — | — |
| — | SCR-AL07 | (alternativo) Cancela | Aplica política (RN-11) + reembolso (DP-03) | `booking/session: cancelled`; `payment: refunded/partial` | NTF cancelación/reembolso |

---

## 4.5 FL-02 — Flujo del Tutor (alta → aprobación → operar → cobrar)

| Paso | Pantalla | Acción del usuario | Respuesta del sistema | Estado (Doc 2) | Notif (Doc 7) |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | SCR-AU02 | Registro como tutor | Crea perfil tutor | `approval: pending` | NTF bienvenida tutor |
| 2 | SCR-TU01 | Onboarding (bio, categorías, oferta) | Guarda perfil | `approval: pending` | — |
| 3 | SCR-TU02 | Sube documentos de identidad | Encola KYC | `identity: pending`; `document: pending` | NTF "en revisión" |
| 4 | (admin) | — | Admin revisa identidad y perfil | `identity: approved` → `approval: approved` (RN-29) | NTF tutor aprobado |
| 5 | SCR-TU04 | Crea producto(s) | Guarda; publica | `product: draft→active` (RN-24) | — |
| 6 | SCR-TU05 | Define disponibilidad | Guarda reglas + excepciones (S-03) | — | — |
| 7 | SCR-TU07 | Recibe reserva | Notifica nueva reserva | (desde FL-01 p.7) | NTF nueva reserva |
| 8 | SCR-LV01 | Da la clase en su horario | Habilita sala (RN-18) | `session: in_progress→completed` | — |
| 9 | SCR-TU08 | Marca completada (o automático) | Cierra sesión | `session: completed` | — |
| 10 | SCR-TU06 | Revisa ingresos | Muestra total ganado/neto | `payout_item` devengado (RN-30) | — |
| 11 | SCR-TU09 | Consulta payouts | Programa/ejecuta liquidación tras retención | `payout: pending→scheduled→paid` (DP-02) | NTF payout pagado |

---

## 4.6 FL-03 — Flujo del Admin (operación)

| Paso | Pantalla | Acción | Respuesta del sistema | Estado | Notif |
| :-- | :-- | :-- | :-- | :-- | :-- |
| A | SCR-AD03/AD05 | Revisa y aprueba/rechaza tutores y KYC | Cambia aprobación/identidad | M1/M2/M8 | NTF resultado al tutor |
| B | SCR-AD11 | Gestiona categorías | CRUD categorías (RN públicas) | — | — |
| C | SCR-AD12 | Edita split / crea tiers | Aplica a reservas nuevas (S-08) | — | — |
| D | SCR-AD06/07/08 | Supervisa pagos; reembolsa | Inicia reembolso (ejecuta service role) | M6 | NTF reembolso |
| E | SCR-AD15 | Gestiona payouts; hold/release | Controla liquidaciones | M7 | NTF interna |
| F | SCR-AD09/10 | Monitorea reservas | Lectura/soporte | — | — |
| G | SCR-AD13/14 | Revisa estadísticas y alertas | KPIs por periodo; incidencias | — | NTF alertas internas |

---

## 4.7 FL-04 — Flujo de Referido (integración externa)

| Paso | Pantalla | Acción | Respuesta del sistema | Nota |
| :-- | :-- | :-- | :-- | :-- |
| 1 | SCR-AL02/G03 | Usuario abre el widget de referidos | Carga artefacto de Referral Factory (frontend) | Sin lógica interna (RN-21) |
| 2 | (externo) | Comparte su enlace/código | Referral Factory gestiona el programa | Reglas externas (DP-04) |
| 3 | SCR-AU02 | El referido se registra con `?ref=` | Captura `referral_code` en `profiles` (S-18) | Solo atribución |
| 4 | (externo) | Conversión válida / payout del referido | Lo resuelve Referral Factory | Monto/condición/límites = DP-04 |

> El detalle técnico del punto de integración (artefacto consumido, captura de parámetro, eventos) se especifica en el Doc 6.

---

## 4.8 FL-05 — Cancelación y reembolso (transversal)

Resumen del recorrido (mecanismo en Doc 2 §2.13; política = **DP-03/DP-08**):

| Caso | Pantalla | Estados resultantes | Notif |
| :-- | :-- | :-- | :-- |
| Alumno cancela | SCR-AL03→AL07 | `booking/session: cancelled`; `payment: refunded/partial` (DP-03) | NTF cancelación + reembolso |
| Tutor cancela | SCR-TU08 | `booking: cancelled`; `payment: refunded` (100%) | NTF al alumno |
| No-show | SCR-LV01 / sistema | `session: no_show`; efecto financiero según DP-08 | NTF según política |
| Reembolso por admin | SCR-AD08 | `payment: refunded/partial`; ajuste payout (S-29) | NTF reembolso |

---

## 4.9 Responsive (multi-dispositivo)

Conforme a la propuesta (§4.1.G, §4.2.G, §8, §12), **todas** las pantallas de los flujos de alumno y tutor son **100% responsive** (Desktop / Tablet / Móvil). El panel **Admin** prioriza Desktop, con adaptación razonable a Tablet. La sala en vivo (SCR-LV01) soporta móvil con controles táctiles. El detalle de breakpoints y comportamiento por pantalla va en el Doc 5. `SUPUESTO S-36`: breakpoints estándar (≈ 360 / 768 / 1024 / 1280).

---

## 4.10 Supuestos introducidos en este documento

| ID | Supuesto |
| :-- | :-- |
| S-35 | No hay checkout como invitado; reservar/pagar exige sesión iniciada (login/registro antes del checkout). |
| S-36 | Breakpoints responsive estándar (≈ 360/768/1024/1280); detalle por pantalla en Doc 5. |
| S-37 | El registro permite declarar intención (alumno/tutor); un usuario puede activar el rol tutor luego desde su cuenta (S-14). |

*Sin nuevas reglas de negocio ni decisiones pendientes en este documento.*

---

## 4.11 Nota sobre diagramas

El **sitemap visual**, los **diagramas de flujo (Mermaid `flowchart`)** de FL-01..FL-05 y los **wireframes de baja fidelidad** se agregan en la pasada final / fase de UX-UI. El `.md` es la fuente y el `.pdf` se regenerará entonces.

---

*Fin del Documento 4.*
