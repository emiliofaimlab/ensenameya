import * as Sentry from "@sentry/nextjs";

/**
 * US-1501 · Monitoreo de errores (EP-15, Doc 6 §6.13, S-09).
 *
 * La credencial es el interruptor, igual que con Daily y con el PSP: sin
 * `SENTRY_DSN` el SDK arranca apagado y no manda nada. Poner el DSN en Vercel
 * (Preview y Production) lo enciende, sin tocar código.
 *
 * No se envuelve `next.config` con `withSentryConfig`: eso sirve para subir
 * source maps y pide token de organización. Se añade cuando exista la cuenta y
 * los stack traces minificados molesten de verdad.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    // Solo errores. El tracing se enciende el día que haya una pregunta de
    // rendimiento que responder; hasta entonces es cuota y ruido.
    tracesSampleRate: 0,
    // El usuario no se identifica solo: los correos de alumnos y tutores no
    // tienen por qué salir de Supabase (RLS los protege, no los regalamos aquí).
    sendDefaultPii: false,
  });
}

export const onRequestError = Sentry.captureRequestError;
