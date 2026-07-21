# Enséñame Ya — Backlog (fuente de verdad de *alcance y sprints*)

> **Master del "qué y cuándo".** Deriva del documento *Backlog Completo + Definición Sprint 1*
> (v1.0 · 2026-06-24 · Faim Lab) y está **cargado en Jira**. Jira es la fuente operativa;
> este `.md` es su espejo versionado en git.
>
> - El **"cómo" técnico** vive en `docs/context/` (Docs 00–09). Ante divergencia de detalle, mandan esos docs + las migraciones.
> - Los **deltas** que este backlog v1.0 introduce sobre los Docs 00–09 están en `docs/context/ADENDA-BACKLOG-v1.md` **y** resumidos en §7 de este archivo.
> - El **plan de ejecución** (qué está hecho, en curso, pendiente) vive en `docs/PLAN-DESARROLLO.md`.

| Indicador | Valor |
| :-- | :-- |
| Épicas | **23** (EP-00 + EP-01…EP-22) |
| Historias | **79** (incl. EP-00 diseño y EP-22 integración visual) |
| Puntos estimados | 259 SP (backlog dev original EP-01…EP-18) |
| Historias Must | 40 |
| Sprints | 4 de dev (+ EP-00 pre-desarrollo, + 3 tracks paralelos) |
| **Sprint activo** | **Sprint 3** — 19 historias / 83 SP |

> **Jira es la fuente operativa** (proyecto `EY` en `faimlab.atlassian.net`). Jira añadió **EP-00 —
> Diseño UX/UI y Contenido** (pre-desarrollo), que el docx original no traía. Este `.md` lo refleja.
>
> **Sync 2026-07-14:** Jira añadió tres épicas que el docx v1.0 no traía: **EP-19** (diseño UI, track
> paralelo), **EP-20** (activación comercial: DLocal + Stripe reales, **bloqueada** por credenciales)
> y **EP-21** (UX del onboarding del tutor). No pertenecen a los sprints S1–S4 de dev; se rastrean
> por **label de Jira** (`Sprint-Diseño`, `Sprint-Activacion-Comercial`, `Sprint-Mejoras-UX`), no por
> el campo Sprint. Ver §4.1.
>
> **Sync 2026-07-20:** Jira añadió **EP-22 — Sprint Integración Visual (Look & Feel)** (`EY-102`,
> label `Sprint-Integracion-Visual`), con IV-01…06 (`EY-103`…`EY-108`). Es el **lado de código** de
> EP-19: aplicar el diseño de Figma sobre el frontend ya construido. Ver §4.1 y §4.2.

---

## 1. Catálogo de Épicas

| ID | Épica | MoSCoW | SP | Sprint |
| :-- | :-- | :-- | :-- | :-- |
| EP-00 | Diseño UX/UI y Contenido (Pre-desarrollo) | M | — | S0 / pre-dev |
| EP-01 | Autenticación y Cuentas | M | 13 | **S1** |
| EP-02 | Onboarding (Alumno/Tutor) | M | 21 | **S1** |
| EP-03 | Descubrimiento y Búsqueda | M | 13 | **S1** |
| EP-04 | Catálogo del Tutor (Productos) | M | 13 | S2 |
| EP-05 | Disponibilidad | M | 8 | S2 |
| EP-06 | Reserva y Checkout | M | 34 | S2 |
| EP-07 | Pagos (Capa Agnóstica) | M | 21 | S2 |
| EP-08 | Sesión en Vivo (Daily) | M | 13 | S3 |
| EP-09 | Reseñas | M | 8 | S3 |
| EP-10 | Payouts a Tutores | M | 21 | S3 |
| EP-11 | Panel Admin | M | 21 | S3 |
| EP-12 | Notificaciones | M | 13 | S3 |
| EP-13 | Referidos (Integración Frontend) | S | 5 | S4 |
| EP-14 | Seguridad / RLS | M | 13 | **S1** |
| EP-15 | Observabilidad / Monitoreo | S | 5 | S4 |
| EP-16 | Responsive / QA / Lanzamiento | M | 13 | S4 (+US-1603 en S1) |
| EP-17 | Chat de la Reserva (v3) | S | 13 | S3 |
| EP-18 | Grabación de la Sesión (v3) | S | 13 | S4 |
| EP-19 | Diseño UI — Implementación Visual · Jira EY-87 | M | — | Track diseño (paralelo) |
| EP-20 | Activación Comercial — DLocal + Stripe reales · Jira EY-92 | M | — | 🔒 Bloqueada (credenciales) |
| EP-21 | UX Onboarding Continuo del Tutor · Jira EY-97 | S | — | Track UX (paralelo) |
| EP-22 | Sprint Integración Visual — Look & Feel · Jira EY-102 | M | — | Track visual (paralelo, **dev**) |

