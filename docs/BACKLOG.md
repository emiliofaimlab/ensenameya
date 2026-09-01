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
| Épicas | **25** (EP-00 + EP-01…EP-24). ⚠️ Jira tiene además `EY-152` — "EP-23 Soporte Técnico al Usuario (Post-MVP)", que **reusa el código EP-23** que ya lleva `EY-110`: duplicado real del tablero, hay que renumerarlo |
| Historias | **87** (incl. EP-00 diseño, EP-22 integración visual y EP-23 datos) + 1 bug (`EY-109`). En Jira son hoy **135 tickets sin contar épicas**: 110 `Done` · 15 `In Review` · 10 `To Do` (sync 4-ago) |
| Puntos estimados | 259 SP (backlog dev original EP-01…EP-18) |
| Historias Must | 40 |
| Sprints | 4 de dev en el docx original; **en Jira van 8** (S1…S5 + **6 AC · 7 · 8**) + EP-00 pre-desarrollo + los tracks paralelos |
| **Sprint activo** | **6 AC · 7 · 8 abiertos a la vez** (sync Jira 4-ago) — S1–S5 cerrados. 6 AC venció el **31-jul** y sigue abierto; 7 venció el **4-ago**; 8 vence el **7-ago**. De los 20 tickets que quedaban el 29-jul, **15 están en `In Review`** (Sprint 7 entero + 4 del 8, todos en código) y **5 siguen `To Do`** (los de 6 AC, esperando claves). Con los 5 abiertos después son **10 `To Do`**. **Al 7-ago:** las 15 de `In Review` están ya **en `dev`** (PR #11 mergeado) y del Sprint 6 AC hay dos —`EY-93` PAC-01 y `EY-95` PAC-03— **hechas por la pata de Stripe**, aunque no cerrables (§4.5). Plan de ataque y estado en `docs/PLAN-DESARROLLO.md` |

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
>
> **Sync 2026-07-21:** al ejecutar EP-22 se creó **EP-23 — Datos que el diseño necesita y no
> existen** (`EY-110`, DD-01…08 / `EY-111`…`EY-118`): campos y relaciones que el Figma da por hechos
> y que el modelo no tiene. También el bug **`EY-109`** (buscar sin tildes devuelve cero), colgado de
> EP-03 porque es un defecto del buscador, no una carencia del diseño. Ver §4.3. — *`EY-109` ✅
> corregido y en prod, pero **al segundo intento**: el arreglo del 21-jul no funcionaba; el bueno es
> del **27-jul** (`b032cc5`, migraciones `20260727120000` + `20260727130000`). Ver §4.3.*
>
> **Sync 2026-08-04:** Jira añadió **EP-24 — Ajustes reunión 24-jul** (`EY-119`), que estos docs no
> recogían, y **cinco tickets nuevos** posteriores al cierre de las 6 tandas: `EY-148` (RF-03, webhook
> de calificación de referido), `EY-149` (RF-04), `EY-150` (RF-05), `EY-151` (NTF-21) y `EY-153`
> (SUP-01) — los cuatro últimos **sin sprint asignado**. Todo lo ejecutado desde el 24-jul —plan
> `R24-01…23`, `R29-01…04`, las **6 tandas** del 29-jul, la limpieza de código muerto y el **`DD-04`
> rehecho**— se recoge en **§4.4**, sin tocar el histórico de §4.1–§4.3.
>
> **Sync 2026-08-07:** el **PR #11 ya se mergeó** (`1a36da2`, 5-ago) y encima entraron dos días más de
> trabajo (5 y 6 de agosto): las páginas legales con texto redactado de verdad, el bug que hacía fallar
> **siempre** `US-1802`, `confirm_payment` fuera del alcance del cliente, el correo enviando de verdad
> (**C-11 resuelta: Resend**) y el **checkout de Stripe de punta a punta en test mode** — `PAC-01` y
> `PAC-03` hechas por esa pata. Y un hallazgo que **cambia el alcance de EP-13**: el mecanismo de
> `US-1302` no funciona con la campaña de referidos que hay montada. Todo en **§4.5**.
>
> ⚠️ ~~**Sigue sin haber nada de esto en producción.**~~ **Desplegado el 26-ago** (`main` =
> `3fca8b2`). El párrafo describía el estado al 7-ago, cuando `main` seguía en `57edfa9` y faltaban
> 20 migraciones. Al **30-ago** quedan **7** por aplicar y `dev` va 52 commits por delante.

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
| EP-23 | Datos que el diseño necesita y no existen · Jira EY-110 | S | — | Derivada de EP-22 |
| EP-24 | Ajustes reunión 24-jul · Jira EY-119 | M | — | `R24-01…23` — nació de la demo con el cliente. Ver §4.4 |

> ⚠️ **`EY-152` es un duplicado del tablero:** se titula "EP-23 Soporte Técnico al Usuario (Post-MVP)"
> y reusa el código **EP-23**, que ya es `EY-110` (datos del diseño). Son dos épicas distintas con el
> mismo identificador. Aquí manda `EY-110`; a la de soporte le toca número nuevo en Jira (sería EP-25).
> De ella cuelga `EY-153` (SUP-01, botón de soporte), hoy `To Do` y sin sprint.

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

> ⚠️ **`US-703` (`EY-56`) se cerró como `Done` con un criterio que no se cumplía.** Su AC dice
> "verifico firma (RN-34)" y **no había ninguna firma que verificar**: el proveedor ruteado era
> `simulated` y no existía endpoint de webhook. Lo que sí estaba hecho era la idempotencia (el evento
> se procesa una vez). ✅ **Desde el 6-ago la firma existe de verdad** (`7b30768`):
> `POST /api/webhooks/stripe` lee el **cuerpo crudo** (`req.text()`, no `req.json()` — un
> parse+stringify reordena claves y rompe el HMAC), responde **400** si la firma no valida —nunca 500,
> o Stripe reintenta tres días un payload que jamás va a validar— y **503** si falta
> `STRIPE_WEBHOOK_SECRET`. Verificado con un evento entregado por Stripe de verdad, y reenviar el
> **mismo `event id` no reprocesa**. Falta la mitad de DLocal. Ver §4.5.
>
> ℹ️ **`US-705` estrenó su promesa el 6-ago**: cambiar de proveedor **ya no es una migración**. Los
> grants acotados de `20260806180000` dejan a `service_role` hacer `update` de
> `charge_provider`/`payout_provider`/`is_active` en `payment_routing_rules` — sin `insert` ni
> `delete`, así que inventar un corredor nuevo sigue exigiendo migración revisada.

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

> **Sync 2026-08-04:** Jira sumó **NTF-21 (`EY-151`) — email de mensaje nuevo en el chat**, `To Do` y
> **sin sprint**. Amplía el catálogo NTF-01..20 de §7 y toca EP-17 (RN-41): hoy el chat no avisa fuera
> de la app.
>
> **Sync 2026-08-07 — `US-1201` pasa de encolar a enviar (`58fd62e`).** **C-11/DP-05 resuelta:
> Resend**, elegido por un motivo operativo y no de gusto — es el único de los tres candidatos
> (SendGrid, Mailgun, Resend) que deja **enviar y probar sin dominio verificado**, y el dominio propio
> sigue bloqueado. El acoplamiento vive entero en `lib/email.ts`: cambiar de proveedor es reescribir
> una función. 🔴 **El detalle que habría hecho inútil todo lo demás:** `process_notifications()`
> marcaba la cola **entera** como `sent` cada 2 minutos sin enviar nada, así que cualquier remitente
> externo habría llegado siempre a una cola vacía. Ahora esa función solo **informa** (mismo patrón que
> la pausa de la purga del chat, `20260722200000`: no se borra ni se desprograma, "si se desprograma,
> se olvida") y el envío real lo hace `/api/cron/notifications-send` **por GitHub Actions** — Vercel
> Hobby limita los crons a **uno al día**, y un aviso de "tienes 24 h para aceptar" que llega mañana
> no sirve. ⚠️ El `cron:` pide 5 minutos pero **GitHub entrega una corrida cada 2-6 h** (medido del
> 27 al 30-ago): mejor que una al día, lejos de lo que dice el archivo. 🐞 **Y un defecto de catálogo encontrado al probarlo: NTF-07** ("tienes
> una reserva nueva por aceptar") se encolaba al pasar a `confirmed`, o sea **después** de que el tutor
> aceptara; ahora se encola en `pending_acceptance` (`20260806160000`), con la misma clave de
> idempotencia, así que no duplica. ~~**Falta la cuenta de Resend y su `RESEND_API_KEY`**~~ →
> ✅ **puesta el 17-ago** en local, Preview y Production; comprobado el 30-ago (el cron devuelve
> `status:"ok"`, no `sin-proveedor`). El reloj también está desde el 30-ago, pero apunta a **prod**,
> donde la cola está vacía: **nadie ha visto llegar todavía un correo de la cola**.

### EP-13 — Referidos · S4
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1301 | Widget de referidos | S | 3 | S4 | Widget Referral Factory en AL02/G03; sin lógica interna (RN-21); reglas 10%/25%. | FL-04, Doc 6 §6.12 |
| US-1302 | Captura de código de referido | S | 2 | S4 | Capturo `?ref=` al registro → `profiles.referral_code`; sin lógica de comisión interna. | profiles.referral_code, S-18 |

> **Sync 2026-08-04:** las dos de arriba están hechas y en `In Review` (Sprint 8), pero Jira sumó
> **tres historias de integración real** que el docx v1.0 no traía: **RF-03 `EY-148`** (webhook de
> calificación del referido — la primera que **toca nuestro backend**), **RF-04 `EY-149`** (alta
> automática en Referral Factory) y **RF-05 `EY-150`** (aviso al referidor). Las tres `To Do`;
> RF-04 y RF-05 **sin sprint**. Ojo: amplían RN-21 ("sin lógica interna") — un webhook propio ya es
> lógica nuestra, aunque el programa siga viviendo en Referral Factory.

> 🔴 **Sync 2026-08-07 — al mirar la campaña de verdad, EP-13 cambia de alcance. Léase entero antes de
> tocar `EY-148`.**
>
> **1. `US-1302` (`EY-79`) está en `In Review` y su mecanismo NO FUNCIONA con esta campaña.** El AC
> asume que el referido aterriza en **nuestra** app con un `?ref=` en la URL. No es lo que hace
> Referral Factory: la campaña (`https://vercel.referral-factory.com/cXr65Wou/signup`) lleva al
> referido a una **página de oferta alojada por RF**, donde deja nombre y correo, y **solo después**
> lo redirige a
> `https://ensenameya.vercel.app`. Encima, los **tres** parámetros de URL que RF ofrece pasar en esa
> redirección (Nombre, Email, Referrer First Name) estaban **apagados**, así que el referido llegaba
> sin nada. Y lo determinante: **RF no ofrece un parámetro de código de referido**. Toda la atribución
> construida —cookie `ey-ref` + `profiles.referral_code`, migración `20260729130000` (`cefb805`,
> `b01f26a`)— **no puede funcionar** tal cual. El ticket no está "hecho a falta de mergear": está
> **hecho contra una premisa equivocada** y hay que rehacer su AC.
>
> ⚠️ **Corregido el 1-sep (D2): aquí decía «se activó el parámetro `ref_email`: la atribución tiene
> que pasar a ser por correo contra la API de RF». Es falso.** `grep -rn "ref_email" src/ supabase/`
> devuelve **cero** y `REFERRAL_FACTORY_API_KEY` **no se lee en ninguna línea de código**; lo repetían
> igual `CLAUDE.md`, `PLAN-DESARROLLO.md` y `QA-LANZAMIENTO.md`, y los cuatro están corregidos. Lo
> único que existe es la cookie (`middleware.ts:76-83` → metadata → `handle_new_user` →
> `profiles.referral_code`), y **`referral_code` no lo lee nadie después**. Comprobado contra la
> campaña real `50297`: no tiene URL de vuelta a la app configurada, así que el `?ref=` no llega
> nunca y la rama de la cookie **no se ejecuta jamás** — **0 de 39 perfiles de dev** lo tienen. O sea
> que la atribución no está «pendiente de cambiar de mecanismo»: **no existe**, y qué mecanismo usar
> es una pregunta abierta (C-10), no una decisión ya tomada. Ver `docs/QA-LANZAMIENTO.md` §4.5.
>
> **2. `RF-03` (`EY-148`) probablemente sobra.** La propia integración **Stripe ↔ Referral Factory**
> de la herramienta ya califica al referido siguiendo el **gasto acumulado de UN Customer de Stripe**
> y lo **descalifica al reembolsar** — exactamente lo que el webhook propio iba a hacer. Por eso el
> checkout guarda `profiles.stripe_customer_id` y **reutiliza un Customer por persona** (`7b30768`):
> con cinco fichas distintas, cinco compras de 20 USD no alcanzan ningún umbral y el referidor no cobra
> nunca. **Hay que comprobarlo antes de escribir una línea de `EY-148`**; si se confirma, el ticket se
> cierra sin código y RN-21 ("sin lógica interna") **sigue en pie**, que era lo que la reunión del
> 17-jul quería.
>
> **3. Bloqueantes que no son código.** Los **términos que RF le enseña al referido** son **su
> plantilla sin rellenar**, con corchetes tipo `[Insert link to Privacy Policy here]` — pendiente de
> redactar, y ahora hay texto propio del que copiarlos (DD-06, §4.5). **`NEXT_PUBLIC_REFERRAL_URL`**
> está **en local pero no en Vercel**, así que en la preview el bloque "Invita y gana" de `US-1301`
> **no se pinta** — y es esa URL sola la que lo decide: `REFERRAL_FACTORY_API_KEY` estaba en la
> misma frase pero **no la lee ningún fichero de `src/`**, así que no pinta ni deja de pintar nada.

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

> **Sync 2026-08-07:** `US-1702` (`EY-84`) y `US-1703` (`EY-76`) **ya están en `dev`** desde el merge
> del PR #11 (`1a36da2`, 5-ago) — dejan de "esperar el merge". La purga vuelve a **borrar de verdad**
> (30 días, mensaje **y adjunto**, `20260729180000`) y la descarga previa la cubre `US-1702`, que es lo
> que pedía la decisión 22 del cliente. Siguen sin llegar a producción hasta el merge `dev` → `main`.

### EP-18 — Grabación de la Sesión (v3) · S4
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1801 | Grabar sesión con consentimiento | S | 8 | S4 | Sin consentimiento de ambos no se graba (RN-42); consentimiento antes de entrar a la sala; add-on Daily de pago. | SCR-LV01, M9, RN-42 |
| US-1802 | Ver y descargar grabación 30 días | S | 5 | S4 | Disponible 30 días desde `completed_at`; luego `expired` y purgada; NTF-19. | M9, SCR-AL03/TU08, NTF-19 |

> 🐞 **Sync 2026-08-07 — `US-1802` (`EY-86`) no encontraba NINGUNA grabación** (`fffd4b5`).
> `join_session` bautiza la sala `'ey-' || replace(id::text,'-','')`, **sin guiones**, y
> `/api/recordings/[sessionId]` la buscaba como `ey-${sessionId}`, **con guiones**. Nunca coincidían:
> `listRecordings` volvía vacío y la interfaz decía "Esta clase no se grabó" aunque Daily estuviera
> bien configurado y los dos hubieran consentido. **Fallo del 100 % de las veces, en silencio.** El
> arreglo no es replicar el `replace`: es **dejar de derivar el nombre por segunda vez** y leer
> `sessions.daily_room_name`, que la BD ya guarda. Columna a `null` = nadie entró nunca a la sala, que
> es un "no hay grabación" legítimo.
>
> ✅ **Y la retención de 30 días ya BORRA de verdad** (`0722b64`, RN-42). Hasta ahora se cumplía solo
> "al servir" —410 pasada la fecha, fichero eterno en Daily—, un dato personal que no caducaba. Ahora
> hay job diario `/api/cron/recordings-purge` (Vercel Cron, 04:00) + `sessions.recordings_purged_at`
> (`20260806130000`), que evita repasar cada sesión vencida para siempre y deja constancia de **cuándo**
> se borró. **No** es una Edge Function a propósito: el repo ya eligió Route Handlers en
> `20260717120000` ("Postgres no puede llamar a la API de Daily"), y una función de Deno pediría su
> propio cliente, su propia copia de la clave y un pipeline que no existe. **Falla cerrado**: sin
> `CRON_SECRET` responde 503 y no corre.
>
> ~~🔒 **Ninguna de las dos desbloquea EP-18:** el add-on de grabación de Daily sigue sin activar~~
> ✅ **EP-18 NO ESTÁ BLOQUEADA — verificado el 31-ago.** El add-on está contratado: hay dos
> grabaciones `finished` del 14-ago, servidas por `/api/recordings/[sessionId]`.
>
> ⚠️ Y `recordings_bucket` en `null` **no era la prueba del bloqueo**: significa que los ficheros
> viven en el almacenamiento de Daily y no en un bucket nuestro, que es el modo por defecto y
> funciona. Sigue en `null` hoy, con grabaciones dentro.

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
| **S4** | Observabilidad · Responsive/QA · Grabación · Avisos in-app · Lanzamiento | 8 | 34 |

- **S2:** US-401,402,403,501,502,601,602,603,604,605,606,607,701,702,703,705.
- **S3:** US-704,801,802,803,901,902,1001,1002,1003,1004,1101,1102,1103,1104,1105,1201,1202,1701,1703.
- **S4:** US-1203,1501,1502,1601,1602,1702,1801,1802. — **US-1301 (3 SP) y US-1302 (2 SP)**, los
  referidos de EP-13, **salen de S4** por decisión de la reunión del 17-jul (`00:59:03`): bajan a los
  dos últimos sprints. S4 pasa de 10 historias / 39 SP a **8 / 34**. ✅ **Replicado en Jira**: US-1301
  y US-1302 (`EY-78`/`EY-79`) acabaron en el **Sprint 8**, y las dos están hoy en `In Review`.
  ⚠️ **`US-1302` no se puede cerrar desde ahí**: su mecanismo no sirve para la campaña de Referral
  Factory que hay montada — ver el 🔴 de EP-13 en §2 y §4.5.

**Estado (sync Jira 2026-08-04):** S1…S5 **cerrados**. Las historias de S4 no se quedaron sin hacer:
se ejecutaron en las tandas 3–6 del plan del 29-jul (observabilidad `EY-80`/`EY-81`, avisos in-app
`EY-77`, grabación `EY-85`/`EY-86`, responsive y QA `EY-82`/`EY-83`) y **están en `dev` desde el 5-ago**
(PR #11 mergeado, `1a36da2`) — siguen en `In Review` en Jira y **ninguna llegó a producción**, que
espera el merge `dev` → `main`. Ver §4.4 y §4.5. **US-202 (`EY-32`) ya no está pendiente**: el asistente del tutor tiene
sus **5 pasos** (`tutor-onboarding-form.tsx`, pasos 1–5) desde IV-02, y el gate de UX-204 se añadió el
27-jul (`66f70e0`). Lo único abierto de dev son los **5 tickets del Sprint 6 AC**, bloqueados por
cuentas y claves de Stripe/DLocal — **no por la decisión**, que C-01 ya cerró. ⚠️ **Corrección del
7-ago:** ese bloqueo era **medio bloqueo**. El *sandbox* de Stripe no exige KYC, así que `PAC-01`
(`EY-93`) y `PAC-03` (`EY-95`) **están construidas y probadas en test mode**; lo que sigue parado es
DLocal —cuenta **rechazada**— y los payouts. Ver §4.5.

### 4.1 Tracks paralelos (fuera de S1–S4)

No consumen SP de los sprints de dev. Se filtran en Jira por label.

| Track | Épica | Jira | Estado | Nota |
| :-- | :-- | :-- | :-- | :-- |
| `Sprint-Diseño` | EP-19 | EY-88…91 (DS-01…04) | **In Review** (Diana Rivera) | Entregable Figma, no código. Precede al rediseño visual de pantallas ya construidas. |
| `Sprint-Activacion-Comercial` | EP-20 | EY-93…96 (PAC-01…04) + `EY-147` | 🟡 **A medias** (antes: 🔒 bloqueada) — hoy **Sprint 6 AC**, vencido el 31-jul y aún abierto | C-01 **decidido: DLocal + Stripe** (resuelta, no bloquea). "Con una cuenta Stripe en *test mode* la mitad es ejecutable" → **se ejecutó el 6-ago**: `PAC-01` y `PAC-03` funcionan de punta a punta contra Stripe. 🔒 Siguen bloqueados **DLocal entero** (cuenta **rechazada**) y los **payouts** (Connect exige KYC). Ver §4.5. |
| `Sprint-Mejoras-UX` | EP-21 | EY-98…101 (UX-201…204) | ✅ **Done** (ninguna aparece ya entre los `To Do`/`In Review`) | Redefinía US-201/202/203 — **ya ejecutado**, ver aviso abajo. |
| `Sprint-Integracion-Visual` | EP-22 | EY-103…108 (IV-01…06) | **Las 6 IV en `Done` desde el 27-jul** · en prod 2026-07-22 | **Código.** Aplica el Figma sobre pantallas ya funcionales. Ver §4.2. |
| — | EP-23 | EY-111…118 (DD-01…08) | **Las 8 cerradas**: DD-01/02/07/08 en `Done`, DD-03/04/05/06 en `In Review` | Huecos de modelo destapados por EP-22. Ver §4.3 y §4.4. |
| — | EP-24 | EY-119 (`R24-01…23`) | ✅ Ejecutada (12/12 + 11/11, 24→27-jul) | Ajustes de la reunión del 24-jul. Detalle en `docs/PLAN-DESARROLLO.md`; resumen en §4.4. |

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
>
> ✅ **Resuelto — el aviso de arriba ya es histórico.** No se abrieron historias derivadas: se ejecutó
> en el código. **UX-203** → los 7 documentos ya están en el modelo (migración
> `20260715130000_us203_seven_documents`, más `20260724130000`/`20260724130100` para el borrador de
> TU02) y con ellos **C-14 queda cerrada**. **UX-202** → el asistente es secuencial de **5
> pasos** desde IV-02 (`tutor-onboarding-form.tsx`), con la verificación metida dentro como penúltimo
> paso (R24-15, `39b40d5`) y los materiales fuera (R24-16, `3f6181d`). **UX-204** → el gate existe desde
> el **27-jul** (`66f70e0`): sin al menos una oferta creada, "Finalizar" sale deshabilitado con copy
> bloqueante y CTA "Crear mi primera oferta".

### 4.2 EP-22 · Sprint Integración Visual (`Sprint-Integracion-Visual`)

Aplicar el look & feel de Figma sobre el frontend **ya funcional**. No cambia lógica ni datos.

**Las 6 en producción desde el 2026-07-22** (PR #6→`dev`, PR #7→`main`) **y en `Done` desde el
2026-07-27**.

| ID | Jira | Alcance | Estado | Páginas Figma |
| :-- | :-- | :-- | :-- | :-- |
| IV-01 | EY-103 | Auth (login / registro / recuperar) | **Done** (27-jul) · `95aacc6` | `AUTH` — AU01…AU04 |
| IV-02 | EY-104 | Onboarding alumno y tutor + KYC | **Done** (27-jul) · `b68b20c` + `1b0efb6` | `ALUMNO` AL01, `TUTOR` TU01 (5 pasos) |
| IV-03 | EY-105 | Descubrimiento y páginas públicas | **Done** (27-jul) · `8a186a7` + `676972f` | `HOME - Contenido` — P01…P09 |
| IV-04 | EY-106 | Dashboard alumno (reservas, checkout, chat, reseñas) + **LV01 sala** | **Done** (27-jul) · `dffa023`…`fa8bec9` | `ALUMNO` AL02…AL08, `CHAT`, `LV01` |
| IV-05 | EY-107 | Dashboard tutor (catálogo, disponibilidad, reservas, payouts) | **Done** (27-jul) · `036a346` | `TUTOR` TU03…TU09 |
| IV-06 | EY-108 | Panel admin | **Done** (27-jul) · `f521315` | `ADMIN` AD02…AD15 |

Rama `feat/iv01-auth-visual` (mergeada y **borrada** tras el release): 25 commits. Los tokens alcanzan
a **toda** la app.

**Notas de ejecución (además de la maquetación de cada pantalla):**

- **IV-02** introdujo modelo nuevo (migración `20260722160000`): `profiles.avatar_path` + bucket
  `avatars`, `tutor_categories`, `student_interests`, `tutor_materials` + bucket privado,
  `tutor_profiles.teaching_level`. TU01 se hizo de **5 pasos** (el 5 no existía; se incluyó por la
  conclusión con Jose). ⚠️ **Desencuentro con diseño en el paso 4**: el comentario #28 del Figma pedía
  replicar el módulo de KYC; el frame que Diana añadió (`390:37`) dice "materiales de clase". Se
  implementó lo del frame. **A aclarar con diseño.** AL01 **sin verificar en navegador**.
- **IV-04 · LV01** se aplicó en dos tandas. La sala quedó a dos columnas (vídeo + panel de chat de
  EP-17 reutilizado, no un chat nuevo) + "Subir documentos" (adjunto de `messages` + bucket privado
  `chat-attachments`). **No** trae tiles ni barra de iconos de Daily: exigen el modo *call-object*
  (reescribir EP-08), y **la reunión del 17-jul lo dio por innecesario** (los controles los pone Daily).
- **IV-05/IV-06** comparten un shell de panel (`app-sidebar` + `*-shell`). Sobre IV-06, la reunión del
  17-jul dejó **trabajo funcional pendiente** (no visual): panel de alertas con badges, detalle de tier
  con tutores, categoría como desplegable, redirección de slug, log del tutor, subida por lotes.
- **Acuerdos del 17-jul aplicados** (migración `20260722200000` + `daily.ts`): chat de Daily apagado,
  prefijo `chat_` en adjuntos, **purga del chat parada** (`US-1703`/`EY-76` reabierta), switch de panel.

**Regla de la épica (de Jira):** ninguna IV pasa a `Done` sin aprobación del cliente y contenido
final. **Estado máximo durante el sprint: `In Review`.** Textos con placeholders donde el copy no
esté aprobado. Labels: `pendiente-contenido`, `sujeto-a-cambios`.

⚠️ **La regla se saltó:** las 6 pasaron a `Done` el **27-jul** y la aprobación del cliente **nunca
llegó** — el rediseño está en producción sin go formal (decisión de negocio de la reunión del 17-jul).
El contenido con placeholders sigue igual: los textos legales y el copy final dependen del cliente.

**AU04 · el spinner costó un cambio de arquitectura.** El Figma dibuja una pantalla de espera
("Verificando tu cuenta…"). `/auth/callback` era un **route handler de servidor**: intercambiaba el
`code` PKCE y devolvía un 302 **sin renderizar nada**. Un Server Component no puede escribir cookies,
así que para poder enseñar el spinner el intercambio tuvo que pasar al navegador — el mismo mecanismo
que ya usa el login por correo (`createBrowserClient`), no un downgrade de seguridad. **Se implementó
tal cual el diseño**, con guarda `useRef` porque el `code` es de un solo uso y StrictMode monta dos
veces. Coste: un round-trip extra frente al 302 anterior; si se prefiere velocidad, se revierte.

**Realidad del archivo Figma** (`Enseñame Ya - Diseño Final`, fileKey `tKTiQF8adZ7SMfNipylz86`) —
verificado por API el 2026-07-20:

- **No hay design system formal**: 0 variables, 0 estilos publicados, 0 componentes. Es maquetación
  plana. **No hay modos** light/dark. Los tokens se **derivan de las capas**, no se importan.
- Tokens de facto: **Poppins** (400/500/600/700, base 13px, LH ≈1.5) · CTA **`#fe6a00`** (naranja) ·
  marca/enlaces `#0080ff` · texto `#14141a` / **`#4d4d4d`** · bordes `#e0e0e0` · fondos `#ffffff` /
  `#f9fafc` · error `#e51a1a`. ✅ **Aplicados** en `src/app/globals.css` + `layout.tsx` (IV-01).
  *(El cuerpo estaba en `#6b6b6b` —la media de las 6 páginas— y se corrigió a `#4d4d4d`, que es el de
  P01; `#666` queda solo para metadatos. 23-jul.)*
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
  → **DD-07 (`EY-117`)**. ✅ **Resuelto el 27-jul** con **R24-21** (`b09e518`): burbuja flotante
  **solo con sesión** (`chat-launcher.tsx` + `chat-bubble.tsx`), tipo bandeja, que lista los hilos por
  reserva sin entrar a la sesión. `EY-117` en `Done`.
- 🔗 **Enlaces sin destino.** El footer del diseño apunta a 5 rutas. `/about` y `/how-it-works` ✅
  creadas en IV-03 (P02, P03); `/terms`, `/privacy` y `/cookies` estuvieron en 404 hasta el **29-jul**
  → ✅ **creadas** (`8d8ddb2`, tanda 1 / **DD-06 `EY-116`**): las 3 responden 200 con el armazón
  público. ~~Y **dicen en pantalla** que el texto legal está pendiente del cliente. Falta ese texto.~~
  → **Ya no**: el **6-ago** las tres pasaron de "documento en preparación" a **texto redactado**
  (`4cf2ca6` → `b957933`), ver §4.5. ⚠️ **En producción siguen siendo 404**: `main` no tiene ni
  siquiera `8d8ddb2`.
- Acceso: el MCP de Figma se agota con asiento *View*; usar `FIGMA_API_KEY` (`.env.local`) contra la
  REST API. El token es **personal de Diana Rivera** — si lo rota, se cae el acceso.

#### Revisión nodo a nodo de P01 (2026-07-23)

IV-03 se maquetó "a ojo de frame". Al comparar el JSON de P01 (`386:3`, 387 nodos, vía REST) contra el
DOM real del home salieron **~25 desviaciones**, corregidas todas el 23-jul. Las de fondo:

- **Rejilla.** El contenedor daba 1088px de contenido; el Figma trabaja a **1152** (1280 con gutter de
  64). Afectaba a *todas* las páginas → `Container` corregido. `Section` pasa a 64px de aire vertical.
- **Color de cuerpo.** `--muted-foreground` era `#6b6b6b`; el cuerpo de P01 es **`#4d4d4d`** (el `#666`
  solo aparece en metadatos). Y los títulos llevaban `tracking-tight` contra un diseño a `ls: 0`.
- **Banda de garantías.** Fondo plano `bg-brand` cuando el asset del Figma es un **degradado
  `#0072ff → #49a9ff`** (muestreado del PNG, que es como está hecho en el archivo), e iconos en azul
  cuando el trazo del diseño es **naranja**.
- **Chips de categoría.** Se habían implementado con etiqueta siempre visible; el diseño deja un chip
  desplegado y el resto en círculo porque **la etiqueta aparece al pasar el ratón** (y al enfocar con
  teclado). En hover el círculo pasa de naranja a azul, que tampoco estaba.
- **Tarjeta de tutor.** Estaba centrada; en el Figma es **alineada a la izquierda** con la foto arriba
  a la izquierda y nombre + titular al lado.
- **3 pasos.** Faltaban las **tres imágenes** de las tarjetas (exportadas del propio archivo), la
  sombra y el radio 17.5.
- **FAQ.** Acordeón cerrado contra un diseño con **las 5 respuestas visibles**; chevron gris en vez de
  azul; tamaños 17/26px.
- **Cifras.** La tarjeta **cabalga el borde** de "Tutorías destacadas": 99 de sus 199px quedan sobre el
  gris. Sin ese solape la sección no se parece.
- **Testimonios.** No es una rejilla: las tarjetas van de `x=-28` a `x=1740` dentro de un frame de
  1280, o sea **se salen del bloque por los dos lados** y la segunda fila arranca desplazada 212px. Es
  un carrusel congelado en el frame; se implementó con dos pistas duplicadas y `translateX(-50%)` en
  CSS, sin JS, con `motion-reduce` respetado.
- **Footer.** Faltaba el **logotipo "Ya"** (el diseño usa la marca gráfica, no el texto) y el claim era
  otro. Header: enlaces a 14px, buscador a 558px **con borde**, botón a 40px.

**Contenido inventado — resuelto el 2026-07-23 con datos reales** (ya no hay `TODO` en el código):

- **Cifras de P01** ("+1.200 tutores · 25k+ clases · 4.9★ · 30+ países"): la banda existe y sale de la
  RPC `home_stats()`, o sea **las cifras reales de la plataforma**. Los **países** no existen como
  campo —`create_booking` escribe `payee_country` con un `'VE'` hardcodeado a la espera de **C-13**—
  así que se **derivan de la zona horaria** del tutor (obligatoria por RN-01) con
  `country_from_timezone()`: ~38 zonas del mercado objetivo, y lo no mapeado no suma. Cuando C-13
  cierre el país de cobro, la función pasa a contar esa columna y el `'VE'` se cae con ella.
- **7 testimonios**: la sección existe y sale de `home_testimonials()` — reseñas **reales** de ≥4★ con
  comentario. El nombre del alumno se **enmascara en la propia RPC** (`Marina G.`) sin abrir `profiles`
  a nadie. ⚠️ **Publicar nombre + inicial de un alumno es decisión del cliente** (privacidad): es el
  patrón estándar de testimonios y lo que dibuja el Figma, pero conviene confirmarlo.
- Logos de pago (VISA, Mastercard, PayPal, Apple Pay, Amex, Stripe) del paso 02 de P01: afirman una
  integración que no existe (motor simulado, EP-20 bloqueada por credenciales).
- Insignia de tier (Élite/Intermedio/Base) en las tarjetas de P04: `tutor_tiers` es el **tramo de
  comisión** (US-1103, RN-06, RLS admin/dueño). Publicarlo filtra margen comercial y el alumno lo lee
  como ranking de calidad.

**Correcciones aplicadas sobre el Figma** (para que la revisión no las tome por descuidos): el CTA
del bloque "¿Sabes enseñar algo?" decía "Explorar tutores" (copy-paste) → "Quiero enseñar" a
`/signup`; bordes de campo con el token `#e0e0e0` en vez del `#cccccc` que solo aparece en AUTH; los
chips de categoría son **10** y no 8, siguiendo el comentario #33 de Diana (faltaban "Vida y
creatividad" y "Habilidades profesionales"). ~~Los 8 chips llevan etiqueta (el diseño deja 7 círculos
sin texto)~~ → **era una mala lectura del frame**: el diseño deja uno desplegado y el resto en círculo
porque la etiqueta se muestra **al pasar el ratón**. Corregido el 23-jul.

#### Revisión nodo a nodo de P02–P09 (2026-07-23)

Misma pasada que en P01, frame por frame: JSON del nodo por REST contra el DOM real, y corrección.
**Las nueve páginas públicas quedan repasadas.** Lo estructural de cada una:

- **P02 · `/about` (`386:393`).** El hero era otra cosa: el diseño usa el **degradado azul + una ola
  `#e0eeff` + la alumna recortada** (PNG con transparencia) recortada por el borde inferior, título a
  **64px centrado** con "*Conectamos*" en Poppins Light Italic. Faltaban los **dos badges flotantes**
  ("25k+ clases", "4.9/5"), el **fondo `#f5f9ff`** de "Enfocados en tus logros", las **fotos y el badge
  de flecha** de "En qué creemos", los **testimonios** y —lo más grave— el **FAQ era el del home**:
  P02 tiene su propio set de cinco. Todo aplicado; los badges salen de `home_stats()`.
- **P03 · `/how-it-works` (`386:688`).** Los bloques de pasos **no son tarjetas**: son imagen + lista
  numerada con línea de progreso, **azul para el alumno y naranja para el tutor**, y el *eyebrow* al
  revés (ESTUDIANTE naranja, TUTOR azul). Faltaban el **hero completo** (forma azul, alumno recortado,
  píldora de 3 iconos y chip "En vivo, 1 a 1"), la **frase de marca** sobre bloque negro, el envoltorio
  melocotón `#ffe5cc` del trust y el **FAQ a dos columnas**. La foto del hero **la recorta el borde**
  (hero 630, foto 634): se resolvió con capa absoluta anclada a la rejilla de 1280.
- **P04 · `/tutors` (`386:905`).** Tarjeta **centrada con avatar de 84px** (usaba iniciales y el
  `headline` pese a tener ya DD-01), **paginación numerada**, selector de orden y filtro de
  **disponibilidad** contra las reglas de EP-05. Dos de los cinco filtros del diseño siguen
  bloqueados (DD-03, DD-04).
- **P05 · `/classes` (`386:1196`).** Tarjeta con **miniatura**, fila de tutor con foto y nombre,
  divisor y **botón circular**; chips del hero en **azul** (distintos de los grises de P04); orden por
  precio. Aquí también estaban DD-01/DD-02 sin cablear.
- **P06 · `/categories` (`386:1489`).** ⚠️ **Lectura corregida por Jose:** los chips del hero **no son
  subcategorías**, son **el selector de categoría**. Y P06 **es la vista de `/categories`**, no solo la
  de una categoría: ahora **las dos rutas comparten plantilla** (`CategoryExplorer`) — sin categoría
  fijada lista todo, con categoría activa el chip se despliega y el listado se filtra. El panel lateral
  desaparece: los filtros van **en fila**, y "Temas" cruza con una **segunda categoría** aprovechando
  que `product_categories` es N–M.
- **P07 · `/tutors/[id]` (`386:1784`).** Lo gordo es el **panel de reserva**: precio, **calendario con
  los días libres, horarios del día elegido** y selector de tipo de clase, todo servidor + URL y
  alimentado por `get_available_slots` (la misma función del flujo de reserva). Además, **resumen de
  reseñas con histograma** y "Lo que enseño" como lista.
- **P08 · `/products/[id]` (`386:2091`).** Faltaba **medio cuerpo**: imagen 764×360, "Cómo funciona",
  FAQ del producto, resumen de reseñas y la tarjeta de tutor con foto/nombre real. El panel de compra
  reutiliza el de P07, así que la ficha ya trae **fecha y horario reales**.
- **P09 · `/search` (`386:2310`).** Hero centrado, *segmented control*, encabezados de sección con
  "Ver los N →", **variantes compactas** de las tarjetas, bloque "Explorar por categoría" con
  recuentos reales y orden por relevancia/valoración. 🐞 De paso: **`searchProducts` no traía el
  tutor**, así que la firma de la tarjeta habría salido vacía en toda la búsqueda.

**Patrón que se repitió en cinco páginas:** DD-01 y DD-02 estaban **cerradas en el modelo pero sin
cablear** en las tarjetas (P04, P05, P07, P08, P09). Nombre público, foto y miniatura ya existían.

**Piezas nuevas reutilizables** que salieron de la pasada: `BookingPanel` (calendario público),
`ReviewsSummary` (histograma), `CategoryExplorer`, `Pager` numerado, `category-icons` compartido, y
variantes de `ProductCard` (`compact`, `action="ver"`, `accent`) y `TutorCard` (`layout="list"`).

**Dos migraciones más** además de la de DD-01/DD-02:

- `20260723140000_home_stats_paises` — `country_from_timezone()` para la cifra de países.
- `20260723150000_slots_publicos_p07` — `get_available_slots` abierta a `anon`. El Figma enseña el
  calendario **antes de iniciar sesión**; la función es `SECURITY DEFINER`, ya se limita a productos
  activos de tutores aprobados y solo devuelve huecos libres. ⚠️ **Publica la agenda del tutor**, que
  es justo lo que el diseño quiere. Reservar sigue exigiendo sesión.

**⚠️ `/categories` no tiene frame en el Figma.** El diseño enlaza "Categorías" desde el footer y el
menú pero nunca dibujó la pantalla. Se resolvió aplicándole **P06** (decisión de Jose). Antes de eso
era la única pública que seguía con el aspecto pre-rediseño.

#### Revisión nodo a nodo de AL01 (2026-07-23)

Primera pantalla del **área con sesión** medida con el mismo método (JSON de Figma + DOM real a
1280 px): `180:1275` / `149:2` / `150:2` contra `/onboarding` (US-201).

**El fallo de fondo era estructural, no de detalle.** El Figma reparte la columna de **600 px** en
cuatro bloques separados por 24: progreso, **título fuera de la tarjeta**, tarjeta blanca **solo con
los campos** (r16, borde `#e6e6e6`, padding 28) y **botonera debajo de la tarjeta**. Nosotros
metíamos las cuatro cosas dentro de una única tarjeta de 672 px sin borde. Además todos los
controles medían 32 px donde el diseño pide **45** (y los botones 116×45 / 82×45 / 182×45).

- **Header de onboarding.** El Figma quita "Panel" y el menú de cuenta y deja solo **"Guardar y
  salir"** arriba a la derecha. Tiene sentido funcional: `requireUser` rebota al asistente hasta
  terminarlo, así que el enlace al panel **no llevaba a ninguna parte**. `SiteHeader` acepta ahora
  `onboarding` y el layout de `(app)` lo activa leyendo `x-pathname` (el header que inyecta el
  proxy) — sin mover la ruta de sitio. Aplica igual a **TU01**.
- **Zona horaria legible.** El selector listaba los ~420 IDs IANA en crudo (`America/Lima`); ahora
  muestra `(GMT-05:00) Lima` y ordena por offset, calculado con `Intl` (correcto con horario de
  verano, sin librería). Mejora de paso `/account`.
- **Teléfono con bandera y máscara** (petición de Jose, 23-jul). Única dependencia nueva de la
  pasada: **`react-phone-number-input`**, elegida porque su `onChange` devuelve **E.164 puro**
  (`+584121234567`) — exactamente lo que exige RN-44 — mientras el campo muestra el formato del país
  (`+58 412 1234567`, `+34 612 34 56 78`). El desplegable es el `<select>` **nativo** superpuesto,
  con los 246 países en español. País por defecto **VE** hasta que se cierre **C-13** (mercados).
- **Detalle**: etiquetas 12.5/400 `#6b6b6b`, "Paso N de 3" 12/400, placeholder `#8c8c8c`, avatar de
  64 px con **iniciales** cuando no hay foto, botón "Subir foto" 106×42 y chips de intereses a 38 px
  con el azul `#0080ff` sólido en los seleccionados.
- **Título**: el Figma dice "Bienvenida a Enséñame Ya" (femenino). Se dejó **"Te damos la bienvenida
  a Enséñame Ya"**, que es neutro y no misgenera a medio padrón.
- **El footer del frame va atrasado** (tagline pre-rediseño y "Explorar clases"): no se tocó.

`WizardShell` quedó con `Field` y `FIELD_CLASS` exportados, así que **TU01 hereda el armazón** — pero
sus pasos siguen con el maquetado viejo hasta que le toque su propia pasada.

#### Revisión nodo a nodo de AL02–AL08 (2026-07-24)

Las 7 pantallas del **panel del alumno** contra `155:2` / `159:2` / `165:2` / `169:2` / `173:2` /
`174:2` / `177:2`. Salió un `PanelShell` compartido (menú lateral en las 7, tarjetas r16 con borde
`#e0e0e0` y padding 20, píldoras de estado `#f0f0f0`/`#595959`, "Salir" en rojo `#bf3333`, contenido
de 1200). Verificado con DOM real a 1280 (AL02–AL07); AL08 quedó **sin verificación viva** por una
limitación del entorno (el navegador integrado no completa el `signInWithPassword` cliente contra
Supabase, así que no se pudo cambiar a una cuenta con reserva completada) — compila y el guard
funciona.

**🔴 Dos bugs de datos, no solo de diseño, en AL02:**

- **La misma reserva salía dos veces** — la lista se armaba desde `sessions` mirando solo su estado,
  así que una `pending_acceptance` aparecía como "clase próxima" **con botón _Entrar a sala_** y otra
  vez en "esperando aceptación". Ahora la lista se arma desde `bookings` (una fila = una reserva) y el
  botón de sala solo sale en `confirmed`/`in_progress`.
- **La fecha de las pendientes era `created_at`**, rotulada "· tu hora local" como si fuera la hora de
  la clase. Ahora se muestra la fecha de la sesión (o "Sin horario aún").

**🔴 Desde `/reservas` no se llegaba al detalle** — la lista no tenía **ni un solo enlace** (`<a>`).
Ahora cada fila enlaza a AL03. `/reservas` no tiene frame propio: hereda el armazón y la fila de AL02.

**Pantallas nuevas** (antes eran estados inline, `window.confirm()` o un diálogo):

- **AL06 confirmación** (`/reservas/[id]/confirmacion`) — página propia y centrada. Redacción honesta:
  la reserva queda **pendiente de que el tutor acepte**, no "confirmada".
- **AL07 cancelación** (`/reservas/[id]/cancelar`) — página con política + badge "Tu caso",
  **estimación de reembolso** (RN-37, calculada en el server, el importe final lo confirma
  `cancel_booking`) y selector de motivo. Sustituye al `window.confirm()` del navegador.
- **AL08 reseña** (`/reservas/[id]/resena`) — página que sustituye al `ReviewDialog` (mismo
  `submit_review`, estrellas naranja `#fe6a00`).

**AL03/AL04/AL05 rehechas:** chat embebido en la columna derecha de AL03 (antes un enlace a
`/chat/[id]`); calendario de AL04 de **67×40** por celda (medía 103×103) con tarjeta de horarios
aparte y chips píldora; **tarjeta de crédito ilustrada** (degradado `#191925`→`#054a94`) en AL05 y
columnas del Figma (360 | resto).

**Se mantuvo contra el Figma, con motivo:** **sin campos de tarjeta** en AL05 (capturar el PAN sería
PCI-DSS SAQ D en vez del SAQ A del checkout alojado; contradice PAC-01/02 ya aprobadas — la tarjeta
ilustrada es decorativa); "¡Reserva registrada!" en vez de "confirmada"; y los huecos ya conocidos
("Visa ···· 4242", "Ver recibo", "Ver grabación", "Invita y gana").

**Componente huérfano:** `src/app/(app)/reservas/[id]/cancel-booking-button.tsx` — el detalle ya no
lo usa (enlaza a la página de cancelación). ✅ **Borrado el 4-ago** (`63a7896`), junto con el otro
huérfano que quedaba, `admin/timeline.tsx` (el `Timeline` de los "logs básicos" de US-1104 que nunca
llegó a montarse). Ninguno de los dos generaba ruta ni entraba al bundle.

#### Revisión nodo a nodo de TU01–TU09 (2026-07-24, nocturna autónoma)

Las 14 pantallas del **área del tutor** contra `185:2`/`186:2`/`186:52`/`390:37`/`186:97` (TU01×5),
`189:2` (TU02), `191:2` (TU03), `192:2` (TU04), `194:2` (TU05), `195:2` (TU06), `197:2` (TU07),
`200:2` (TU07b), `202:2` (TU08) y `203:2` (TU09). Todo el panel migró al `PanelShell`/`PanelCard`
de AL02+ y `StatusPill` ganó los **tonos del Figma** (verde/azul/ámbar/rojo/gris por estado).
Verificado con sesión real del tutor de prueba: TU01 p1 clava el Figma al píxel (columna y=178,
tarjeta y=321, avatar 72×72, campos 45).

- **TU01** — los 5 pasos con `Field`/45 px, avatar de 72 (prop `large`), teléfono con bandera
  (`PhoneInput`), **nivel como select** (186:44, era chips) y paso 5 con el CTA azul a lo ancho.
- **TU02** — de página suelta `max-w-lg` a **dentro del panel**: tarjeta de estado con píldora,
  filas de documento (icono, hint, píldora de color, "Subir" azul / "Volver a subir" / "Reemplazar")
  y **redes en tarjeta aparte** como enlace. Sin "Enviar a revisión": cada documento queda en
  revisión al subirse — se dice en pantalla.
- **TU03** — tarjetas con **miniatura 64 r12** (DD-02, iniciales si falta), "Resultado: …", meta,
  píldora de color y acciones bajo divisor con **"Publicar" azul sólido**.
- **TU04** — de tarjeta centrada a página del panel: tarjetas "Detalles" y "Precio y formato",
  **modelo de precio como chips**, moneda visible (USD fijo hasta C-13), la **nota azul de política
  única** (RN-37) y doble acción **Publicar / Guardar borrador** (publicar = update posterior, el
  guard RN-23 de BD sigue mandando).
- **TU05** — reglas **agrupadas por día** (chips de franja con ✕), altas plegadas en `<details>`
  ("+ Añadir franja" / "+ Añadir excepción") y **calendario del mes** server-rendered que pinta azul
  los días con regla activa y ámbar los de excepción, con leyenda (194:107).
- **TU06** — layout del Figma: 4 cifras en tarjeta (con icono azul circular), dos columnas
  (Próximas sesiones con "Ver todas" azul · Reservas recientes con píldoras), y **Accesos rápidos
  como filas con flecha azul** (no tarjetas).
- **TU07 + TU07b en una ruta** — chips de filtro en la URL (Todas/Por aceptar/Confirmadas/…); las
  `pending_acceptance` como **tarjetas con cuenta atrás "Vence en X h Y m"** (RN-38, negra; roja
  <12 h, con borde rojo) y Aceptar naranja/Rechazar; el resto como filas con píldora y "Ver".
  Flujo probado en vivo: aceptar → "Reserva confirmada." → fila verde.
- **TU08 · ruta nueva** `/tutor/reservas/[id]` — antes no existía. Datos, "Entrar a la sala",
  **"Marcar completada"** (la RPC `complete_session` ya existía con guard de tutor, US-802/S-26),
  "Cancelar" (100 % al alumno) y el **chat con el alumno** en la columna derecha (RN-41).
- **TU09** — cifras en tarjeta, retiro self-service, **"Próximos payouts" separados del historial**
  y píldoras de color por estado.

**🐞 De paso:** `/tutor/payouts` usaba `requireRole("tutor")` mientras todo el panel usa
`requireTutorProfile` — un tutor aprobado sin el rol concedido (o uno pendiente, al que el menú ya
ofrece Payouts) **rebotaba a `/app`**. Alineado a `requireTutorProfile`; la RPC `tutor_balance` y la
RLS de `payouts` ya limitan a lo propio. (Salió a la luz porque el fixture `tutor.us401` se aprobó a
mano por SQL y nunca pasó por la RPC del admin que concede el rol.)

**Se mantuvo contra el Figma, con motivo:** "Calendario de la clase" y "Material de apoyo" POR
PRODUCTO en TU04 (el modelo no los tiene: la agenda sale de la disponibilidad general y
`tutor_materials` es por tutor → huecos de EP-23; el **material por producto se cerró el 27-jul** con
R24-16, migración `20260724150000`); la tarjeta "Grabación" de TU08 —que es **US-1802**, no US-1602, y
ya está construida: `RecordingLink` se pinta en TU08 y en AL03 desde la tanda 4 (`bc35f9b`) —y
desde el 31-ago se sabe que el add-on **está activo**, así que ya no espera a nada—;
"Cuenta de cobro" de TU09 (depende del PSP, EP-20); "Total ganado" bruto en TU06 (`tutor_balance`
solo devuelve netos); el nombre del alumno en TU06/07/08 (`profiles` es RLS own-only — hueco ya
documentado); y "Mis productos"→**"Mis mentorías"** por consistencia con el renombrado global.

#### Revisión nodo a nodo de AD01–AD15 (2026-07-24, autónoma)

Las 13 pantallas con contenido del **panel de administración** contra `211:2` (AD01), `218:1723`
(AD02), `213:2` (AD03-04), `214:2` (AD05), `219:2` (AD06-07), `220:2` (AD08), `221:2` (AD09),
`224:2` (AD10), `225:2` (AD11), `226:2` (AD12), `228:2` (AD13), `230:2` (AD14) y `232:2` (AD15).
Verificado en vivo con la sesión del admin fixture (capturas de AD02/AD05/AD13/AD14; el resto
responde 200 con los mismos patrones).

- **Chrome propio del admin** (218:1724/1851): header con la **píldora negra "Admin"** junto al
  logo y sin la navegación pública (modo `admin` de `SiteHeader`, activado por ruta), y
  **`AdminFooter`** claro con GESTIÓN/CONFIG/LEGAL y "Panel interno". El "Buscar en el panel…" del
  Figma **no se pinta**: no existe búsqueda global del panel a la que conectarlo.
- **Menú reordenado al Figma** (218:1739): Dashboard, Tutores, Pagos, Reservas, Categorías, Tiers,
  Estadísticas, Alertas, Payouts. **`/admin` ahora es el dashboard (AD02)** — pantalla nueva con
  GMV/comisiones del mes (30 días vía `admin_stats`), las tres **colas de trabajo** con su "Cola"
  ámbar y las reservas recientes con "Ver →" — y **la cola de tutores se movió a `/admin/tutores`**
  (AD03-04) con chips Por aprobar/Aprobados/Suspendidos con conteo real y fila con fecha de
  solicitud.
- **AD05** en dos columnas (perfil + visor KYC / acciones + historial), con el historial derivado
  de timestamps reales. **AD08 y AD10** también a dos columnas con sus "Logs" derivados.
- **AD13** con **chips de período** (7/30/90/Año/Todo) y los DOS gráficos del Figma servidos por
  una **migración nueva de solo lectura** (`20260724120000_ad13_admin_charts`):
  `admin_gmv_weekly()` (barras CSS, la última en naranja como 228:113) y
  `admin_bookings_by_category()` (barras de progreso). Guard `has_role('admin')` dentro, mismo
  patrón que `admin_stats`. Aplicada a dev; llega a prod al mergear.
- **AD14 · pantalla NUEVA `/admin/alertas`** — el Figma pedía una pantalla que no existía. Se
  construyó **derivada de datos reales** (últimos 30 días): pagos `failed` (Alta), payouts
  `failed`/`on_hold` (Media/Alta) y cancelaciones (Baja), con chips de tipo y "Abrir" al detalle.
  **Sin "Marcar atendida"**: no hay tabla de incidencias donde persistir ese estado (hueco EP-23);
  la alerta desaparece cuando el dato subyacente se resuelve. Las "disputas" llegan con el PSP.
  → ✅ **"Marcar atendida" existe desde el 29-jul** (decisión 29, migración `20260729170000`): la tabla
  `alert_acks` guarda **el acuse, no una copia de la incidencia** — duplicar la alerta daría dos
  versiones del mismo hecho. Atendidas se apartan de la lista, se pueden revisar y reabrir.
- **AD11/AD12** reestiladas (filas con /slug + Orden + píldora Activa/Inactiva; tiers con split
  20/700, "Por defecto" azul y la nota del seed C-09). **AD06-07/AD09/AD15** con chips, cifras en
  tarjeta y filas de píldora + "Ver".
- **AD01 (login admin) NO se construyó**: `/login` compartido ya enruta al admin por rol
  (`pickHome`) y RN-31 (sin registro de admins) ya se cumple — una segunda pantalla de login sería
  duplicar auth. Decisión documentada.
- **La "Cancelar reserva" de AD10** tampoco: no existe RPC de cancelación ejecutada por admin
  (`cancel_booking` exige ser parte de la reserva). El camino de soporte real es el **reembolso
  manual** (US-704), y la tarjeta "Soporte" enlaza a él. Si el cliente quiere cancelación por
  admin, es una RPC nueva con su política — no un botón.

### 4.3 EP-23 · Datos que el diseño necesita y no existen (`EY-110`)

Salió de ejecutar EP-22: campos y relaciones que el Figma da por hechos y que el modelo no tiene.
**No bloquean el despliegue; bloquean la fidelidad al diseño.** Cada una pide migración, política RLS
o alcance nuevo — no son trabajo visual.

| ID | Jira | Qué falta | Afecta a |
| :-- | :-- | :-- | :-- |
| DD-01 | EY-111 | ✅ **Cerrada (23-jul, migración `20260723120000`)** — `tutor_profiles.display_name` + `avatar_path`: copias **públicas** que el tutor publica, en una tabla que ya solo expone tutores `approved`. `profiles` **sigue privado** (no se abre a `anon`). Volcado desde el onboarding y sembrado con lo que ya había | P01, P04, P05, P07, P08, P09 |
| DD-02 | EY-112 | ✅ **Cerrada (23-jul, misma migración)** — `products.image_path` + bucket público `product-images` con RLS por carpeta del tutor, y campo de subida en el formulario de producto | P01, P05, P06, P09 |
| DD-03 | EY-113 | ✅ **Cerrada (29-jul, migración `20260729190000`, `31a9ddd`)** — nivel e idioma **por mentoría**. El nivel **reutiliza el enum `teaching_level`** (mismo vocabulario del filtro del Figma, un tipo menos); el idioma es texto con check porque la lista la mueve producto. Selects en TU04, grupos en P05, desplegables en P06 y chips en P08. El "Idioma del tutor" de P04 no necesitó columna: se deriva de las clases que publica | P05, P06, P07, P08 |
| DD-04 | EY-114 | ✅ **Cerrada, y rehecha (4-ago, `cccb566` + `96f4e0b`)** — la primera versión (29-jul, `302ba82`) copiaba los **cuatro tramos fijos** del Figma; el comentario de Jose en `EY-114` pedía un **rango continuo**. Ahora es una **vista nueva `tutors_public`** (migración `20260804120000`) que expone el precio de la mentoría activa más barata por *lateral join*: el rango, la paginación y el `count` los hace Postgres, sin columna materializada que mantener. `security_invoker = true` **no es decorativo** — sin él la vista correría con los privilegios del dueño y habría publicado tutores no aprobados y borradores. El deslizador va en **escala logarítmica**: con un tutor a 120 US$ y ocho entre 10 y 25, en lineal el catálogo útil cabía en el primer 12 % del recorrido | P04 |
| DD-05 | EY-115 | Subcategorías / "Temas" — hoy las categorías son **planas por decisión** (S-13). **Reducida el 23-jul:** los chips del hero de P06 no eran subcategorías sino el **selector de categoría**, y el filtro "Temas" se resolvió cruzando con una **segunda categoría** (`product_categories` es N–M). ✅ **Cerrada el 29-jul sin escribir código**: la decisión 26 del cliente mantiene las categorías planas y el cruce ya vivía en `category-explorer.tsx:83-90`. La jerarquía real queda **fuera del MVP** | P04, P06, P07 |
| DD-06 | EY-116 | ✅ **Cerrada (29-jul, `8d8ddb2`) y completada (6-ago, `4cf2ca6`→`b957933`)** — `/terms`, `/privacy` y `/cookies` ya no dicen "documento en preparación": llevan **texto redactado que describe la plataforma que existe** (ventana de pago de 20 min, 24 h para aceptar, sala 10/10, chat desde 2 días antes, retención de 7 días y lote de los lunes, los 7 documentos de KYC), con los **% de reembolso importados de `lib/policy.ts`** para que no puedan divergir de lo que aplica `cancel_booking`. **Sin migración**: son páginas de contenido. 🔍 **Hallazgo:** el cliente **ya tenía** términos y privacidad publicados en `ensenameya.com` (GoDaddy, "Última actualización: Marzo 23, 2026") y nadie los había mirado — de ahí salen el buzón oficial **`info@ensenameya.com`** (sustituye al marcador `hola@`) y su **§8 de limitación de responsabilidad**, incorporada. **Dos divergencias deliberadas** con el texto del cliente, anotadas en la cabecera del componente: el suyo nombra "Stripe o Mercado Pago" (C-01) y deja los reembolsos en "puede variar según cada caso" cuando **RN-37 ya es código**. Mientras los dos sitios estén publicados hay **dos contratos vivos**: eso lo decide negocio, no dev | todas |
| DD-07 | EY-117 | ✅ **Cerrada (27-jul, `b09e518` / R24-21)** — burbuja flotante **solo con sesión** (RN-41), tipo bandeja: los hilos por reserva sin entrar a la sesión. Reconcilia el FAB del Figma con el error de diseño documentado arriba | todas, con sesión |
| DD-08 | EY-118 | ✅ **Cerrada en Jira** (`Done`) — 🐞 Seed de dev: ratings sembrados sin filas en `reviews`. Era dato de semilla, así que **no deja commit ni migración que citar** | dev/QA |

**Dónde está cada una hoy (sync Jira 4-ago):** DD-01, DD-02, DD-07 y DD-08 en `Done`; DD-03, DD-04,
DD-05 y DD-06 en `In Review`, esperando el merge del PR #11. **Ninguna sigue abierta.**

**🐞 Sin ticket todavía — el catálogo público de productos devolvía CERO a quien no había iniciado
sesión.** Detectado y corregido el **2026-07-23** (migración `20260723130000`), **pendiente de abrir en
Jira bajo EP-03**. La migración `20260722140000` (que devuelve al alumno el título de lo que ya compró)
creó `products_select_booked` **sin `to authenticated`**: la política se aplicaba también a `anon`, que
no tiene grant sobre `bookings`, y **cualquier** `select` anónimo sobre `products` moría con
`permission denied for table bookings`. Home ("Tutorías destacadas"), `/classes`, `/search`,
`/categories/[slug]` y el detalle de producto salían vacíos **sin sesión**; con sesión funcionaba, por
eso pasó desapercibido en la revisión de IV-03. Arreglo: acotar esa política (y su gemela de
`product_categories`) a `authenticated`, que es el único rol que puede tener reservas. Verificado:
`anon` pasa de 0 a 5 productos en dev. ✅ **En prod desde el 27-jul** (la migración `20260723130000`
está en `main`). El ticket de Jira **sigue sin abrir**.

**Aparte, en EP-03: `EY-109` — buscar sin tildes devolvía cero resultados.** ✅ **Corregido y en prod,
pero hizo falta arreglarlo DOS veces.**

- **21-jul (`20260721120000` + `20260721130000`) — no funcionaba.** Se indexaron las dos ramas (con y
  sin tilde) en `products.search_vector`, y estos docs lo dieron por bueno. Pero el fallo estaba del
  **lado de la consulta**: el stemmer español de Snowball es sensible al acento, así que el documento
  "Aprende a programar…" stemea a `program`, la consulta `programación` también → ✅, y `programacion`
  stemea distinto → ❌. Medido antes del segundo arreglo: `programacion` devolvía **0** productos y
  `Programación` 1.
- **27-jul (`b032cc5`, migraciones `20260727120000` + `20260727130000`) — el bueno.** Dos caminos que
  solo **añaden** (el `tsvector` sigue mandando en relevancia): columna generada `products.search_text`
  sin acentos con índice GIN de trigramas, y `word_similarity` para el error de tecleo. `matematicas`/
  `Matemáticas`, `programacion`/`Programación`, `calculo`/`cálculo`, `ingles`/`inglés` devuelven ya el
  mismo conjunto.

⚠️ Lección: "corregido" no es lo mismo que "verificado con la consulta que fallaba". La primera
corrección se cerró sin reproducir el caso original.

**Huecos NUEVOS que destapó la pasada P02–P09 (2026-07-23)** — sin ticket todavía, **pendientes de
abrir en Jira bajo EP-23**:

| Qué falta | Dónde | Nota |
| :-- | :-- | :-- |
| **Años de experiencia** del tutor | P07 | No existe en ninguna tabla |
| **Tiempo de respuesta** ("Responde en ~2 h") | P07 | Ídem; exigiría medir respuestas del chat |
| **"Qué incluye el paquete"** (segunda lista del producto) | P08 | `products` guarda un único texto libre. Las viñetas de "Qué vas a conquistar" se derivan de la `description` si viene en líneas |
| **Canal de soporte** ("Contactar a soporte") | P03 | No hay ruta ni dirección. El canal que asume el diseño es DD-07. **Ya tiene ticket: `EY-153` (SUP-01, botón de soporte)**, `To Do` y sin sprint, colgado de la épica de soporte post-MVP (`EY-152`, la del código duplicado) |
| **Foto por categoría** | P06 | Resuelta **sin columna**: es un asset de diseño, vive en `public/img/categories/{slug}.jpg`. Si el cliente quiere que el admin las suba, pide migración + pantalla |
| **Nombre del alumno en las reseñas** | P07, P08 | Las reseñas son anónimas por diseño de la consulta (US-902). Firmarlas sería DD-01 aplicado al **alumno**: otra decisión de privacidad. ✅ **Cerrado (decisión 18, migración `20260729150000`)**: `reviews.author_display` es una copia enmascarada que escribe `submit_review` **solo con consentimiento** — `profiles` sigue cerrado y la consulta pública deja de tocarlo. ⚠️ Efecto visible: los testimonios de la home firman "Alumno" hasta que alguien marque la casilla |
| **"Tu objetivo principal"** del alumno | AL01 p2 | El Figma pinta un `<select>` ("Prepararme para una entrevista") y `profiles` no tiene el campo. **El diseño tampoco da la lista de opciones**, así que no se inventó el enum. ✅ **Cerrado (decisión 30, migración `20260729160000`)**: `profiles.primary_goal` con check de las **seis opciones que confirmó el cliente** + select en AL01 p2 |
| **Motivo de cancelación** del alumno | AL07 | El Figma pide un `<select>` de motivo + texto libre; `bookings` no tiene columna. ✅ **Cerrado (decisión 23, migración `20260729140000`)**: `bookings.cancel_reason`, lo escribe `cancel_booking` con un parámetro opcional y sale en el log de AD10. **Sin enum**: la lista es de producto, no de esquema |
| **Calendario de la clase** (fechas por producto) | TU04 | El Figma define fechas específicas por mentoría; la agenda real sale de la **disponibilidad general** del tutor (`get_available_slots`). Sería una tabla nueva `product_dates` + cruce en la función de slots |
| **Material de apoyo por producto** | TU04 | `tutor_materials` es **por tutor** (TU01 p4); el Figma lo pide además por mentoría. ✅ **Cerrado el 27-jul** con **R24-16** (`3f6181d`, migración `20260724150000`): los materiales salen del onboarding y pasan a la creación de la oferta; el asistente baja de 6 a 5 pasos |
| **Cuenta de cobro del tutor** | TU09 | "Banco BBVA · ****1234 · Verificada" — no hay dónde guardarla; depende del PSP elegido (EP-20 / C-01). Con DLocal, la cuenta se registra en el proveedor, no en nuestra BD |
| **Total ganado (bruto)** | TU06 | `tutor_balance` solo devuelve netos (`tutor_net_amount`); el bruto exigiría agregar `payments.gross_amount` en la RPC |

**⚠️ Conflicto Figma ↔ regla de negocio en AL01 p3:** el diseño marca el teléfono como
**"(opcional)"**, pero **RN-44 lo exige** en E.164 y el paso 3 no deja terminar sin él. Se mantuvo la
regla y la etiqueta dice "Teléfono". **Pendiente de confirmar con el cliente** cuál de las dos manda.

> ℹ️ **`tutor_categories`, `student_interests` y `tutor_materials`** (creadas en IV-02) son tablas
> **nuevas**, no cierran ninguna DD: cubren lo que el onboarding del Figma pedía, no los huecos del
> catálogo público que lista EP-23.

**Pendientes que deja el cierre de DD-01/DD-02 (23-jul):**

- **Semilla de dev sin aplicar.** `supabase/seed/p01-demo-images.sql` asigna las miniaturas y fotos
  demo (los ficheros ya están en los buckets). Hay que ejecutarlo **a mano en el SQL Editor de dev**:
  los tutores de `ep03-demo.sql` no pueden iniciar sesión (`encrypted_password` null) y la RLS impide
  —con razón— que ni un admin escriba en el catálogo ajeno.
- **Privacidad de los testimonios.** `home_testimonials()` publicaba *nombre + inicial* del alumno.
  ✅ **Decidido (decisión 18, 24-jul; en código el 29-jul, `20260729150000`)**: solo se firma **con
  consentimiento explícito** al reseñar; el resto sale como "Alumno". El enmascarado se comparte en
  `mask_person_name()`.
- **Países pendiente de C-13.** La cifra se deriva de la zona horaria; el campo real es
  `bookings.payee_country`, hoy hardcodeado a `'VE'` en `create_booking` y en `us1103_tutor_tiers`.

### 4.4 Sincronización 2026-08-04 — lo posterior al 24-jul

Este espejo se quedó en el 24-jul. Desde entonces hubo cuatro bloques de trabajo, todos en
`docs/PLAN-DESARROLLO.md` con su detalle; aquí queda la correspondencia con el backlog y con Jira.

**1) EP-24 · Plan de la reunión del 24-jul (`EY-119`, `R24-01…23`) — completo el 27-jul.**
Fila 🅐 12/12 (`4bd2e51`→`bd3801c`) y fila 🅑 11/11 (`af02c7c`→`20554c1`), en `dev` y `main`. Lo que
cambia el producto, no solo la pantalla: reserva **día → clase → horario** con precio dinámico
(R24-13/14), verificación **dentro** del onboarding (R24-15), materiales (R24-16, `20260724150000`) y
FAQ (R24-17, `20260724180000`) **por producto**, `auto_accept_bookings` (R24-19, `20260724160000`),
módulo `/pagos` propio (R24-20), bandeja de chat con sesión (R24-21 → cierra DD-07), horarios en la tz
del visitante (R24-22) y fotos alumno/tutor **independientes** (R24-23, `20260724170000`, que deshace
el `coalesce` de DD-01). Con esto **UX-201…204 quedan cubiertas** y `C-14` cerrada.

**2) Comentarios del 29-jul (`R29-01…04`) — aplicados.** Precio fuera del calendario (`7a81819`),
redes + portafolio en un solo módulo (`643ee32`, migración `20260729120000`), y en un solo commit
(`e7b96e6`, PR #8) las categorías en modal como los tiers y "Métodos de pago" **fuera del menú del
tutor** —`/pagos` es la tarjeta con la que paga el **alumno** (RN-43); el tutor cobra, no paga—.
`R29-03b` (cuenta de cobro del tutor) quedó **aplazado con EP-20**: depende del PSP; se entregó la
mitad no bloqueada, "Información de pago" con estado real (`EY-147`, `d03dd86`).

**3) Las 6 tandas del 29-jul — Sprint 7 y Sprint 8 enteros, en código.** De los 16 tickets que
tocaron, **15 están en `In Review`** ~~esperando el merge del PR #11~~ → **el PR #11 se mergeó el
5-ago** (`1a36da2`), así que están en `dev`; ninguno está en producción todavía. El 16.º es `EY-147`,
que solo pudo entregarse a medias y **sigue `To Do`** con el Sprint 6 AC.

| Tanda | Tickets | Cómo quedó |
| :-- | :-- | :-- |
| 1 · barrer lo barato | `EY-115` DD-05 · `EY-79` US-1302 · `EY-116` DD-06 · `EY-114` DD-04 · `EY-147` · `EY-80` US-1501 | `US-1302` **no estaba hecho, estaba a medias y fallaba en silencio**: con confirmación de correo el `update` del formulario nunca corría, y el alta por Google perdía el código. Ahora lo copia `handle_new_user` (`20260729130000`) + cookie `ey-ref` de respaldo (`cefb805`, `b01f26a`). 🔴 **Y aun así no sirve**: la campaña de RF no manda ningún código por URL — ver EP-13 en §2 y §4.5 |
| 2 · cerrar el chat | `EY-84` US-1702 · `EY-76` US-1703 | La decisión 22 (**30 días + descarga**) sacó a las dos del limbo del 17-jul. Descarga por `GET /api/chat/[id]/download` apoyada **en la RLS**, no en comprobaciones a mano; purga destructiva **con adjuntos** (`20260729180000`) — borrar solo las filas dejaría el objeto huérfano en Storage, que es el dato personal que RN-41 quiere caducar |
| 3 · datos y avisos | `EY-113` DD-03 · `EY-77` US-1203 · `EY-81` US-1502 | Avisos in-app con `read_at` (`20260729200000`), marcados por **RLS + grant de una columna**, no por RPC. Métricas de operación dentro de `admin_stats` (`20260729210000`): la "latencia de webhook" se mide con lo que hay y, sobre todo, cuenta los **cobros sin evento** |
| 4 · grabación | `EY-85` US-1801 · `EY-86` US-1802 | Consentimiento como **fila** (`20260729220000`): retirar es borrarla, sin booleano que confunda "dijo que no" con "no ha contestado". El permiso **no se pide en la interfaz, se quita del proveedor** (`enable_recording` solo si `recording_allowed()`). Acceso por `/api/recordings/[sessionId]` sin copiar metadatos a tabla propia (`20260729230000`). 🐞 **Esa ruta buscaba la sala con un nombre que no existía** y no encontraba **ninguna** grabación: corregido el 6-ago (`fffd4b5`), ver EP-18 en §2 |
| 5 · referidos | `EY-78` US-1301 | Cero lógica interna (RN-21): el bloque "Invita y gana" abre la campaña en pestaña nueva y **no le pasa el correo por la URL** |
| 6 · cierre | `EY-82` US-1601 · `EY-83` US-1602 | Barrido de scroll horizontal en 17 rutas a 360/768 (dos fallos reales, uno **global**: el footer a 768) y matriz de RLS ejecutada — 12 tablas × 4 roles; `messages` devuelve 0 filas **también al admin**. Resultados en `docs/QA-LANZAMIENTO.md` |

**Los 4 compromisos del 24-jul que no tenían ni ticket** (decisiones 18/23/29/30) se resolvieron
**en código, no en Jira** (`0b710b1`, 29-jul): `bookings.cancel_reason`, `alert_acks`,
`profiles.primary_goal` y reseñas firmadas con consentimiento. Ver las filas ya actualizadas en §4.3.

**4) Limpieza y `DD-04` rehecho (3–4 ago).** `9e56afb` borró código muerto —`booking-list.tsx`,
`review-dialog.tsx`, `reserve-button.tsx`, `category-chips.tsx`, `lib/avatar.ts`, `lib/routes.ts` y 6
primitivos de shadcn sin usar— y fundió `AdminShell` + `TutorShell` en **`PanelShell`** (misma
cabecera, 18 llamadas sin cambios). `63a7896` remató **los dos huérfanos** que aquel barrido no vio.
`cccb566` + `96f4e0b` rehicieron **DD-04** sobre la vista `tutors_public` (`20260804120000`) con rango
continuo y escala logarítmica — ver §4.3.

**Tickets abiertos después del cierre de las 6 tandas** (los 5 que no existían el 29-jul):

| Jira | Qué es | Épica | Sprint |
| :-- | :-- | :-- | :-- |
| `EY-148` | RF-03 · webhook de calificación de referido | EP-13 | en sprint, **sin empezar** — ⚠️ **probablemente sobra**, ver §4.5 |
| `EY-149` | RF-04 · alta automática en Referral Factory | EP-13 | **sin sprint** |
| `EY-150` | RF-05 · aviso al referidor | EP-13 | **sin sprint** |
| `EY-151` | NTF-21 · email de mensaje nuevo en el chat | EP-12 | **sin sprint** |
| `EY-153` | SUP-01 · botón de soporte | soporte post-MVP (`EY-152`, código duplicado) | **sin sprint** |

> Los referidos, que la reunión del 17-jul dio por "widget y poco más" (RN-21), vuelven con tres
> historias de integración real. `EY-148` es la primera que **toca nuestro backend**: un webhook que
> Referral Factory llama para calificar al referido. — ⚠️ **Corregido el 7-ago:** al mirar la campaña
> se vio que **la integración Stripe ↔ RF de la propia herramienta ya hace eso**, así que `EY-148`
> apunta a caerse y RN-21 se sostiene. Lo que sí hay que rehacer es `EY-79` (`US-1302`). Ver EP-13 en
> §2 y §4.5.

**Interruptores por variable de entorno.** Cada vez más funciones quedan cableadas y **apagadas hasta
que llegue su credencial** — sin ella no rompen, no se pintan (o fallan **cerrado**, con 503, si lo que
hay detrás borra o cobra). Eran tres el 29-jul; al 7-ago son estas:

| Variable | Enciende | Dónde falta |
| :-- | :-- | :-- |
| `DAILY_API_KEY` | sala real de Daily (sin ella, sala simulada) | — |
| `NEXT_PUBLIC_REFERRAL_URL` | bloque "Invita y gana" (`EY-78`) | **Vercel** (está en local) |
| `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` | monitoreo de errores (`EY-80`) | — |
| `CRON_SECRET` | los **tres** crons (purga `EY-86`, correo `US-1201`, reembolsos X-01) — **sin ella responden 503 y no corren** | ✅ **puesta**: Vercel ya la tenía, GitHub desde el **30-ago** |
| `STRIPE_API_KEY` + `STRIPE_WEBHOOK_SECRET` | checkout y webhook de Stripe (`EY-93`/`EY-95`) | ✅ ya en Vercel, scope **Preview** |
| `RESEND_API_KEY` | envío real de correo (`US-1201`) — sin ella la cola se queda `pending`, no `failed` | ✅ **puesta el 17-ago** (local, Preview y Production) |
| `REFERRAL_FACTORY_API_KEY` | ⚠️ **nada — no la lee ningún fichero de `src/`** (1-sep). Esta celda decía «atribución de referidos contra la API de RF» y esa atribución no está escrita | — (no hace falta en Vercel) |
| `APP_BASE_URL` (variable de repo en GitHub) | los workflows de correo y de reembolsos | ✅ **puesta el 30-ago** (`https://ensenameya.vercel.app`), tras **30 corridas en rojo**. ⚠️ Y la cadencia que entrega GitHub es **una cada 2-6 h**, no los 5/15 min que piden los `cron:` |

**Decisiones del cliente (`C-xx`) al 7-ago.** **Resueltas:** C-01 (proveedor → **DLocal + Stripe**; lo
que bloquea el Sprint 6 AC son las **cuentas y claves**, no la decisión), C-03 (RN-37), **C-14** (los
7 documentos de KYC, cerrada por UX-203) y **C-11/DP-05** (proveedor de correo → **Resend**, resuelta
el 6-ago; ver EP-12 en §2). **Siguen abiertas:** C-02, C-04, C-05, C-06, C-07, C-09, C-10, C-12,
**C-13** y C-15.

**Camino a producción.** ~~`main` y `origin/dev` están en el mismo commit (`57edfa9`) y hacen falta dos
merges.~~ → **Corregido el 7-ago:** el **PR #11 se mergeó** (`1a36da2`, 5-ago), así que todo lo de esta
sección está en `dev` (hoy `3529655`). Queda **un solo merge, `dev` → `main`**, y con él llegan **20
migraciones que prod no tiene** (`20260729130000` … `20260806180000`) — 12 de esta sección más las **8**
del 5–6 de agosto, ver §4.5.

### 4.5 Sincronización 2026-08-07 — el PR #11 ya está en `dev`, y dos días más encima

**El PR #11 se mergeó** (`1a36da2`, 5-ago). Todo lo que §4.4 daba por "esperando merge" vive ya en
`dev`. Encima entraron el **5 y el 6 de agosto** dos jornadas de trabajo que **mueven el estado de
nueve historias**, resuelven **C-11** y **cambian el alcance de EP-13**. Detalle commit a commit en
`docs/PLAN-DESARROLLO.md`; aquí queda la correspondencia con el backlog.

**Estado de las historias tocadas**

| Jira | Historia | Cómo queda |
| :-- | :-- | :-- |
| `EY-116` | DD-06 · páginas legales | ✅ **Completada**: de "documento en preparación" a texto redactado (`4cf2ca6`→`b957933`). Ver la fila de DD-06 en §4.3 |
| `EY-86` | US-1802 · ver y descargar grabación | 🐞 **Bug que la hacía fallar SIEMPRE, corregido** (`fffd4b5`) + la retención de 30 días ya borra de verdad (`0722b64`). ~~Sigue bloqueada por el add-on de Daily~~ → ✅ **desbloqueada**: el add-on está contratado (31-ago). Ver EP-18 en §2 |
| `EY-76` | US-1703 · purga del chat | **En `dev`** desde el merge. Sin cambios de alcance |
| `EY-77` | US-1203 · avisos in-app | **En `dev`** desde el merge. Sin cambios de alcance |
| `EY-80` | US-1501 · Sentry | **En `dev`** desde el merge; se declara en la política de privacidad (`sendDefaultPii: false`). Sigue apagado sin DSN |
| `EY-81` | US-1502 · métricas de pago/payout/webhook | **En `dev`** desde el merge. Con Stripe real, la métrica de "cobros sin evento" deja de ser teórica |
| `EY-93` | PAC-01 · checkout del proveedor | 🟡 **Hecha por la pata de Stripe**, en test mode. **No cerrable** |
| `EY-95` | PAC-03 · webhooks del proveedor | 🟡 **Hecha por la pata de Stripe**, con firma verificada. **No cerrable** |
| `EY-56` | US-703 · webhooks idempotentes | Se cerró `Done` con un criterio que no existía; **ahora sí existe**. Ver EP-07 en §2 |
| `EY-79` | US-1302 · captura de código de referido | 🔴 **`In Review`, pero su mecanismo NO FUNCIONA** con la campaña montada. Ver abajo |
| `EY-148` | RF-03 · webhook de calificación | 🔴 **Probablemente sobra.** Ver abajo |

> ⚠️ **Por qué `EY-93` y `EY-95` no se pueden cerrar aunque el código funcione.** Cada ticket está
> redactado como **"Stripe **y** DLocal" en uno solo**, así que la mitad hecha no cierra el ticket:
> `PAC-01` y `PAC-03` se quedan a medias por definición hasta que exista cuenta de DLocal. Si se
> quieren cerrar, hay que **partirlos por proveedor** en Jira; si no, cuentan como no hechos y el
> Sprint 6 AC sigue con sus 5 `To Do`.

**1) Páginas legales (`EY-116` / DD-06).** Ver §4.3 para el detalle. Lo que importa al backlog: el
texto sale de **lo que el código hace** (plazos leídos de las migraciones, reembolsos importados de
`lib/policy.ts`), apareció que **el cliente ya tenía términos publicados** en `ensenameya.com` desde
el 23-mar-2026 —de ahí el buzón `info@ensenameya.com` y su §8—, y se dejaron **dos divergencias
deliberadas** con ese texto (proveedor de pago y reembolsos). El texto se reescribió además **contra
`dev` y no contra `main`** (`b957933`): redactado sobre producción decía "la plataforma no graba las
clases" y "el borrado del chat está en pausa", dos frases que pasaban de cautas a **falsas** en el
mismo merge. **En producción las tres rutas siguen dando 404.**

