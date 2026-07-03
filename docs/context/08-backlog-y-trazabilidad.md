# DOC 8 — Backlog y Matriz de Trazabilidad

> ⚠️ **SUPERADO como backlog operativo.** El backlog vigente es **`docs/BACKLOG.md`** (v1.0,
> 2026-06-24, cargado en **Jira**), que amplía éste con EP-17/18, US-606/607/1004 y RN-37..44.
> Este documento se **conserva** por su **matriz de trazabilidad §8.4** (épica→pantalla→entidad→
> estado→notif→DP), que sigue siendo útil como mapa cruzado. Para *qué construir y en qué sprint*,
> usa `docs/BACKLOG.md`; para los deltas, `docs/context/ADENDA-BACKLOG-v1.md`.

> **Enséñame Ya — MVP Web.** Épicas, historias de usuario con criterios de aceptación y trazabilidad cruzada de todo el alcance.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 8 — Backlog y Matriz de Trazabilidad |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Docs 0–7 + Propuesta §4, §6, §12 |
| **Alimenta a** | Plan de sprints, QA/UAT, Doc 9 (riesgos/DP) |
| **Estado** | Borrador para revisión |
| **Fecha** | 2026-06-03 |

---

## 8.1 Propósito y convenciones

Convierte todo el alcance en un **backlog accionable** y lo hace **trazable** de extremo a extremo: cada historia se vincula con su origen en la propuesta, las pantallas (Doc 4/5), las entidades (Doc 1), los estados (Doc 2), los permisos (Doc 3), las notificaciones (Doc 7) y las reglas/decisiones (RN/DP).

