import type { MetadataRoute } from "next";

/**
 * ⚠️ BLOQUEO DE PRE-LANZAMIENTO — se quita el día del corte, en el mismo commit
 * que los `redirects` de `vercel.json`. Los dos son la misma decisión.
 *
 * ⚠️ Y ESTO YA NO ES LO ÚNICO QUE QUEDA DEL BLOQUEO: la redirección de
 * pre-lanzamiento se quitó el 10-sep y el sitio abre en su home. Este fichero
 * sobrevive **a propósito**, porque son dos cosas distintas: que el sitio
 * funcione y que Google lo indexe. Se abre cuando haya tutores publicados.
 *
 * Por qué existe: hasta ahora la app vivía en `ensenameya.vercel.app`, sin
 * enlaces entrantes y sin nadie que la buscara. En cuanto `ensenameya.com`
 * apunte aquí hereda la autoridad de la landing de GoDaddy, y lo que Google
 * encontraría es un marketplace con **cero tutores** y un checkout en
 * `sk_test_`. Ese es el estado que no se puede indexar: no el dominio.
 *
 * Por qué NO va detrás de una variable de entorno: Vercel inyecta las env vars
 * al **construir**, así que cambiarla exige un Redeploy igual que cambiar este
 * fichero. La variable no ahorra el despliegue — solo añade una forma más de
 * equivocarse (§1.3 de `docs/ENTORNOS.md`: "Vercel no aplica una variable nueva
 * a un despliegue que ya existe").
 *
 * El día del lanzamiento esto pasa a ser un `allow` con su `sitemap`. Hoy no
 * hay `sitemap.ts` y no hace falta: sin nada que indexar, no hay nada que
 * anunciar.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
