# DOC 9 — Riesgos y Decisiones Pendientes

> **Enséñame Ya — MVP Web.** Registro consolidado de decisiones abiertas (DP), riesgos, supuestos a confirmar, divergencias y gobierno de decisiones.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 9 — Riesgos y Decisiones Pendientes |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Docs 0–8 + `ENSEÑAME YA INFRAESTRUCTURA DE PAGOS.md` |
| **Propósito** | Hacer visibles y gestionables los puntos abiertos y los riesgos antes de Fase 0 |
| **Estado** | Borrador para revisión |
| **Fecha** | 2026-06-03 |

---

## 9.1 Propósito

Consolida en un solo lugar lo que **no está cerrado** y lo que **puede salir mal**, con su impacto, mitigación y **quién/cuándo** debe resolverlo. Cumple el mandato del engagement: *no inventar decisiones*; documentar opciones e impacto, y diseñar **sin acoplarse** a lo pendiente. Es la entrada principal a la **Fase 0 (Descubrimiento)**.

---

## 9.2 Registro de decisiones pendientes (DP)

> Las DP-01..DP-07 vienen del Doc 0/1; DP-08 surgió en el Doc 2. **Ninguna se resuelve aquí.** Cada una incluye un *default operable* que el diseño ya soporta como configuración.

### DP-01 — Proveedores de pago, corredores y estrategia
- **Opciones / recomendación:** Stripe-first (procesar todo lo posible con Stripe) + fallback por geografía (MercadoPago intra-LATAM, dLocal/Bamboo cross-border, USDT para Venezuela). Ver infraestructura de pagos.
- **Impacto:** qué adaptadores se construyen primero (EP-07/EP-10). El core agnóstico (Doc 6) ya evita acoplamiento.
- **Default operable:** tabla `payment_routing_rules` vacía salvo corredores activados; corredor sin regla = reserva bloqueada (RN-33).
- **Owner:** Cliente + Faim Lab. **Necesaria antes de:** producción real de pagos (Fase 2/3).

### DP-02 — Periodo de retención de payout
- **Opciones:** 15 vs 30 días.
- **Impacto:** flujo de caja del tutor; `retention_until`/`scheduled_for` (M7).
- **Default operable:** parámetro de configuración (sin cambio de modelo).
- **Owner:** Cliente. **Necesaria antes de:** primeros payouts reales.

### DP-03 — Política de reembolsos
- **Opciones:** plazos de cancelación gratuita, % retenido, prorrateo de paquetes.
- **Impacto:** M4/M6; pantallas AL07/AD08; NTF-09/10; relación con payout (S-29).
- **Default operable:** mecanismo de reembolso total/parcial implementado; porcentajes/plazos leídos de configuración.
- **Owner:** Cliente. **Necesaria antes de:** habilitar cancelaciones en producción.

### DP-04 — Reglas del programa de referidos (externo)
- **Opciones:** configuración en Referral Factory (monto, conversión válida, límites de payout) — propuesta §15.
- **Impacto:** EP-13; sin lógica interna (RN-21); solo atribución `referral_code`.
- **Default operable:** integración frontend lista; reglas se cargan en la plataforma externa.
- **Owner:** Cliente. **Necesaria antes de:** activar el programa.

### DP-05 — Herramienta de email
- **Opciones:** SendGrid (candidato) u otra.
- **Impacto:** adaptador de `EmailProvider` (Doc 6 §6.11); no acopla los disparos (Doc 7).
- **Default operable:** puerto definido; un adaptador concreto se conecta sin tocar el catálogo.
- **Owner:** Faim Lab + Cliente (cuenta). **Necesaria antes de:** envío real de correos.

### DP-06 — Relación Pago ↔ Payout (agregación)
- **Opciones:** (a) un payout por pago; (b) un payout por lote.
- **Impacto:** agrupación al pasar M7 `pending→scheduled`; reportes del tutor.
- **Default operable:** `payout_items` soporta ambos sin migración (Doc 1 §1.4.14).
- **Owner:** Cliente + Faim Lab. **Necesaria antes de:** primeros payouts.

### DP-07 — Moneda de liquidación y FX (cross-border)
- **Opciones:** (a) split en moneda de cobro; (b) en moneda de payout con `fx_rate`; (c) cobrar/liquidar en USD.
- **Impacto:** `settlement_currency`/`fx_rate` en `payments`; reportes; ligado a DP-01.
- **Default operable:** campos presentes; sin FX si corredor mono-moneda.
- **Owner:** Cliente + Faim Lab. **Necesaria antes de:** corredores cross-border.