**2) Seguridad — `confirm_payment` sale del alcance del cliente** (`ab0b1bf`, `20260806120000`, **S-15
/ RN-26**, toca `US-1402`). Estaba concedida a `authenticated` con un único control —"eres el dueño de
la reserva"—, así que **cualquier alumno con sesión podía marcarse el pago como cobrado desde la
consola del navegador**. Hoy no robaba nada porque el proveedor ruteado era `simulated`; el agujero se
abría **justo el día que entrase Stripe**. Y tenía un problema de fondo: comprobaba `auth.uid()`, y un
webhook no tiene usuario — la función que existe para que la llame el proveedor **era imposible de
llamar por el proveedor**. Se parte en dos: `confirm_payment` **solo `service_role`** y
`confirm_simulated_payment` para `authenticated`, que exige ser dueño **y** que `payments.provider` sea
`'simulated'`. Lo bueno del diseño: **el camino del cliente se desarma solo** cuando el ruteo deje de
ser simulado; no hay que acordarse de revocar nada el día del lanzamiento.

**3) Stripe — `PAC-01` y `PAC-03` en test mode** (`7b30768` + `3529655`, `20260806170000` +
`20260806180000`). ⚠️ **Premisa corregida:** la épica `EY-92` decía "no iniciar hasta tener **ambas**
cuentas". **No hacía falta** — con solo registrar el correo, el sandbox de Stripe da Sessions,
webhooks **firmados de verdad**, rechazos, expiraciones y reembolsos; el KYC solo bloquea *live mode*.
Construido: `lib/stripe.ts` (singleton perezoso, versión de API **fijada** a `2026-07-29.dahlia`),
`POST /api/pagos/checkout` (el importe sale de **`payments.gross_amount`**, el snapshot que congeló
`create_booking`, **nunca del navegador**), `POST /api/webhooks/stripe` y `profiles.stripe_customer_id`
(**un Customer por persona**, o Referral Factory no alcanza nunca el umbral de gasto).
✅ **Verificado de punta a punta contra la preview, con Stripe entregando el evento de verdad:** Session
creada desde la preview → expirada desde la API de Stripe → webhook entregado a través del *Protection
Bypass* de Vercel → reserva `cancelled`, pago `failed`, `pending_webhooks=0`. La regla de
`payment_routing_rules` en **dev** está ya en `'stripe'`, y cambiarla **ya no es una migración**: es un
`update` (ver la nota de `US-705` en §2).

