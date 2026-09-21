import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Next no versiona lo que hay en `public/`, así que no puede cachearlo
        // sin riesgo y lo sirve con `max-age=0, must-revalidate`: un viaje
        // condicional completo por delante del primer byte del video EN CADA
        // visita. En una red móvil con latencia alta eso es justo lo que hace
        // que el usuario baje antes de ver nada.
        //
        // Aquí la versión va en el NOMBRE (`-v2`), así que el `immutable` es
        // seguro: para invalidar se cambia el nombre del fichero, nunca esta
        // cabecera.
        source: "/:carpeta(video|img)/:fichero*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

/**
 * ── POR QUÉ ESTO ENVUELVE AL CONFIG: LOS SOURCE MAPS ────────────────────────
 *
 * Sentry ya recogía errores del navegador (`src/instrumentation-client.ts`),
 * pero sin subir los mapas, así que todo lo que llegaba era ilegible. El caso
 * que lo motiva, del 17-sep-2026: «Rendered more hooks than during the previous
 * render» en `/signup`, con la traza entera en
 * `44-smpbrkmny5.js:1:71077` y nombres como `ol`, `sd`, `sf` — todo interno de
 * React y ni un fichero nuestro. Un error real, imposible de localizar: se
 * buscó a mano por `signup-form`, por `AuthShell` y por todo el repo (hooks
 * tras un `return` temprano, hooks en ternarios, en `&&`, en `.map`) sin
 * encontrarlo, y sin poder reproducirlo a mano en producción.
 *
 * Con los mapas subidos, el PRÓXIMO que salte trae fichero y línea. Eso es lo
 * que convierte a Sentry en algo accionable; hasta ahora era un detector de
 * humo que solo sabe decir «hay humo».
 *
 * ⚠️ LA CREDENCIAL ES EL INTERRUPTOR, como el resto del proyecto. Sin
 * `SENTRY_AUTH_TOKEN` en el entorno de build, el plugin NO sube nada y el build
 * sigue pasando igual: no se rompe el despliegue de nadie por una variable que
 * falte. Con ella puesta en Vercel, cada despliegue sube sus mapas.
 *
 * ⚠️ Y SE BORRAN DESPUÉS DE SUBIRLOS (`deleteSourcemapsAfterUpload`). Sin eso
 * quedan servidos en `/_next/static/` y cualquiera puede reconstruir el código
 * fuente del cliente desde el navegador. Que Sentry los tenga es justo lo que
 * hace que no haga falta publicarlos.
 */
export default withSentryConfig(nextConfig, {
  // Los dos de la URL de las incidencias: `ensename-ya.sentry.io`, proyecto
  // `javascript-nextjs` (el prefijo de JAVASCRIPT-NEXTJS-4 y -5).
  org: "ensename-ya",
  project: "javascript-nextjs",

  // En local el plugin no tiene nada que decir; en CI sí interesa ver si subió.
  silent: !process.env.CI,

  // Los chunks del App Router caen fuera de la carpeta que el plugin mira por
  // defecto, y son justo los que salen en las trazas de `/signup`.
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Nada de telemetría del propio plugin hacia Sentry.
  telemetry: false,
});