### DP-08 — Política de inasistencia (no-show) *(surgida en Doc 2)*
- **Opciones:** (a) no-show alumno = consumido / no-show tutor = reembolso; (b) ventana de gracia + reprogramación; (c) penalizaciones configurables.
- **Impacto:** M5/M4; reembolsos (ligado a DP-03); NTF-09/10.
- **Default operable:** no-show alumno = sin reembolso; no-show tutor = reembolso de esa sesión.
- **Owner:** Cliente. **Necesaria antes de:** operación con tráfico real.

**Resumen de necesidad temporal**

| DP | Bloquea | Se puede diferir sin frenar el core | Owner |
| :-- | :-- | :-- | :-- |
| DP-01 | Pagos en producción | Sí (core agnóstico) | Cliente+Faim |
| DP-02 | Primeros payouts | Sí | Cliente |
| DP-03 | Cancelaciones en prod | Sí (mecanismo listo) | Cliente |
| DP-04 | Activar referidos | Sí | Cliente |
| DP-05 | Correos reales | Sí (puerto listo) | Faim+Cliente |
| DP-06 | Primeros payouts | Sí | Cliente+Faim |
| DP-07 | Corredores cross-border | Sí | Cliente+Faim |
| DP-08 | Operación con tráfico | Sí (default operable) | Cliente |

---

## 9.3 Registro de riesgos

> Escala: Probabilidad/Impacto ∈ {Baja, Media, Alta}. Severidad = combinación. Fuente principal de riesgos de pago: `ENSEÑAME YA INFRAESTRUCTURA DE PAGOS.md`.

| ID | Riesgo | Prob. | Impacto | Sev. | Mitigación / contingencia | Refs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| RISK-01 | Holds o cierres de cuenta del proveedor (Stripe) | Media | Alto | Alta | Capa agnóstica + multi-proveedor; reservas de routing; KYC del negocio en regla | DP-01, infra §4 |
| RISK-02 | Venezuela sin cobro/payout nativo | Alta | Medio | Alta | Payout USDT/Payoneer; entidad constituida afuera; comunicar limitación | DP-01, infra §2 |
| RISK-03 | Exposición FX en corredores cross-border | Media | Medio | Media | Resolver DP-07; registrar `fx_rate`; opción liquidar en USD | DP-07 |
| RISK-04 | Retención de payout afecta caja del tutor | Media | Medio | Media | Definir DP-02 (15/30 d); comunicar claramente en TU09 | DP-02 |
| RISK-05 | Sobrecosto de Daily (>10k min/mes gratis) | Media | Medio | Media | Monitorear minutos; alertas de uso; plan de costos | §17, Doc 6 |
| RISK-06 | Fee por cuenta activa de Stripe escala con tutores | Media | Medio | Media | Modelar costo por tutor; revisar Connect Standard vs Express | infra §4 |
| RISK-07 | Confusión paquetes vs. clases grupales (alcance) | Baja | Medio | Baja | D-02 confirmado: paquete = N sesiones 1:1; grupal fuera (RN-22) | D-02 |
| RISK-08 | Reglas de referidos sin definir | Media | Medio | Media | DP-04 a cargo del cliente; integración no bloquea core | DP-04 |
| RISK-09 | Herramienta de email sin definir | Baja | Bajo | Baja | Puerto `EmailProvider`; adaptador tardío | DP-05 |
| RISK-10 | KYC manual se vuelve cuello de botella | Media | Medio | Media | Diseñado para automatizar luego (RN-05); cola/SLA en admin | RN-05, M2 |
| RISK-11 | Política de reembolsos sin definir → disputas | Media | Alto | Alta | DP-03 prioritaria; mecanismo listo; mostrar política en checkout | DP-03 |
| RISK-12 | Errores de zona horaria (citas a hora equivocada) | Media | Alto | Alta | UTC en BD + hora local en UI (RN-02/32); pruebas multi-tz | RN-01/02/32 |
| RISK-13 | Mala configuración de RLS → fuga de datos | Baja | Alto | Alta | Default-deny; pruebas de políticas por rol; revisión de seguridad | Doc 3 |
| RISK-14 | Webhook no idempotente → doble cobro/efecto | Media | Alto | Alta | Firma + idempotencia (RN-34/26); conciliación | Doc 6 §6.8 |
| RISK-15 | No-show sin política → fricción y reclamos | Media | Medio | Media | DP-08 con default operable; ventana de gracia | DP-08 |
| RISK-16 | Chargebacks / disputas de pago | Media | Medio | Media | Evidencias del proveedor; estados de disputa; alertas AD14 | NTF-13 |
| RISK-17 | Protección de datos personales/KYC | Baja | Alto | Media | Bucket privado (S-19); mínimo privilegio; retención de documentos | Doc 3, S-19 |
| RISK-18 | Bus factor: 1 full-stack dev | Media | Alto | Alta | Documentación (estos docs); código y CLAUDE/handoff; revisión por pares cuando aplique | §13 |
| RISK-19 | Demoras de aprobación del cliente afectan timeline | Media | Medio | Media | Feedback consolidado por ronda (§19.5); hitos claros | §19.5 |
| RISK-20 | Onboarding/KYC de tutores en el proveedor (Connect) | Media | Medio | Media | Flujo de alta del proveedor; estados de cuenta del tutor | DP-01 |
| RISK-21 | Complejidad de conciliación multi-proveedor | Media | Medio | Media | Job de conciliación; `provider_metadata`; reportes | Doc 6 §6.8 |
| RISK-22 | Errores de redondeo / unidades menores / multi-moneda | Baja | Medio | Media | `bigint` minor units (S-12); pruebas de split y FX | S-12, RN-08 |

