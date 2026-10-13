import { getProductDetail, productIdFrom } from "@/lib/catalog/queries";
import { FORMATOS, imagenMentoria } from "@/lib/compartir/imagen-mentoria";

/**
 * EY-223 · la vista previa del enlace de la ficha (WhatsApp, Facebook,
 * LinkedIn, X…) es la MISMA tarjeta banner que el tutor descarga en «Compartir
 * mi mentoría». Así el enlace compartido a pelo ya llega con precio, tutor y
 * valoración, sin que el tutor suba nada.
 *
 * Por convención de archivo y no como `openGraph.images` apuntando a
 * `/api/…`: `robots.txt` cierra `/api/` (`lib/seo.ts`) y los rastreadores de
 * X y LinkedIn lo respetan, así que una imagen colgada de ahí no la vería
 * nadie. Esta sirve bajo `/mentorias/<id>/opengraph-image-…`, que es pública.
 */
export const alt = "Mentoría en Enséñame Ya";
export const size = FORMATOS.banner;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = await productIdFrom((await params).id);
  const p = id ? await getProductDetail(id) : null;
  if (!p) return new Response("No encontrada", { status: 404 });
  return imagenMentoria(p, "banner");
}
