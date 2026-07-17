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

/** US-301 — tutores aprobados, filtrables por categoría, paginados. */
export async function listApprovedTutors(opts: {
  categorySlug?: string;
  page: number;
}): Promise<{ tutors: TutorCardData[]; hasMore: boolean }> {
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
    if (tutorIds.length === 0) return { tutors: [], hasMore: false };
  }

  const base = supabase
    .from("tutor_profiles")
    .select("profile_id, headline, bio, rating_avg, rating_count")
    .eq("approval_status", "approved");
  const filtered = tutorIds ? base.in("profile_id", tutorIds) : base;

  const { data } = await filtered
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE); // 1 fila extra = ¿hay más?

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const tutors = rows.slice(0, PAGE_SIZE).map((r) => ({
    id: r.profile_id,
    headline: r.headline,
    bio: r.bio,
    ratingAvg: r.rating_avg,
    ratingCount: r.rating_count,
  }));
  return { tutors, hasMore };
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

/** US-302 — productos activos (de tutores aprobados por RLS), filtrables por
 *  categoría y paginados. */
export async function listActiveProducts(opts: {
  categorySlug?: string;
  page: number;
}): Promise<{ products: ProductCardData[]; hasMore: boolean }> {
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
    if (ids.length === 0) return { products: [], hasMore: false };
  }

  const base = supabase
    .from("products")
    .select(
      "id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, product_categories(categories(slug, name))",
    )
    .eq("status", "active");
  const filtered = ids ? base.in("id", ids) : base;

  const { data } = await filtered
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE); // 1 fila extra = ¿hay más?

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  return { products: rows.slice(0, PAGE_SIZE).map(mapProductCard), hasMore };
}

/** US-303 — búsqueda por texto en productos (título+descripción, `search_vector`
 *  tsvector `spanish`, RN-20). Tutor/categoría como resultado → diferido. */
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
