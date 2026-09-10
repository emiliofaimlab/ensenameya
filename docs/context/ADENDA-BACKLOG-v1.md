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
| **Pagos** | Nada de esta adenda manda sobre `docs/DICTADO-PAGOS.md` |

---

## 1. Reglas de negocio nuevas (RN-37…RN-44)

| RN | Regla | Origen |
| :-- | :-- | :-- |
| **RN-37** | **Política de cancelación/reembolso única de plataforma** (no por tutor). Reembolso: **≥24h = 100%**, **<24h por el alumno = 50%**, **cancelada por el tutor = 100%**. Visible en perfil y checkout. | US-403, US-604 |
| **RN-38** | Reserva pagada entra en **`pending_acceptance`**: el tutor **acepta (→`confirmed`) o rechaza** en **24h**; timeout = rechazo → `cancelled` + reembolso 100%. | US-606 |
| **RN-40** | **Retiro self-service** del tutor: dispara payout `trigger=tutor_request`, solo sobre saldo con retención **ya vencida**. Admin conserva hold/release. | US-1004 |
| **RN-41** | **Chat de reserva** persistente (tabla `messages`): 1:1 por reserva, habilitado **2 días antes**, retención **30 días** (`expires_at` + purga pg_cron), RLS por participantes. | EP-17 |
| **RN-42** | 🔴 **Reformulada el 2-sep-2026: la grabación es OBLIGATORIA y NOTIFICADA.** No hay consentimiento que recabar — `recording_allowed()` devuelve `true` siempre, y por eso la casilla de la sala dice «Entiendo» y no «Acepto». Lo que sigue vigente de esta regla es la **retención: 30 días** desde `completed_at`, que es lo que prometen las páginas legales. El cloud recording de Daily está contratado y consume. | EP-18 |
| **RN-43** | **Card-on-file**: tokenización en el PSP; **nunca se guarda el PAN**; token reutilizable (`payment_methods`). ⚠️ El formulario embebido de dLocal **no tiene bóveda**, así que donde cobre dLocal no se puede guardar la tarjeta → decisión abierta D-6 del dictado. | US-602/607 |
| **RN-44** | **Onboarding ampliado**: teléfono en formato **E.164** obligatorio (alumno y tutor); flag `onboarding_complete`; tutor añade foto + redes; KYC amplía documentos. | US-201/202/203 |

---

## 2. La máquina de reserva con `pending_acceptance` (Doc 02 · M4)

**RN-38** mete un estado entre el pago y la confirmación:

```
pending_payment ──pago──▶ pending_acceptance ──tutor acepta──▶ confirmed
       │                          │
       │                          ├─ tutor rechaza / vencen las 24 h ─▶ cancelled (+ reembolso 100 %)
       └─ 20 min sin pago (RN-27) ─▶ cancelled
```

- **`confirmed` es el disparador** de la creación de `sessions` y del devengo del `payout_item`. En
  `pending_acceptance` todavía no existe ni una sesión ni una sala.
- El aviso al tutor de que tiene 24 h es **NTF-17**, y hoy **no se manda** (§3).
- Ya está reflejado en el Doc 02 §2.7; esta sección queda como trazabilidad de dónde salió.

---

## 3. Notificaciones nuevas (catálogo ahora NTF-01…23)

| NTF | Evento | Estado | Origen |
| :-- | :-- | :-- | :-- |
| **NTF-17** | Reserva pagada en `pending_acceptance` → aviso al tutor (aceptar/rechazar en 24 h). | 🔴 **stub**: el camino existe y no encola nada | US-606 |
| **NTF-19** | Grabación disponible para descarga. | ✅ en código (`recording_ready`) | US-1802 |
| **NTF-21** | Mensaje nuevo en un hilo de chat. Agrupa por hilo y hora, así que una ráfaga es un solo aviso. | ✅ en código (`new_message`) | EY-151 |
| **NTF-22** | El admin escribe a un alumno o a un tutor desde la bandeja de moderación. | ✅ en código (`admin_message`) | EY-189 |
| **NTF-23** | Payout reclamado y sin cerrar tras N días. | ✅ en código (`payout_unclaimed`) | payouts |

