import * as Sentry from "@sentry/nextjs";

/**
 * US-1501 · Sentry en el navegador. Mismo interruptor que el servidor, pero la
 * variable tiene que ser pública para llegar al bundle: sin
 * `NEXT_PUBLIC_SENTRY_DSN` no se inicializa nada.
 *
 * Un DSN es público por diseño (solo permite ENVIAR eventos), así que exponerlo
 * no rompe la regla de oro 3 — esa es para la `service_role`.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
