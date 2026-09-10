// URL pública del sitio. Vive en su PROPIO módulo, y no en `lib/stripe.ts`
// como hasta hoy, porque también la necesita `src/app/layout.tsx` para el
// `metadataBase` de §5.6 — y el layout raíz lo carga cada pantalla del sitio,
// incluidas las que no cobran nada. Importarla de `lib/stripe` arrastraría el
// SDK de Stripe (y su `server-only`) a todas ellas. Aquí no hay ni una cosa ni
// la otra: son cuatro variables de entorno.

/**
 * Base absoluta para `return_url`. Stripe la exige absoluta y con protocolo.
 *
 * ⚠️ ESTO ES EX-07. `VERCEL_URL` es la URL del DESPLIEGUE CONCRETO
 * (`ensenameya-a1b2c3….vercel.app`) y **cambia en cada push**, así que la URL a
 * la que Stripe devuelve al alumno tras pagar deja de existir en cuanto alguien
 * publica. Es exactamente el fallo que se reportó como «pantalla de Vercel tras
 * pagar» y que se cerró como «cosa del sandbox, en producción no se reproduce».
 * Se reproduce igual: lo único que lo evitaba era acordarse de poner
 * `NEXT_PUBLIC_SITE_URL` a mano, y nadie se acordó.
 *
 * La corrección es preferir las URL ESTABLES que Vercel ya expone (requieren
 * "System Environment Variables" activado, que lo está):
 *   · producción → `VERCEL_PROJECT_PRODUCTION_URL`, el dominio del proyecto;
 *   · preview    → `VERCEL_BRANCH_URL`, el alias fijo de la rama
 *                  (`ensenameya-git-dev-….vercel.app`), que NO cambia por push.
 *
 * El reparto por entorno es lo que hace esto seguro, y es la pieza que faltaba
 * en la versión anterior de este comentario: `VERCEL_PROJECT_PRODUCTION_URL`
 * está definida TAMBIÉN en los previews, así que usarla sin mirar `VERCEL_ENV`
 * devolvería al alumno a la app de producción tras pagar en pruebas. Por eso se
 * ramifica en vez de encadenar reservas.
 *
 * `NEXT_PUBLIC_SITE_URL` sigue mandando sobre todo: es la salida para un
 * dominio propio el día que lo haya.
 */
export function siteUrl(): string {
  const explicita = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicita) return explicita.replace(/\/$/, "");

  const entorno = process.env.VERCEL_ENV;
  const estable =
    entorno === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : entorno === "preview"
        ? process.env.VERCEL_BRANCH_URL
        : undefined;
  if (estable) return `https://${estable}`;

  // Último recurso: la del despliegue. Inestable, pero mejor que nada — y en
  // `development` (vercel dev) es la única que hay.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
