import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

/**
 * Consultas del catálogo público (EP-03). Todo pasa por el cliente ANON + RLS:
 * solo devuelve tutores `approved` y productos `active` de tutores aprobados
 * (Doc 3 / RN-24). Los `.eq('approval_status','approved')` / `.eq('status','active')`
 * son explícitos para leer la intención, aunque RLS ya lo garantice.
 */

type PricingModel = Database["public"]["Enums"]["pricing_model"];

export type CategoryTag = { slug: string; name: string };

export type TutorCardData = {
  id: string;
  headline: string | null;
  bio: string | null;
  ratingAvg: number | null;
  ratingCount: number;
};

export type ProductTutor = {
  id: string;
  headline: string | null;
  ratingAvg: number | null;
  ratingCount: number;
};

export type ProductCardData = {
  id: string;
  title: string;
  outcome: string | null;
  pricingModel: PricingModel;
  priceAmount: number;
  currency: string;
  sessionDurationMin: number | null;
  packageNumSessions: number | null;
  categories: CategoryTag[];
  /** Solo lo rellena el listado de P05; `null` donde no se consultó. */
  tutor?: ProductTutor | null;
};

export type ProductDetail = ProductCardData & {
  description: string | null;
  tutor: {
    id: string;
    headline: string | null;
    ratingAvg: number | null;
    ratingCount: number;
  };
};

const PAGE_SIZE = 12;

function toCategoryTags(
  pc: { categories: CategoryTag | null }[] | null | undefined,
): CategoryTag[] {
  return (pc ?? [])
    .map((row) => row.categories)
    .filter((c): c is CategoryTag => c != null);
}

/** Fila de producto con el embed de categorías → tarjeta. Compartido por las
 *  consultas de listado/búsqueda (el `select` literal se repite en cada sitio
 *  porque Supabase infiere el tipo desde el string literal, no desde una const). */
function mapProductCard(r: {
  id: string;
  title: string;
  outcome: string | null;
  pricing_model: PricingModel;
  price_amount: number;
  currency: string;
  session_duration_min: number | null;
  package_num_sessions: number | null;
  product_categories: { categories: CategoryTag | null }[] | null;
}): ProductCardData {
  return {
    id: r.id,
    title: r.title,
    outcome: r.outcome,
    pricingModel: r.pricing_model,
    priceAmount: r.price_amount,
    currency: r.currency,
    sessionDurationMin: r.session_duration_min,
    packageNumSessions: r.package_num_sessions,
    categories: toCategoryTags(r.product_categories),
  };
}

/** Categorías activas (para filtros); RLS ya limita a `is_active`. */
export async function listActiveCategories(): Promise<CategoryTag[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("slug, name")
    .order("sort_order");
  return data ?? [];
}

export type FeaturedTutor = TutorCardData & {
  /** Precio más bajo entre sus productos activos (unidades menores). */
  priceFromMinor: number | null;
  currency: string | null;
  /** Categorías de sus productos activos (P04 muestra un par en la tarjeta). */
  categories: CategoryTag[];
};

type TutorRow = {
  profile_id: string;
  headline: string | null;
  bio: string | null;
  rating_avg: number | null;
  rating_count: number;
};

/**
 * Añade a cada tutor su precio de entrada y las categorías de sus productos
 * activos. Una sola consulta extra para las dos cosas (P01 y P04 las piden).
 */
