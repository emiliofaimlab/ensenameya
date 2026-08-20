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

// ⚠️ CUÁNTO SE LE RETIENE EL HORARIO AL ALUMNO — y por qué vive aquí.
//
// La fuente de verdad es la migración `20260709190000`: el `p_payment_cutoff`
// de `expire_stale_bookings`, que pg_cron ejecuta cada 5 minutos dentro de la
// propia base (regla de oro 5). Esto es la copia que se ENSEÑA, exactamente
// igual que `CANCELLATION_POLICY` con los reembolsos: si divergen, gana el SQL
// y el número equivocado es este.
//
// Está en `lib/policy.ts` y no en el Route Handler que lo usa porque desde D-2
// (§20.14) hay DOS sitios que hablan de este plazo y tienen que decir el mismo
// número: el contador del checkout (`/api/pagos/checkout` → `HoldCountdown`) y
// la promesa del selector de horarios, justo encima de «Continuar al pago».
// Escribirlo a mano en los dos es como acaban divergiendo — el selector estuvo
// prometiendo hasta hoy justo lo contrario de lo que hace el código.
//
// ⚠️ SE ANUNCIA EL PLAZO CORTO A PROPÓSITO. El cron corre cada 5 minutos, así
// que una reserva puede sobrevivir hasta 25; prometer 25 sería prometer un
// retraso del job. Que el horario aguante un poco más de lo anunciado es la
// dirección buena del error.
export const HOLD_POLICY = {
  minutes: 20,
} as const;
