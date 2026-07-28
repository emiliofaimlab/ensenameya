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
  /** Nivel que enseña (IV-02). Es del TUTOR, no por materia. */
  teachingLevel?: string | null;
  /** Nombre público que el tutor decide mostrar (DD-01); null = sin publicar. */
  displayName: string | null;
  /** Ruta en el bucket público `avatars` (DD-01). */
  avatarPath: string | null;
  headline: string | null;
  bio: string | null;
  ratingAvg: number | null;
  ratingCount: number;
};

export type ProductTutor = {
  id: string;
  displayName: string | null;
  avatarPath: string | null;
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
  /** Ruta en el bucket público `product-images` (DD-02). */
  imagePath: string | null;
  categories: CategoryTag[];
  /** Solo lo rellena el listado de P05; `null` donde no se consultó. */
  tutor?: ProductTutor | null;
};

export type ProductDetail = ProductCardData & {
  description: string | null;
  tutor: ProductTutor & { bio: string | null };
  /** FAQ propias de la mentoría (R24-17); vacío = se muestran las genéricas. */
  faqs: { q: string; a: string }[];
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
  image_path: string | null;
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
    imagePath: r.image_path,
    categories: toCategoryTags(r.product_categories),
  };
}

/** Añade a cada producto su tutor (nombre público, foto y rating). `products`
 *  apunta a `profiles`, no a `tutor_profiles`, así que PostgREST no lo embebe:
 *  va en una segunda consulta. Lo usan el listado (P05) y la búsqueda (P09). */