---

## 2. Historias por Épica

Cada historia: **descripción · criterio de aceptación (condensado) · refs de trazabilidad**.

### EP-00 — Diseño UX/UI y Contenido (Pre-desarrollo) · Jira EY-1
| US | Historia | Estado código | Jira |
| :-- | :-- | :-- | :-- |
| US-001 | Identidad visual (marca) | pendiente | EY-4 |
| US-002 | Tokens de diseño (colores, tipografía, espaciado, breakpoints) | ✅ hecho (globals.css) | EY-3 |
| US-003 | Librería de componentes base (Design System) | ~ parcial (`src/components/ui/`) | EY-5 |
| US-004 | Sistema de badges de estado | pendiente | EY-6 |
| US-010 | Wireframes lo-fi — Públicas (P01–P09) | pendiente | EY-7 |
| US-011 | Wireframes lo-fi — Autenticación (AU01–AU04) | pendiente | EY-8 |

> EP-00 sólo existe en Jira (añadida al cargar el tablero); no venía en el docx v1.0.

### EP-01 — Autenticación y Cuentas · [S1]
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-101 | Registro con email o Google | M | 5 | S1 | Datos válidos → crea cuenta y llega NTF-01; email duplicado se rechaza con mensaje claro. | SCR-AU02, NTF-01, RN-31 |
| US-102 | Inicio de sesión | M | 3 | S1 | Válidas abren sesión; inválidas → error genérico. Email + Google OAuth. | SCR-AU01 |
| US-103 | Recuperar contraseña | M | 3 | S1 | Solicitud envía NTF-02 con token; token vigente permite nueva contraseña; expirado → error claro. | SCR-AU03, NTF-02 |
| US-104 | Gestión de cuenta y cierre de sesión | S | 2 | S1 | Editar perfil, timezone y cerrar sesión desde SCR-G03. | SCR-G03, RN-01 |

### EP-02 — Onboarding (Alumno/Tutor) · [S1]
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-201 | Onboarding del alumno | M | 5 | S1 | Timezone (IANA) y teléfono (E.164) obligatorios; guardo preferencias; `onboarding_complete=true` al terminar. | SCR-AL01, RN-01/44, profiles |
| US-202 | Onboarding del tutor | M | 8 | S1 | headline, bio, foto, teléfono, redes y categorías obligatorios; al guardar quedo `approval: pending`. | SCR-TU01, M1, RN-44 |
| US-203 | KYC del tutor (identidad ampliada) | M | 8 | S1 | Subo id_document, degree, certificate, diploma, transcript, cv, social_media → `identity: pending`; recibo NTF-06. | SCR-TU02, M2/M8, NTF-06, C-14 |

