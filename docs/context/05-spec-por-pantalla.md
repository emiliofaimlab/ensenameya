# DOC 5 — Especificación por Pantalla

> **Enséñame Ya — MVP Web.** Detalle funcional de cada pantalla del Doc 4: propósito, datos, componentes, acciones, validaciones y estados.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 5 — Especificación por Pantalla |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Doc 1 (campos), Doc 2 (estados), Doc 3 (RLS), Doc 4 (pantallas/flujos) |
| **Alimenta a** | Diseño UX/UI, Doc 7 (notificaciones), Doc 8 (backlog) |
| **Estado** | Borrador para revisión |
| **Fecha** | 2026-06-03 |

---

## 5.1 Cómo leer este documento

Cada pantalla usa esta plantilla compacta:

- **Ruta / Acceso:** URL y rol (con dependencia RLS del Doc 3).
- **Propósito / Entrada:** para qué sirve y desde dónde se llega.
- **Componentes:** bloques de UI principales.
- **Datos:** campos mostrados (referencia al Doc 1).
- **Acciones:** CTAs y la **transición de estado** que provocan (Doc 2).
- **Validaciones / Estados:** reglas de entrada y estados vacío/carga/error.
- **Responsive / Notif:** notas de adaptabilidad y correos disparados (Doc 7).

> Convenciones globales: fechas/horas mostradas en `timezone` del usuario (RN-02); montos formateados desde unidades menores + `currency` (S-12). `SUPUESTO S-38`: i18n del MVP en español; textos centralizados para futura localización.

---

## 5.2 Pantallas públicas

### SCR-P01 — Landing / Home
- **Ruta / Acceso:** `/` · anon.
- **Propósito / Entrada:** punto de entrada; comunica valor y enruta al descubrimiento. Entrada directa/marketing.
- **Componentes:** hero + CTA, buscador, accesos a Explorar Tutores/Categorías, sección Destacados/Populares, "¿Cómo funciona?", footer.
- **Datos:** lista curada de tutores/productos destacados (`tutor_profiles` aprobados, `products` activos); categorías activas.
- **Acciones:** buscar → SCR-P09; explorar → SCR-P04/06; "Reservar" → SCR-P07/P08; login/registro → SCR-AU01/02.
- **Validaciones / Estados:** vacío → CTA a explorar; carga → skeletons; error → SCR-G01.
- **Responsive / Notif:** 100% responsive; sin notif.

### SCR-P02 — Sobre Nosotros / SCR-P03 — ¿Cómo funciona?
- **Ruta / Acceso:** `/about`, `/how-it-works` · anon.
- **Propósito:** contenido institucional/educativo (estático o CMS ligero `SUPUESTO S-39`).
- **Componentes:** secciones de contenido, CTA a registro.
- **Acciones:** CTA → SCR-AU02. Sin estados de datos relevantes.

### SCR-P04 — Explorar Tutores
- **Ruta / Acceso:** `/tutors` · anon.
- **Propósito / Entrada:** grid/listado de tutores aprobados con filtros y búsqueda.
- **Componentes:** filtros (categoría, rating, precio), buscador, grid de tarjetas, paginación.
- **Datos:** `tutor_profiles` (headline, bio, `rating_avg`, `rating_count`), categorías; solo `approval_status='approved'` (RLS pública, Doc 3).
- **Acciones:** abrir perfil → SCR-P07; filtrar/buscar (querystring).
- **Validaciones / Estados:** sin resultados → SCR-G02 con sugerencias; carga → skeleton grid.
- **Responsive:** grid 1/2/3/4 columnas por breakpoint.

### SCR-P05 — Explorar Clases/Productos
- **Ruta / Acceso:** `/classes` · anon.
- **Propósito:** listado de ofertas (productos) con enfoque a reservar.
- **Componentes:** filtros (categoría, modelo de precio, rango de precio, duración), tarjetas de producto.
- **Datos:** `products` activos de tutores aprobados (título, `outcome`, `pricing_model`, `price_amount`+`currency`, rating del tutor).
- **Acciones:** abrir → SCR-P08; filtrar/buscar.
- **Estados:** vacío/carga/error como P04.

