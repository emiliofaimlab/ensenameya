# DOC 6 — Arquitectura de Pagos/Payouts e Integraciones

> **Enséñame Ya — MVP Web.** Capa de pagos agnóstica (ports & adapters), enrutamiento por geografía e integraciones externas (Daily, Auth, Email, Referidos, Monitoreo).

| Campo | Valor |
| :-- | :-- |
| **Documento** | 6 — Arquitectura de Pagos/Payouts e Integraciones |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Doc 1 (`payments`/`payouts`/`payment_routing_rules`), Doc 2 (M6/M7), Doc 3 (service role) |
| **Fuente** | `ENSEÑAME YA INFRAESTRUCTURA DE PAGOS.md` |
| **Estado** | Borrador para revisión |
| **Fecha** | 2026-06-03 |

---

## 6.1 Propósito y principios

Define **cómo se cobra al alumno y se paga al tutor** sin acoplar el núcleo del producto a un proveedor concreto, y **cómo se integran** los servicios externos del MVP. Principios rectores (bloqueados en el HANDOFF y Doc 0):

1. **Capa agnóstica (anti-acoplamiento).** Patrón *strategy/adapter* detrás de una interfaz común (`PaymentProvider`) + `PaymentRouter`. La **selección concreta de proveedores es `DECISIÓN PENDIENTE DP-01`**; el diseño no depende de ella.
2. **Routing en datos, nunca hardcodeado** (RN-16): tabla `payment_routing_rules` en BD; activar un país/proveedor no toca el core.
3. **El cuello de botella es el payout** (infraestructura de pagos §5): el proveedor se elige por el **país donde cobra el tutor** (`payee_country`, RN-15).
4. **El split es independiente del proveedor** (RN-08): se aplica sobre el cobro según el tier (S-08, congelado en `bookings`/`payments`).
5. **Escritura financiera solo en el servidor** (S-15, RN-26): webhooks/jobs vía `service_role`; el cliente solo lee.

---

## 6.2 Puertos (interfaces) y enrutador

Interfaz común a todos los proveedores y enrutador que puede resolver proveedores **distintos** para cobro y payout (fuente: infraestructura de pagos §6):

```typescript
// Puerto común a todos los proveedores de pago
interface PaymentProvider {
  readonly key: string;                       // 'stripe' | 'dlocal' | 'mercadopago' | ...
  charge(input: ChargeInput): Promise<ChargeResult>;   // cobro al alumno
  payout(input: PayoutInput): Promise<PayoutResult>;   // pago al tutor
  refund(input: RefundInput): Promise<RefundResult>;   // reembolso (DP-03)
  verifyWebhook(req: WebhookRequest): WebhookEvent;     // firma + parseo idempotente
}

interface ChargeInput {
  bookingId: string; payerCountry: string; payeeCountry: string;
  amountMinor: number; currency: string; method?: string;
  idempotencyKey: string;                     // evita doble cobro
}

// El enrutador resuelve por geografía; charge y payout pueden diferir
class PaymentRouter {
  resolveCharge(payerCountry: string, payeeCountry: string): PaymentProvider;
  resolvePayout(payeeCountry: string): PaymentProvider;  // decisivo: país del tutor
}
```

> El core llama siempre a `PaymentRouter` + `PaymentProvider`; **nunca** a un SDK de proveedor directamente. Sustituir o agregar un proveedor = nuevo adaptador + fila de routing, sin cambios en el flujo de negocio.

---

## 6.3 Tabla de enrutamiento y algoritmo de resolución

La resolución lee `payment_routing_rules` (Doc 1 §1.4.17): se busca la regla activa más específica por `payee_country` (y opcionalmente `payer_country`), ordenada por `priority`.

```text
resolveCharge(payer, payee):
  reglas = SELECT * FROM payment_routing_rules
           WHERE is_active
             AND payee_country = payee
             AND (payer_country = payer OR payer_country IS NULL)
           ORDER BY (payer_country IS NULL) ASC, priority ASC
  si vacío -> error de cobertura (corredor no soportado)  // ver Venezuela
  return adapterFor(reglas[0].charge_provider)

resolvePayout(payee):
  regla = primera regla activa con payee_country = payee, menor priority
  return adapterFor(regla.payout_provider)   // puede diferir del de charge
```