### EP-03 — Descubrimiento y Búsqueda · [S1]
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-301 | Explorar tutores | M | 5 | S1 | Solo `approval_status=approved`; filtro por categoría/rating/precio; paginación. | SCR-P04, RN-24 |
| US-302 | Explorar productos/categorías | M | 3 | S1 | Productos activos por categoría (N–M); categoría enlaza a perfil/producto. | SCR-P05/P06, RN-09 |
| US-303 | Búsqueda por palabra clave | S | 3 | S1 | Búsqueda en título/desc/tutor/categoría; sin resultados → sugerencias. | SCR-P09, RN-20 |
| US-304 | Ver perfil/detalle de producto | M | 2 | S1 | Bio, productos, rating, política, CTA Reservar; producto muestra resultado/precio/modelo. | SCR-P07/P08 |

### EP-04 — Catálogo del Tutor (Productos) · S2
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-401 | Crear/editar productos | M | 5 | S2 | Modelo de precio (sesión/hora/paquete), duración ≥30 min, paquete ≥1, categorías; guardo `draft`. | SCR-TU04, RN-03/09/10/22 |
| US-402 | Publicar / pausar / archivar producto | M | 5 | S2 | Publico solo si `approved` (RN-23); pauso/archivo con guardas M3. | SCR-TU03, M3, RN-23 |
| US-403 | Política de cancelación del tutor | S | 3 | S2 | Política **única de plataforma** (RN-37); visible en perfil y checkout. | SCR-TU04, RN-11/37 |

### EP-05 — Disponibilidad · S2
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-501 | Definir horarios recurrentes | M | 5 | S2 | CRUD por día/hora; `end_time > start_time`; en timezone del tutor. | SCR-TU05, availability_rules |
| US-502 | Bloquear/abrir fechas puntuales | S | 3 | S2 | Excepciones `block`/`open` que sobrescriben la regla recurrente. | SCR-TU05, availability_exceptions, S-03 |

### EP-06 — Reserva y Checkout · S2
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-601 | Elegir horario disponible | M | 5 | S2 | Slots en hora local; paquete = N slots; sin doble-reserva (S-41). | SCR-AL04, RN-12/32 |
| US-602 | Pagar reserva (checkout) | M | 8 | S2 | Checkout alojado del proveedor; opción card-on-file (RN-43); al `paid` → `pending_acceptance` + NTF-04. | SCR-AL05, M6, NTF-04, RN-43 |
| US-603 | Ver confirmación de reserva | M | 3 | S2 | Tras aceptación del tutor: resumen + sesiones creadas; recibo NTF-05. | SCR-AL06, M5, NTF-05 |
| US-604 | Cancelar reserva/sesión | M | 5 | S2 | Reembolso RN-37: ≥24h=100%, <24h alumno=50%, tutor=100%; estados a `cancelled`. | SCR-AL07, M4/M5, RN-37 |
| US-605 | Autocancelar pagos vencidos | M | 3 | S2 | Sin pago en 20 min → `cancelled`; slot liberado; job de timeout. | M4/M6, RN-27, C-07 |
| US-606 | Aceptar/rechazar reserva en 24h | M | 8 | S2 | `pending_acceptance` → acepto (`confirmed`) o rechazo/timeout (`cancelled` + reembolso 100%); NTF-17. | SCR-TU07b, M4, RN-38 |
| US-607 | Guardar tarjeta (card-on-file) | S | 3 | S2 | Tokenización en el PSP; nunca se guarda el PAN; token reutilizable. | SCR-AL05/G03, payment_methods, RN-43 |

### EP-07 — Pagos (Capa Agnóstica) · S2
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-701 | Enrutamiento de cobro por geografía | M | 5 | S2 | PaymentRouter lee `payment_routing_rules`; sin regla activa → reserva bloqueada (RN-33). | Doc 6, RN-15/16/33 |
| US-702 | Split tutor/plataforma por tier | M | 5 | S2 | `tier_split_pct` snapshot al crear el pago; `tutor_net`/`platform_fee` server-side. | payments, RN-08, S-08 |
| US-703 | Webhooks idempotentes de cobro/payout | M | 5 | S2 | Verifico firma (RN-34); proceso cada evento una vez; actualizo M6/M7. | Doc 6, RN-26/34 |
| US-704 | Reembolso manual (admin) | S | 3 | S3 | Reembolso total/parcial desde SCR-AD08; ejecuta `service_role`; NTF-10. | SCR-AD08, DP-03, M6 |
| US-705 | Nuevos proveedores sin tocar el core | M | 3 | S2 | Alta de adaptador + fila en `payment_routing_rules`; sin migración ni cambio de negocio. | Doc 6, RN-16, DP-01 |

