# Enséñame Ya — Backlog (fuente de verdad de *alcance y sprints*)

> **Master del "qué y cuándo".** Deriva del documento *Backlog Completo + Definición Sprint 1*
> (v1.0 · 2026-06-24 · Faim Lab) y está **cargado en Jira**. Jira es la fuente operativa;
> este `.md` es su espejo versionado en git.
>
> - El **"cómo" técnico** vive en `docs/context/` (Docs 00–09). Ante divergencia de detalle, manda la migración.
> - Los **deltas** que este backlog v1.0 introduce sobre los Docs 00–09 están en `docs/context/ADENDA-BACKLOG-v1.md` **y** resumidos en §7.
> - El **estado de ejecución** (qué está hecho, en curso, pendiente) vive en `docs/PLAN-DESARROLLO.md`.
> - 🔴 **En cobro y payout manda `docs/DICTADO-PAGOS.md`** (9-sep-2026, aprobado por el cliente):
>   deroga todo criterio de aceptación de este archivo que lo contradiga. Los ocho que contradice
>   están en **§2.1**.

| Indicador | Valor |
| :-- | :-- |
| Épicas | **28** — EP-00 + EP-01…EP-24 (v1.0 y tracks paralelos) + **EP-25/EP-26/EP-27** (§4.4) |
| Historias | **66** en §2 (60 de dev + 6 de diseño en EP-00) + 1 bug (`EY-109`) + **15 fichas** en EP-25/26/27 |
| Criterios de aceptación superados por el código desplegado | **8**, todos de reserva, checkout y pagos → **§2.1** |
| Puntos estimados | 259 SP (backlog dev original EP-01…EP-18) |
| Historias Must | 40 |
| Sprints | 4 de dev en el docx original; en Jira van **8** (S1…S5 + 6 AC · 7 · 8) + EP-00 pre-desarrollo + los tracks paralelos |
| Ficha abierta | **`EY-187`** (área verificada), y su pregunta al cliente **P-7** sin contestar → §4.4 |

### Dónde estamos

- **Las 60 historias de dev de §2 están en producción.** `main` lleva el código y las **178
  migraciones** desplegadas.
- ✅ **El sitio está abierto desde el 10-sep.** `ensenameya.com` sirve la app entera; `www` y
  `ensenameya.vercel.app` son 308 hacia él. La migración de dominio ya no es un pendiente. Lo que
  sigue cerrado a propósito es **la indexación**: `robots.ts` mantiene `Disallow: /` hasta que haya
  tutores publicados, porque que el sitio funcione y que Google lo indexe son decisiones distintas.
  Producción tiene **un usuario**, y es una cáscara anonimizada de un alta de prueba dada de baja el
  mismo día.
- **El dictado de pagos del 9-sep-2026 reestructuró cobro y payout, y ya está desplegado** (11
  migraciones `20260910*`). Lo que fija:
  1. la pasarela de **cobro** la decide el país del **alumno** —`ruta_de_pago(payer_country).charge_providers`—
     y el **payout** el del **tutor** —`ruta_de_pago(payee_country).payout_providers`—;
  2. el **checkout vive siempre dentro del sitio**: dLocal transparente, sin redirect;
  3. el tutor ve **dos tarjetas**, PayPal y Banco, y detrás de Banco compiten **Wise, dLocal y
     Stripe** sin que él vea cuál ejecutó — la cuenta bancaria por **Stripe Connect salió del
     producto y del código**;
  4. los métodos **manuales** (Binance, Zinli, Zelle) son **solo Venezuela**.
- ✅ **Producción tiene las claves de dLocal desde el 10-sep**, más `DLOCALGO_API_BASE`. Medido: el
  webhook pasó de **503** a **400**. La credencial es el interruptor y ya está puesto.
- **EP-25, EP-26 y EP-27** —las épicas que nacieron de las listas del cliente de agosto y que este
  espejo no recogía— están cerradas **salvo `EY-187`**. Sus 15 fichas, con lo que cerró cada una,
  en **§4.4**. Las fichas que abrió la auditoría de septiembre, en **§4.5**.

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
| EP-20 | Activación Comercial — DLocal + Stripe reales · Jira EY-92 | M | — | ✅ Desbloqueada (4-sep-2026): las dos cuentas operativas |
| EP-21 | UX Onboarding Continuo del Tutor · Jira EY-97 | S | — | Track UX (paralelo) |
| EP-22 | Sprint Integración Visual — Look & Feel · Jira EY-102 | M | — | Track visual (paralelo, **dev**) |
| EP-23 | Datos que el diseño necesita y no existen · Jira EY-110 | S | — | Derivada de EP-22 |
| EP-24 | Ajustes reunión 24-jul · Jira EY-119 | M | — | `R24-01…23` — nació de la demo con el cliente. Detalle en `docs/PLAN-DESARROLLO.md` |
| EP-25 | Carrito y pedido multilínea | M | — | Post-v1.0 · nace de las listas del cliente (ago-2026). Ver §4.4 |
| EP-26 | Trabajo mayor — afinidad, calendario, moderación, baja de cuenta | S | — | Post-v1.0. Ver §4.4 |
| EP-27 | Soporte técnico al usuario (post-MVP) · Jira EY-152 | C | — | Post-v1.0. Ver §4.4 |

> **`EY-152` está mal titulada en Jira:** se llama "EP-23 Soporte Técnico al Usuario (Post-MVP)" y
> reusa el código **EP-23**, que ya es `EY-110` (datos que el diseño necesita). Aquí esa épica es
> **EP-27**, el número que también usa `docs/PLAN-DESARROLLO.md`, y **EP-25** es el carrito. De ella
> cuelga `EY-153` (SUP-01), cerrada.

---

## 2. Historias por Épica