async function withProductFacts(rows: TutorRow[]): Promise<FeaturedTutor[]> {
  if (rows.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(
      "tutor_id, price_amount, currency, product_categories(categories(slug, name))",
    )
    .eq("status", "active")
    .in(
      "tutor_id",
      rows.map((r) => r.profile_id),
    );

  const cheapest = new Map<string, { amount: number; currency: string }>();
  const cats = new Map<string, Map<string, string>>();
  for (const p of data ?? []) {
    const current = cheapest.get(p.tutor_id);
    if (!current || p.price_amount < current.amount) {
      cheapest.set(p.tutor_id, { amount: p.price_amount, currency: p.currency });
    }
    const bucket = cats.get(p.tutor_id) ?? new Map<string, string>();
    for (const tag of toCategoryTags(p.product_categories)) {
      bucket.set(tag.slug, tag.name);
    }
    cats.set(p.tutor_id, bucket);
  }

  return rows.map((r) => ({
    id: r.profile_id,
    headline: r.headline,
    bio: r.bio,
    ratingAvg: r.rating_avg,
    ratingCount: r.rating_count,
    priceFromMinor: cheapest.get(r.profile_id)?.amount ?? null,
    currency: cheapest.get(r.profile_id)?.currency ?? null,
    categories: [...(cats.get(r.profile_id) ?? new Map())].map(
      ([slug, name]) => ({ slug, name }),
    ),
  }));
}

/** US-301 — tutores aprobados, filtrables por categoría y rating, paginados. */
export async function listApprovedTutors(opts: {
  categorySlug?: string;
  minRating?: number;
  page: number;
}): Promise<{ tutors: FeaturedTutor[]; hasMore: boolean; total: number }> {
  const supabase = await createClient();
  const from = (opts.page - 1) * PAGE_SIZE;

  // Filtro por categoría: ids de tutores con ≥1 producto activo en esa categoría.
  let tutorIds: string[] | null = null;
  if (opts.categorySlug) {
    const { data } = await supabase
      .from("products")
      .select("tutor_id, product_categories!inner(categories!inner(slug))")
      .eq("status", "active")
      .eq("product_categories.categories.slug", opts.categorySlug);
    tutorIds = [...new Set((data ?? []).map((r) => r.tutor_id))];
    if (tutorIds.length === 0) return { tutors: [], hasMore: false, total: 0 };
  }

  let base = supabase
    .from("tutor_profiles")
    .select("profile_id, headline, bio, rating_avg, rating_count", {
      count: "exact",
    })
    .eq("approval_status", "approved");
  if (tutorIds) base = base.in("profile_id", tutorIds);
  if (opts.minRating) base = base.gte("rating_avg", opts.minRating);

  const { data, count } = await base
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE); // 1 fila extra = ¿hay más?

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  return {
    tutors: await withProductFacts(rows.slice(0, PAGE_SIZE)),
    hasMore,
    total: count ?? rows.length,
  };
}

/**
 * P01 — "Tutores destacados": los mejor valorados, con su precio de entrada.
 * El nombre real y la foto **no son públicos** (profiles solo lo lee su dueño),
 * así que la tarjeta se apoya en `headline`, como el resto del catálogo.
 */
export async function listFeaturedTutors(limit = 4): Promise<FeaturedTutor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("profile_id, headline, bio, rating_avg, rating_count")
    .eq("approval_status", "approved")
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .limit(limit);

  return withProductFacts(data ?? []);
}

/** US-304 (P07) — perfil público del tutor + sus clases activas. */
export async function getTutorDetail(
  id: string,
): Promise<{ tutor: TutorCardData; products: ProductCardData[] } | null> {
  const supabase = await createClient();

  const { data: t } = await supabase
    .from("tutor_profiles")
    .select("profile_id, headline, bio, rating_avg, rating_count")
    .eq("profile_id", id)
    .eq("approval_status", "approved")
    .maybeSingle();
  if (!t) return null;

  const { data: prods } = await supabase
    .from("products")
    .select(
      "id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, product_categories(categories(slug, name))",
    )
    .eq("tutor_id", id)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const products = (prods ?? []).map(mapProductCard);

  return {
    tutor: {
      id: t.profile_id,
      headline: t.headline,
      bio: t.bio,
      ratingAvg: t.rating_avg,
      ratingCount: t.rating_count,
    },
    products,
  };
}

export type TutorReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

/**
 * US-902 — reseñas públicas del tutor. Se muestran sin nombre del alumno: el
 * perfil es público (cliente anon) y `profiles.full_name` está protegido por
 * RLS, así que atribuirlas a un nombre no es posible sin romper esa barrera.
 * Anónimas es, además, una elección razonable de privacidad para el MVP.
 */
export async function listTutorReviews(tutorId: string): Promise<TutorReview[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reviews")
    .select("id, rating, comment, created_at")
    .eq("tutor_id", tutorId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
  }));
}

/** US-304 (P08) — detalle de producto; null si no es visible (RN-24). */
export async function getProductDetail(
  id: string,
): Promise<ProductDetail | null> {
  const supabase = await createClient();

  const { data: p } = await supabase
    .from("products")
    .select(
      "id, title, description, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, tutor_id, product_categories(categories(slug, name))",
    )
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();
  if (!p) return null;

  // El tutor debe estar aprobado (RLS ya lo exige para que el producto salga).
  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select("profile_id, headline, rating_avg, rating_count")
    .eq("profile_id", p.tutor_id)
    .eq("approval_status", "approved")
    .maybeSingle();
  if (!tutor) return null;

  return {
    id: p.id,
    title: p.title,
    description: p.description,
    outcome: p.outcome,
    pricingModel: p.pricing_model,
    priceAmount: p.price_amount,
    currency: p.currency,
    sessionDurationMin: p.session_duration_min,
    packageNumSessions: p.package_num_sessions,
    categories: toCategoryTags(p.product_categories),
    tutor: {
      id: tutor.profile_id,
      headline: tutor.headline,
      ratingAvg: tutor.rating_avg,
      ratingCount: tutor.rating_count,
    },
  };
}

/** Nombre de una categoría activa (o null si no existe / inactiva por RLS). */
export async function getCategoryBySlug(
  slug: string,
): Promise<{ name: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("name")
    .eq("slug", slug)
    .maybeSingle();
  return data ?? null;
}