- **`payer_country IS NULL`** actúa como comodín (cualquier alumno) para un `payee_country` dado.
- La selección concreta de `charge_provider`/`payout_provider` por corredor es **DP-01** (datos, no código).
- Corredor sin regla activa ⇒ se bloquea la reserva con mensaje claro (RN-33).

---

## 6.4 Catálogo de adaptadores (estado: DP-01)

Adaptadores previstos y su rol por corredor (fuente: infraestructura de pagos §2–§5). **Cuáles se construyen primero es DP-01** (recomendación Stripe-first donde aplique):

| Adapter (`key`) | Cobro | Payout | Cobertura / uso |
| :-- | :-- | :-- | :-- |
| `stripe` (Connect) | Sí (135+ monedas) | Sí (50+ países; LATAM local solo BR/MX) | **USA nativo**; split, tax/1099/KYC US |
| `mercadopago` | Sí | Split entre cuentas MP | LATAM intra-país (AR, CL, CO, PE, UY, BR, MX, EC) |
| `dlocal` | Sí (LATAM) | Sí (moneda local) | Cross-border LATAM; liquidar a US/EU |
| `bamboo` | Sí | Payouts instantáneos (8 países) | Alternativa a dLocal con foco en payout |
| `crypto_usdt` | No | Sí (USDT) | **Venezuela** y tutores sin banca |

> **Recomendación DP-01 (no resuelta):** Stripe-first — procesar todo lo posible con Stripe y enrutar al proveedor alterno cuando la ubicación del tutor/alumno no sea soportada. El adaptador `crypto_usdt` es **solo payout** (no cobra ni hace split).

---

## 6.5 Matriz de decisión por corredor

Resumen accionable (filas = país del **tutor/payout**, columnas = país del **alumno/cobro**; fuente: infraestructura §6):

| Tutor ↓ / Alumno → | Estados Unidos | LATAM (con MP) | Venezuela |
| :-- | :-- | :-- | :-- |
| **Estados Unidos** | Stripe (cobro+payout, split) | Stripe cobra · payout intl al tutor US | Stripe cobra · payout US |
| **Brasil / México** | Stripe cobra · payout BR/MX (Stripe o MP) | Stripe Connect o MercadoPago | dLocal/intl cobra · payout BR/MX |
| **LATAM (AR, CO, CL, PE, UY)** | Stripe cobra · payout MP/dLocal | MercadoPago (mismo país) o dLocal (cross-border) | dLocal cobra · payout MP/dLocal |
| **Venezuela** | Stripe cobra · payout **USDT** | MP/dLocal cobra · payout **USDT** | Cobro + payout en **USDT** |

> **Venezuela:** ningún proveedor de la lista cubre cobro/pago nativo; el payout va por **USDT/Payoneer** con la entidad del negocio constituida afuera (riesgo en Doc 9).

---

## 6.6 Flujo de cobro (charge)

Secuencia server-side; el cliente nunca escribe `payments` (S-15):

| # | Paso | Resultado |
| :-- | :-- | :-- |
| 1 | Alumno confirma slots (SCR-AL04) | `booking: pending_payment`; snapshot `tier_split_pct`, `payer/payee_country`, montos |
| 2 | Crear `payment` (`pending`) e `idempotencyKey` | Fila `payments` (service role) |
| 3 | `router.resolveCharge(payer, payee)` | Adaptador de cobro (RN-15) |
| 4 | `provider.charge(...)` → checkout alojado | Redirección/embed (S-28); sin datos de tarjeta locales |
| 5 | Proveedor confirma vía **webhook** | `verifyWebhook` (firma) → `payment: paid` (M6) |
| 6 | Efectos del `paid` | `booking: confirmed`; crear `sessions` + salas Daily; **devengar `payout_item`** (RN-30); **NTF-04/05** |
| 7 | Fallo/expiración | `payment: failed` o ventana vencida → `booking: cancelled` (RN-27) |

**Cálculo del split** (al crear el pago, congelado):

```text
gross_amount        = total cobrado al alumno (minor units)
tutor_net_amount    = round(gross_amount * tier_split_pct / 100)
platform_fee_amount = gross_amount - tutor_net_amount
# tier_split_pct es snapshot del tier al momento de la reserva (S-08, RN-08)
# independiente del proveedor; las comisiones del PSP se contabilizan aparte
```

---

## 6.7 Flujo de payout