- **Config nueva en Vercel (scope Preview):** `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`. Endpoint
  registrado en Stripe (`ensenameya-vercel`, 4 eventos de `checkout.session`) apuntando a la preview
  **con `?x-vercel-protection-bypass=…`**, porque Deployment Protection devuelve 302 **antes** de que
  corra nuestro código.
- **Anotado por si acaso:** el endpoint quedó con API version `2026-06-24.dahlia` y el código fija
  `2026-07-29.dahlia`. Irrelevante para los campos que se leen.
- **Fuera de alcance a propósito:** reembolsos por webhook (`US-704`). `refund_payment` arrastra el
  mismo bug de `has_role('admin')` que tenía `confirm_payment`, y arreglarlo bien exige decidir quién
  es la fuente de verdad del reembolso.
- 🔒 **Sigue bloqueado:** **DLocal entero** (sin cuenta) y los **payouts** de EP-10 (Connect exige KYC).

**4) Referidos — el hallazgo que cambia el alcance de EP-13.** Está contado entero en el 🔴 de EP-13
(§2). Resumen para el tablero: **`EY-79` (`US-1302`) hay que rehacerlo** —la atribución pasa a ser por
**correo** contra la API de RF, no por código propio, porque **RF no ofrece parámetro de código**— y
**`EY-148` (RF-03) hay que comprobar si sobra** antes de escribirlo, porque la integración Stripe ↔ RF
de la herramienta ya califica y descalifica al referido sola. Pendiente además, y no es código:
**redactar los términos que RF le enseña al referido**, hoy la plantilla de RF sin rellenar.

