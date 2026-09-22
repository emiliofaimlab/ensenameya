import Script from "next/script";

/**
 * GA4 por `gtag.js`. Sin `NEXT_PUBLIC_GA_ID` no se pinta ni una etiqueta: la
 * credencial es el interruptor, igual que el resto de integraciones del repo.
 *
 * ⚠️ La variable se define SOLO en el entorno Production de Vercel. Definida en
 * "All Environments" contamina la propiedad con el tráfico de los previews y de
 * `npm run dev`, y GA4 no tiene forma cómoda de separarlos después. PostHog sí
 * la tiene —se etiqueta cada evento con el entorno—, por eso allí no se hace
 * esta distinción y aquí sí.
 *
 * No hay componente que capture los cambios de ruta: GA4 lo hace por su cuenta
 * con "Enhanced measurement › Page changes based on browser history events",
 * que viene activado en toda propiedad nueva. Si alguien lo apaga en la consola
 * de GA, las navegaciones internas dejan de contarse y NO hay nada en el código
 * que lo delate — se mira ahí antes de buscar el fallo aquí.
 *
 * ponytail: `next/script` en vez de `@next/third-parties`; son ocho líneas y
 * una dependencia menos. Si algún día entra Google Ads o Tag Manager, esa
 * librería ya sí paga su sitio.
 */
export function GoogleAnalytics() {
  const id = process.env.NEXT_PUBLIC_GA_ID;
  if (!id) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
        strategy="afterInteractive"
      />
      <Script
        id="ga4"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${id}')`,
        }}
      />
    </>
  );
}