| # | Paso | Resultado |
| :-- | :-- | :-- |
| 1 | `payment: paid` | Se crea `payout_item` con `tutor_net_amount` (M7 `pending`) |
| 2 | Job de retención | Al vencer **DP-02** (15/30 d) agrupa items (**DP-06**) → `payout: scheduled` |
| 3 | Job de ejecución | `router.resolvePayout(payee_country)` → `provider.payout(...)` → `processing` |
| 4 | Webhook del proveedor | `payout: paid` (+ `provider_payout_id`) → **NTF-12**; o `failed` |
| 5 | Incidencia | `admin` puede `on_hold`/reintentar (SCR-AD15) |

- **Agregación (DP-06):** `payout_items` soporta 1:1 o lote sin migración (Doc 1 §1.4.14).
- **Retención (DP-02):** parámetro de configuración; ancla `retention_until`/`scheduled_for`.
- **FX/moneda (DP-07):** si `settlement_currency` ≠ `currency`, se registran `settlement_currency`/`fx_rate` en `payments`; el payout liquida en la moneda del corredor.

---

## 6.8 Webhooks, idempotencia y conciliación

- **Verificación de firma** obligatoria en cada webhook (`verifyWebhook`); se rechaza lo no firmado (RN-34).
- **Idempotencia:** cada evento se procesa una sola vez (clave del proveedor + `idempotencyKey`); reintentos no duplican efectos (RN-26). Se persiste `provider_payment_id`/`provider_payout_id` y `provider_metadata`.
- **Conciliación:** un job compara el estado interno (`payments`/`payouts`) contra el proveedor; discrepancias → SCR-AD14.
- **Reembolsos (DP-03):** `provider.refund(...)` → `payment: partially_refunded|refunded`; ajusta `payout_item` si no liquidado (S-29) o clawback manual si ya pagado.

```typescript
// Esbozo de manejador de webhook (Edge Function, service_role)
async function handleWebhook(req: WebhookRequest) {
  const provider = router.adapterFor(req.providerKey);
  const evt = provider.verifyWebhook(req);     // valida firma; lanza si inválida
  if (await alreadyProcessed(evt.id)) return ok();   // idempotente
  switch (evt.type) {
    case 'charge.succeeded': await markPaymentPaid(evt); break;  // M6 -> M4 + sessions
    case 'charge.failed':    await markPaymentFailed(evt); break;
    case 'payout.paid':      await markPayoutPaid(evt); break;   // M7
    case 'refund.succeeded': await applyRefund(evt); break;      // DP-03
  }
  await recordProcessed(evt.id);
}
```

---

## 6.9 Integración de video (Daily)

- **Provisión de sala** al confirmarse la reserva (M4→`confirmed`): se crea `daily_room_name`/`daily_room_url` por sesión (Doc 1 §1.4.11).
- **Ventana de acceso** (RN-18, S-07): `access_opens_at = start_at − N`, `access_closes_at = end_at + N`. Fuera de ventana, la sala no es accesible.
- **Token de acceso** generado **server-side al unirse** (no se almacena), con rol (alumno/tutor) y expiración alineada a la ventana.
- **Coste por uso:** 10,000 participant-minutes gratis/mes y luego por uso (propuesta §17); riesgo de coste en Doc 9.
- `SUPUESTO S-45`: `N` (ventana) ≈ 10 min antes / 10 min después (valor a confirmar).

---

## 6.10 Autenticación (Supabase Auth)

- **Métodos:** email/password + **Google OAuth** (Doc 0). `auth.users` es canónico; `profiles` extiende 1:1 (S-17).
- **Sesión:** JWT de Supabase; `auth.uid()` alimenta RLS (Doc 3).
- **Onboarding:** primera sesión crea/completa `profiles` (incluye `timezone`, RN-01).
- **Verificación de email** y **reset** (NTF-01/02) vía Auth + proveedor de email (§6.11).

---

## 6.11 Email transaccional (detrás de interfaz — DP-05)

La **herramienta concreta es `DECISIÓN PENDIENTE DP-05`** (SendGrid candidato). Se diseña detrás de un puerto, igual que pagos:

```typescript
interface EmailProvider {
  send(input: {
    to: string; templateKey: string;          // catálogo en Doc 7
    vars: Record<string, unknown>;
    locale?: string;                           // S-38 (es por defecto)
  }): Promise<{ id: string }>;
}
// Adaptadores: SendGridProvider | ResendProvider | ... (DP-05)
```

