// RN-37 (resuelve C-03 / DP-03) — política de cancelación ÚNICA de la plataforma,
// igual para todos los tutores (no hay override por tutor en el MVP). Fuente
// única: la muestra US-403 y la consumirá el cálculo de reembolso al cancelar
// (US-604). Umbral en horas de antelación respecto al inicio de la sesión.
export const CANCELLATION_POLICY = {
  cutoffHours: 24,
  refundPct: {
    studentEarly: 100, // alumno cancela con ≥ cutoff de antelación → 100%
    studentLate: 50, //   alumno cancela con < cutoff de antelación → 50%
    tutorCancels: 100, //  cancela el tutor (en cualquier momento)  → 100%
  },
} as const;