**5) Lección que mordió tres veces: `service_role` se salta la RLS, pero NO los grants de tabla.**
Este proyecto tiene *auto-expose new tables* **OFF** (ver el patrón RLS del `CLAUDE.md`), así que una
tabla sin `grant` explícito devuelve `permission denied` **en tiempo de ejecución**, no en el build.
Pasó tres veces en dos días: `sessions` (`20260806140000`), `payments`/`profiles`
(`20260806170000`) y `payment_routing_rules` (`20260806180000`). **Cualquier trabajo nuevo con
`service_role` sobre una tabla nueva se va a estrellar igual hasta que declare sus grants** — y los
tres grants se conceden **acotados** (columna a columna donde se puede), no en bloque.

**6) Arreglos de interfaz del 5-ago** (posteriores al merge, ninguno con ticket propio): el modal de
cerrar sesión se quedaba clavado en "Cerrando…" (`836a573`); testimonios y FAQ del home con anchos
fijos heredados del Figma de 1280 que sobrevivieron al full-width de R24-01 (`b8e6709`); el pomo
derecho del deslizador de precio de P04 **invertía el filtro** —regresión de `DD-04`— (`e3e2cf9`);
filtros y navegación mezclados en la misma píldora del hero de `/classes` (`54f8abc`); y en
`794d0c7`, **dos de fondo**: un **admin veía en el sitio público las categorías desactivadas** (el
filtro se apoyaba en la RLS, y `categories_select_admin` deja al admin verlas todas — lo que se enseña
no puede depender de quién mira) y el **icono de categoría deja de vivir en el código** y pasa a ser
`categories.icon` (`20260805120000`), elegible desde el modal del panel, con la paleta de
`category-icons.ts` como **lista blanca y menú a la vez**. Toca `US-1102`.

