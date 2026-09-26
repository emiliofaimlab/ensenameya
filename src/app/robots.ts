import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";
import { RUTAS_PRIVADAS } from "@/lib/seo";

/**
 * 22-sep-2026 · SE ABRE LA INDEXACIÓN. El bloqueo total existía porque lo que
 * Google habría encontrado era un marketplace con cero tutores; con tutores
 * publicados y movimiento real, seguir cerrado ya solo cuesta tráfico.
 *
 * ⚠️ Pero solo en PRODUCCIÓN. Los previews (`ensenameya-git-dev-….vercel.app`)
 * sirven exactamente el mismo HTML que producción: abiertos, Google los ve como
 * contenido duplicado del dominio bueno y reparte la autoridad entre los dos.
 * `VERCEL_ENV` se evalúa al construir, y Vercel construye cada entorno con la
 * suya, así que esta rama SÍ distingue —al revés que una variable que hubiera
 * que acordarse de poner (§1.3 de `docs/ENTORNOS.md`)—. En local no está
 * definida y cae al lado cerrado, que es lo correcto.
 *
 * Qué se deja fuera y por qué vive en `lib/seo.ts`: ahí está el detalle, y el
 * `npm run check:seo` que impide que un `Disallow` se coma el catálogo.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  const base = siteUrl();
  return {
    // `/*?` · 25-sep-2026: los filtros del catálogo (`?lang=…&level=…&sort=…`)
    // se encadenan y cada combinación enlaza a más: decenas de miles de URLs
    // por categoría, todas dinámicas. Un crawler se metió ahí a ~10 pet/s
    // desde el 23-sep y agotó en dos días la CPU del plan Hobby → sitio
    // pausado. Nada con `?` va al sitemap, así que no se pierde nada indexable.
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...RUTAS_PRIVADAS, "/*?"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