### EP-08 — Sesión en Vivo (Daily) · S3
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-801 | Entrar a la sala en el horario | M | 5 | S3 | Acceso solo en ventana (RN-18, S-45 = 10/10 min); token server-side. | SCR-LV01, RN-18 |
| US-802 | Ciclo de vida de la sesión | M | 5 | S3 | Cierre automático al vencer ventana (S-26); `in_progress` al primer join; `completed` al cerrar. | M5, S-26 |
| US-803 | Sala responsive en móvil | S | 3 | S3 | Controles táctiles; reconexión automática ante caída de red. | SCR-LV01, S-36 |

### EP-09 — Reseñas · S3
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-901 | Dejar reseña tras completar | M | 5 | S3 | Solo si `booking: completed` (RN-28); una por compra; recalcula `rating_avg`. | SCR-AL08, M4, RN-17/28 |
| US-902 | Ver reseñas en perfil del tutor | S | 3 | S3 | Reseñas públicas en SCR-P07 por recencia. | SCR-P07 |

### EP-10 — Payouts a Tutores · S3
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1001 | Ver ingresos y payouts | M | 5 | S3 | Saldo disponible vs. en retención; lista con estado; detalle por payout. | SCR-TU06/TU09, M7 |
| US-1002 | Liquidación automática (lote semanal) | M | 8 | S3 | Al vencer 7d con reserva `completed` → `scheduled` (lote semanal); `resolvePayout`; NTF-12. | M7, DP-02/06, NTF-12 |
| US-1003 | Gestión de payouts por admin | S | 5 | S3 | hold/release/reintento desde SCR-AD15; alertas NTF-13/16. | SCR-AD15, M7 |
| US-1004 | Retiro self-service del tutor | M | 3 | S3 | Botón Retirar → payout `trigger=tutor_request`; solo saldo con retención vencida; admin conserva hold/release. | SCR-TU06/TU09, M7, RN-40 |

### EP-11 — Panel Admin · S3
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1101 | Aprobar/rechazar tutores y KYC | M | 8 | S3 | Reviso docs en SCR-AD05; aprobar requiere `identity: approved` (RN-29); rechazo con motivo; NTF-03. | SCR-AD03/05, M1/M2, NTF-03 |
| US-1102 | Gestionar categorías | M | 3 | S3 | CRUD con slug único; planas (S-13); baja lógica si tiene productos. | SCR-AD11, categories |
| US-1103 | Configurar comisión y tiers | M | 5 | S3 | Edito `split_pct` (75/85/90 seed); creo tiers; aplica solo a reservas nuevas (S-08). | SCR-AD12, RN-06/07 |
| US-1104 | Supervisar pagos y reservas | M | 3 | S3 | Listas y detalle con filtros (SCR-AD06..AD10); logs básicos por entidad. | SCR-AD06/07/08/09/10 |
| US-1105 | Estadísticas globales | S | 2 | S3 | KPIs filtrables por período en SCR-AD13. | SCR-AD13, S-44 |

### EP-12 — Notificaciones · S3
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1201 | Emails transaccionales | M | 5 | S3 | Cada NTF-01..20 dispara su email una vez (RN-36); fechas en hora local del destinatario (RN-35). | Doc 7, notifications |
| US-1202 | Registro idempotente de envíos | M | 5 | S3 | Tabla `notifications` con `event_key` único; estado queued/sent/failed/skipped; reintento. | Doc 7 §7.5 |
| US-1203 | Avisos in-app | C | 3 | S4 | Banners/lista desde `notifications`; campo `read_at`. | SCR-AL02/TU06, S-48/50 |