**7) dLocal rechazó la cuenta.** Sin saber qué URL presentó el cliente. El problema de fondo **no lo
arregla ningún merge**: `ensenameya.com` es una landing de GoDaddy que **no enlaza a la app**, que vive
en `ensenameya.vercel.app`. Son **dos webs de la misma marca sin conectar, con dos juegos de términos**
(§4.3, DD-06). Es DNS y negocio, y **bloquea el PSP**.

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

*Espejo del backlog v1.0 (Faim Lab, 2026-06-24). Se sincroniza con Jira. Última edición: **2026-08-07**
(**§4.5 nueva — el PR #11 mergeado (`1a36da2`, 5-ago) y el trabajo del 5–6 de agosto**. Corregido lo que
había quedado desfasado: ya **no** hacen falta dos merges sino **uno** (`dev` → `main`), y no son 12
migraciones sin aplicar en prod sino **20**; `main` sigue en `57edfa9` y `dev` en `3529655`. Historias
movidas: **DD-06 `EY-116`** completada con texto legal redactado —y el hallazgo de que el cliente ya
tenía términos publicados en `ensenameya.com`—; **`EY-86` US-1802** con el bug del nombre de sala que la
hacía fallar el 100 % de las veces y la purga de grabaciones que ahora borra de verdad; `EY-76`, `EY-77`,
`EY-80` y `EY-81` ya en `dev`; **`EY-93` PAC-01 y `EY-95` PAC-03 hechas por la pata de Stripe pero NO
cerrables**, porque cada ticket pide Stripe *y* DLocal en uno solo; **`EY-56` US-703**, cerrada `Done`
con el criterio "verifico firma" cuando no había firma que verificar, y que **ahora sí** la verifica.
🔴 **Alcance de EP-13 cambiado**: `EY-79` US-1302 está en `In Review` y su mecanismo **no funciona** con
la campaña de Referral Factory, y `EY-148` RF-03 **probablemente sobra**. Resueltas además **C-11**
(correo → Resend) y el reparto de `confirm_payment` (S-15). Previo: **2026-08-04**
(**§4.4 — sincronización de todo lo posterior al 24-jul**: EP-24 / `R24-01…23`, `R29-01…04`, las 6
tandas del 29-jul —Sprint 7 y 8 enteros, hoy en `In Review`—, los 4 compromisos del 24-jul resueltos en
código, la limpieza de código muerto y **`DD-04` rehecho** sobre la vista `tutors_public`. Corregido:
las 6 IV están en `Done` desde el 27-jul y no en `In Review`; `EY-109` hizo falta arreglarlo **dos
veces** (el bueno es del 27-jul); US-202 y UX-204 ya no están pendientes; las páginas legales ya no dan
404; **las 8 DD cerradas**; la tarjeta "Grabación" de TU08 es **US-1802** y está construida. Añadidos
EP-24 y el duplicado `EY-152`, los 5 tickets nuevos (`EY-148…151`, `EY-153`) y los interruptores por
variable. ⚠️ Nada de esto está en producción: `main` = `dev` = `57edfa9` y todo espera en el **PR #11**,
con 12 migraciones sin aplicar —*superado por la edición del 7-ago*. Previo: 2026-07-24 (revisión nodo a nodo **COMPLETA del Figma**: P01–P09 + `/categories`, AL01–AL08, TU01–TU09 y **AD01–AD15** (panel admin: AD02 y AD14 son pantallas nuevas, migración `admin_charts` en dev); **DD-01 y DD-02 cerradas** y **DD-05 reducida**; cifras, testimonios y calendario público servidos con datos reales; 4 migraciones nuevas; 🐞 catálogo público vacío para `anon` corregido y 🐞 `searchProducts` sin tutor — **faltan abrir sus tickets en Jira**, y los huecos nuevos de P07/P08 bajo EP-23))).*
