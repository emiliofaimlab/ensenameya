import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  listActiveProducts,
  listCategoriesWithCounts,
  type CategoryTag,
  type ProductCardData,
} from "@/lib/catalog/queries";
import type { Database } from "@/lib/database.types";

/**
 * N-30 · Qué mentorías sugerirle al alumno en su panel (AL02).
 *
 * El cliente lo pidió explícito: que el panel sea un punto de partida y no una
 * pantalla muerta entre reserva y reserva, con mentorías **según sus categorías
 * de interés** (las que eligió en el onboarding, `student_interests`).
 *
 * ⚠️ **Aquí no se lista el catálogo a mano.** Todo sale de
 * `listActiveProducts()`, la misma consulta que pintan /classes y /categories.
 * Es a propósito: quién es visible —producto `active` **y** tutor `approved`—
 * lo deciden las políticas RLS de `products` / `product_categories`
 * (`20260706120000`), no un `.eq()` copiado en esta carpeta. Reimplementar el
 * filtro aquí es la forma de que un día el panel recomiende la mentoría
 * despublicada de un tutor rechazado.
 *
 * Los dos casos que hoy son la NORMA, no la excepción, porque el catálogo es
 * pequeño y los intereses son opcionales en el onboarding:
 *
 *   1. El alumno no declaró intereses (se saltó el paso 2).
 *   2. Sus categorías todavía no tienen ninguna mentoría publicada.
 *
 * En los dos se cae a lo más reciente del catálogo y se dice la verdad en el
 * subtítulo, en vez de pintar un carrusel vacío — que es peor que no ponerlo.
 * Si ni así hay nada que enseñar, `suggestedForStudent` devuelve `null` y la
 * tarjeta no se monta.
 */

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/**
 * Reservas "vivas" cuyo producto NO se vuelve a sugerir: son exactamente las
 * que el panel ya pinta arriba, en "Próximas sesiones". Recomendar en la mitad
 * de abajo lo que el alumno tiene agendado en la de arriba es repetir contenido
 * en la misma pantalla.
 *
 * Las `completed` sí siguen siendo sugeribles a propósito: repetir una mentoría
 * que salió bien es un buen final, no un error de recomendación.
 */
const VIVAS: BookingStatus[] = ["pending_payment", "pending_acceptance", "confirmed", "in_progress"];

/**
 * Cuántas categorías de interés se consultan. Cada una es una llamada a
 * `listActiveProducts` (que por dentro son tres consultas), así que el número
 * es coste directo del panel; van en paralelo, pero suman carga. Con 3 tarjetas
 * a la vista, más de 3 temas no cabrían igualmente. Si el panel se pone pesado,
 * este es el pomo que hay que bajar.
 */
const MAX_TEMAS = 3;

/** Por qué salen estas mentorías y no otras. Lo dice el subtítulo de la tarjeta. */
export type SuggestionSource =
  /** Salen de sus categorías de interés: lo que pidió el cliente. */
  | "interests"
  /** No eligió temas en el onboarding (es opcional). */
  | "no-interests"
  /**
   * Eligió temas, pero hoy no tienen nada NUEVO que ofrecerle: o no hay
   * mentorías publicadas en ellos, o las que hay ya las tiene reservadas.
   */
  | "no-offer";

export type PanelSuggestions = {
  products: ProductCardData[];
  /** Los temas suyos que sostienen la lista; vacío fuera de `interests`. */
  temas: CategoryTag[];
  /** Categorías que HOY tienen mentorías publicadas: la salida de RV-11. */
  conOferta: CategoryTag[];
  source: SuggestionSource;
};

/** El recuento sobra fuera de aquí: las burbujas solo quieren slug/nombre/icono. */
function soloTag({ slug, name, icon }: CategoryTag): CategoryTag {
  return { slug, name, icon };
}

/**
 * Categorías con al menos una mentoría publicada. Es lo que se ofrece como
 * salida en los estados vacíos (RV-11): mandar al alumno a una categoría vacía
 * es el mismo callejón sin salida del que se le quiere sacar.
 */
export async function categoriesWithOffer(): Promise<CategoryTag[]> {
  const cats = await listCategoriesWithCounts();
  return cats.filter((c) => c.products > 0).map(soloTag);
}