### EP-13 — Referidos · S4
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1301 | Widget de referidos | S | 3 | S4 | Widget Referral Factory en AL02/G03; sin lógica interna (RN-21); reglas 10%/25%. | FL-04, Doc 6 §6.12 |
| US-1302 | Captura de código de referido | S | 2 | S4 | Capturo `?ref=` al registro → `profiles.referral_code`; sin lógica de comisión interna. | profiles.referral_code, S-18 |

### EP-14 — Seguridad / RLS · [S1]
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1401 | RLS default-deny en todas las tablas | M | 5 | S1 | RLS ENABLE en todas; sin política = sin acceso; `has_role()` SECURITY DEFINER. | Doc 3 |
| US-1402 | Proteger escritura financiera (service role) | M | 5 | S1 | Ningún cliente escribe `payments`/`payouts`/`payout_items`; solo webhooks/jobs. | Doc 3, RN-26, S-15 |
| US-1403 | Prevenir escalada de privilegios | M | 3 | S1 | Sin auto-asignación de `admin`/`approval_status`/`tier_id`; admin por seed/migración. | Doc 3, RN-31 |

### EP-15 — Observabilidad / Monitoreo · S4
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1501 | Monitoreo de errores con Sentry | S | 3 | S4 | Sentry en frontend y Edge Functions; alertas ante errores no manejados. | Doc 6 §6.13, S-09 |
| US-1502 | Métricas de pago/payout/webhook | C | 2 | S4 | Tasa de fallo de cobro, payouts `failed`, latencia de webhook en admin. | Doc 6 §6.8/6.13, S-47 |

### EP-16 — Responsive / QA / Lanzamiento · S4 (US-1603 en S1)
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1601 | Experiencia 100% responsive | M | 5 | S4 | Breakpoints 360/768/1024/1280; flujos alumno/tutor responsive; admin Desktop-first. | Doc 4 §4.9, S-36 |
| US-1602 | QA y UAT | M | 5 | S4 | Checklist de lanzamiento; pruebas de RLS por rol; webhooks idempotentes verificados. | §9/§11 |
| US-1603 | Ambientes dev/staging/prod | M | 3 | **S1** | Supabase: proyecto por ambiente; Vercel: preview por PR + producción desde main; secretos en env. | §8, Doc 10 §10.6 → `docs/ENTORNOS.md` |

### EP-17 — Chat de la Reserva (v3) · S3
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1701 | Chat 1:1 en la reserva | S | 5 | S3 | Hilo 1:1 por reserva; habilitado 2 días antes, persiste 30 días; Supabase Realtime; RLS por participantes. | messages, SCR-AL03/TU08/LV01, RN-41 |
| US-1702 | Descargar conversación del chat | C | 3 | S4 | Exporto .txt/.json del hilo desde SCR-AL03/TU08. | Doc 6 §6.12b, S-57 |
| US-1703 | Purga automática del chat | S | 2 | S3 | pg_cron borra mensajes con `expires_at` vencido (30 días); job diario. | messages.expires_at, RN-41 |

### EP-18 — Grabación de la Sesión (v3) · S4
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1801 | Grabar sesión con consentimiento | S | 8 | S4 | Sin consentimiento de ambos no se graba (RN-42); consentimiento antes de entrar a la sala; add-on Daily de pago. | SCR-LV01, M9, RN-42 |
| US-1802 | Ver y descargar grabación 30 días | S | 5 | S4 | Disponible 30 días desde `completed_at`; luego `expired` y purgada; NTF-19. | M9, SCR-AL03/TU08, NTF-19 |

---

## 3. Sprint 1 — Definición

**Objetivo:** fundaciones técnicas (ambientes, BD, RLS) + registro, login, onboarding alumno/tutor, KYC básico y descubrimiento público. Al cerrar S1: un usuario se registra, completa su perfil, y un visitante explora tutores y productos.