- El **catálogo de notificaciones** y sus disparadores está en el **Doc 7**.
- Sustituir el proveedor = nuevo adaptador, sin tocar los puntos de disparo.

---

## 6.12 Referidos (Referral Factory — integración frontend)

- **Sin lógica interna** (RN-21, D-03): el programa se configura **en Referral Factory**; la plataforma solo **integra en frontend** (FL-04).
- **Atribución:** captura de `referral_code` desde la URL de registro (`?ref=`) y persistencia en `profiles.referral_code` (S-18). Sin tablas ni reglas internas.
- **Reglas del programa (monto, conversión válida, límites de payout):** **`DECISIÓN PENDIENTE DP-04`**, externas (propuesta §15).
- `SUPUESTO S-46`: el artefacto consumido es el snippet/SDK de Referral Factory; los eventos de conversión los gestiona esa plataforma (y, si aplica, su integración con el proveedor de pago).

---

## 6.13 Monitoreo y observabilidad

- **Errores:** Sentry candidato (propuesta §17, S-09) detrás de configuración; captura excepciones de frontend y Edge Functions.
- **Logs de pago/payout:** `provider_metadata` + log estructurado de webhooks/jobs; alertas a SCR-AD14.
- `SUPUESTO S-47`: métricas operativas mínimas (tasa de fallo de cobro, payouts en `failed`, latencia de webhook) en el dashboard admin/observabilidad.

---

## 6.14 Seguridad

- **Sin datos de tarjeta** en la plataforma: checkout alojado por el proveedor (S-28); alcance PCI minimizado.
- **Secretos** (claves de proveedores, Daily, email) en variables de entorno del servidor; nunca en el cliente.
- **Firmas de webhook** verificadas (RN-34); endpoints idempotentes.
- **Escritura financiera** solo `service_role` (S-15); RLS default-deny (Doc 3).
- **Principio de menor privilegio** en claves de proveedor (scopes mínimos).

---

## 6.15 Configuración / variables de entorno (orientativo)

| Variable | Ámbito | Uso |
| :-- | :-- | :-- |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | cliente | Auth + lectura RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor | Escritura financiera/jobs (S-15) |
| `PAYMENT_<PROVIDER>_KEY` / `_WEBHOOK_SECRET` | servidor | Adaptadores DP-01 (alta sin migración, RN-16) |
| `DAILY_API_KEY` | servidor | Provisión de salas + tokens |
| `EMAIL_PROVIDER_KEY` | servidor | Adaptador de email DP-05 |
| `REFERRALFACTORY_*` | cliente | Snippet/SDK de referidos (DP-04) |
| `SENTRY_DSN` | ambos | Monitoreo (S-09) |

---

## 6.16 Reglas y supuestos introducidos en este documento

**Reglas de negocio nuevas**

| ID | Regla |
| :-- | :-- |
| RN-33 | Un corredor sin regla activa en `payment_routing_rules` bloquea la reserva con mensaje de cobertura (no se cobra a ciegas). |
| RN-34 | Todo webhook debe verificar firma y procesarse de forma idempotente; lo no firmado se rechaza. |

**Supuestos nuevos**

| ID | Supuesto |
| :-- | :-- |
| S-45 | Ventana de acceso a sala ≈ 10 min antes / 10 min después (valor a confirmar). |
| S-46 | La integración de referidos consume el snippet/SDK de Referral Factory; conversión gestionada externamente. |
| S-47 | Métricas operativas mínimas de pago/payout/webhook en observabilidad. |

**Decisiones pendientes referenciadas (no resueltas):** DP-01 (proveedores/corredores), DP-02 (retención), DP-03 (reembolsos), DP-04 (reglas de referidos), DP-05 (email), DP-06 (agregación payout), DP-07 (FX/settlement), DP-08 (no-show). Toda se consume como **configuración**, no como código acoplado.

---

## 6.17 Nota sobre diagramas

Los **diagramas de secuencia** (charge y payout), el **diagrama de componentes** (core ↔ router ↔ adapters ↔ proveedores) y el **mapa de integraciones** se agregan en la pasada final (Mermaid `sequenceDiagram`/`flowchart`). El `.md` es la fuente y el `.pdf` se regenerará entonces.

---

*Fin del Documento 6.*