**Top riesgos a atacar en Fase 0:** RISK-11 (DP-03), RISK-12 (zonas horarias), RISK-13/RISK-14 (seguridad/idempotencia), RISK-01/RISK-02 (estrategia de proveedores y Venezuela).

---

## 9.4 Supuestos materiales a confirmar

> Lista completa S-01..S-53 distribuida en los Docs 0–8. Aquí, los **que más impactan** y conviene validar pronto.

| ID | Supuesto | Por qué importa |
| :-- | :-- | :-- |
| S-04 | Una reserva = un pago (1:1) | Base del modelo de pago/conciliación |
| S-08 | Cambios de split no retroactivos | Justicia y contabilidad con tutores |
| S-15 | Escritura financiera solo service role | Seguridad del dinero |
| S-21 | Aprobar tutor requiere identidad verificada | Política de confianza/KYC |
| S-24/S-29 | No-show / reembolso previo a liquidar | Ligados a DP-08/DP-03 |
| S-25 | Ventana de checkout 30 min | UX de reserva y liberación de slots |
| S-35 | Sin checkout como invitado | Conversión vs. fricción |
| S-45 | Ventana de sala ≈ 10/10 min | Acceso a clase en vivo |
| S-49 | Opt-out de no-esenciales | Cumplimiento/anti-spam |
| S-52 | Estimación fina en Fase 0 | Planeación y costos |

---

## 9.5 Divergencias con la propuesta firmada (estado)

| ID | Tema | Estado |
| :-- | :-- | :-- |
| D-01 | Pagos: Stripe único → Stripe-first + fallback | Diferido a **DP-01** (capa agnóstica como salvaguarda) |
| D-02 | Paquetes vs. clases grupales | **Confirmado:** paquete = N sesiones 1:1; grupal fuera (RN-22) |
| D-03 | Referidos: lógica interna → integración externa | **Confirmado:** Referral Factory + frontend (RN-21); reglas DP-04 |
| D-04 | Comisión única → Tutor Tiers | Enriquecimiento (RN-06/07) |
| D-05 | Email: SendGrid → herramienta tras interfaz | **DP-05**; SendGrid candidato |

---

## 9.6 Gobierno de decisiones y control de cambios

- **Cómo se resuelve una DP:** propuesta de opciones (estos docs) → decisión del owner → se registra como regla/configuración → se actualiza el HANDOFF y el doc afectado. La resolución de una DP **no** debería requerir rediseño (el core es agnóstico).
- **Control de cambios (propuesta §19.4):** todo lo fuera de §4/§12 es cambio de alcance → estimación de impacto + aprobación escrita antes de ejecutar.
- **Feedback (propuesta §19.5):** consolidado por ronda (idealmente un documento/mensaje), como en esta entrega conjunta de Docs 2–9.
- **Bitácora:** el `docs/HANDOFF.md` es el documento vivo de estado; el changelog registra cada cambio aprobado.

---

## 9.7 Recomendaciones de cierre para Fase 0

1. **Resolver primero** las DP que tocan dinero y confianza: **DP-03** (reembolsos), **DP-02/DP-06** (retención/agregación), **DP-01** (proveedores por corredor inicial).
2. **Confirmar la estrategia de Venezuela** (RISK-02): entidad y riel USDT, o excluir el corredor en el MVP.
3. **Validar zonas horarias** con casos reales multi-país (RISK-12) en UAT.
4. **Cerrar cuentas/accesos** (Stripe/otros, Referral Factory, email, Daily) — dependencias del cliente (propuesta §15).
5. **Revisión de seguridad** de RLS e idempotencia de webhooks antes de producción (RISK-13/14).

---

## 9.8 Nota sobre diagramas

Una **matriz de calor de riesgos** (probabilidad × impacto) y un **diagrama de dependencias DP→fase** se agregan en la pasada final. El `.md` es la fuente y el `.pdf` se regenerará entonces.

---

*Fin del Documento 9. — Fin del conjunto de documentos de implementación (Doc 0–9).*