### SCR-P06 — Explorar / Resultados por Categoría
- **Ruta / Acceso:** `/categories`, `/categories/{slug}` · anon.
- **Propósito:** navegar categorías y ver su catálogo filtrado.
- **Componentes:** lista de categorías activas; al entrar, listado de productos/tutores de la categoría.
- **Datos:** `categories` (activas, `sort_order`), `product_categories` join `products`.
- **Acciones:** seleccionar categoría → listado; abrir producto/tutor.

### SCR-P07 — Perfil público del Tutor
- **Ruta / Acceso:** `/tutors/{id|slug}` · anon.
- **Propósito / Entrada:** convertir: presenta al tutor y sus productos; CTA "Reservar".
- **Componentes:** cabecera (avatar, headline, rating), bio, categorías, lista de productos, reseñas, bloque de disponibilidad resumida.
- **Datos:** `tutor_profiles` (público), `products` activos, `reviews` (públicas), `availability_rules` (resumen).
- **Acciones:** "Reservar" en un producto → SCR-P08/AL04 (si sin sesión, login primero, S-35).
- **Estados:** tutor no aprobado/inexistente → SCR-G01; sin productos → mensaje.
- **Notif:** ninguna.

### SCR-P08 — Detalle de Producto (Tutoría)
- **Ruta / Acceso:** `/products/{id|slug}` · anon.
- **Propósito:** detalle de la oferta y arranque de reserva.
- **Componentes:** título, `outcome`, descripción, modelo de precio y precio, duración, nº de sesiones (paquete), política de cancelación efectiva, tutor, CTA "Reservar".
- **Datos:** `products` (+ snapshot de política RN-11), tutor, categorías.
- **Acciones:** "Reservar" → si sin sesión SCR-AU01/02 → SCR-AL04. Guarda intención de reserva.
- **Validaciones:** producto debe estar `active` y tutor `approved` (RN-24); si no, oculto/410.

### SCR-P09 — Resultados de Búsqueda
- **Ruta / Acceso:** `/search?q=` · anon.
- **Propósito:** búsqueda simple por palabra clave (materia/tutor/categoría).
- **Componentes:** input, resultados agrupados (tutores/productos/categorías), filtros.
- **Datos:** índice de texto en `products(title,description)` (Doc 1 §1.5), `tutor_profiles`, `categories`.
- **Estados:** sin `q` → sugerencias; sin resultados → SCR-G02.

---

## 5.3 Autenticación

### SCR-AU01 — Login
- **Ruta / Acceso:** `/login` · anon.
- **Componentes:** email+password, botón Google OAuth, enlace a recuperar/registro.
- **Acciones:** login email; OAuth Google → SCR-AU04. Éxito → destino previo o dashboard por rol.
- **Validaciones:** email válido; credenciales; manejo de error genérico (no revelar existencia de cuenta, S-40).
- **Notif:** ninguna directa (reset en AU03).

### SCR-AU02 — Registro
- **Ruta / Acceso:** `/signup` · anon.
- **Componentes:** email+password o Google, selección de intención (alumno/tutor, S-37), aceptación de términos.
- **Acciones:** crear cuenta → onboarding por rol (SCR-AL01/TU01). Captura `referral_code` si viene `?ref=` (S-18).
- **Validaciones:** email único (Auth), password mínimo, términos obligatorios.
- **Notif:** **NTF-01 bienvenida / verificación de email**.

### SCR-AU03 — Recuperar contraseña
- **Ruta / Acceso:** `/reset` · anon.
- **Acciones:** solicitar enlace (email) → **NTF-02 reset**; pantalla de nueva contraseña vía token.
- **Validaciones:** email válido; token vigente.

### SCR-AU04 — Callback OAuth / Verificación email
- **Ruta / Acceso:** `/auth/callback` · anon→auth.
- **Propósito:** procesar retorno de Google / confirmación de correo; crear `profiles` si primera vez.
- **Estados:** éxito → onboarding/dashboard; error → SCR-AU01 con mensaje.

---

## 5.4 Alumno