/**
 * US-302 — productos activos (de tutores aprobados por RLS), filtrables y
 * paginados. Precio y sesiones se filtran en la BD porque son columnas de
 * `products`; no hace falta el rodeo que sí necesita el precio del tutor.
 * ponytail: sin filtros de nivel ni idioma — el Figma los pide pero `products`
 * no tiene esas columnas; requieren migración.
 */
export async function listActiveProducts(opts: {
  categorySlug?: string;
  model?: PricingModel;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  minSessions?: number;
  maxSessions?: number;
  page: number;
}): Promise<{
  products: ProductCardData[];
  hasMore: boolean;
  total: number;
}> {
  const supabase = await createClient();
  const from = (opts.page - 1) * PAGE_SIZE;

  // Filtro por categoría: ids de productos activos en esa categoría (2 pasos para
  // conservar TODAS las categorías del producto en la tarjeta, no solo la filtrada).
  let ids: string[] | null = null;
  if (opts.categorySlug) {
    const { data } = await supabase
      .from("product_categories")
      .select("product_id, categories!inner(slug), products!inner(status)")
      .eq("categories.slug", opts.categorySlug)
      .eq("products.status", "active");
    ids = [...new Set((data ?? []).map((r) => r.product_id))];
    if (ids.length === 0) return { products: [], hasMore: false, total: 0 };
  }

  let base = supabase
    .from("products")
    .select(
      "id, tutor_id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, product_categories(categories(slug, name))",
      { count: "exact" },
    )
    .eq("status", "active");
  if (ids) base = base.in("id", ids);
  if (opts.model) base = base.eq("pricing_model", opts.model);
  if (opts.minPriceMinor) base = base.gte("price_amount", opts.minPriceMinor);
  if (opts.maxPriceMinor) base = base.lte("price_amount", opts.maxPriceMinor);
  if (opts.minSessions) {
    base = base.gte("package_num_sessions", opts.minSessions);
  }
  if (opts.maxSessions) {
    base = base.lte("package_num_sessions", opts.maxSessions);
  }

  const { data, count } = await base
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE); // 1 fila extra = ¿hay más?

  const rows = (data ?? []).slice(0, PAGE_SIZE);
  const hasMore = (data ?? []).length > PAGE_SIZE;

  // El tutor va aparte: products apunta a `profiles`, no a `tutor_profiles`,
  // así que PostgREST no puede embeberlo desde aquí.
  const tutors = new Map<string, ProductTutor>();
  if (rows.length > 0) {
    const { data: tp } = await supabase
      .from("tutor_profiles")
      .select("profile_id, headline, rating_avg, rating_count")
      .in("profile_id", [...new Set(rows.map((r) => r.tutor_id))]);
    for (const t of tp ?? []) {
      tutors.set(t.profile_id, {
        id: t.profile_id,
        headline: t.headline,
        ratingAvg: t.rating_avg,
        ratingCount: t.rating_count,
      });
    }
  }

  return {
    products: rows.map((r) => ({
      ...mapProductCard(r),
      tutor: tutors.get(r.tutor_id) ?? null,
    })),
    hasMore,
    total: count ?? rows.length,
  };
}

/**
 * Deja el término apto para un patrón `ilike` dentro de un `or(...)`: quita las
 * comas y paréntesis que romperían la gramática del filtro de PostgREST, y los
 * comodines `%`/`_` para que el usuario no controle el patrón.
 */
function likeSafe(q: string): string {
  return q.replace(/[,()%_*\\]/g, " ").trim().slice(0, 60);
}

/** US-303 — tutores cuyo headline o bio menciona el término. */
export async function searchTutors(q: string): Promise<FeaturedTutor[]> {
  const term = likeSafe(q);
  if (!term) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("profile_id, headline, bio, rating_avg, rating_count")
    .eq("approval_status", "approved")
    .or(`headline.ilike.%${term}%,bio.ilike.%${term}%`)
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);

  return withProductFacts(data ?? []);
}

/** US-303 — categorías cuyo nombre menciona el término. */
export async function searchCategories(q: string): Promise<CategoryTag[]> {
  const term = likeSafe(q);
  if (!term) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("slug, name")
    .ilike("name", `%${term}%`)
    .order("sort_order");
  return data ?? [];
}

/** US-303 — búsqueda por texto en productos (título+descripción, `search_vector`
 *  tsvector `spanish`, RN-20). */
export async function searchProducts(q: string): Promise<ProductCardData[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(
      "id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, product_categories(categories(slug, name))",
    )
    .eq("status", "active")
    .textSearch("search_vector", q, { type: "websearch", config: "spanish" })
    .limit(PAGE_SIZE);
  return (data ?? []).map(mapProductCard);
}