**15 historias / 63 SP:** US-101, 102, 103, 104, 201, 202, 203, 301, 302, 303, 304, 1401, 1402, 1403, 1603.

**Épicas S1:** EP-01 (13) · EP-02 (21) · EP-03 (13) · EP-14 (13) · +US-1603 de EP-16 (3).

---

## 4. Roadmap por Sprint

| Sprint | Foco | Historias | SP |
| :-- | :-- | :-- | :-- |
| **S1** | Fundaciones · Auth · Onboarding · Descubrimiento · RLS · Ambientes | 15 | 63 |
| **S2** | Catálogo tutor · Disponibilidad · Reserva completa · Pagos · Webhooks | 16 | 74 |
| **S3** | Sala en vivo · Reseñas · Payouts · Admin · Notificaciones · Chat | 19 | 83 |
| **S4** | Referidos · Observabilidad · Responsive/QA · Grabación · Avisos in-app · Lanzamiento | 10 | 39 |

- **S2:** US-401,402,403,501,502,601,602,603,604,605,606,607,701,702,703,705.
- **S3:** US-704,801,802,803,901,902,1001,1002,1003,1004,1101,1102,1103,1104,1105,1201,1202,1701,1703.
- **S4:** US-1203,1301,1302,1501,1502,1601,1602,1702,1801,1802.

**Estado (sync Jira 2026-07-14):** S1 ✅ y S2 ✅ cerrados (39 issues `Done`). **S3 en curso.**

### 4.1 Tracks paralelos (fuera de S1–S4)

No consumen SP de los sprints de dev. Se filtran en Jira por label.

| Track | Épica | Jira | Estado | Nota |
| :-- | :-- | :-- | :-- | :-- |
| `Sprint-Diseño` | EP-19 | EY-88…91 (DS-01…04) | **In Review** (Diana Rivera) | Entregable Figma, no código. Precede al rediseño visual de pantallas ya construidas. |
| `Sprint-Activacion-Comercial` | EP-20 | EY-93…96 (PAC-01…04) | 🔒 **Bloqueada** | C-01 **decidido: DLocal + Stripe**. Falta cuenta + API keys de ambos. El motor simulado ya está hecho y probado. |
| `Sprint-Mejoras-UX` | EP-21 | EY-98…101 (UX-201…204) | To Do | ⚠️ **Redefine** US-201/202/203 (ya `Done`) — ver aviso abajo. |
| `Sprint-Integracion-Visual` | EP-22 | EY-103…108 (IV-01…06) | To Do | **Código.** Aplica el Figma sobre pantallas ya funcionales. Avanza al ritmo en que EP-19 entrega. Ver §4.2. |

> ⚠️ **EP-21 no es documentación: es alcance nuevo sobre historias cerradas.**
> - **UX-203** pide **7 documentos** de KYC (`id_document`, `degree`, `certificate`, `diploma`,
>   `transcript`, `cv`, `social_media`); lo construido en US-203 son **3** (`id_front`, `id_back`,
>   `selfie`). Esto **resuelve C-14** y obliga a migración del set de documentos.
> - **UX-202** pide asistente **secuencial** de 5 pasos (contacto → headline/bio → foto → redes →
>   categorías); lo construido en US-202 es un **form único** sin foto ni categorías.
> - **UX-204** exige ≥1 producto `draft` para habilitar "Enviar a revisión" — hoy no existe ese gate.
>
> Las historias UX-2xx están redactadas como *requisitos de pantalla* (entregable: documento), pero su
> AC implica **re-trabajo de código**. Antes de ejecutarlas hay que decidir si se abren historias de dev
> derivadas o se reabren US-202/203.

### 4.2 EP-22 · Sprint Integración Visual (`Sprint-Integracion-Visual`)

