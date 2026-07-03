# ADENDA — Deltas del Backlog v1.0 sobre los Docs 00–09

> **Enséñame Ya — MVP Web.** Capa de reconciliación: qué introdujo el *Backlog v1.0*
> (2026-06-24, `docs/BACKLOG.md`, ya en Jira) que **no** está en los Docs 00–09 originales.
> Los Docs 00–09 siguen siendo la fuente del "cómo"; esta adenda registra los añadidos
> para que la trazabilidad (RN/NTF/US/DP) siga completa hasta que se haga la pasada final
> de reescritura de cada doc.

| Campo | Valor |
| :-- | :-- |
| **Depende de** | Docs 00–09, `docs/BACKLOG.md` |
| **Estado** | Vigente (capa de deltas) |
| **Fecha** | 2026-07-03 |

---

## 1. Reglas de negocio nuevas (RN-37…RN-44)

| RN | Regla | Origen |
| :-- | :-- | :-- |
| **RN-37** | **Política de cancelación/reembolso única de plataforma** (no por tutor). Reembolso: **≥24h = 100%**, **<24h por el alumno = 50%**, **cancelada por el tutor = 100%**. Visible en perfil y checkout. | US-403, US-604 |
| **RN-38** | Reserva pagada entra en **`pending_acceptance`**: el tutor **acepta (→`confirmed`) o rechaza** en **24h**; timeout = rechazo → `cancelled` + reembolso 100%. | US-606 |
| **RN-40** | **Retiro self-service** del tutor: dispara payout `trigger=tutor_request`, solo sobre saldo con retención **ya vencida**. Admin conserva hold/release. | US-1004 |
| **RN-41** | **Chat de reserva** persistente (tabla `messages`): 1:1 por reserva, habilitado **2 días antes**, retención **30 días** (`expires_at` + purga pg_cron), RLS por participantes. | EP-17 |
| **RN-42** | **Grabación** solo con **consentimiento mutuo** (alumno y tutor) solicitado **antes** de entrar a la sala; sin ambos consentimientos no se graba. Add-on de pago de Daily. | EP-18 |
| **RN-43** | **Card-on-file**: tokenización en el PSP; **nunca se guarda el PAN**; token reutilizable (`payment_methods`). | US-602/607 |
| **RN-44** | **Onboarding ampliado**: teléfono en formato **E.164** obligatorio (alumno y tutor); flag `onboarding_complete`; tutor añade foto + redes; KYC amplía documentos. | US-201/202/203 |

---

## 2. Cambio en la máquina de reserva (Doc 02 · M4)

Antes: `pending_payment → paid → confirmed`.
**Ahora (RN-38):**

```
pending_payment ──pago──▶ paid ──▶ pending_acceptance ──tutor acepta──▶ confirmed
                                          │
                                          ├─ tutor rechaza / timeout 24h ─▶ cancelled (+ reembolso 100%)
                                          └─ (autocancel 20 min sin pago, RN-27) ─▶ cancelled
```

- Nueva notificación **NTF-17** al entrar en `pending_acceptance` (aviso al tutor "tienes 24h").
- `confirmed` sigue siendo el disparador de creación de `sessions` y devengo de `payout_item`.

---

## 3. Notificaciones nuevas (catálogo ahora NTF-01…20)

| NTF | Evento | Origen |
| :-- | :-- | :-- |
| **NTF-17** | Reserva pagada en `pending_acceptance` → aviso al tutor (aceptar/rechazar en 24h). | US-606 |
| **NTF-19** | Grabación disponible para descarga. | US-1802 |

> NTF-18 y NTF-20 quedan reservadas en el rango; se cablearán en su épica (Doc 7 §7.4).

---

## 4. Onboarding ampliado (Doc 05 · SCR-AL01/TU01/TU02)

- **Alumno (US-201):** `timezone` (IANA) **y teléfono (E.164)** obligatorios; `onboarding_complete=true` al terminar.
- **Tutor (US-202):** headline, bio, **foto**, teléfono, **redes** y categorías obligatorios → `approval: pending`.
- **KYC (US-203):** documentos = `id_document, degree, certificate, diploma, transcript, cv, social_media` → `identity: pending` + NTF-06. (El set final depende de **C-14**.)

---

## 5. Ventanas y parámetros afinados

| Parámetro | Valor v1.0 | Nota |
| :-- | :-- | :-- |
| Autocancelación pago vencido | **20 min** | antes genérico; **C-07** afina |
| Aceptación del tutor | **24h** | RN-38; timeout = rechazo |
| Retención payout | **7 días**, lote **semanal** | DP-02 |
| Tiers seed (split) | **75 / 85 / 90** | RN-06/07; **C-09** confirma |
| Ventana de sala | **10 / 10 min** | S-45; **C-08** confirma |
| Chat: apertura / retención | **2 días antes / 30 días** | RN-41 |
| Grabación: retención | **30 días** desde `completed_at` | RN-42 |

---

## 6. Decisiones resueltas

- **C-03 / DP-03 (reembolsos):** **resuelta** por **RN-37** (100/50/100). Se consume como configuración; ver Doc 09 y `APROBACION-CLIENTE-FAIMLAB.md`.

Siguen abiertas: C-01 (proveedores), C-07/C-08 (ventanas), C-09 (tiers), C-13 (mercado/Venezuela), C-14 (docs KYC), y el resto del tracker del plan.

---

## 7. Detalle técnico de EP-17 (Chat) y EP-18 (Grabación)

Absorbido del PDF `INTEGRACION-CHAT-Y-GRABACION` (retirado). Vive ahora en:
- **Doc 01 §1.10** — tablas `messages` y `recordings`.
- **Doc 06 §6.18** — Supabase Realtime, purga pg_cron, add-on de grabación de Daily.

---

*Adenda viva. Se pliega dentro de los Docs 00–09 en la próxima pasada de reescritura.*
