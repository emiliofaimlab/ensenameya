import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";

// El porqué de este filtro —y su comprobación— viven en `lib/sentry-bot.ts`.
import { loEjecutaUnBot } from "@/lib/sentry-bot";

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
    beforeSend: (evento) => (loEjecutaUnBot(evento) ? null : evento),
  });
}

/**
 * PostHog: producto, no errores. Mismo interruptor —sin
 * `NEXT_PUBLIC_POSTHOG_KEY` no se carga nada— y mismo sitio que Sentry, porque
 * los dos son "código que corre una vez al arrancar el navegador" y Next ya
 * tiene un fichero para eso.
 *
 * `capture_pageview: "history_change"` es lo que hace que cuente las
 * navegaciones del App Router: sin él solo registraría la PRIMERA carga y todo
 * embudo de más de un paso saldría vacío, sin ningún error de por medio.
 *
 * `person_profiles: "identified_only"` no crea una persona por cada visitante
 * anónimo. Las crea `PostHogIdentidad` al entrar a `(app)`, y así la cuota de
 * PostHog la gastan usuarios reales y no los bots que ya tuvimos que filtrar en
 * Sentry (`lib/sentry-bot.ts`).
 *
 * `entorno` va como propiedad de TODOS los eventos porque la misma clave sirve
 * a producción y a los previews: sin ella un embudo mezcla el tráfico real con
 * el de las pruebas y nadie se da cuenta. En PostHog se filtra por esta
 * propiedad; es el equivalente del `environment` de Sentry.
 */
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: "history_change",
    capture_pageleave: true,
    person_profiles: "identified_only",
  });
  posthog.register({
    entorno: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