Cada historia: **descripción · criterio de aceptación (condensado) · refs de trazabilidad**.
**⛔** marca un criterio **superado por el código desplegado**; el motivo de cada uno, en **§2.1**.

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
| US-203 | KYC del tutor (identidad ampliada) | M | 8 | S1 | Subo **seis** documentos —`cv`, `degree`, `id_document`, `certificate`, `diploma`, `transcript`— → `identity: pending`; recibo NTF-06. Las redes **no son documento**: viven en `tutor_profiles.socials` (R29-02). | SCR-TU02, M2/M8, NTF-06, C-14 |

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
| ⛔ US-601 | Elegir horario disponible | M | 5 | S2 | Slots en hora local; paquete = N slots; sin doble-reserva (S-41). | SCR-AL04, RN-12/32 |
| ⛔ US-602 | Pagar reserva (checkout) | M | 8 | S2 | Checkout alojado del proveedor; opción card-on-file (RN-43); al `paid` → `pending_acceptance` + NTF-04. | SCR-AL05, M6, NTF-04, RN-43 |
| ⛔ US-603 | Ver confirmación de reserva | M | 3 | S2 | Tras aceptación del tutor: resumen + sesiones creadas; recibo NTF-05. | SCR-AL06, M5, NTF-05 |
| US-604 | Cancelar reserva/sesión | M | 5 | S2 | Reembolso RN-37: ≥24h=100%, <24h alumno=50%, tutor=100%; estados a `cancelled`. | SCR-AL07, M4/M5, RN-37 |
| ⛔ US-605 | Autocancelar pagos vencidos | M | 3 | S2 | Sin pago en 20 min → `cancelled`; slot liberado; job de timeout. | M4/M6, RN-27, C-07 |
| US-606 | Aceptar/rechazar reserva en 24h | M | 8 | S2 | `pending_acceptance` → acepto (`confirmed`) o rechazo/timeout (`cancelled` + reembolso 100%); NTF-17. | SCR-TU07b, M4, RN-38 |
| ⛔ US-607 | Guardar tarjeta (card-on-file) | S | 3 | S2 | Tokenización en el PSP; nunca se guarda el PAN; token reutilizable. | SCR-AL05/G03, payment_methods, RN-43 |

### EP-07 — Pagos (Capa Agnóstica) · S2
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| ⛔ US-701 | Enrutamiento de cobro por geografía | M | 5 | S2 | PaymentRouter lee `payment_routing_rules`; sin regla activa → reserva bloqueada (RN-33). | Doc 6, RN-15/16/33 |
| US-702 | Split tutor/plataforma por tier | M | 5 | S2 | `tier_split_pct` snapshot al crear el pago; `tutor_net`/`platform_fee` server-side. | payments, RN-08, S-08 |
| ⛔ US-703 | Webhooks idempotentes de cobro/payout | M | 5 | S2 | Verifico firma (RN-34); proceso cada evento una vez; actualizo M6/M7. | Doc 6, RN-26/34 |
| US-704 | Reembolso manual (admin) | S | 3 | S3 | Reembolso total/parcial desde SCR-AD08; ejecuta `service_role`; NTF-10. | SCR-AD08, DP-03, M6 |
| ⛔ US-705 | Nuevos proveedores sin tocar el core | M | 3 | S2 | Alta de adaptador + fila en `payment_routing_rules`; sin migración ni cambio de negocio. | Doc 6, RN-16, DP-01 |

> **`US-703` · la firma existe y se verifica en los dos webhooks.**
> `POST /api/webhooks/stripe` y `POST /api/webhooks/dlocalgo` leen el **cuerpo crudo** (`req.text()`,
> no `req.json()` — un parse+stringify reordena claves y rompe el HMAC), responden **400** si la
> firma no valida —nunca 500, o el proveedor reintenta tres días un payload que jamás va a validar—
> y **503** si falta su secreto. Son **dos rutas y dos secretos**, cada una con un solo camino: lo
> que separa a los dos proveedores es la firma, así que no comparten endpoint.

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
| US-1106 | Ver alertas e incidencias | S | 2 | S3 | Pagos `failed`, payouts en incidencia y disputas listadas en SCR-AD14, con acuse por `alert_acks`; NTF-13. | SCR-AD14, NTF-13, RISK-16/21 |

> **`US-1106` llega del Doc 8 (§8.3), la única de sus 34 historias que este espejo no tenía.** Sostiene **RISK-16** (chargebacks / disputas) y **RISK-21**
> (conciliación multi-proveedor), que sin ella no tienen superficie donde aterrizar. Construida en
> parte: `/admin/alertas` deriva las alertas de datos reales (pagos `failed`, payouts
> `failed`/`on_hold`, cancelaciones) y `alert_acks` guarda el acuse. Lo que falta es **NTF-13**: no
> lo encola ninguna migración, así que hoy las incidencias solo se ven entrando al panel.

### EP-12 — Notificaciones · S3
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1201 | Emails transaccionales | M | 5 | S3 | Cada NTF-01..**23** dispara su email una vez (RN-36); fechas en hora local del destinatario (RN-35). | Doc 7, notifications |
| US-1202 | Registro idempotente de envíos | M | 5 | S3 | Tabla `notifications` con `event_key` único; estado queued/sent/failed/skipped; reintento. | Doc 7 §7.5 |
| US-1203 | Avisos in-app | C | 3 | S4 | Banners/lista desde `notifications`; campo `read_at`. | SCR-AL02/TU06, S-48/50 |

> **NTF-21** (`EY-151`) cerrada: un mensaje nuevo avisa por correo con un `trigger after insert on
> messages` —y no dentro de las RPC de envío, que cambiaron tres veces— agrupado con techo de
> **1/hora por hilo**. Con ella el catálogo del Doc 7 llega a **NTF-01..23**: NTF-22 es el correo
> con el que el admin escribe a un alumno o a un tutor desde la bandeja de moderación, y NTF-23 el
> aviso de un payout reclamado y sin cerrar.
>
> **`US-1201` envía de verdad.** El acoplamiento vive entero en `lib/email.ts` (**Resend**, C-11 /
> DP-05 resueltas: es el único de los tres candidatos que deja enviar y probar **sin dominio
> verificado**); `process_notifications()` **solo informa** y el envío real lo hace
> `/api/cron/notifications-send` por GitHub Actions, porque Vercel Hobby limita los crons a uno al
> día y un aviso de "tienes 24 h para aceptar" que llega mañana no sirve. ⚠️ El `cron:` pide 5
> minutos y **GitHub entrega una corrida cada 2-6 h**: no se puede planificar con el número del
> fichero.

### EP-13 — Referidos · S4
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1301 | Widget de referidos | S | 3 | S4 | ~~Widget Referral Factory en AL02/G03~~ → **rehecha el 11-sep como pantalla nativa `/referidos`** (Referidos v2): igual para alumno y tutor, pintada entera desde nuestra base, con enlaces propios, QR, historial de invitados y `/admin/referidos` para decidir qué campañas se ven. Sigue **sin lógica interna** (RN-21): reglas, montos y pago viven en RF. | FL-04, Doc 6 §6.12, `20260911120000` |
| US-1302 | Captura de código de referido | S | 2 | S4 | Capturo `?ref=` al registro → `profiles.referral_code`; sin lógica de comisión interna. ✅ **Y desde el 11-sep el `?ref=` llega de verdad**: el código es el del referidor en Referral Factory y el enlace lo emitimos nosotros. | profiles.referral_code, S-18 |