Aplicar el look & feel de Figma sobre el frontend **ya funcional**. No cambia lógica ni datos.

| ID | Jira | Alcance | Depende de | Páginas Figma |
| :-- | :-- | :-- | :-- | :-- |
| IV-01 | EY-103 | Auth (login / registro / recuperar) | DS-01 (EY-88) | `AUTH` — AU01…AU04 |
| IV-02 | EY-104 | Onboarding alumno y tutor + KYC | DS-02 (EY-89) | `ALUMNO` AL01, `TUTOR` TU01/TU02 |
| IV-03 | EY-105 | Descubrimiento y páginas públicas | DS-03 (EY-90) | `HOME - Contenido` — P01…P09 |
| IV-04 | EY-106 | Dashboard alumno (reservas, checkout, chat, reseñas) | DS-04 (EY-91) | `ALUMNO` AL02…AL08, `CHAT` |
| IV-05 | EY-107 | Dashboard tutor (catálogo, disponibilidad, reservas, payouts) | — (DS no creada) | `TUTOR` TU03…TU09 |
| IV-06 | EY-108 | Panel admin | — (DS no creada) | `ADMIN` AD01…AD15 |

**Regla de la épica (de Jira):** ninguna IV pasa a `Done` sin aprobación del cliente y contenido
final. **Estado máximo durante el sprint: `In Review`.** Textos con placeholders donde el copy no
esté aprobado. Labels: `pendiente-contenido`, `sujeto-a-cambios`.

**⚠️ AU04 no se implementó — decisión pendiente de diseño.** El Figma dibuja una pantalla de espera
("Verificando tu cuenta…" con spinner y "¿No se redirige? Haz clic aquí"). En el código,
`/auth/callback` es un **route handler de servidor** ([route.ts](../src/app/auth/callback/route.ts)):
intercambia el `code` PKCE y devuelve un 302 — **nunca renderiza nada**. Para poder enseñar el
spinner habría que mover el intercambio al cliente, lo que añade un round-trip, exige JS y **empeora**
el tiempo hasta el destino. Se dejó el 302. Si diseño quiere la pantalla igualmente, es un cambio de
arquitectura, no de estilos. El estado de error del diseño sí existe: fallo → `/login?error=oauth`
con aviso en la card.

**Realidad del archivo Figma** (`Enseñame Ya - Diseño Final`, fileKey `tKTiQF8adZ7SMfNipylz86`) —
verificado por API el 2026-07-20:

- **No hay design system formal**: 0 variables, 0 estilos publicados, 0 componentes. Es maquetación
  plana. **No hay modos** light/dark. Los tokens se **derivan de las capas**, no se importan.
- Tokens de facto: **Poppins** (400/500/600/700, base 13px, LH ≈1.5) · CTA **`#fe6a00`** (naranja) ·
  marca/enlaces `#0080ff` · texto `#14141a` / `#6b6b6b` · bordes `#e0e0e0` · fondos `#ffffff` /
  `#f9fafc` · error `#e51a1a`. `src/app/globals.css` sigue con los defaults de shadcn → **el primer
  commit de IV-01 es reescribir esas variables**, no parchear pantalla por pantalla.
- ⚠️ **Todas las pantallas están a 1280px: no existe diseño móvil.** El AC "según Figma" no es
  aplicable a breakpoints. Choca con **US-1601** (responsive/QA, S4): o se pide diseño móvil, o
  US-1601 se ejecuta con criterio propio de dev. **Decisión pendiente.**
- ⚠️ EP-19 sólo cubre DS-01…04. **IV-05 y IV-06 no tienen historia de diseño** que las respalde,
  aunque las pantallas `TUTOR` y `ADMIN` **sí existen** en Figma.