| Convención | Valor |
| :-- | :-- |
| **Épica** | `EP-xx` |
| **Historia** | `US-xxx` |
| **Prioridad (MoSCoW)** | M (Must), S (Should), C (Could), W (Won't-now) |
| **Estimación** | Puntos relativos (`SUPUESTO S-52`: la estimación fina se cierra en Fase 0, propuesta §10) |
| **Criterio de aceptación** | Formato Dado/Cuando/Entonces, condensado |

---

## 8.2 Épicas

| Épica | Nombre | Origen (propuesta) |
| :-- | :-- | :-- |
| EP-01 | Autenticación y cuentas | §4.1.A, §12.2 |
| EP-02 | Onboarding (alumno/tutor) | §4.1.A, §4.2.A, §12.3/12.4 |
| EP-03 | Descubrimiento y búsqueda | §4.1.B, §12.1 |
| EP-04 | Catálogo del tutor (productos) | §4.2.A, §12.4 |
| EP-05 | Disponibilidad | §4.2.B, §12.4 |
| EP-06 | Reserva y checkout | §4.1.C, §12.3 |
| EP-07 | Pagos (capa agnóstica) | §4.4, infraestructura de pagos |
| EP-08 | Sesión en vivo (Daily) | §4.1.D, §4.2.D, §12 |
| EP-09 | Reseñas | §4.1.F, §12.3 |
| EP-10 | Payouts a tutores | §4.2.F, §12.4 |
| EP-11 | Panel Admin | §4.3, §12.5 |
| EP-12 | Notificaciones | §4.4 |
| EP-13 | Referidos (integración frontend) | §3, §4.4 |
| EP-14 | Seguridad / RLS | §7, §8 |
| EP-15 | Observabilidad / Monitoreo | §4.4, §17 |
| EP-16 | Responsive / QA / UAT / Lanzamiento | §4.x.G, §9, §11 |

---

## 8.3 Historias de usuario por épica

### EP-01 — Autenticación y cuentas

| US | Historia | Criterio de aceptación (condensado) | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-101 | Como visitante quiero registrarme con email o Google | Dado el form, cuando envío datos válidos, entonces se crea cuenta y recibo NTF-01; email duplicado se rechaza | M | SCR-AU02, NTF-01, RN-31 |
| US-102 | Como usuario quiero iniciar sesión | Credenciales válidas abren sesión; inválidas muestran error genérico (S-40) | M | SCR-AU01 |
| US-103 | Como usuario quiero recuperar mi contraseña | Solicitud envía NTF-02; token vigente permite nueva contraseña | M | SCR-AU03, NTF-02 |
| US-104 | Como usuario quiero gestionar mi cuenta y cerrar sesión | Puedo editar perfil/`timezone` y cerrar sesión | S | SCR-G03, RN-01 |

### EP-02 — Onboarding

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-201 | Como alumno quiero completar mi perfil | `timezone` obligatorio (RN-01); guardo prefs; continúo al destino | M | SCR-AL01, `profiles` |
| US-202 | Como tutor quiero completar mi onboarding | Capturo bio, categorías, oferta inicial; quedo `pending` | M | SCR-TU01, M1 |
| US-203 | Como tutor quiero subir mi identidad | Subo docs → `identity: pending`, NTF-06; re-subo si rechazado | M | SCR-TU02, M2/M8, NTF-06 |

### EP-03 — Descubrimiento y búsqueda

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-301 | Como visitante quiero explorar tutores | Veo solo tutores `approved` (RN-24); filtro y pagino | M | SCR-P04, RN-20 |
| US-302 | Como visitante quiero explorar productos/categorías | Listados de productos activos por categoría (N–M, RN-09) | M | SCR-P05/P06 |
| US-303 | Como visitante quiero buscar por palabra clave | Búsqueda en título/descr/tutor/categoría; sin resultados → sugerencias | S | SCR-P09, índice texto |
| US-304 | Como visitante quiero ver el perfil/producto | Veo bio, productos, rating, política y CTA Reservar | M | SCR-P07/P08 |

### EP-04 — Catálogo del tutor

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-401 | Como tutor quiero crear/editar productos | Defino modelo de precio, duración (≥30), paquete (≥1), categorías; guardo `draft` | M | SCR-TU04, RN-03/09/10/22 |
| US-402 | Como tutor quiero publicar/pausar/archivar | Publico solo si `approved` (RN-23); pauso/archivo con guardas (M3) | M | SCR-TU03, M3 |
| US-403 | Como tutor quiero definir política de cancelación | Default a nivel tutor con override por producto (RN-11) | S | SCR-TU04, RN-11 |

### EP-05 — Disponibilidad

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-501 | Como tutor quiero definir horarios recurrentes | CRUD reglas por día/hora; `end>start` | M | SCR-TU05, `availability_rules` |
| US-502 | Como tutor quiero bloquear/abrir fechas puntuales | Excepciones `block`/`open` (S-03) | S | SCR-TU05, `availability_exceptions` |

### EP-06 — Reserva y checkout

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-601 | Como alumno quiero elegir horario disponible | Veo slots libres en mi hora local; paquete = N; sin doble-reserva (S-41) | M | SCR-AL04, RN-12/32 |
| US-602 | Como alumno quiero pagar mi reserva | Checkout del proveedor (RN-15); al `paid` se confirma (M4) y recibo NTF-04 | M | SCR-AL05, M6, NTF-04 |
| US-603 | Como alumno quiero ver mi confirmación | Resumen + horario bloqueado; sesiones creadas; NTF-05 | M | SCR-AL06, M5, NTF-05 |
| US-604 | Como alumno/tutor quiero cancelar | Aplico política (RN-11) y reembolso según DP-03; estados a `cancelled` | S | SCR-AL07, M4/M5, DP-03 |
| US-605 | Como sistema quiero autocancelar pagos vencidos | Sin pago en ventana → `cancelled`; libero slot (RN-27) | M | M4/M6, RN-27 |

### EP-07 — Pagos (capa agnóstica)

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-701 | Como plataforma quiero enrutar el cobro por geografía | `resolveCharge` lee `payment_routing_rules`; sin regla → bloqueo (RN-33) | M | Doc 6, RN-15/16/33 |
| US-702 | Como plataforma quiero aplicar el split | `tutor_net`/`platform_fee` por `tier_split_pct` snapshot (RN-08, S-08) | M | `payments`, RN-08 |
| US-703 | Como plataforma quiero procesar webhooks idempotentes | Verifico firma (RN-34); proceso una vez; actualizo estados | M | Doc 6, RN-26/34 |
| US-704 | Como admin quiero reembolsar | Inicio reembolso total/parcial (ejecuta service role); M6; NTF-10 | S | SCR-AD08, DP-03 |
| US-705 | Como plataforma quiero soportar nuevos proveedores sin tocar el core | Alta de adaptador + fila de routing; sin migración (RN-16) | M | Doc 6, DP-01 |

### EP-08 — Sesión en vivo (Daily)

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-801 | Como participante quiero entrar a la sala en mi horario | Acceso solo en ventana (RN-18, S-45); token server-side | M | SCR-LV01, RN-18 |
| US-802 | Como sistema quiero gestionar el ciclo de la sesión | `scheduled→in_progress→completed`; cierre por fin de ventana (S-26) | M | M5 |
| US-803 | Como participante quiero usar la sala en móvil | Controles táctiles; reconexión ante caída | S | SCR-LV01, S-36 |

### EP-09 — Reseñas

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-901 | Como alumno quiero reseñar tras completar | Solo si `booking: completed` (RN-28); una por compra; recalcula rating | M | SCR-AL08, M4, RN-17/28 |
| US-902 | Como visitante quiero ver reseñas | Reseñas públicas en perfil del tutor | S | SCR-P07 |

### EP-10 — Payouts

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-1001 | Como tutor quiero ver mis ingresos y payouts | Saldo en retención, programados, historial (solo lectura, S-15) | M | SCR-TU06/TU09, M7 |
| US-1002 | Como plataforma quiero liquidar tras retención | Al vencer DP-02 → `scheduled`; ejecuta `resolvePayout`; NTF-12 | M | M7, DP-02/06, NTF-12 |
| US-1003 | Como admin quiero gestionar payouts e incidencias | hold/release/reintento (M7); alertas NTF-13/16 | S | SCR-AD15, M7 |

### EP-11 — Panel Admin

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-1101 | Como admin quiero aprobar/rechazar tutores y KYC | Reviso docs; aprueba requiere identidad `approved` (RN-29); NTF-03 | M | SCR-AD03/05, M1/M2 |
| US-1102 | Como admin quiero gestionar categorías | CRUD con `slug` único; planas (S-13) | M | SCR-AD11, `categories` |
| US-1103 | Como admin quiero configurar comisión/tiers | Edito `split_pct`, creo tiers; aplica a reservas nuevas (S-08) | M | SCR-AD12, RN-06/07 |
| US-1104 | Como admin quiero supervisar pagos y reservas | Listas/detalle con filtros; logs básicos | M | SCR-AD06/07/08/09/10 |
| US-1105 | Como admin quiero ver estadísticas globales | KPIs filtrables por periodo (S-44) | S | SCR-AD13 |
| US-1106 | Como admin quiero ver alertas/incidencias | Fallas de pago, payouts en incidencia, disputas | S | SCR-AD14, NTF-13 |

### EP-12 — Notificaciones

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-1201 | Como usuario quiero recibir correos transaccionales | Cada evento dispara su NTF una vez (RN-36), hora local (RN-35) | M | Doc 7, `notifications` |
| US-1202 | Como plataforma quiero registrar envíos | `notifications` con idempotencia y estado; reintento ante fallo | M | Doc 7 §7.5 |
| US-1203 | Como usuario quiero ver avisos in-app | Banners/lista desde `notifications` (S-48/S-50) | C | SCR-AL02/TU06 |

### EP-13 — Referidos

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-1301 | Como usuario quiero compartir mi enlace de referido | Widget de Referral Factory embebido; sin lógica interna (RN-21) | S | FL-04, Doc 6 §6.12 |
| US-1302 | Como plataforma quiero atribuir el referido | Captura `referral_code` en registro (S-18); reglas externas (DP-04) | S | `profiles.referral_code` |

### EP-14 — Seguridad / RLS

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-1401 | Como plataforma quiero RLS default-deny | Toda tabla con RLS; acceso por rol/pertenencia (Doc 3) | M | Doc 3 |
| US-1402 | Como plataforma quiero proteger escritura financiera | `payments`/`payouts`/`notifications` solo service role (S-15) | M | Doc 3, RN-26 |
| US-1403 | Como plataforma quiero evitar escalada de privilegios | Sin auto-asignación de `admin`/`approval_status`/`tier_id` (RN-31) | M | Doc 3 |

### EP-15 — Observabilidad

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-1501 | Como equipo quiero monitorear errores | Sentry captura excepciones (S-09) | S | Doc 6 §6.13 |
| US-1502 | Como equipo quiero métricas de pago/payout/webhook | Tasa de fallo, latencia, conciliación (S-47) | C | Doc 6 §6.8/6.13 |

### EP-16 — Responsive / QA / Lanzamiento

| US | Historia | Criterio | Prio | Refs |
| :-- | :-- | :-- | :-- | :-- |
| US-1601 | Como usuario quiero una experiencia responsive | Flujos alumno/tutor 100% responsive (S-36) | M | Doc 4 §4.9 |
| US-1602 | Como equipo quiero QA + UAT | Checklist de lanzamiento y validación responsive (propuesta §11) | M | §9/§11 |
| US-1603 | Como equipo quiero ambientes dev/staging/prod | Separación de ambientes y configuración (§8) | M | §8 |

---

## 8.4 Matriz de trazabilidad (resumen)

> Vincula cada épica con su alcance de propuesta, pantallas, entidades, estados, notificaciones y decisiones pendientes. (El detalle US→ref está en §8.3.)

| Épica | Propuesta | Pantallas (Doc 4) | Entidades (Doc 1) | Estados (Doc 2) | Notif (Doc 7) | DP relacionadas |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| EP-01 | §4.1.A | SCR-AU01..04, G03 | `profiles` | — | NTF-01/02 | — |
| EP-02 | §4.1.A/4.2.A | SCR-AL01, TU01/02 | `profiles`,`tutor_profiles`,`verification_documents` | M1/M2/M8 | NTF-03/06 | — |
| EP-03 | §4.1.B | SCR-P04..09 | `products`,`categories`,`tutor_profiles` | M1/M3 | — | — |
| EP-04 | §4.2.A | SCR-TU03/04 | `products`,`product_categories` | M3 | — | — |
| EP-05 | §4.2.B | SCR-TU05 | `availability_*` | — | — | — |
| EP-06 | §4.1.C | SCR-AL04..07 | `bookings`,`sessions` | M4/M5 | NTF-05/09 | DP-03/08 |
| EP-07 | §4.4 | SCR-AL05, AD08 | `payments`,`payment_routing_rules` | M6 | NTF-04/10/15 | DP-01/03/07 |
| EP-08 | §4.1.D | SCR-LV01 | `sessions` | M5 | NTF-08/11 | — |
| EP-09 | §4.1.F | SCR-AL08, P07 | `reviews` | M4 | NTF-14 | — |
| EP-10 | §4.2.F | SCR-TU09, AD15 | `payouts`,`payout_items` | M7 | NTF-12/16 | DP-02/06/07 |
| EP-11 | §4.3 | SCR-AD01..15 | (todas) | M1/M6/M7 | NTF-03/13 | DP-01/03 |
| EP-12 | §4.4 | — | `notifications` | (todas) | NTF-01..16 | DP-05/08 |
| EP-13 | §3/§4.4 | (widget) | `profiles.referral_code` | — | — | DP-04 |
| EP-14 | §7/§8 | (transversal) | (todas) | (todas) | — | — |
| EP-15 | §17 | SCR-AD14 | — | M6/M7 | NTF-13 | — |
| EP-16 | §9/§11 | (todas) | — | — | — | — |

---

## 8.5 Mapeo a fases del proyecto (propuesta §9/§10)

| Fase | Contenido | Épicas principales |
| :-- | :-- | :-- |
| **Fase 0 — Descubrimiento** | Cierre de backlog y estimación; resolver DP bloqueantes (Doc 9) | (todas, definición) |
| **Fase 1 — UX/UI** | Wireframes y diseño responsive de Doc 4/5 | EP-03/06/11/16 |
| **Fase 2 — Desarrollo MVP** | Core: auth, onboarding, descubrimiento, reserva/pago, sala, dashboards, admin | EP-01..EP-11 |
| **Fase 3 — QA + UAT** | Pruebas, checklist de lanzamiento y responsive | EP-14/16 |
| **Fase 4 — Lanzamiento + Hypercare** | Publicación, monitoreo, estabilización | EP-15/16 |

> **Bloqueos por decisión pendiente:** EP-07/EP-10 dependen de **DP-01** (proveedores) para producción real; **DP-02/DP-03/DP-06/DP-07** afinan pagos/payouts; **DP-04** (referidos) y **DP-05** (email) deben cerrarse antes de su épica. El diseño agnóstico permite **avanzar en paralelo** sin bloquear el core (ver Doc 9).

---

## 8.6 Supuestos introducidos en este documento

| ID | Supuesto |
| :-- | :-- |
| S-52 | La estimación fina (puntos/horas/sprints) se cierra en Fase 0; el backlog usa prioridad MoSCoW y puntos relativos. |
| S-53 | "Destacados/Populares" del Home se basa en datos básicos (rating/recencia), sin motor de recomendación (fuera de alcance §5). |

*Sin nuevas reglas de negocio ni decisiones pendientes en este documento.*

---

## 8.7 Nota sobre diagramas

Un **mapa de trazabilidad visual** (épica→US→pantalla→entidad) y un **roadmap por fases** se agregan en la pasada final. El `.md` es la fuente y el `.pdf` se regenerará entonces.

---

*Fin del Documento 8.*
