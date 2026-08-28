import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { parseFaqs, type Faq } from "@/lib/tutor-faqs";
import { stripAccents } from "./format";

/**
 * Consultas del catálogo público (EP-03). Todo pasa por el cliente ANON + RLS:
 * solo devuelve tutores `approved` y productos `active` de tutores aprobados
 * (Doc 3 / RN-24). Los `.eq('approval_status','approved')` / `.eq('status','active')`
 * son explícitos para leer la intención, aunque RLS ya lo garantice.
 */

type PricingModel = Database["public"]["Enums"]["pricing_model"];
/** DD-03 · el nivel de la mentoría reusa el enum del nivel del tutor. */
export type TeachingLevel = Database["public"]["Enums"]["teaching_level"];

export type CategoryTag = {
  slug: string;
  name: string;
  /** Clave del icono en la paleta del frontend; nulo = genérico. */
  icon?: string | null;
};

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
  /** DD-03 — de la mentoría; `null` en las que se publicaron antes del campo. */
  level: string | null;
  language: string | null;
  /** Solo lo rellena el listado de P05; `null` donde no se consultó. */
  tutor?: ProductTutor | null;
};

export type ProductDetail = ProductCardData & {
  description: string | null;
  tutor: ProductTutor & {
    bio: string | null;
    /**
     * EY-194 · FAQ del TUTOR, las mismas en todas sus mentorías. Llegan
     * separadas de las de la mentoría a propósito: la ficha las pinta en orden
     * (primero las de esta mentoría) y ese orden se pierde si se fusionan aquí.
     *
     * ⚠️ Desde el 28-ago llega SIEMPRE vacía: la sección de FAQ de perfil está
     * oculta y la columna ya no se consulta. El campo se conserva para no tener
     * que rehacer el tipo al reactivarla.
     */
    faqs: Faq[];
  };
  /** FAQ propias de la mentoría (R24-17); vacío = se muestran las genéricas. */
  faqs: Faq[];
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
  level?: string | null;
  language?: string | null;
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
    level: r.level ?? null,
    language: r.language ?? null,
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
    .select("slug, name, icon")
    // `is_active` explícito y no sólo por RLS: la política pública filtra por
    // él, pero `categories_select_admin` deja al admin verlas TODAS — así que
    // un admin navegando el catálogo público veía también las desactivadas,
    // y el resto del mundo no. Lo que se enseña no puede depender de quién mira.
    .eq("is_active", true)
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

/**
 * DD-04 · "Inversión por clase" de P04: **rango continuo**, no tramos fijos
 * (decisión de Jose en EY-114). Los extremos que ofrece el deslizador salen de
 * los datos, no de una constante — ver `tutorPriceBounds`.
 *
 * Filtra por el **precio de entrada**, que es el mismo "Desde $18" que enseña
 * la tarjeta: la mentoría activa más barata del tutor. Lo calcula la vista
 * `tutors_public` en Postgres, así que aquí es un `gte`/`lte` normal y el
 * rango, la paginación y el `count` los resuelve el motor.
 *
 * Los tutores sin producto activo tienen `price_from` nulo y quedan fuera en
 * cuanto se toca el filtro: no tienen precio de entrada que comparar.
 */
export async function tutorPriceBounds(): Promise<{ min: number; max: number } | null> {
  const supabase = await createClient();
  // Dos consultas de UNA fila (order + limit 1); PostgREST no agrega sin RPC y
  // montar una función para esto sería más pieza que problema.
  const [{ data: barato }, { data: caro }] = await Promise.all([
    supabase
      .from("tutors_public")
      .select("price_from")
      .not("price_from", "is", null)
      .order("price_from", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("tutors_public")
      .select("price_from")
      .not("price_from", "is", null)
      .order("price_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (barato?.price_from == null || caro?.price_from == null) return null;
  return { min: barato.price_from, max: caro.price_from };
}

/** US-301 — tutores aprobados, filtrables por categoría y rating, paginados. */
export async function listApprovedTutors(opts: {
  categorySlug?: string;
  minRating?: number;
  availability?: AvailabilityFilter;
  /** DD-04 · extremos del rango en unidades menores (inclusivos). */
  minPrice?: number;
  maxPrice?: number;
  /** DD-03 · "Idioma del tutor" (386:1006): el de las clases que publica. */
  language?: string;
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

  // DD-03 · "Idioma del tutor" del Figma. No hay columna de idioma en el
  // tutor: se deriva de las clases que publica, que es lo que el alumno
  // pregunta de verdad ("¿da clases en inglés?").
  if (opts.language) {
    const { data } = await supabase
      .from("products")
      .select("tutor_id")
      .eq("status", "active")
      .eq("language", opts.language);
    const speak = [...new Set((data ?? []).map((r) => r.tutor_id))];
    tutorIds = tutorIds ? tutorIds.filter((id) => speak.includes(id)) : speak;
    if (tutorIds.length === 0) return { tutors: [], hasMore: false, total: 0 };
  }

  // La vista trae el precio de entrada ya resuelto por Postgres (DD-04), así
  // que el filtro de precio es un `gte`/`lte` más: nada que reducir en memoria,
  // y el `count` sigue siendo el del conjunto filtrado.
  let base = supabase
    .from("tutors_public")
    .select("profile_id, display_name, avatar_path, headline, bio, rating_avg, rating_count", {
      count: "exact",
    })
    .eq("approval_status", "approved");
  if (tutorIds) base = base.in("profile_id", tutorIds);
  if (opts.minRating) base = base.gte("rating_avg", opts.minRating);
  // Los extremos son inclusivos: el deslizador enseña el número que el usuario
  // ve, y un tutor que cueste exactamente el tope tiene que entrar.
  if (opts.minPrice != null) base = base.gte("price_from", opts.minPrice);
  if (opts.maxPrice != null) base = base.lte("price_from", opts.maxPrice);

  const orderBy = opts.sort === "reviews" ? "rating_count" : "rating_avg";
  const { data, count } = await base
    .order(orderBy, { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE); // 1 fila extra = ¿hay más?

  // Postgres no declara NOT NULL en las columnas de una vista, así que los
  // tipos generados las dan todas nullable aunque vengan de columnas que no lo
  // son. Se estrecha aquí, en el borde, en vez de esparcir el `| null` por toda
  // la UI: `profile_id` es la PK de `tutor_profiles` y el `from` de la vista.
  const rows = (data ?? [])
    .filter((r): r is typeof r & { profile_id: string } => r.profile_id !== null)
    .map((r) => ({ ...r, rating_count: r.rating_count ?? 0 }));
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
    .select(
      "profile_id, display_name, avatar_path, headline, bio, rating_avg, rating_count",
    )
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
      "id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, image_path, product_categories(categories(slug, name, icon))",
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
  /** Firma del alumno si consintió publicarla (decisión 18); si no, null. */
  author: string | null;
};

/**
 * US-902 — reseñas públicas del tutor. Van **anónimas salvo consentimiento**:
 * el perfil es público (cliente anon) y `profiles` está cerrado por RLS, así
 * que el nombre no se lee de ahí — es la copia enmascarada que `submit_review`
 * guarda en la propia reseña cuando el alumno acepta firmarla (decisión 18).
 */
export async function listTutorReviews(tutorId: string): Promise<TutorReview[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reviews")
    .select("id, rating, comment, created_at, author_display")
    .eq("tutor_id", tutorId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
    author: r.author_display,
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
      "id, title, description, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, image_path, faqs, level, language, tutor_id, product_categories(categories(slug, name, icon))",
    )
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();
  if (!p) return null;

  // El tutor debe estar aprobado (RLS ya lo exige para que el producto salga).
  const { data: tutor } = await supabase
    .from("tutor_profiles")
    // ⚠️ `faqs` va SOLO aquí, y esa exclusividad es deliberada. Este mismo
    // `select` aparece en `listFeaturedTutors` y en `searchTutors`, y en los
    // dos la fila acaba en `withProductFacts`, que mapea campo a campo y NUNCA
    // lee la columna: pedirla allí sería bajar un jsonb sin tope de tamaño —la
    // migración `20260826150000` solo comprueba que sea una lista— para tirarlo.
    // Y `searchTutors` cuelga del typeahead, que dispara con cada pulsación de
    // cualquier visitante anónimo. El typecheck no protege de esto: las
    // propiedades de más se admiten al pasar la variable, así que si se añade
    // una columna a un `select` de listado nadie se entera. Este comentario es
    // la única barrera.
    .select(
      // 28-ago: `faqs` sale del select mientras la sección de FAQ de perfil esté
      // oculta — la ficha ya no las pinta y bajar un jsonb sin tope para tirarlo
      // es justo lo que avisa el párrafo de abajo. Al reactivar la sección hay
      // que reponerlo aquí y en el mapeo de `tutor.faqs`.
      "profile_id, display_name, avatar_path, headline, bio, rating_avg, rating_count",
    )
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
    level: p.level,
    language: p.language,
    categories: toCategoryTags(p.product_categories),
    // jsonb → lista tipada; se ignora lo que no tenga forma {q,a}. El parseo es
    // el MISMO que el de las FAQ del tutor (EY-194) a propósito: las dos listas
    // se concatenan al pintar y una diferencia de criterio se vería como
    // preguntas que aparecen o desaparecen según de dónde vengan.
    faqs: parseFaqs(p.faqs),
    tutor: {
      id: tutor.profile_id,
      displayName: tutor.display_name,
      avatarPath: tutor.avatar_path,
      headline: tutor.headline,
      bio: tutor.bio,
      ratingAvg: tutor.rating_avg,
      ratingCount: tutor.rating_count,
      // Vacío a propósito: la columna ya no se consulta (ver el select de arriba).
      faqs: [],
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
  /** DD-03 · nivel e idioma DE LA MENTORÍA (filtros de P05/P06). */
  level?: TeachingLevel;
  language?: string;
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
      "id, tutor_id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, image_path, level, language, product_categories(categories(slug, name, icon))",
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
  // DD-03: quien no lo rellenó no aparece bajo ningún nivel ni idioma. Es lo
  // correcto — un filtro no debe colar lo que no sabe si encaja.
  if (opts.level) base = base.eq("level", opts.level);
  if (opts.language) base = base.eq("language", opts.language);

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
    .select(
      "profile_id, display_name, avatar_path, headline, bio, rating_avg, rating_count",
    )
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
  "id, tutor_id, title, outcome, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, image_path, product_categories(categories(slug, name, icon))";

/**
 * RV-17 · cuánto pesa que el término esté en el TÍTULO.
 *
 * Las tres ramas de `searchProducts` buscan contra `search_vector`/`search_text`,
 * que son título **y** descripción pegados: `?q=calculo` devolvía "Álgebra y
 * Cálculo desde cero" (bien) al mismo nivel que "Finanzas para emprendedores",
 * que solo menciona "cálculo" de pasada en su cuerpo. No es un falso positivo
 * —el alumno puede querer encontrarla— pero no puede salir por delante de la
 * que lo lleva en el nombre.
 *
 * 3 = el término entero en el título · 2 = todas sus palabras · 1 = alguna ·
 * 0 = solo casa por el cuerpo.
 */
function tituloScore(title: string, termino: string, palabras: string[]): number {
  const t = stripAccents(title).toLowerCase();
  if (termino && t.includes(termino)) return 3;
  // Con `palabras` vacío (término de 1-2 letras) `every` daría `true` sobre la
  // lista vacía y TODO puntuaría 2: el guard evita ese empate falso.
  if (palabras.length === 0) return 0;
  if (palabras.every((w) => t.includes(w))) return 2;
  return palabras.some((w) => t.includes(w)) ? 1 : 0;
}

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

  // RV-17 · el título por delante del cuerpo. Se reordena AQUÍ y no en SQL a
  // propósito: llevar el ranking a Postgres es tocar `search_vector` /
  // `search_text`, y ese arreglo (EY-109, migraciones `20260727120000` y
  // `20260727130000`) costó dos intentos — no se mueve por una cuestión de
  // orden. Son ≤4 ramas de PAGE_SIZE filas, ya traídas.
  //
  // El desempate es el índice de llegada, explícito y no confiando en que
  // `sort` sea estable: dentro del mismo peso sigue mandando la relevancia del
  // tsvector, y la rama sin acentos y la difusa quedan detrás, que es el orden
  // en que llegaron.
  const termino = plain.toLowerCase();
  const palabras = [
    ...new Set(termino.split(/\s+/).filter((w) => w.length >= 3)),
  ];
  const ordenados = [...seen.values()]
    .map((p, i) => ({ p, i, peso: tituloScore(p.title, termino, palabras) }))
    .sort((a, b) => b.peso - a.peso || a.i - b.i)
    .map((x) => x.p);

  // El corte va DESPUÉS de ordenar: cortando antes, una coincidencia de título
  // que llegó por la rama difusa se perdía sin llegar a subir.
  // La tarjeta de P09 firma con el tutor: hay que traerlo.
  return withTutors(ordenados.slice(0, PAGE_SIZE));
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

/** Índice de categorías: cada una con cuántas mentorías activas tiene.
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

/**
 * Hasta dónde llega la agenda que se PUBLICA. **Un solo número para todo el
 * cliente**, y no es una preferencia estética: los mismos huecos se pintaban con
 * tres ventanas distintas y eso era un bug con cara de mentira.
 *
 *   · la ficha pública pedía **60 días**;
 *   · el selector de `/reservar/<id>` no pasaba rango y caía al default de la
 *     RPC, **21 días**;
 *   · `create_booking` revalida contra `current_date + 30` antes de escribir.
 *
 * Resultado: la vitrina ofrecía horarios del día +45 que la reserva rechazaba, y
 * el error mentía —«algún horario ya no está disponible»— cuando el hueco estaba
 * libre y el problema era la fecha. Y por el otro lado, un hueco del día +25 era
 * reservable pero invisible en el selector.
 *
 * Se elige **30 = el límite que la base de datos YA acepta**, no un número nuevo:
 * bajar la vitrina no necesita migración y ninguna reserva que hoy funciona deja
 * de funcionar. Subir el tope de `create_booking` habría sido tocar dinero y
 * disponibilidad para enseñar tres semanas más de agenda que casi nadie reserva.
 *
 * ⚠️ El default de la RPC sigue siendo 21 y **no se toca** (regla de oro 5: la
 * migración está aplicada). Se neutraliza por el otro lado: **todo llamador pasa
 * el rango explícito**, así que ese default no se alcanza desde el cliente. Si
 * añades una llamada a `get_available_slots`, pásale `rangoPublicado()` — si la
 * dejas sin rango vuelves a tener dos verdades, y esta vez en silencio.
 *
 * Y si algún día hay que subirlo: se cambia AQUÍ **y** en `create_booking`, con
 * migración nueva. Cambiar solo uno reabre exactamente este bug.
 */
export const HORIZONTE_RESERVA_DIAS = 30;

/**
 * Rango `date` que espera `get_available_slots`, en el mismo huso en el que
 * Postgres evalúa `current_date` (UTC en Supabase) — por eso el corte se hace
 * con `toISOString()` y no con la fecha local del servidor de Next: un `new
 * Date().getDate()` en Vercel y el `current_date` de la BD no siempre son el
 * mismo día, y ahí se cuela el hueco fantasma del borde.
 */
export function rangoPublicado(days = HORIZONTE_RESERVA_DIAS) {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const hoy = new Date();
  return {
    p_from: iso(hoy),
    p_to: iso(new Date(hoy.getTime() + days * 86400000)),
  };
}

/** P07 · huecos libres de un producto para pintar el calendario público.
 *  `get_available_slots` ya descuenta reglas, excepciones y sesiones ocupadas. */
export async function listProductSlots(
  productId: string,
  days = HORIZONTE_RESERVA_DIAS,
): Promise<{ start: string; end: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_available_slots", {
    p_product_id: productId,
    ...rangoPublicado(days),
  });
  return (data ?? []).map((s) => ({ start: s.slot_start, end: s.slot_end }));
}