> **NTF-18 y NTF-20 siguen reservadas** en el rango, sin evento asignado. Catálogo completo, con el
> estado de cada una y el cruce pantalla → notificación: **Doc 7 §7.3 y §7.3b**.

---

## 4. Onboarding ampliado (SCR-AL01 / TU01 / TU02, Doc 04 §4.2)

- **Alumno (US-201):** `timezone` (IANA) **y teléfono (E.164)** obligatorios; `onboarding_complete=true` al terminar.
- **Tutor (US-202):** headline, bio, **foto**, teléfono, **redes** y categorías obligatorios → `approval: pending`.
- **KYC (US-203):** ✅ **C-14 resuelta: son SEIS documentos**, no siete. El set en código es
  `cv, degree, id_document, certificate, diploma, transcript` → `identity: pending` + NTF-06. Los tres
  primeros están marcados como obligatorios en la pantalla, aunque ningún paso del asistente bloquea.
  **`social_media` no es un documento de KYC**: las redes son un campo del perfil del tutor.

---

## 5. Ventanas y parámetros afinados

| Parámetro | Valor v1.0 | Nota |
| :-- | :-- | :-- |
| Autocancelación pago vencido | **20 min** | ✅ En código (RN-27). Deja obsoleto el S-25 de 30 min del Doc 02 |
| Aceptación del tutor | **24h** | RN-38; timeout = rechazo |
| Retención payout | **7 días**, lote **semanal** (lunes 03:00) | ✅ Confirmado en código; cierra DP-02 |
| Tiers seed (split) | **75 / 85 / 90** | ✅ Sembrados así, con Tier 1 como `is_default`. Son configuración, no código |
| Ventana de sala | **10 / 10 min** | ✅ Confirmado en código. Ojo: son **dos** funciones separadas —acceso a la sala y contabilidad de la clase— que hoy dan el mismo rango |
| Chat: apertura / retención | **2 días antes / 30 días** | RN-41 |
| Grabación: retención | **30 días** desde `completed_at` | RN-42, purgado por `/api/cron/recordings-purge` |

---

## 6. Decisiones resueltas

- **C-03 / DP-03 (reembolsos):** **RN-37** (100/50/100), única de plataforma. Vive en
  `src/lib/policy.ts` y de ahí lo leen también las páginas legales.
- **C-01 / DP-01 (proveedores):** el cobro lo decide el país del **alumno** y el payout el del
  **tutor** → `docs/DICTADO-PAGOS.md`.
- **C-11 / DP-05 (correo):** **Resend**.
- **C-14 (documentos de KYC):** **seis**, ver §4.
- **C-07 / C-08 / C-09 (ventanas y tiers):** los valores de §5 están en código y operando.

**Sigue abierta C-13** (mercado y métodos de pago para Venezuela) — el único bloqueante de negocio
de esta lista, y con Venezuela pagando a mano es el que más carga operativa arrastra. Estado
consolidado de las DP en **Doc 09 §9.2**.

---

## 7. Detalle técnico de EP-17 (Chat) y EP-18 (Grabación)

Absorbido del PDF `INTEGRACION-CHAT-Y-GRABACION` (retirado). Vive ahora en:
- **Doc 01 §1.10** — la tabla `messages`. ⚠️ **No hay tabla `recordings`, y es a propósito**: las
  grabaciones se consultan a Daily en el momento y no se guarda ninguna URL.
- **Doc 06 §6.18** — Supabase Realtime para el chat, purga en pg_cron, y cómo se arranca de verdad
  una grabación (`start_cloud_recording` en el token, no una propiedad de la sala).

---

*Adenda viva. Se pliega dentro de los Docs 00–09 en la próxima pasada de reescritura.*

> ⚠️ **RN-39 no existe**: la numeración salta de RN-38 a RN-40 y el hueco no se ha reutilizado.