### SCR-AL01 — Onboarding Alumno
- **Ruta / Acceso:** `/onboarding` (alumno) · alumno (RLS: edita su `profiles`).
- **Componentes:** nombre, **`timezone`** (autodetectado, editable; RN-01), preferencias (jsonb), avatar opcional.
- **Acciones:** guardar → `profiles`; continúa al destino previo o SCR-AL02.
- **Validaciones:** `timezone` obligatorio (RN-01); nombre requerido.
- **Notif:** ninguna.

### SCR-AL02 — Dashboard Alumno
- **Ruta / Acceso:** `/app` · alumno.
- **Componentes:** próximas sesiones, sesiones pasadas, accesos a reservas, widget de referidos (FL-04), CTA descubrir.
- **Datos:** `bookings` del alumno + `sessions` (estado, hora local), enlaces a SCR-LV01 cuando la ventana esté abierta.
- **Acciones:** abrir reserva → SCR-AL03; entrar a sala (si habilitada, RN-18); dejar reseña (si `completed`).
- **Estados:** sin reservas → empty state con CTA descubrir.

### SCR-AL03 — Detalle de Reserva / Sesión
- **Ruta / Acceso:** `/app/bookings/{id}` · alumno (RLS: dueño).
- **Componentes:** estado de la reserva (M4), lista de sesiones (M5) con hora local, pago/recibo, política de cancelación, CTA sala, CTA cancelar, CTA reseña.
- **Datos:** `bookings`, `sessions`, `payments` (lectura), política efectiva.
- **Acciones:** "Entrar a sala" → SCR-LV01 (guarda RN-18); "Cancelar" → SCR-AL07; "Dejar reseña" → SCR-AL08 (si `completed`, RN-28).
- **Estados:** según estado de la reserva; botones habilitados por guardas (Doc 2).

### SCR-AL04 — Agendar (selección de horario)
- **Ruta / Acceso:** `/products/{id}/book` · alumno.
- **Propósito:** elegir slot(s) disponibles; para paquete, N sesiones (RN-12).
- **Componentes:** calendario/lista de slots (derivados de `availability_rules` − `availability_exceptions` − sesiones ocupadas), en hora local del alumno; resumen.
- **Datos:** disponibilidad del tutor, duración del producto (mín. 30, RN-03; `per_hour` múltiplos de 30, S-20).
- **Acciones:** confirmar selección → crea **reserva tentativa** y va a SCR-AL05. Estado: `booking: pending_payment`.
- **Validaciones:** slot libre y futuro; cantidad = `num_sessions`; reglas de solapamiento; doble-reserva evitada (S-41).
- **Estados:** sin disponibilidad → mensaje; conflicto al confirmar → re-selección.

### SCR-AL05 — Checkout / Pago
- **Ruta / Acceso:** `/app/checkout/{bookingId}` · alumno.
- **Propósito:** cobrar mediante el proveedor resuelto por geografía (RN-15; Doc 6).
- **Componentes:** resumen (producto, sesiones, fecha/hora, total, moneda), método de pago (checkout alojado del proveedor, S-28), aviso de política.
- **Datos:** `bookings` (snapshot precio/split), `payments` (creado `pending`).
- **Acciones:** pagar → redirige/embebe checkout del proveedor; al confirmar (webhook) `payment: paid` → SCR-AL06. Cancelar → vuelve a SCR-AL04.
- **Validaciones:** ventana de pago (RN-27, S-25); montos íntegros; manejo de fallo → reintento (M6).
- **Notif:** **NTF-04 recibo de pago** (al `paid`).

### SCR-AL06 — Confirmación de Reserva
- **Ruta / Acceso:** `/app/bookings/{id}/confirmed` · alumno.
- **Componentes:** confirmación, resumen con horario bloqueado, próximos pasos, enlace a SCR-AL03.
- **Datos:** `bookings` (confirmada), `sessions` creadas.
- **Notif:** **NTF-05 reserva confirmada** (alumno + tutor).

### SCR-AL07 — Flujo de Cancelación
- **Ruta / Acceso:** `/app/bookings/{id}/cancel` · alumno.
- **Componentes:** política aplicable y resultado estimado (reembolso total/parcial/nulo — **según DP-03**), confirmación.
- **Acciones:** confirmar → `booking/session: cancelled`; dispara reembolso (M6) según política. 
- **Validaciones:** elegibilidad por estado/tiempo (RN-11); muestra el cálculo **sin** hardcodear DP-03 (lee configuración).
- **Notif:** **NTF-09 cancelación** + **NTF-10 reembolso** (si aplica).

