import type { MetadataRoute } from "next";

import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { RUTAS_FIJAS } from "@/lib/seo";

/**
 * Lo que se le ofrece a Google. Las fijas salen de `lib/seo.ts`; las de ficha
 * —tutores, mentorías, categorías y academias— de la base, porque son las que
 * cambian solas cada vez que un tutor se aprueba o publica.
 *
 * Los filtros (`approved`, `active`) son los MISMOS que pinta el catálogo
 * (`lib/catalog/queries.ts`): anunciar una ficha que luego devuelve 404 es la
 * forma más barata de que Search Console se llene de errores.
 *
 * ⚠️ Se mira el `error` de cada consulta, no solo el `data`: un `const { data }`
 * a secas convierte un fallo en una lista vacía —un sitemap con 12 URL en vez
 * de 200, sin que nada se ponga rojo— que es la mentira creíble de la regla de
 * oro 10. Aquí no se aborta: media lista es mejor que ninguna, pero queda
 * escrita en los logs.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const supabase = await createClient();

  const [tutores, productos, categorias, academias] = await Promise.all([
    supabase
      .from("tutors_public")
      .select("profile_id")
      .eq("approval_status", "approved"),
    supabase.from("products").select("id, updated_at").eq("status", "active"),
    supabase.from("categories").select("slug").eq("is_active", true),
    supabase.from("academies_public").select("slug"),
  ]);

  for (const [nombre, r] of [
    ["tutors_public", tutores],
    ["products", productos],
    ["categories", categorias],
    ["academies_public", academias],
  ] as const) {
    if (r.error) console.error("[sitemap]", nombre, r.error.code, r.error.message);
  }

  const ahora = new Date();
  const url = (ruta: string, lastModified: Date = ahora) => ({
    url: `${base}${ruta}`,
    lastModified,
  });

  return [
    ...RUTAS_FIJAS.map((r) => url(r)),
    ...(tutores.data ?? [])
      .filter((t) => t.profile_id)
      .map((t) => url(`/tutors/${t.profile_id}`)),
    ...(productos.data ?? []).map((p) =>
      url(`/products/${p.id}`, p.updated_at ? new Date(p.updated_at) : ahora),
    ),
    ...(categorias.data ?? [])
      .filter((c) => c.slug)
      .map((c) => url(`/categories/${c.slug}`)),
    ...(academias.data ?? [])
      .filter((a) => a.slug)
      .map((a) => url(`/academias/${a.slug}`)),
  ];
}
