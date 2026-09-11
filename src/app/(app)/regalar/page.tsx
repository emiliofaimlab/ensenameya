import Link from "next/link";
import {
  CalendarClockIcon,
  GiftIcon,
  HourglassIcon,
  SearchIcon,
  WalletIcon,
} from "lucide-react";

import { requireUser } from "@/lib/auth/server";
import { panelMenu } from "@/lib/auth/panel-items";
import {
  listActiveCategories,
  listActiveProducts,
  searchProducts,
  type ProductCardData,
} from "@/lib/catalog/queries";
import { CategoryIconChips } from "@/components/catalog/category-icon-chips";
import { EmptyResults } from "@/components/catalog/empty-results";
import { Pager } from "@/components/catalog/pager";
import { ProductCard } from "@/components/catalog/product-card";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { diasParaAgendar, plazoEnPalabras } from "./gift-policy";

export const metadata = { title: "Regalar una mentoría · Enséñame Ya" };

/**
 * US-REG · «REGALAR UNA MENTORÍA» — LA PUERTA.
 *
 * El encargo del cliente, literal: «quien regala elige tutor y mentoría y paga
 * su precio íntegro por adelantado; al destinatario le aparece en "Mis
 * reservas" como un regalo pendiente de agendar y él elige día y hora».
 *
 * De ahí salen las tres cosas que esta pantalla tiene que hacer, en este orden:
 *
 *   1. **Decir qué es**, antes de que nadie elija nada: quien regala paga el
 *      precio entero, NO elige horario, y el regalo caduca. Las tres son
 *      sorpresas caras si se cuentan después de cobrar, y la tercera es la
 *      única que trae fecha (`gift_expiry_days()`, ver `./gift-policy.ts`).
 *   2. **Elegir la mentoría.** Aquí no hay buscador nuevo: son las MISMAS
 *      consultas que pintan `/classes` (`listActiveProducts`) y el typeahead
 *      público (`searchProducts`), con las MISMAS tarjetas (`ProductCard`).
 *      Quién es visible —producto `active` y tutor `approved`— lo deciden las
 *      políticas RLS de `products`, no un `.eq()` copiado en esta carpeta; es
 *      el mismo argumento que ya está escrito en `(app)/app/sugerencias.ts`, y
 *      reimplementarlo aquí es cómo un día se regala la mentoría despublicada
 *      de un tutor rechazado.
 *   3. **Llevar a confirmar**: `/regalar/mentoria/<productId>`, que es donde se dice a
 *      quién va y con qué dedicatoria. Esta pantalla no llama a ninguna RPC de
 *      dinero.
 *
 * ⚠️ LA TARJETA SIGUE LLEVANDO A LA FICHA, Y ESO ES DELIBERADO. `ProductCard`
 * enlaza a `/products/<id>` por dentro y no se toca: antes de regalarle algo a
 * alguien conviene poder leer qué es, y la ficha pública es donde está el
 * temario, el tutor y las reseñas. El botón de «Regalar» va DEBAJO de la
 * tarjeta, como hermano y no como envoltorio — un `<Link>` alrededor de un
 * `<article>` que ya tiene enlaces dentro es HTML inválido y, en la práctica,
 * un botón que a veces navega al sitio equivocado.
 *
 * ⚠️ PANTALLA COMPARTIDA (alumno y tutor), como `/referidos`: regalar no es una
 * acción de alumno. Por eso el menú lo decide `panelMenu()` a partir de la
 * cookie `ey-panel` y no se asume `STUDENT_ITEMS` — un tutor que llega aquí
 * desde su panel tiene que seguir viendo el suyo. El porqué largo, y por qué
 * `items?.[0]?.href` NO sirve para deducirlo, está en `lib/auth/panel-items.ts`.
 */