### SCR-AL08 — Dejar Reseña
- **Ruta / Acceso:** `/app/bookings/{id}/review` · alumno (RLS: solo si `completed`, Doc 3).
- **Componentes:** estrellas 1–5, comentario opcional.
- **Acciones:** enviar → crea `reviews` (RN-28); trigger recalcula `rating_avg/count`. Editable en ventana corta (S-32).
- **Validaciones:** reserva `completed`; una sola reseña (UNIQUE `booking_id`).

---

## 5.5 Tutor

### SCR-TU01 — Onboarding Tutor
- **Ruta / Acceso:** `/tutor/onboarding` · tutor.
- **Componentes:** headline, bio, categorías (multi), `timezone`, primera oferta (atajo a SCR-TU04).
- **Acciones:** guardar `tutor_profiles`; siguiente → SCR-TU02. Estado: `approval: pending`.
- **Validaciones:** campos mínimos; `timezone` obligatorio.

### SCR-TU02 — Verificación de Identidad
- **Ruta / Acceso:** `/tutor/verification` · tutor (RLS: dueño; bucket privado S-19).
- **Componentes:** subida de documentos (`id_front`, `id_back`, `selfie`), estado por documento (M8) y global (M2).
- **Acciones:** subir → `document: pending`, `identity: pending` → **NTF-06 "en revisión"**. Re-subir si `rejected`.
- **Validaciones:** tipo/tamaño de archivo (S-42); legibilidad (revisión manual).

### SCR-TU03 — Mis Productos
- **Ruta / Acceso:** `/tutor/products` · tutor (RLS: dueño).
- **Componentes:** listado con estado (M3), acciones publicar/pausar/archivar, CTA crear.
- **Acciones:** crear → SCR-TU04; cambiar estado (guardas RN-24).
- **Estados:** sin productos → empty con CTA; bloqueo de publicar si tutor no aprobado (RN-23).

### SCR-TU04 — Crear / Editar Producto
- **Ruta / Acceso:** `/tutor/products/new|{id}` · tutor.
- **Componentes:** título, `outcome`, descripción, **modelo de precio** (`per_session`/`per_hour`/`per_package`), precio+moneda, `session_duration_min` (≥30), `package_num_sessions` (si paquete), categorías (N–M), política de cancelación (override RN-11).
- **Acciones:** guardar borrador (`draft`); publicar (`active`, requiere aprobado).
- **Validaciones:** precio ≥ 0; duración ≥ 30 (RN-03); paquete `num_sessions ≥ 1` (1 participante, RN-22); al menos 1 categoría (RN-09).

### SCR-TU05 — Disponibilidad / Calendario
- **Ruta / Acceso:** `/tutor/availability` · tutor.
- **Componentes:** reglas recurrentes por día/hora (`availability_rules`), excepciones puntuales (`block`/`open`), vista de calendario, todo en `timezone` del tutor.
- **Acciones:** CRUD reglas/excepciones (S-03).
- **Validaciones:** `end_time > start_time`; sin solapamientos contradictorios; aviso si choca con sesiones agendadas.

### SCR-TU06 — Dashboard Tutor
- **Ruta / Acceso:** `/tutor` · tutor.
- **Componentes:** próximas sesiones, **total ganado / neto**, reservas recientes, estado de aprobación, accesos.
- **Datos:** agregados de `sessions`/`bookings`/`payments`/`payout_items` del tutor.
- **Estados:** tutor `pending` → banner "en revisión"; sin actividad → empty.

### SCR-TU07 — Reservas del Tutor
- **Ruta / Acceso:** `/tutor/bookings` · tutor (RLS: sus productos).
- **Componentes:** listado + filtros (estado, fecha), detalle por reserva.
- **Acciones:** abrir → SCR-TU08; cancelar (con política).
- **Notif:** **NTF-07 nueva reserva** (al confirmarse, desde FL-01).