- 🐞 **Error de diseño confirmado — el FAB de chat.** El Figma pinta el botón flotante `v2-chat`
  en las 9 páginas públicas **y en el login**. Es incorrecto: **solo debe verse con sesión
  iniciada**. Además su función es mensajería **alumno ↔ tutor(es) estilo LinkedIn** (bandeja con
  varias conversaciones), no el chat por reserva de US-1701 (`/chat/[bookingId]`), que es lo único
  construido. **No implementar el FAB tal como está dibujado**; la bandeja global es alcance nuevo
  → hace falta historia propia (aún no creada en Jira).
- 🔗 **Enlaces sin destino.** El footer del diseño apunta a `/about`, `/how-it-works`, `/terms`,
  `/privacy` y `/cookies`; **ninguna de las 5 rutas existe**. `/about` y `/how-it-works` están
  diseñadas (P02, P03 → IV-03); las 3 legales **no tienen ni diseño ni contenido** → dependen del
  cliente.
- Acceso: el MCP de Figma se agota con asiento *View*; usar `FIGMA_API_KEY` (`.env.local`) contra la
  REST API. El token es **personal de Diana Rivera** — si lo rota, se cae el acceso.

---

## 5. Definition of Done (por historia)

Código en PR revisado · pruebas de **RLS por rol** · **webhooks idempotentes** verificados · **responsive** checkeado · criterio de aceptación validado · (dinero) escritura solo `service_role` · fechas UTC en BD, render hora local.

---

## 6. Importación a Jira (referencia)

Épicas EP-01..EP-18 como *Epic*; US-xxx como *Story* con `Epic Link`, AC en descripción y SP. Etiquetas MoSCoW (must/should/could) + dominio (rls, pagos, auth, video, chat, notif, admin) + `Refs`. **Los sprints ya están cargados** — este archivo es el espejo, no la fuente de creación.

---

## 7. Deltas de este backlog (v1.0) sobre los Docs 00–09

> Detalle y trazabilidad completa en `docs/context/ADENDA-BACKLOG-v1.md`. Resumen:

**Épicas nuevas:** EP-17 (Chat), EP-18 (Grabación) — antes vivían en el PDF `INTEGRACION-CHAT-Y-GRABACION` (retirado; su detalle técnico se absorbió a Docs 01 §1.10 y 06 §6.18).

**Historias nuevas / cambiadas:**
- **US-606** (nueva): reserva pasa por `pending_acceptance` — el tutor **acepta/rechaza en 24h** antes de `confirmed`. Cambia la máquina M4 (ver Doc 02 + adenda). NTF-17, RN-38.
- **US-607** (nueva): card-on-file (tokenización PSP, `payment_methods`). RN-43.
- **US-1004** (nueva): retiro self-service del tutor (`trigger=tutor_request`). RN-40.
- **US-403 / US-604:** política de cancelación es **única de plataforma** con % de reembolso ya fijados (RN-37) — antes era default-tutor + override y % en DP-03.
- **US-605:** ventana de pago = **20 min** (antes genérica; C-07 sigue afinando el valor).
- **US-201/202/203:** onboarding exige **teléfono E.164** + `onboarding_complete`; tutor exige foto+redes; KYC amplía docs (degree, certificate, diploma, transcript, cv, social_media). RN-44.

**Reglas nuevas:** RN-37 (política/reembolsos únicos), RN-38 (aceptar/rechazar 24h), RN-40 (retiro), RN-41 (chat), RN-42 (grabación/consentimiento), RN-43 (card-on-file), RN-44 (onboarding ampliado).

**Notificaciones:** catálogo ampliado a **NTF-01..20** (nuevas: NTF-17 aceptar/rechazar, NTF-19 grabación disponible).

**Decisión resuelta:** **C-03 / DP-03** → RN-37 fija los % de reembolso (≥24h=100%, <24h alumno=50%, tutor=100%). Ver Doc 09 + `APROBACION-CLIENTE-FAIMLAB.md`.

---

*Espejo del backlog v1.0 (Faim Lab, 2026-06-24). Se sincroniza con Jira. Última edición: 2026-07-20 (sync EP-22).*