> ✅ **LA ATRIBUCIÓN DE REFERIDOS EXISTE DESDE EL 11-SEP-2026.** El párrafo que había aquí decía lo
> contrario —«no existe, y no está a medias»— y era verdad hasta ese día; se resume ahora en pasado
> para que nadie se lo lleve por delante. El nudo era que la landing de RF no redirige de vuelta, así
> que el `?ref=` **no llegaba nunca** y `profiles.referral_code` quedaba null siempre.
>
> **Se deshizo emitiendo nosotros el enlace.** El recorrido: `/referidos` da de alta al usuario como
> referidor en RF (`POST users`) y guarda su código en `referral_memberships` → el usuario comparte
> `https://<origen>/?ref=<code>` → el proxy lo guarda en la cookie `ey-ref` (30 días, sin cambios) →
> el alta lo aterriza en `profiles.referral_code` (sin cambios) → el cron
> `/api/cron/referrals-sync` detecta la conversión —alumno: primer pago; tutor: primera sesión
> completada— y la manda a RF. Esquema en `20260911120000_referidos_nativos.sql`.
>
> **Y las campañas son tres, no una:** **50785** (alumnos) y **50784** (tutores), visibles, y la
> vieja **50297**, que entra en el seed no visible. «Solo existe la 50297» y «no existe la campaña de
> tutores» eran ciertas hasta el 10-sep y hoy no lo son.
>
> ⚠️ **El interruptor cambió**: era la URL (`NEXT_PUBLIC_REFERRAL_URL` y sus tres hermanas, ya
> retiradas del código) y ahora es la credencial **`REFERRAL_FACTORY_API_KEY`**, server-only. **Está
> borrada de Vercel desde el 10-sep**, así que hoy la funcionalidad está apagada **sin que nada se
> ponga rojo**: la pantalla carga con su aviso y el cron responde `sin-credencial` con **200**, con
> lo que el workflow de GitHub sale en verde sin haber hecho nada. Reponerla y los otros cuatro
> puntos de gestión están en `docs/ENTORNOS.md` §3 C.1.
>
> ⚠️ Lo que **sigue abierto en C-10** es el dinero: cuánto gana quien refiere y quien es referido. Los
> `reward_text` del seed son **ejemplos sin aprobar** y hoy se le prometen al usuario tal cual
> (DP-32.1); se editan desde `/admin/referidos` sin tocar código.
>
> **`EY-148` (RF-03) se cerró sin código:** la integración nativa **Stripe ↔ Referral Factory** de
> la propia herramienta ya califica al referido por gasto acumulado de un Customer y lo descalifica
> al reembolsar, que es exactamente lo que iba a hacer el webhook propio. Por eso el checkout
> reutiliza **un Customer por persona** (`profiles.stripe_customer_id`): con cinco fichas distintas,
> cinco compras de 20 USD no alcanzan ningún umbral. **RN-21 ("sin lógica interna") sigue en pie.**
> ⚠️ **Al 11-sep esto ya no es lo que califica.** Quien marca la conversión es **nuestro** cron
> (`/api/cron/referrals-sync`, `PUT users/{id}` con `qualified: true`), así que `RF-03` vuelve a
> tener código aunque no sea un webhook —RF no los tiene: sus endpoints `webhooks` y `events` dan
> 404—. **`EY-149` (RF-04, alta automática en RF) también quedó hecho**: lo hace `/referidos` al
> abrirse por primera vez. El que sigue sin escribir es **`EY-150` (RF-05, aviso al referidor)**: hoy
> el referidor se entera abriendo la pantalla.
> Y queda un bloqueante que no es código: los términos que RF le enseña al referido son **su
> plantilla sin rellenar**, y ahora hay texto propio del que copiarlos (DD-06). Pesa menos —la
> pantalla nativa ya no manda a nadie a la landing de RF— pero la **50297 sigue `launched` en RF** y
> su landing sigue aceptando altas hasta que se apague.

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

> **`US-1703` borra de verdad** (30 días, mensaje **y** adjunto, `20260729180000`), y `US-1702` es
> la descarga previa que pidió la decisión 22 del cliente: `GET /api/chat/[id]/download` apoyado
> **en la RLS**, no en comprobaciones a mano.

### EP-18 — Grabación de la Sesión (v3) · S4
| US | Historia | MoSCoW | SP | S | Criterio de aceptación | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| US-1801 | Grabar sesión con consentimiento | S | 8 | S4 | Sin consentimiento de ambos no se graba (RN-42); consentimiento antes de entrar a la sala; add-on Daily de pago. | SCR-LV01, M9, RN-42 |
| US-1802 | Ver y descargar grabación 30 días | S | 5 | S4 | Disponible 30 días desde `completed_at`; luego `expired` y purgada; NTF-19. | M9, SCR-AL03/TU08, NTF-19 |

