// ⚠️ ESTO NO CALCULA NINGÚN REEMBOLSO REAL. Es la copia que leen la pantalla de
// cancelación (US-403) y las páginas legales para poder ENSEÑAR la política; el
// porcentaje que manda lo aplica `cancel_booking` en SQL, sobre la sesión
// agendada más próxima y con la hora del servidor. Si algún día divergen, gana
// la migración (regla de oro 5) y esta constante es la que está mal.
//
// Y desde X-01 (`20260817170000`) hay un tercer eslabón que conviene tener en
// la cabeza al tocar estos números: el porcentaje no solo cambia un estado en
// Postgres, se convierte en un `refunds.create` contra el PSP a través de la
// cola `refund_requests` que vacía `/api/cron/refunds-process`. Subir aquí un
// 50 a 100 sin tocar la función no devuelve un céntimo de más: solo hace que la
// pantalla y los Términos prometan algo que el dinero no cumple.
//
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