### SCR-TU08 — Detalle de Sesión (Tutor)
- **Ruta / Acceso:** `/tutor/sessions/{id}` · tutor (RLS: participante).
- **Componentes:** datos de la sesión, alumno, hora local, CTA sala, "marcar completada".
- **Acciones:** entrar a sala (RN-18) → SCR-LV01; marcar `completed` (M5); cancelar.
- **Estados:** botones por ventana/estado (Doc 2).

### SCR-TU09 — Payout / Cobros
- **Ruta / Acceso:** `/tutor/payouts` · tutor (RLS: dueño).
- **Componentes:** saldo en retención, próximos payouts (`scheduled_for`), historial (M7), detalle de items.
- **Datos:** `payouts` + `payout_items` (lectura). Retención según DP-02; agregación DP-06; moneda DP-07.
- **Acciones:** ver detalle; (datos de cuenta de cobro → onboarding del proveedor, Doc 6). No edita estados (S-15).
- **Notif:** **NTF-12 payout pagado**.

---

## 5.6 Sala en vivo

### SCR-LV01 — Sala de Clase en Vivo 1:1
- **Ruta / Acceso:** `/room/{sessionId}` · alumno y tutor de la sesión (RLS: participantes).
- **Propósito:** videollamada Daily 1:1 habilitada por ventana (RN-18, S-07).
- **Componentes:** video/audio, controles (mute, cámara, salir, compartir pantalla `SUPUESTO S-43`), temporizador de sesión, estado de conexión.
- **Datos:** `sessions.daily_room_url`; **token generado server-side al unirse** (no se almacena, Doc 1 §1.4.11).
- **Acciones:** unirse (genera token si `now()` en ventana); salir → marca progreso; fin de ventana → `completed`.
- **Validaciones / Estados:** fuera de ventana → bloqueado con cuenta regresiva; sala no provista → error; reconexión ante caída.
- **Responsive:** móvil con controles táctiles; usa minutos Daily (coste por uso, Doc 9).
- **Notif:** **NTF-08 "sala lista"** (recordatorio de inicio).

---

## 5.7 Admin

### SCR-AD01 — Login Admin / SCR-AD02 — Dashboard Admin
- **Ruta / Acceso:** `/admin/login`, `/admin` · admin.
- **Componentes (AD02):** tarjetas de pendientes (tutores por aprobar, pagos/payouts en proceso, incidencias), KPIs resumidos, accesos al panel.
- **Datos:** conteos de colas (M1/M6/M7), reservas recientes.
- **Acciones:** navegar a secciones; resolver pendientes.

### SCR-AD03 — Tutores por Aprobar / SCR-AD04 — Tutores Aprobados
- **Ruta / Acceso:** `/admin/tutors?status=` · admin.
- **Componentes:** lista + filtros (estado, fecha, categoría), buscador.
- **Acciones:** abrir → SCR-AD05.

### SCR-AD05 — Detalle de Tutor (Admin)
- **Ruta / Acceso:** `/admin/tutors/{id}` · admin.
- **Componentes:** perfil, **documentos KYC** (visor seguro), estado de identidad (M2/M8), tier asignado, historial.
- **Acciones:** aprobar/rechazar identidad (M2/M8); aprobar/rechazar/suspender/reactivar tutor (M1); asignar tier; solicitar info.
- **Validaciones:** aprobar tutor requiere identidad `approved` (RN-29, salvo S-21).
- **Notif:** **NTF-03 resultado de aprobación/identidad** al tutor.

### SCR-AD06 — Pagos Pendientes / SCR-AD07 — Historial de Pagos
- **Ruta / Acceso:** `/admin/payments` · admin.
- **Componentes:** listas + filtros (estado, proveedor, fecha, corredor), totales.
- **Datos:** `payments` (lectura), agregados.
- **Acciones:** abrir → SCR-AD08.

### SCR-AD08 — Detalle de Pago (Admin)
- **Ruta / Acceso:** `/admin/payments/{id}` · admin.
- **Componentes:** monto bruto/comisión/neto, `tier_split_pct`, proveedor y referencia, corredor (`payer/payee_country`), estado (M6), logs.
- **Acciones:** **iniciar reembolso** total/parcial (lo ejecuta service role; DP-03) → M6; ver payout asociado.
- **Notif:** **NTF-10 reembolso**.