async function withTutors<T extends ProductCardData & { tutorId: string }>(
  rows: T[],
): Promise<ProductCardData[]> {
  if (rows.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("profile_id, display_name, avatar_path, headline, rating_avg, rating_count")
    .in("profile_id", [...new Set(rows.map((r) => r.tutorId))]);

  const tutors = new Map<string, ProductTutor>();
  for (const t of data ?? []) {
    tutors.set(t.profile_id, {
      id: t.profile_id,
      displayName: t.display_name,
      avatarPath: t.avatar_path,
      headline: t.headline,
      ratingAvg: t.rating_avg,
      ratingCount: t.rating_count,
    });
  }
  return rows.map(({ tutorId, ...p }) => ({
    ...p,
    tutor: tutors.get(tutorId) ?? null,
  }));
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
  display_name: string | null;
  avatar_path: string | null;
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
    displayName: r.display_name,
    avatarPath: r.avatar_path,
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

/** Filtro de disponibilidad de P04. Las reglas son semanales (weekday + rango),
 *  así que "esta semana" = tiene cualquier regla activa. */
export type AvailabilityFilter = "today" | "week" | "weekend";
/** Orden de P04. El precio no entra: sale de los productos, no de la fila del
 *  tutor, y ordenar por él rompería la paginación (pide DD-04 / `EY-114`). */
export type TutorSort = "rating" | "reviews";

/** US-301 — tutores aprobados, filtrables por categoría y rating, paginados. */
export async function listApprovedTutors(opts: {
  categorySlug?: string;
  minRating?: number;
  availability?: AvailabilityFilter;
  sort?: TutorSort;
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

  // Disponibilidad: se mira la REGLA semanal, no los huecos libres reales.
  // ponytail: no descuenta excepciones ni sesiones ya reservadas — para un
  // filtro de listado basta; el hueco de verdad se comprueba al reservar.
  if (opts.availability) {
    let rules = supabase
      .from("availability_rules")
      .select("tutor_id")
      .eq("is_active", true);
    if (opts.availability === "today") {
      rules = rules.eq("weekday", new Date().getUTCDay());
    } else if (opts.availability === "weekend") {
      rules = rules.in("weekday", [0, 6]);
    }
    const { data } = await rules;
    const withSlots = [...new Set((data ?? []).map((r) => r.tutor_id))];
    tutorIds = tutorIds
      ? tutorIds.filter((id) => withSlots.includes(id))
      : withSlots;
    if (tutorIds.length === 0) return { tutors: [], hasMore: false, total: 0 };
  }

  let base = supabase
    .from("tutor_profiles")
    .select("profile_id, display_name, avatar_path, headline, bio, rating_avg, rating_count", {
      count: "exact",
    })
    .eq("approval_status", "approved");
  if (tutorIds) base = base.in("profile_id", tutorIds);
  if (opts.minRating) base = base.gte("rating_avg", opts.minRating);

  const orderBy = opts.sort === "reviews" ? "rating_count" : "rating_avg";
  const { data, count } = await base
    .order(orderBy, { ascending: false, nullsFirst: false })
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
 * Nombre y foto salen de `tutor_profiles.display_name/avatar_path` (DD-01):
 * copias públicas que el tutor publica, no lecturas de `profiles`.
 */
export async function listFeaturedTutors(limit = 4): Promise<FeaturedTutor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("profile_id, display_name, avatar_path, headline, bio, rating_avg, rating_count")
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
    .select(
      "profile_id, display_name, avatar_path, headline, bio, rating_avg, rating_count, teaching_level",
    )
    .eq("profile_id", id)
    .eq("approval_status", "approved")
    .maybeSingle();
  if (!t) return null;

  const { data: prods } = await supabase
    .from("products")
    .select(
      "id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, image_path, product_categories(categories(slug, name))",
    )
    .eq("tutor_id", id)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const products = (prods ?? []).map(mapProductCard);

  return {
    tutor: {
      id: t.profile_id,
      displayName: t.display_name,
      avatarPath: t.avatar_path,
      teachingLevel: t.teaching_level,
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
      "id, title, description, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, image_path, faqs, tutor_id, product_categories(categories(slug, name))",
    )
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();
  if (!p) return null;

  // El tutor debe estar aprobado (RLS ya lo exige para que el producto salga).
  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select("profile_id, display_name, avatar_path, headline, bio, rating_avg, rating_count")
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
    imagePath: p.image_path,
    categories: toCategoryTags(p.product_categories),
    // jsonb → lista tipada; se ignora lo que no tenga forma {q,a}.
    faqs: Array.isArray(p.faqs)
      ? (p.faqs as { q?: unknown; a?: unknown }[])
          .filter((f) => typeof f?.q === "string" && typeof f?.a === "string")
          .map((f) => ({ q: f.q as string, a: f.a as string }))
      : [],
    tutor: {
      id: tutor.profile_id,
      displayName: tutor.display_name,
      avatarPath: tutor.avatar_path,
      headline: tutor.headline,
      bio: tutor.bio,
      ratingAvg: tutor.rating_avg,
      ratingCount: tutor.rating_count,
    },
  };
}

/** Nombre de una categoría activa (o null si no existe / inactiva por RLS). */
export async function getCategoryBySlug(
  slug: string,
): Promise<{ name: string; description: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("name, description")
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
/** Orden de P05. Todo se resuelve en columnas de `products`, así que la
 *  paginación sigue siendo consistente. */
export type ProductSort = "recent" | "price_asc" | "price_desc";

export async function listActiveProducts(opts: {
  categorySlug?: string;
  /** P06 · "Temas": cruza con otra categoría del mismo producto (N–M). */
  secondCategorySlug?: string;
  model?: PricingModel;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  minSessions?: number;
  maxSessions?: number;
  sort?: ProductSort;
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
  for (const slug of [opts.categorySlug, opts.secondCategorySlug]) {
    if (!slug) continue;
    const { data } = await supabase
      .from("product_categories")
      .select("product_id, categories!inner(slug), products!inner(status)")
      .eq("categories.slug", slug)
      .eq("products.status", "active");
    const found = [...new Set((data ?? []).map((r) => r.product_id))];
    // Con las dos, intersección: el producto tiene que estar en ambas.
    ids = ids ? ids.filter((id) => found.includes(id)) : found;
    if (ids.length === 0) return { products: [], hasMore: false, total: 0 };
  }

  let base = supabase
    .from("products")
    .select(
      "id, tutor_id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, image_path, product_categories(categories(slug, name))",
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

  const { data, count } =
    opts.sort === "price_asc" || opts.sort === "price_desc"
      ? await base
          .order("price_amount", { ascending: opts.sort === "price_asc" })
          .range(from, from + PAGE_SIZE)
      : await base
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
      .select("profile_id, display_name, avatar_path, headline, rating_avg, rating_count")
      .in("profile_id", [...new Set(rows.map((r) => r.tutor_id))]);
    for (const t of tp ?? []) {
      tutors.set(t.profile_id, {
        id: t.profile_id,
        displayName: t.display_name,
        avatarPath: t.avatar_path,
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
 * Quita tildes y diacríticos (EY-109). El lado almacenado ya viene sin ellos
 * (`f_unaccent` en la migración `20260721120000`), así que normalizar aquí el
 * término hace que "matematicas" y "Matemáticas" busquen lo mismo.
 */
function stripAccents(q: string): string {
  return q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Deja el término apto para un patrón `ilike`: fuera los comodines `%`/`_`,
 * para que el usuario no controle el patrón, y sin acentos.
 */
function likeSafe(q: string): string {
  return stripAccents(q).replace(/[%_\\]/g, " ").trim().slice(0, 60);
}

/**
 * US-303 — tutores cuyo **nombre**, headline o bio menciona el término. Busca
 * contra `search_text`, la columna generada sin acentos (EY-109 + R24-04:
 * incluye `display_name`). Al ser una sola columna se acabó el `or(...)`: ya no
 * hay gramática de PostgREST que romper.
 */
export async function searchTutors(
  q: string,
  categorySlug?: string,
): Promise<FeaturedTutor[]> {
  const term = likeSafe(q);
  if (!term) return [];
  const supabase = await createClient();

  // Acotar a una categoría = quedarse con los tutores que tienen ≥1 producto
  // activo en ella (mismo criterio que `listApprovedTutors`).
  let tutorIds: string[] | null = null;
  if (categorySlug) {
    const { data } = await supabase
      .from("products")
      .select("tutor_id, product_categories!inner(categories!inner(slug))")
      .eq("status", "active")
      .eq("product_categories.categories.slug", categorySlug);
    tutorIds = [...new Set((data ?? []).map((r) => r.tutor_id))];
    if (tutorIds.length === 0) return [];
  }

  let query = supabase
    .from("tutor_profiles")
    .select("profile_id, display_name, avatar_path, headline, bio, rating_avg, rating_count")
    .eq("approval_status", "approved")
    .ilike("search_text", `%${term}%`);
  if (tutorIds) query = query.in("profile_id", tutorIds);

  const { data } = await query
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);

  return withProductFacts(data ?? []);
}

/**
 * US-303 — categorías cuyo nombre menciona el término.
 * ponytail: filtrado en memoria. Son 8 filas que el buscador ya trae enteras
 * para los chips; una consulta más (y una columna sin acentos en la tabla)
 * sobraba.
 */
export async function searchCategories(q: string): Promise<CategoryTag[]> {
  const term = likeSafe(q).toLowerCase();
  if (!term) return [];
  const all = await listActiveCategories();
  return all.filter((c) => stripAccents(c.name).toLowerCase().includes(term));
}

/** Sugerencias del buscador global (R24-05): tutores/clases/categorías, pocas de
 *  cada una, para el desplegable typeahead del header. Reusa las 3 búsquedas. */
export type SearchSuggestions = {
  tutors: { id: string; name: string; headline: string | null }[];
  products: { id: string; title: string }[];
  categories: CategoryTag[];
};

export async function suggestSearch(q: string): Promise<SearchSuggestions> {
  if (!q.trim()) return { tutors: [], products: [], categories: [] };
  const [tutors, products, categories] = await Promise.all([
    searchTutors(q),
    searchProducts(q),
    searchCategories(q),
  ]);
  return {
    tutors: tutors.slice(0, 4).map((t) => ({
      id: t.id,
      name: t.displayName ?? "Tutor",
      headline: t.headline,
    })),
    products: products.slice(0, 4).map((p) => ({ id: p.id, title: p.title })),
    categories: categories.slice(0, 4),
  };
}

const PRODUCT_CARD_SELECT =
  "id, tutor_id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, image_path, product_categories(categories(slug, name))";

/**
 * US-303 — búsqueda por texto en productos (título+descripción, RN-20).
 *
 * Dos caminos que se complementan (EY-109):
 *  1. `search_vector` (tsvector español) con el término tal cual y, si lleva
 *     tildes, también sin ellas → relevancia lingüística: "programación"
 *     encuentra "programar" porque ambos stemean a `program`.
 *  2. `search_text` (texto sin acentos) con `ilike` → red de seguridad para el
 *     tecleo **sin tildes**. Hace falta porque el stemmer español es sensible
 *     al acento: "programacion" no stemea a `program`, así que por el camino 1
 *     no casaría nunca aunque el vector guarde las dos ramas.
 *  3. `search_product_ids_fuzzy` (word_similarity de pg_trgm) → el último
 *     hueco: sin tilde y sin ser subcadena, "programacion" ~ "programar" solo
 *     se alcanza por similitud de raíz.
 *
 * Las tres se unen por id conservando el orden: manda la relevancia del
 * tsvector y las otras dos solo añaden lo que aquélla no alcanzó.
 */
export async function searchProducts(
  q: string,
  categorySlug?: string,
): Promise<ProductCardData[]> {
  const raw = q.trim();
  if (!raw) return [];
  const plain = stripAccents(raw);
  const terms = plain === raw ? [raw] : [raw, plain];

  const supabase = await createClient();
  // `likeSafe` puede dejar el término vacío (p. ej. si era solo comodines):
  // sin este guard, `ilike '%%'` devolvería el catálogo entero.
  const likeTerm = likeSafe(raw);

  // Acotar a una categoría: ids de productos activos en ella (N–M, RN-09). El
  // filtro se aplica DENTRO de cada rama, no sobre el resultado final: si no,
  // el `limit` se gastaría en productos de otras categorías y se perderían
  // coincidencias válidas.
  let allowed: Set<string> | null = null;
  if (categorySlug) {
    const { data } = await supabase
      .from("product_categories")
      .select("product_id, categories!inner(slug), products!inner(status)")
      .eq("categories.slug", categorySlug)
      .eq("products.status", "active");
    allowed = new Set((data ?? []).map((r) => r.product_id));
    if (allowed.size === 0) return [];
  }
  const allowedIds = allowed ? [...allowed] : null;

  // Rama 3 (EY-109): similitud por palabra. Rescata el caso que ni el stemmer
  // ni la subcadena alcanzan — teclear sin tilde una palabra que solo casa por
  // su raíz ("programacion" ~ "programar"). Devuelve ids; la fila la lee el
  // `select` de abajo, con la RLS de siempre.
  const { data: fuzzy } = await supabase.rpc("search_product_ids_fuzzy", {
    p_q: raw,
    p_limit: PAGE_SIZE,
  });
  const fuzzyIds = (fuzzy ?? [])
    .map((r) => r.id)
    .filter((id) => !allowed || allowed.has(id));

  const branches = [];
  for (const term of terms) {
    let b = supabase
      .from("products")
      .select(PRODUCT_CARD_SELECT)
      .eq("status", "active")
      .textSearch("search_vector", term, {
        type: "websearch",
        config: "spanish",
      });
    if (allowedIds) b = b.in("id", allowedIds);
    branches.push(b.limit(PAGE_SIZE));
  }
  // Rama sin acentos. Va después a propósito: primero manda la relevancia del
  // tsvector y esto solo añade lo que aquélla no alcanzó.
  if (likeTerm) {
    let b = supabase
      .from("products")
      .select(PRODUCT_CARD_SELECT)
      .eq("status", "active")
      .ilike("search_text", `%${likeTerm}%`);
    if (allowedIds) b = b.in("id", allowedIds);
    branches.push(b.limit(PAGE_SIZE));
  }
  if (fuzzyIds.length) {
    branches.push(
      supabase.from("products").select(PRODUCT_CARD_SELECT).in("id", fuzzyIds),
    );
  }

  const results = await Promise.all(branches);

  // Unir por id conservando el orden de la primera rama.
  const seen = new Map<string, ProductCardData & { tutorId: string }>();
  for (const { data } of results) {
    for (const row of data ?? []) {
      if (!seen.has(row.id)) {
        seen.set(row.id, { ...mapProductCard(row), tutorId: row.tutor_id });
      }
    }
  }
  // La tarjeta de P09 firma con el tutor: hay que traerlo.
  return withTutors([...seen.values()].slice(0, PAGE_SIZE));
}

/** Cifras de la home (P01). La RPC agrega en vivo; los países se derivan de la
 *  zona horaria del tutor hasta que C-13 cierre el país de cobro (RN-15). */
export type HomeStats = {
  tutors: number;
  sessions: number;
  ratingAvg: number | null;
  countries: number;
};

export async function getHomeStats(): Promise<HomeStats | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("home_stats");
  if (!data || typeof data !== "object") return null;
  const s = data as Record<string, number | null>;
  return {
    tutors: Number(s.tutors ?? 0),
    sessions: Number(s.sessions ?? 0),
    ratingAvg: s.rating_avg == null ? null : Number(s.rating_avg),
    countries: Number(s.countries ?? 0),
  };
}

/** Testimonios de la home (P01): reseñas reales de ≥4★ con comentario. El autor
 *  llega ya enmascarado desde la RPC ("Marina G."), sin abrir `profiles`. */
export type Testimonial = {
  id: string;
  comment: string;
  rating: number;
  author: string;
  context: string;
};

export async function listTestimonials(limit = 7): Promise<Testimonial[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("home_testimonials", { p_limit: limit });
  return (data ?? []).map((r) => ({
    id: r.id,
    comment: r.comment ?? "",
    rating: r.rating,
    author: r.author ?? "Alumno",
    context: r.context ?? "",
  }));
}

/** Índice de categorías: cada una con cuántas tutorías activas tiene.
 *  Una sola consulta al puente + recuento en memoria; con ~10 categorías y el
 *  volumen del MVP no hace falta agregación en BD. */
export async function listCategoriesWithCounts(): Promise<
  (CategoryTag & { products: number; tutors: number })[]
> {
  const supabase = await createClient();
  const [categories, { data }] = await Promise.all([
    listActiveCategories(),
    supabase
      .from("product_categories")
      .select("categories!inner(slug), products!inner(status, tutor_id)")
      .eq("products.status", "active"),
  ]);

  const counts = new Map<string, number>();
  const tutors = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const slug = (row.categories as unknown as { slug: string }).slug;
    const tutorId = (row.products as unknown as { tutor_id: string }).tutor_id;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
    tutors.set(slug, (tutors.get(slug) ?? new Set()).add(tutorId));
  }
  return categories.map((c) => ({
    ...c,
    products: counts.get(c.slug) ?? 0,
    tutors: tutors.get(c.slug)?.size ?? 0,
  }));
}

/** P07 · huecos libres de un producto para pintar el calendario público.
 *  `get_available_slots` ya descuenta reglas, excepciones y sesiones ocupadas. */
export async function listProductSlots(
  productId: string,
  days = 60,
): Promise<{ start: string; end: string }[]> {
  const supabase = await createClient();
  const today = new Date();
  const to = new Date(today.getTime() + days * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const { data } = await supabase.rpc("get_available_slots", {
    p_product_id: productId,
    p_from: iso(today),
    p_to: iso(to),
  });
  return (data ?? []).map((s) => ({ start: s.slot_start, end: s.slot_end }));
}