export default async function RegalarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; page?: string }>;
}) {
  const [{ user, roles }, sp] = await Promise.all([requireUser(), searchParams]);
  const termino = (sp.q ?? "").trim();
  const cat = sp.cat?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const [menu, dias, categorias, resultado] = await Promise.all([
    panelMenu(user.id, roles),
    diasParaAgendar(),
    listActiveCategories(),
    // Buscando manda `searchProducts` (una sola página, como el buscador
    // público); sin término, el catálogo paginado de `/classes`.
    termino
      ? searchProducts(termino, cat).then((products) => ({
          products,
          hasMore: false,
          total: products.length,
        }))
      : listActiveProducts({ categorySlug: cat, page }),
  ]);

  /** El estado vive en la URL; cambiar de tema o de búsqueda vuelve a la 1. */
  const hrefCon = (next: { q?: string; cat?: string; page?: number }) => {
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.cat) p.set("cat", next.cat);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const qs = p.toString();
    return qs ? `/regalar?${qs}` : "/regalar";
  };

  return (
    <PanelShell
      items={menu.items}
      badges={menu.badges}
      title="Regalar una mentoría"
      description="Eliges la mentoría y la pagas entera. Quien la recibe elige el día y la hora."
      actions={
        <Button asChild variant="outline" className="h-11 rounded-[10px]">
          <Link href="/regalar/mis-regalos">Mis regalos</Link>
        </Button>
      }
    >
      {/* ── Lo que hay que saber ANTES de elegir ──────────────────────────────
          Va arriba y no en el pie del formulario de pago a propósito: las tres
          líneas cambian la decisión de comprar, no la de pagar. La del plazo
          trae su número de la base; si no se pudo leer, dice «caduca» a secas en
          vez de inventarse un 90 (ver `plazoEnPalabras`). */}
      <PanelCard>
        <PanelCardTitle className="flex items-center gap-2 text-[18px]">
          <GiftIcon className="size-[18px] shrink-0 text-brand" aria-hidden />
          Cómo funciona
        </PanelCardTitle>
        <ul className="mt-3.5 grid gap-3 sm:grid-cols-3">
          {[
            {
              Icon: WalletIcon,
              titulo: "Pagas el precio íntegro",
              texto:
                "El regalo no es un descuento: la mentoría vale lo mismo y su tutor cobra lo mismo. Lo único que cambia es quién la paga.",
            },
            {
              Icon: CalendarClockIcon,
              titulo: "El horario lo elige quien lo recibe",
              texto:
                "Tú no reservas ningún hueco. El regalo le aparece en «Mis reservas» y agenda con ese tutor cuando le venga bien.",
            },
            {
              Icon: HourglassIcon,
              titulo: `El regalo ${plazoEnPalabras(dias)}`,
              texto:
                "Contados desde que se cobra. Le avisamos por correo antes de que venza, y tú ves la fecha en «Mis regalos».",
            },
          ].map(({ Icon, titulo, texto }) => (
            <li
              key={titulo}
              className="rounded-[12px] bg-muted p-3.5 first-letter:uppercase"
            >
              <p className="flex items-center gap-2 text-[13px] font-semibold text-[#19191f]">
                <Icon className="size-4 shrink-0 text-brand" aria-hidden />
                {titulo}
              </p>
              <p className="mt-1.5 text-[12.5px] text-pretty text-[#595959]">
                {texto}
              </p>
            </li>
          ))}
        </ul>
      </PanelCard>

      {/* ── Elegir la mentoría ────────────────────────────────────────────── */}
      <PanelCard id="catalogo" className="scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <PanelCardTitle className="text-[22px]">
              Elige la mentoría
            </PanelCardTitle>
            <p className="mt-1 text-[13px] text-[#6b6b6b]">
              {termino
                ? `${resultado.total} ${resultado.total === 1 ? "resultado" : "resultados"} para «${termino}».`
                : "El mismo catálogo de siempre. Busca por tema, por objetivo o por el nombre de la mentoría."}
            </p>
          </div>
        </div>

        {/* Formulario GET, sin JavaScript: la búsqueda es un enlace con estado
            en la URL, así que se puede compartir, volver atrás y recargar. El
            campo mide 44 px de alto (objetivo táctil) y el botón lo iguala. */}
        <form action="/regalar" method="get" className="mt-4 flex flex-wrap gap-2">
          {/* El tema elegido sobrevive a la búsqueda: sin este campo oculto,
              buscar dentro de una categoría la perdía en silencio. */}
          {cat ? <input type="hidden" name="cat" value={cat} /> : null}
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#8a8a8a]"
              aria-hidden
            />
            <Input
              type="search"
              name="q"
              defaultValue={termino}
              placeholder="Buscar una mentoría para regalar…"
              aria-label="Buscar una mentoría para regalar"
              className="h-11 rounded-[10px] pl-9"
            />
          </div>
          <Button type="submit" className="h-11 rounded-[10px] px-5 font-semibold">
            Buscar
          </Button>
          {termino || cat ? (
            <Button asChild variant="ghost" className="h-11 rounded-[10px]">
              <Link href="/regalar">Quitar filtros</Link>
            </Button>
          ) : null}
        </form>

        {categorias.length > 0 ? (
          <div className="mt-4 border-t border-[#e0e0e0] pt-4">
            <p className="text-[13px] text-[#6b6b6b]">O elige un tema:</p>
            {/* `tone="light"` porque el fondo de la tarjeta es blanco, y
                `strip`/`text` porque por debajo de `lg` nueve burbujas ocupan dos
                filas enteras (Verónica, 3-sep). Mismos ajustes de sangrado que
                `SugerenciasCard`: el padre es una `PanelCard` con `p-5` fijo. */}
            <CategoryIconChips
              categories={categorias}
              activeSlug={cat}
              hrefFor={(slug) =>
                hrefCon({ q: termino, cat: cat === slug ? undefined : slug })
              }
              tone="light"
              layout="strip"
              variant="text"
              scroll={false}
              className="mt-2 -mx-5 px-5 scroll-px-5 sm:-mx-5 sm:px-5 sm:scroll-px-5 md:-mx-5 md:px-5 md:scroll-px-5"
            />
          </div>
        ) : null}

        {resultado.products.length === 0 ? (
          <EmptyResults
            message={
              termino
                ? `No encontramos ninguna mentoría para «${termino}».`
                : "No hay mentorías publicadas con esos filtros."
            }
            categories={categorias}
            // Se queda en ESTA pantalla ya filtrada: salir a `/categories` para
            // volver a entrar es la peor salida, y además perdería el hilo del
            // regalo (RV-11, ver la cabecera de `EmptyResults`).
            hrefFor={(slug) => hrefCon({ cat: slug })}
            action={termino || cat ? { href: "/regalar", label: "Quitar los filtros" } : undefined}
            className="mt-6"
          />
        ) : (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {resultado.products.map((p: ProductCardData) => (
              <li key={p.id} className="flex flex-col gap-2.5">
                {/* `flex-1` para que la tarjeta llene la altura de la celda y
                    los botones queden alineados entre columnas: `ProductCard`
                    es `h-full`, pero necesita un padre con altura de la que
                    tirar. `compact` porque la columna del panel es más estrecha
                    que la rejilla del catálogo público. */}
                <div className="flex-1">
                  <ProductCard product={p} compact />
                </div>
                <Button
                  asChild
                  className="h-11 w-full rounded-[10px] font-semibold"
                >
                  <Link href={`/regalar/mentoria/${p.id}`}>
                    Regalar esta
                    <span className="sr-only"> mentoría: {p.title}</span>
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Sin paginación cuando se busca: `searchProducts` devuelve una sola
            página por diseño (es el mismo motor del typeahead público), así que
            un «siguiente» aquí enseñaría la misma lista. */}
        {termino ? null : (
          <Pager
            page={page}
            hasMore={resultado.hasMore}
            hrefFor={(n) => hrefCon({ cat, page: n })}
            targetId="catalogo"
          />
        )}
      </PanelCard>
    </PanelShell>
  );
}