### SCR-AD09 — Reservas (Admin) / SCR-AD10 — Detalle de Reserva (Admin)
- **Ruta / Acceso:** `/admin/bookings` · admin.
- **Componentes:** lista + filtros; detalle con estado (M4), pago asociado, sesiones, logs básicos.
- **Acciones:** soporte (cancelar con motivo, ver trazas).

### SCR-AD11 — Gestión de Categorías
- **Ruta / Acceso:** `/admin/categories` · admin.
- **Componentes:** CRUD (nombre, `slug`, `description`, `is_active`, `sort_order`).
- **Validaciones:** `slug` único; categorías planas (S-13).

### SCR-AD12 — Comisión / Tiers
- **Ruta / Acceso:** `/admin/tiers` · admin.
- **Componentes:** lista de `tutor_tiers`, editar `split_pct` (0–100), `is_default`, crear tier.
- **Acciones:** editar/crear (RN-07); cambios aplican a reservas nuevas (S-08, no retroactivo).
- **Validaciones:** un solo `is_default`; rango de split.

### SCR-AD13 — Estadísticas Globales
- **Ruta / Acceso:** `/admin/stats` · admin.
- **Componentes:** KPIs (GMV, comisiones, reservas, tutores activos, conversión), filtros por periodo.
- **Datos:** agregados (vistas/materializadas, `SUPUESTO S-44`).

### SCR-AD14 — Alertas / Incidencias
- **Ruta / Acceso:** `/admin/alerts` · admin.
- **Componentes:** fallas de pago, cancelaciones, disputas, payouts en `failed`/`on_hold`.
- **Acciones:** abrir entidad relacionada; marcar atendida.
- **Notif:** **NTF-13 alertas internas**.

### SCR-AD15 — Payouts a Tutores (Admin)
- **Ruta / Acceso:** `/admin/payouts` · admin.
- **Componentes:** lista + filtros (estado M7, tutor, periodo, proveedor), detalle con items.
- **Acciones:** **hold/release** (M7), reintentar `failed`, ver corredor/proveedor (RN-15). Ejecuta service role (S-15).
- **Notif:** internas; **NTF-12** al tutor cuando `paid`.

---

## 5.8 Globales

### SCR-G01 — Error (404/500) / SCR-G02 — Estado vacío
- Mensajería clara + CTA de retorno; G02 con sugerencias contextuales.

### SCR-G03 — Configuración de cuenta
- **Ruta / Acceso:** `/account` · auth.
- **Componentes:** perfil, `timezone`, seguridad (cambiar contraseña), **activar rol tutor** (S-37), widget referidos (FL-04), cerrar sesión.
- **Acciones:** editar `profiles`; iniciar onboarding tutor.

---

## 5.9 Reglas, supuestos y notas

**Supuestos introducidos**

| ID | Supuesto |
| :-- | :-- |
| S-38 | i18n del MVP en español; textos centralizados para futura localización. |
| S-39 | Contenido institucional (P02/P03) como estático o CMS ligero. |
| S-40 | Mensajes de auth genéricos (no revelar existencia de cuenta). |
| S-41 | Bloqueo de doble-reserva del mismo slot vía verificación transaccional al confirmar. |
| S-42 | Límites de tipo/tamaño de archivo en subida de KYC (definidos en implementación). |
| S-43 | Compartir pantalla en sala en vivo: deseable; a confirmar según plan Daily. |
| S-44 | Estadísticas admin sobre vistas/materializadas para rendimiento. |

**Nueva regla de negocio**

| ID | Regla |
| :-- | :-- |
| RN-32 | Toda fecha/hora se captura/almacena en UTC y se **muestra** en el `timezone` del usuario actual (refuerzo de RN-02 a nivel de UI). |

*Las decisiones pendientes referenciadas (DP-01/03/06/07/08) no se resuelven aquí; las pantallas leen su configuración sin acoplarse.*

---

## 5.10 Nota sobre diagramas / wireframes

Los **wireframes** y prototipos de cada pantalla son parte de la fase UX/UI (propuesta §9) y se producen junto con el diseño visual. Este documento define el **contenido funcional**; el `.md` es la fuente y el `.pdf` se regenerará si se anexan referencias visuales.

---

*Fin del Documento 5.*