> ⛔ **`US-1801` está superada por la decisión del cliente del 2-sep-2026: se graba SIEMPRE.**
> `recording_allowed()` devuelve `true` desde `20260902100000` y la casilla de la sala pasó de
> "Acepto" a "Entiendo" — grabación **obligatoria y notificada**. La regla anterior ("sin
> consentimiento de ambos no se graba", RN-42) comprobaba en la práctica «los dos entraron» y dejaba
> sin grabar justo la clase con un no-show. La tabla `session_recording_consents` y el parámetro de
> la función se conservan para tener un solo sitio donde volver a poner excepciones.
>
> **`US-1802` funciona, y el fallo que la tenía muerta era de nombre de sala.** `join_session`
> bautiza la sala `'ey-' || replace(id::text,'-','')` **sin guiones** y la ruta la buscaba **con
> guiones**: no coincidían nunca, así que la interfaz decía "esta clase no se grabó" con Daily bien
> configurado. El arreglo no es replicar el `replace`, es **leer `sessions.daily_room_name`**, que la
> BD ya guarda. Columna a `null` = nadie entró nunca a la sala.
>
> **La retención de 30 días borra**, no solo tapa: job diario `/api/cron/recordings-purge` (Vercel
> Cron, 04:00) + `sessions.recordings_purged_at`. ⚠️ Y **`recordings_purged_at` a `null` no es un job
> roto**: con la sala más antigua terminada el 14-ago, la primera purga vencía el 13-sep, así que no
> había tenido nada que hacer. Lo que sigue sin demostrarse es que funcione **cuando le toque**, y esa
> retención es la que prometen las páginas legales.
>
> ⚠️ **`enable_recording:"cloud"` solo enciende el BOTÓN de grabar, no graba.** Quien arranca es
> `start_cloud_recording` en el token (`mintToken`); Daily no tiene propiedad de sala para esto.

---

## 2.1 Criterios de aceptación superados por el código desplegado

Ocho de los 60 criterios de §2 describen un producto que **ya no es el que corre**. No están mal
escritos: eran ciertos en v1.0 y los derogó trabajo posterior —el **carrito y el pedido multilínea**
de `EY-176` y el **dictado de pagos** del 9-sep-2026—. Se dejan con su texto original y marcados
**⛔**: reescribirlos borraría el contrato que el cliente firmó.

| Historia | Lo que decía | Lo que hace el código | Quién lo derogó |
| :-- | :-- | :-- | :-- |
| **US-601** | un horario → **una** reserva | la selección puede ir a un **carrito** (cookie `ey-cart`, solo ids e instantes, nunca precios) con líneas de **varios tutores**, y cada línea es una reserva de un pedido | `EY-176` / `EY-177` |
| **US-602** | "**checkout alojado** del proveedor" | el checkout vive **dentro del sitio**: dLocal monta el formulario de tarjeta en nuestra página (`modo: "transparente"`), y el `redirectUrl` solo queda como salida de respaldo | dictado §2 |
| **US-603** | confirmación de **una** reserva | la confirmación es del **pedido**: `orders` + `bookings.order_id` (`20260827150000`), y `confirm_order_payment` recorre **todas** las líneas del cargo | `EY-176` |
| **US-605** | "sin pago en **20 min** → `cancelled`" | el hold es de **7 minutos** (`20260826120000`, V-3). El otro corte, las 24 h de RN-38, no se tocó | V-3 del cliente |
| **US-607** | "tokenización **en el PSP**" | las tarjetas guardadas son **solo de Stripe** y **no pasan por el puerto de pagos**: el vault no tiene equivalente garantizado en dLocal, así que un alumno ruteado a dLocal no tiene card-on-file | decisión de arquitectura (PAC-02) |
| **US-701** | ruteo por la geografía **de la reserva** | **dos preguntas y dos países**: el cobro se busca con el del **alumno** (`payments.payer_country`) y el payout con el del **tutor** (`tutor_profiles.payout_country` → `payee_country`). La columna `payer_country` de `payment_routing_rules` no interviene: `ruta_de_pago()` filtra `payer_country is null` | dictado §1 |
| **US-703** | "proceso cada evento **una vez**" | una vez **por línea**: `payment_webhook_events` pasó de `primary key (event_id)` a **`(event_id, booking_id)`** (`20260827160000`), porque un evento acredita N reservas. Con la clave vieja se confirmaba una y las demás morían a los 7 min, cobradas y sin clase | `EY-176` |
| **US-705** | "fila en `payment_routing_rules`; **sin migración**" | **tocar `payment_routing_rules` es una migración** (regla de oro 5). `20260904190000` declara el ruteo entero justamente porque hacerlo con `UPDATE`s a mano tuvo a dev cobrando por dLocal y a producción por `simulated` durante semanas | dictado + regla de oro 5 |

Además, **fuera de reserva y pagos**, dos criterios corregidos en su propia fila de §2: **US-203**
(seis documentos de KYC, no siete: las redes viven en `tutor_profiles.socials`) y **US-1801** (se
graba **siempre** desde el 2-sep-2026, no con consentimiento de ambos).

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
  dos últimos sprints, y en Jira acabaron en el **Sprint 8**. S4 pasa de 10 historias / 39 SP a
  **8 / 34**.

**Estado.** S1…S5 cerrados; **6 AC · 7 · 8** siguen abiertos en Jira a la vez, con las 60 historias
de dev **ya en producción** — el tablero va por detrás del código, no al revés. Del Sprint 6 AC
(activación comercial) no queda nada bloqueado por credenciales, y desde el **10-sep** menos aún:
Stripe lleva claves **live** con su webhook de live (⚠️ falta el KYC del cliente para que un cobro no
se rechace), dLocal tiene **credenciales de producción** puestas, PayPal también —con `Payouts`
habilitado y Log In with PayPal configurado, a falta de la revisión de su app— y Wise tiene el token
en Production. `PAC-01` y `PAC-03` **no son cerrables como están redactadas**: cada ticket pide
"Stripe **y** DLocal" en uno solo, así que hay que partirlos por proveedor en Jira o cuentan como no
hechos.

### 4.1 Tracks paralelos (fuera de S1–S4)

No consumen SP de los sprints de dev. Se filtran en Jira por label.

| Track | Épica | Jira | Estado | Nota |
| :-- | :-- | :-- | :-- | :-- |
| `Sprint-Diseño` | EP-19 | EY-88…91 (DS-01…04) | **In Review** (Diana Rivera) | Entregable Figma, no código. Precede al rediseño visual de pantallas ya construidas. |
| `Sprint-Activacion-Comercial` | EP-20 | EY-93…96 (PAC-01…04) + `EY-147` | 🟡 **A medias**, y por redacción de los tickets, no por bloqueo | C-01 decidida: **DLocal + Stripe** (y con el dictado, PayPal y Wise). Cobran **Stripe** y **dLocal**; pagan **PayPal**, **dLocal**, **Wise** y **Stripe** —éste como tercer riel de la tarjeta de Banco, siempre **después de Wise** (decisión D-1 aprobada)—. ⚠️ Wise alcanza **55 países** por `payout_country_rules`, por **formato de cuenta**; **no Venezuela**; **sí Panamá** (USD a USD). ⚠️ El fondeo de Wise depende de que operaciones deje saldo: es tarea diaria de operación, no límite del diseño. Ver §2.1 y `docs/DICTADO-PAGOS.md` |
| `Sprint-Mejoras-UX` | EP-21 | EY-98…101 (UX-201…204) | ✅ **Done** (ninguna aparece ya entre los `To Do`/`In Review`) | Redefinía US-201/202/203 — **ya ejecutado**, ver aviso abajo. |
| `Sprint-Integracion-Visual` | EP-22 | EY-103…108 (IV-01…06) | **Las 6 IV en `Done` desde el 27-jul** · en prod 2026-07-22 | **Código.** Aplica el Figma sobre pantallas ya funcionales. Ver §4.2. |
| — | EP-23 | EY-111…118 (DD-01…08) | **Las 8 cerradas** | Huecos de modelo destapados por EP-22. Ver §4.3. |
| — | EP-24 | EY-119 (`R24-01…23`) | ✅ Ejecutada (12/12 + 11/11, 24→27-jul) | Ajustes de la reunión del 24-jul. Detalle en `docs/PLAN-DESARROLLO.md`. |

> **EP-21 no era documentación: era alcance nuevo sobre historias cerradas, y se ejecutó en código.**
> **UX-203** amplió el set de documentos de KYC (`20260715130000`, más `20260724130000`/`20260724130100`
> para el borrador de TU02) y con ello **C-14 queda cerrada** — en **seis** documentos, no siete.
> **UX-202** es el asistente secuencial (`tutor-onboarding-form.tsx`), con la verificación dentro como
> penúltimo paso (R24-15) y los materiales fuera (R24-16); `EY-183` le metió después la disponibilidad
> como paso 4 de 6. **UX-204** es el gate del 27-jul (`66f70e0`): sin al menos una oferta creada,
> "Finalizar" sale deshabilitado con copy bloqueante y CTA "Crear mi primera oferta".

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
  público, con **texto redactado** desde el 6-ago (`4cf2ca6` → `b957933`) y **200 en producción**
  (verificado; llevaban meses en 404).
- Acceso: el MCP de Figma se agota con asiento *View*; usar `FIGMA_API_KEY` (`.env.local`) contra la
  REST API. El token es **personal de Diana Rivera** — si lo rota, se cae el acceso.


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
| DD-06 | EY-116 | ✅ **Cerrada (29-jul, `8d8ddb2`) y luego sustituida por el texto del cliente** — `/terms`, `/privacy` y `/cookies` existen y responden **200 en producción**. Desde el 17-ago los **Términos y Condiciones son el contrato que redactó el cliente** (39 secciones, inglés y español) y viven en `src/components/legal/terms-content.ts` con su propia página; `legal-doc.tsx` se queda con **privacidad y cookies**, que siguen siendo texto nuestro escrito desde el funcionamiento real del sistema. La garantía de que los **% de reembolso no divergan de `lib/policy.ts`** no se perdió al cambiar de texto: se comprueba en `terms-content.check.ts` (`npm run check:terms`). 🔍 **Hallazgo que disparó el cambio:** el cliente **ya tenía** términos y privacidad publicados en `ensenameya.com` (GoDaddy, marzo-2026) y nadie los había mirado — de ahí el buzón oficial **`info@ensenameya.com`**. ✅ **Y el 10-sep se acabaron los dos contratos vivos:** `ensenameya.com` pasó a servir la app, la landing de GoDaddy dejó de publicarse y con ella su juego de términos de marzo. Queda un solo contrato, el del cliente | todas |
| DD-07 | EY-117 | ✅ **Cerrada (27-jul, `b09e518` / R24-21)** — burbuja flotante **solo con sesión** (RN-41), tipo bandeja: los hilos por reserva sin entrar a la sesión. Reconcilia el FAB del Figma con el error de diseño documentado arriba | todas, con sesión |
| DD-08 | EY-118 | ✅ **Cerrada en Jira** (`Done`) — 🐞 Seed de dev: ratings sembrados sin filas en `reviews`. Era dato de semilla, así que **no deja commit ni migración que citar** | dev/QA |

**Las 8 están cerradas y en producción.** Ninguna sigue abierta.

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
| **Cuenta de cobro del tutor** | TU09 | ✅ **Cerrado**: `tutor_payout_accounts` (`20260901160000`) la guarda, `payout_country_rules` dice qué campos pide cada país y `payout_banks` contra qué lista de bancos se valida. El tutor ve **dos tarjetas** —PayPal y Banco— y no ve cuál de los tres rieles de Banco ejecuta |
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
- **Países pendiente de C-13.** La cifra de la home se deriva de la zona horaria. Los campos reales
  ya no son un literal: `payee_country` sale de `tutor_profiles.payout_country` y `payer_country` de
  la zona horaria del alumno (`20260908130000`, `20260910120000`).


### 4.4 EP-25 · EP-26 · EP-27 — las épicas posteriores al backlog v1.0

No vienen del docx v1.0: nacieron de las listas del cliente de agosto de 2026, cuyas actas y decisiones
están consolidadas en `docs/PLAN-DESARROLLO.md`. Sus fichas se evaluaron
una a una contra el código antes de escribirse; **están cerradas todas menos `EY-187`**, y lo que
cerró cada una es esto.

#### EP-25 · Carrito y pedido multilínea

| Ficha | Qué pedía | Con qué cerró |
| :-- | :-- | :-- |
| `EY-176` · B3.1 | Motor de cobro por línea de compra | Cabecera **`orders`** + `bookings.order_id` (`20260827150000`). **Un pago por línea**, no un pago con varios `payout_items`: `payments_select_tutor` autoriza por `booking_id`, así que con un pago compartido **cada tutor vería el importe total del pedido**. Tres decisiones de producto: **todo o nada** (las N reservas nacen en una transacción y se dice cuál línea falló), **el carrito no retiene** (el reloj de 7 min arranca al entrar al pago, las N líneas comparten `created_at` y el cron las vence juntas) y **un cargo con N `line_item`**. Los dos fallos que cerró: `payment_webhook_events.event_id` era clave primaria —un evento confirmaba UNA reserva y dejaba las demás muriendo cobradas y sin clase— y pasa a `(event_id, booking_id)` (`20260827160000`); y `late_payment_refunds.provider_payment_id` es `not null unique`, así que el criterio de X-02 pasa a ser «¿lo esperan **todas** las líneas?» |
| `EY-177` · B3.2 | Checkout en 3 pasos | Selección → revisión → pago, **sin tocar el motor de cobro**. El carrito vive en la cookie **`ey-cart`** con solo ids de mentoría e instantes en ms —nunca precios—, así que la revisión y el contador de la cabecera son **componentes de servidor** y el proyecto sigue sin su primer estado global; y funciona **sin sesión**, porque la cookie es del navegador y sobrevive al registro. La revisión relee cada línea contra la base y distingue si el hueco sigue libre, si ya pasó, si la mentoría se despublicó o si es un hold propio a medio pagar. Dos marchas atrás asumidas: vuelve una pantalla en medio (N-33) y hay indicador de pasos, puesto en la página y no en el layout |
| `EY-178` · B3.3 | Añadir sin salir, animación y contador | `EY-177` ya traía dos de las tres. Falta la animación: la insignia **salta solo cuando el número sube** —un acuse que también salta al perder algo deja de significar «hecho»—, con los keyframes **dentro de `@theme`** (Tailwind v4 descarta los sueltos y la animación saldría quieta sin avisar) y apagada con `prefers-reduced-motion` |
| `EY-179` · B3.4 | Dos selectores fijos, sin cambio de tamaño | Mentoría y hora pasan de tarjetas y chips a `<select>`; el título deja de cambiar al seleccionar. El panel sigue siendo **100 % de servidor** y el estado sigue siendo la query: lo único de cliente recibe cadenas con el `href` ya calculado. Caen tres de las ocho fuentes de salto de altura sin ir a por ellas. ⚠️ **Coste inseparable de lo pedido:** los chips eran enlaces y funcionaban sin JavaScript; un `select` con `onChange` no |
| `EY-180` | El CTA de reserva no se esconde bajo el pliegue | Cerrada, y con una lección: el primer arreglo de escritorio partía de una **premisa falsa** —`lg:sticky` nunca tuvo recorrido en ese panel— y el `max-h`+`overflow` que se añadió convirtió el panel en contenedor de scroll, con la barra opaca tapando **11 de 15 chips de hora** y comiéndose sus clics. Medido antes y después |
| `EY-181` | El resumen del pedido se lee | Primero creció el resumen y la tarjeta ilustrada se quedó; después se **borró entera**: solo existía en `/reservar/[productId]/checkout` y el checkout del carrito —`/pedidos/[id]/pagar`, el que el cliente señala como diseño aprobado— nunca la pintó. Se borra y no se condiciona: era decorativa. De paso, **una consulta con `service_role` y dos llamadas a la API de Stripe menos** en cada carga. ⚠️ Anula por escrito la D-1 del 20-ago |

#### EP-26 · Trabajo mayor

| Ficha | Qué pedía | Con qué cerró |
| :-- | :-- | :-- |
| `EY-182` | Crear la primera oferta sin salir del asistente | Ya estaba hecho por **N-03** (`fee79f9`), que además hizo que el onboarding **termine** y guarde por el camino. Solo quedaba arrastre de numeración |
| `EY-183` | La disponibilidad en el asistente del tutor | Entra como **paso 4 de 6, después de la zona horaria**, y el orden es la feature: las franjas son hora de pared y las interpreta `get_available_slots` con `profiles.timezone`, que se fija en el paso 3. Al revés, un tutor de Caracas publicaría 05:00-09:00 creyendo haber puesto 9:00-13:00 |
| `EY-186` · B5.3 | Carrusel del panel: historial y mentores favoritos | **Un algoritmo, no un botón de guardar** (lo pidió así el responsable): `student_tutor_affinity()` cruza en una consulta clases dadas (6), mentorías pagadas (4) y la **reseña propia** ((nota−3)×3, o sea −6 con una estrella) por una **escalera de recencia** de cuatro peldaños — explicable al cliente y estable. La reseña no estaba entre las señales pedidas y entra por corrección: sin ella el panel invita a repetir con un tutor al que el propio alumno puso 1★. «Tutores vistos» no existía y estrena **`tutor_views`** (`20260827140000`), solo con sesión y en tres capas, con antirrebote de 30 min, una fila por par con contadores y retención de 90 días. Los topes sostienen un invariante enunciable: **mirar no puede adelantar a estudiar**. ⚠️ Esa tabla puente es la que volvió **ambiguos** los embeds de PostgREST entre `profiles` y `tutor_profiles` (regla de oro 10) |
| `EY-187` · B5.4 | Validación de área verificada del tutor | 🔴 **ABIERTA** — ver abajo |
| `EY-188` · B5.5 | Sincronización con Apple y Google Calendar | Feed `.ics` **por suscripción, no por descarga**: un fichero descargado es una foto y si la clase cambia el evento miente. Serializador de iCalendar propio, cero dependencias, con comprobación ejecutable (`npm run check:ics`). El handler **no recibe ningún id de usuario, solo un token**, y llama a `calendar_feed(text)`, que es `security definer`, así que un fallo de filtrado en TypeScript no puede convertirse en fuga. El token vive en `calendar_feed_tokens` con RLS y **cero políticas y cero grants**: no lo lee nadie por PostgREST, ni su dueño ni el admin. `pending_payment` fuera del feed, `pending_acceptance` como `TENTATIVE`, y **404 y no 401** ante token desconocido, porque un 401 hace que Calendario de Apple pida usuario y contraseña. Después, una segunda puerta —«Añadir al calendario» en la ficha y en la sala— que autoriza **solo con RLS** |
| `EY-189` · B5.6 | «Reportar conducta» en la sala + bandeja de admin | El backend de reportes existía entero desde M-12, con `set_conversation_blocked` sin llamar nunca. Faltaba el botón fuera de los hilos sin compra, en la sala, y **dónde triar**. ⚠️ El admin **no puede leer `conversations`**, y es a propósito: el chat no se lee «por soporte», para eso está el reporte, que trae el hilo con consentimiento de quien lo levanta — por eso la bandeja va por dos funciones `SECURITY DEFINER` y el hilo se pide con el id del **reporte**. Y se cerró un agujero que nadie había visto: `purge_expired_messages` borraba a los 30 días el hilo de un par sin compra y la cascada **se llevaba el reporte**, así que la bandeja perdía casos sola. Después se añadió el abanico de acciones sobre las personas del reporte —desactivar/reactivar (`set_account_suspended`, reversible, con el estado previo en `account_suspensions`) y contactar (NTF-22, reusando la cola de EP-12)— |
| `EY-192` · B5.9 | Eliminación de cuenta con anonimización | La respuesta V-10 del cliente **no se podía cumplir tal cual** (pedía borrar reservas y conservar reseñas anónimas, y `reviews.booking_id` es cascade), así que se aprobó el diseño alternativo: **no se borra nada de `bookings`/`payments`/`payouts`, se anonimiza el perfil y se cierra el acceso**. ⚠️ El rastro va en tabla aparte y **no** en una columna `profiles.deleted_at`, y eso es un hallazgo: `grant select, update on public.profiles to authenticated` es de **tabla entera**, así que cualquier columna nueva ahí nace escribible por el propio usuario vía PostgREST y un `revoke` por columna no lo arregla. La puerta de Google se cierra **borrando `auth.identities`**, no reescribiendo el correo. Después, **la baja espera al dinero**: saldo sin liquidar, `payouts` vivos o `refund_requests` en `pending` **desactivan** la cuenta y programan la anonimización (peor caso ≈ 14 días); las clases futuras vendidas como tutor **impiden pedir la baja**, porque desactivar ahí sería un interbloqueo |
| `EY-194` | FAQ heredadas del tutor | El tutor escribe sus propias FAQ y **se heredan en todas sus mentorías**, para que no reciba veinte veces la misma pregunta: columna jsonb en `tutor_profiles` y fusión al pintar, con la de la mentoría primero |

#### EP-27 · Soporte técnico al usuario (post-MVP) · `EY-152`

| Ficha | Qué pedía | Con qué cerró |
| :-- | :-- | :-- |
| `EY-153` · SUP-01 | Botón de soporte | Soporte en los dos paneles **reusando `/contacto`**, que ya existía. Cierra además el hueco «Canal de soporte» que EP-23 había dejado abierto en P03 |

#### Lo que sigue abierto

🔴 **`EY-187` · área verificada — no se puede empezar, y su pregunta P-7 sigue sin contestar.** No es
que falte tiempo: **no hay contra qué validar**.

- `tutor_categories` son **dos columnas y ningún indicador de verificación**, y las escribe **el
  propio tutor desde el navegador** por PostgREST (`tutor_categories_write_own … with check
  ( auth.uid() = tutor_id )`): el asistente borra todo e inserta.
- **Las categorías de la mentoría no se contrastan contra las del tutor**: la política de escritura
  de `product_categories` comprueba solo la propiedad del producto, y el formulario ofrece **todas**
  las categorías activas. Un tutor de «Idiomas» publica en «Programación» sin fricción, ni en base de
  datos ni en pantalla.
- **El KYC no tiene dimensión de materia.** `verification_documents` es
  `(tutor_id, doc_type, storage_path, status, reviewed_by, review_notes)`: un «diploma» es un diploma
  y la base no sabe si dice Filología Inglesa o Ingeniería. Y la aprobación es **global** —
  `refresh_identity_status()` lo funde todo y `review_tutor` pone un único `approval_status`.
- **«Tutor verificado» es texto fijo sin condición en cinco superficies:**
  `products/[id]/page.tsx:326`, `tutors/[id]/page.tsx:288`, `tutor-summary.tsx:108` y
  `catalog/tutor-card.tsx:52` y `:123`. Su único significado es que la consulta filtra
  `approval_status = 'approved'`. Y `home-faq.tsx` promete públicamente que se validan «títulos,
  certificaciones y trayectoria».

**La versión barata es trabajo tirado**, y conviene decirlo con estas palabras: comprobar que las
categorías de la mentoría estén entre las que el tutor se puso él mismo **no valida nada** — el
ingeniero que quiera dar inglés marca «Idiomas» y pasa. La versión que vale algo es **KYC por área**:
documento ligado a categoría, revisión del admin por categoría y un estado de aprobación por par
(tutor, categoría). Eso es esquema nuevo, panel de admin nuevo y proceso operativo nuevo.

> **P-7, la pregunta al cliente:** ¿qué se quiere de verdad — **(a)** que el admin apruebe categoría
> por categoría con documento delante, que es proceso operativo nuevo, o **(b)** quitar «Tutor
> verificado» de donde promete más de lo que hay?

🔴 **Se promete REPROGRAMAR y el código no sabe hacerlo.** **Ninguna migración toca
`sessions.start_at`**: los `update public.sessions` que existen solo derivan la ventana de acceso a
la sala. Solo se puede **cancelar y volver a reservar**, y con menos de 24 h eso **cuesta el 50 %**
(RN-37). Las dos superficies no dicen lo mismo y solo una hay que corregir:

- **El contrato se cubre.** El §14 de los Términos («Reprogramación») dice «generalmente podrán
  **solicitar**» y lo sujeta expresamente a «la disponibilidad del Tutor, **las funcionalidades de la
  Plataforma** y cualquier condición aplicable». Con esa redacción, que hoy no exista **no incumple**
  el §14.
- **La FAQ no.** `products/[id]/page.tsx:37-38` afirma en plano *«Puedes reagendar con al menos 24
  horas de anticipación sin coste»*, y `home-faq.tsx:59` responde a «¿puedo reprogramar?» y a
  continuación describe **la política de reembolso**, que es otra cosa. Es la única superficie que
  promete de más, y corregir la frase es de coste mínimo.

### 4.5 Fichas nuevas — lo que destapó la auditoría de septiembre

Cuatro historias pequeñas, sin ticket todavía. La primera es **dinero** y no puede esperar a las
otras tres.

| ID | Historia | Prio | Épica | Qué exige |
| :-- | :-- | :-- | :-- | :-- |
| **AUD-01** | El riel rechazado **baja al siguiente candidato** | **M** | EP-10 | Hoy no baja: en `src/app/api/cron/payouts-process/route.ts:734`, el caso `rechazado` marca la orden `failed`, encola NTF-16 y hace `break` — no reintenta con el siguiente riel del país. **Un tutor puede quedarse sin cobrar teniendo otro riel capaz**, y con la tarjeta de Banco compitiendo entre Wise, dLocal y Stripe eso deja de ser hipotético. El descenso que **sí** existe es el **previo**: `rielSirveParaEsteTutor` (`src/lib/payments/riel-viable.ts`) descarta los rieles sin datos **antes** de elegir. ⚠️ `docs/DICTADO-PAGOS.md` afirma, en el párrafo del saldo como red de seguridad, que este descenso «ya existe en el código y no hay que escribirlo»: **es falso**. Lo que existe es el filtro de candidatos, no el reintento tras un rechazo |
| **AUD-02** | El retiro se confirma **dentro de la app**, no con `window.confirm()` | S | EP-10 | `src/app/(app)/tutor/payouts/withdraw-button.tsx:51` pide confirmación de una acción **de dinero** con un `confirm()` nativo. El repo ya decidió lo contrario tres veces (N-04, N-34 y la pantalla de cancelación): un navegador que marca «impedir que esta página cree más diálogos» hace que `confirm()` devuelva `false` **sin preguntar**, y aquí eso se lee como «no me ha hecho caso» |
| **AUD-03** | Los ejemplos del formulario bancario dejan de ser colombianos | C | EP-10 | `src/app/(app)/tutor/payouts/payout-account-form.tsx:850` y `:900` sugieren `Calle 12 #4-56, apto 301` y `+57 300 123 4567` **a todo el mundo**, incluida una tutora española. Con `payout_country_rules` cubriendo 55 países, el ejemplo tiene que salir de la fila del país, que es donde ya viven el rótulo y la regla de validación |
| **AUD-04** | La cookie `ey-ref` se escribe **con `domain`** | C | EP-13 | `src/lib/supabase/middleware.ts:78-82` la escribe sin `domain`, así que queda atada al host exacto: el día que la app y la landing compartan dominio con subdominios distintos, la atribución **muere en silencio**. Hoy es inocuo —la atribución no existe— pero es **requisito previo de `US-1302`**, y un fallo silencioso es la peor forma de perder un referido |

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
- **US-605:** ventana de pago = **20 min** (antes genérica). → **Hoy son 7 min** (`20260826120000`), ver §2.1.
- **US-201/202/203:** onboarding exige **teléfono E.164** + `onboarding_complete`; tutor exige foto+redes; KYC amplía docs (degree, certificate, diploma, transcript, cv, social_media). RN-44. → **Hoy son seis**: `social_media` salió del set y las redes viven en `tutor_profiles.socials`.

**Reglas nuevas:** RN-37 (política/reembolsos únicos), RN-38 (aceptar/rechazar 24h), RN-40 (retiro), RN-41 (chat), RN-42 (grabación/consentimiento — **reformulada el 2-sep-2026: obligatoria y notificada**, ver EP-18), RN-43 (card-on-file), RN-44 (onboarding ampliado).

**Notificaciones:** catálogo ampliado a **NTF-01..20** (nuevas: NTF-17 aceptar/rechazar, NTF-19 grabación disponible). → **Hoy llega a NTF-01..23**: NTF-21 (mensaje nuevo), NTF-22 (el admin escribe al usuario) y NTF-23 (payout reclamado y sin cerrar).

**Decisiones resueltas:** **C-01 / DP-01** (proveedores → DLocal + Stripe, y con el dictado también PayPal y Wise), **C-11 / DP-05** (correo → Resend), **C-14** (los documentos de KYC) y **C-03 / DP-03** → RN-37 fija los % de reembolso (≥24h=100%, <24h alumno=50%, tutor=100%). Ver Doc 09 + `APROBACION-CLIENTE-FAIMLAB.md`.

---

## 8. Matriz de trazabilidad

El único mapa cruzado **épica → pantallas → entidades → estados → notificaciones** del repo. Viene
del Doc 8 (§8.4) y se corrigió al traerlo, contra el código: **EP-12
alcanza NTF-01..23**, **EP-08 no dispara ninguna notificación** (NTF-08 y NTF-11 no los encola
ninguna migración) y **las DP resueltas salen de la última columna** — DP-01 (proveedores, C-01),
DP-03 (reembolsos, RN-37) y DP-05 (correo, Resend).

La columna **Propuesta** cita secciones de la **propuesta comercial**, no de este archivo.

| Épica | Propuesta | Pantallas (Doc 4) | Entidades (Doc 1) | Estados (Doc 2) | Notif (Doc 7) | DP abiertas |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| EP-01 | §4.1.A | SCR-AU01..04, G03 | `profiles` | — | NTF-01/02 (los manda **Auth**, no la cola) | — |
| EP-02 | §4.1.A/4.2.A | SCR-AL01, TU01/02 | `profiles`, `tutor_profiles`, `verification_documents` | M1/M2/M8 | NTF-03/06 | — |
| EP-03 | §4.1.B | SCR-P04..09 | `products`, `categories`, `tutor_profiles`, vista `tutors_public` | M1/M3 | — | — |
| EP-04 | §4.2.A | SCR-TU03/04 | `products`, `product_categories`, `tutor_materials` | M3 | — | — |
| EP-05 | §4.2.B | SCR-TU05 | `availability_rules`, `availability_exceptions`, `product_availability_rules` | — | — | — |
| EP-06 | §4.1.C | SCR-AL04..07 | `bookings`, `sessions`, `orders` | M4/M5 | NTF-05/07/09/17 | DP-08 |
| EP-07 | §4.4 | SCR-AL05, AD08 | `payments`, `payment_routing_rules`, `payment_webhook_events`, `payment_methods`, `refund_requests`, `late_payment_refunds` | M6 | NTF-04/10/15 | DP-07 |
| EP-08 | §4.1.D | SCR-LV01 | `sessions` | M5 | **ninguna** | — |
| EP-09 | §4.1.F | SCR-AL08, P07 | `reviews` | M4 | NTF-14 | — |
| EP-10 | §4.2.F | SCR-TU06/TU09, AD15 | `payouts`, `payout_items`, `tutor_payout_accounts`, `payout_country_rules`, `payout_banks`, `tutor_payout_preferences`, `payout_manual_channels`, `tutor_manual_payout_destinations` | M7 | NTF-12/16/23 | DP-02/06/07 |
| EP-11 | §4.3 | SCR-AD01..15 | (todas) + `alert_acks`, `account_suspensions` | M1/M6/M7 | NTF-03/22, **NTF-13 pendiente (US-1106)** | DP-02 |
| EP-12 | §4.4 | — (transversal) + campana | `notifications` | (todos) | **NTF-01..23** | DP-08 |
| EP-13 | §3/§4.4 | ~~(widget)~~ → **`/referidos`, `/admin/referidos`** (11-sep) | `profiles.referral_code` (+ `referral_converted_at`, `referral_rf_user_id`), `referral_campaigns`, `referral_memberships` | — | — | DP-04 |
| EP-14 | §7/§8 | (transversal) | (todas) | (todos) | — | — |
| EP-15 | §17 | SCR-AD13/AD14 | — | M6/M7 | **NTF-13 pendiente** | — |
| EP-16 | §9/§11 | (todas) | — | — | — | — |
| EP-17 | adenda v1.0 | SCR-AL03/TU08/LV01 | `conversations`, `messages`, `message_reads`, `conversation_reads`, `conversation_reports` | — | NTF-21 | — |
| EP-18 | adenda v1.0 | SCR-LV01, AL03/TU08 | `sessions`, `session_recording_consents` | M9 | NTF-19 | — |
| EP-25 | listas del cliente (ago-2026) | `/carrito`, `/pedidos/[id]/pagar` | `orders`, `bookings.order_id` | M4/M6 | NTF-04/05 | — |
| EP-26 | listas del cliente (ago-2026) | panel del alumno, sala, `/admin/reportes`, `/account` | `tutor_views`, `calendar_feed_tokens`, `conversation_reports`, `account_deletions`, `account_deletion_requests`, `account_suspensions` | M4/M5 | NTF-22 | — |
| EP-27 | listas del cliente (ago-2026) | los dos paneles → `/contacto` | `contact_messages`, `contact_message_attachments` | — | — | — |

---

## 9. Supuestos vigentes de este backlog

| ID | Supuesto | Estado |
| :-- | :-- | :-- |
| S-52 | La estimación fina (puntos/horas/sprints) se cierra en Fase 0; el backlog usa MoSCoW y puntos relativos | vigente |
| S-53 | "Destacados" y "Populares" del Home se basan en datos básicos —**rating y recencia**— **sin motor de recomendación** | vigente. El único algoritmo que existe es `student_tutor_affinity()` de `EY-186`, y vive en el **panel del alumno**, no en la portada pública |

---

*Espejo del backlog v1.0 (Faim Lab, 2026-06-24). Manda en alcance y sprints; el estado de ejecución
vive en `docs/PLAN-DESARROLLO.md` y el cobro y el payout en `docs/DICTADO-PAGOS.md`.*