export async function suggestedForStudent(
  studentId: string,
  limit = 3,
): Promise<PanelSuggestions | null> {
  const supabase = await createClient();

  const [{ data: mine }, { data: activas }, cats] = await Promise.all([
    // Sus intereses, ya resueltos a categoría. `!inner` para que un interés
    // apuntando a una categoría desactivada desaparezca en vez de llegar nulo.
    //
    // El `is_active` va explícito aunque la política pública ya filtre por él:
    // `categories_select_admin` deja al admin verlas TODAS, así que un admin
    // mirando su propio panel recibiría sugerencias de categorías que nadie más
    // ve. Mismo criterio que `listActiveCategories()`.
    supabase
      .from("student_interests")
      .select("categories!inner(slug, name, icon)")
      .eq("student_id", studentId)
      .eq("categories.is_active", true),
    supabase
      .from("bookings")
      .select("product_id")
      .eq("student_id", studentId)
      .in("status", VIVAS),
    listCategoriesWithCounts(),
  ]);

  const conOferta = cats.filter((c) => c.products > 0);
  /** slug → cuántas mentorías activas tiene. Sirve de "¿tiene algo?" y de orden. */
  const oferta = new Map(conOferta.map((c) => [c.slug, c.products]));

  // `flatMap` y no `filter(...)`: el embed llega como objeto o nulo, y un
  // predicado de tipo hacia `CategoryTag` no compila porque su `icon` es
  // opcional y el de la consulta no. Esto descarta los nulos sin discutir tipos.
  const declarados: CategoryTag[] = (mine ?? []).flatMap((r) =>
    r.categories ? [r.categories] : [],
  );

  // Sus temas, quedándonos solo con los que hoy tienen algo que enseñar y
  // empezando por el que más ofrece: así las primeras rondas del reparto
  // llegan llenas y no hay que pedir más categorías para completar la fila.
  const temas = declarados
    .filter((c) => oferta.has(c.slug))
    .sort((a, b) => (oferta.get(b.slug) ?? 0) - (oferta.get(a.slug) ?? 0))
    .slice(0, MAX_TEMAS);

  let source: SuggestionSource =
    temas.length > 0
      ? "interests"
      : declarados.length > 0
        ? "no-offer"
        : "no-interests";

  const descartar = new Set((activas ?? []).map((b) => b.product_id));
  const elegidas: ProductCardData[] = [];
  const vistas = new Set<string>();
  const anota = (p: ProductCardData) => {
    if (elegidas.length >= limit || vistas.has(p.id) || descartar.has(p.id)) return;
    vistas.add(p.id);
    elegidas.push(p);
  };

  if (temas.length > 0) {
    const listas = await Promise.all(
      temas.map((c) => listActiveProducts({ categorySlug: c.slug, page: 1 })),
    );
    // Reparto por rondas (una de cada tema, luego la segunda…): con un tema muy
    // poblado y otro con dos mentorías, coger "las N primeras" dejaría fuera al
    // segundo tema entero, y el alumno eligió los dos.
    const largo = Math.max(0, ...listas.map((l) => l.products.length));
    for (let i = 0; i < largo && elegidas.length < limit; i++) {
      for (const lista of listas) {
        const p = lista.products[i];
        if (p) anota(p);
      }
    }
  }

  // Si sus temas dieron 1 o 2 tarjetas, se quedan 1 o 2: NO se rellena la fila
  // con mentorías de otras categorías, porque el subtítulo promete "por los
  // temas que te interesan" y dejaría de ser verdad. Solo cuando no dieron
  // NINGUNA se cae al catálogo — y entonces el subtítulo cambia con ella.
  if (elegidas.length === 0) {
    if (source === "interests") source = "no-offer";
    // "Lo más reservado" sería mejor criterio, pero hoy no existe esa consulta
    // en el catálogo y esta carpeta no es sitio para inventarla: `listActive
    // Products` sin filtros ordena por reciente, que es lo que hay.
    const { products } = await listActiveProducts({ page: 1 });
    for (const p of products) anota(p);
  }

  // Catálogo vacío (o el alumno ya tiene reservado todo lo que hay): mejor no
  // montar la tarjeta que enseñar un hueco con título.
  if (elegidas.length === 0) return null;

  return {
    products: elegidas,
    temas: source === "interests" ? temas : [],
    conOferta: conOferta.map(soloTag),
    source,
  };
}
