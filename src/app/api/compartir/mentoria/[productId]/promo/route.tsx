import { getProductDetail, productIdFrom } from "@/lib/catalog/queries";
import { esFormato, imagenMentoria } from "@/lib/compartir/imagen-mentoria";

/**
 * EY-223 · la imagen con la que el tutor promociona su mentoría:
 * `?formato=banner|post|story` (por defecto `banner`). El molde y el porqué de
 * cada lienzo están en `lib/compartir/imagen-mentoria.tsx`.
 *
 * Pública y sin sesión, como su hermana de «Compartir mi reserva»: solo pinta
 * lo que ya es público en la ficha. Mentoría no activa (o tutor no aprobado) =
 * 404, igual que la ficha. Acepta uuid o slug.
 *
 * `?descargar=1` la sirve como adjunto con un nombre legible: es el botón
 * «Descargar» en los navegadores que no hacen caso del atributo `download`.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { productId } = await params;
  const id = await productIdFrom(productId);
  const p = id ? await getProductDetail(id) : null;
  if (!p) return new Response("No encontrada", { status: 404 });

  const sp = new URL(req.url).searchParams;
  const pedido = sp.get("formato");
  const formato = esFormato(pedido) ? pedido : "banner";

  const headers: Record<string, string> = {
    // La mentoría cambia poco: una hora en el CDN y un día sirviendo la vieja
    // mientras se regenera. Si el tutor cambia la portada, tarda ≤ 1 h en verse.
    "cache-control":
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  };
  if (sp.get("descargar") === "1") {
    headers["content-disposition"] =
      `attachment; filename="ensenameya-${p.slug ?? p.id}-${formato}.png"`;
  }

  return imagenMentoria(p, formato, { headers });
}
