import Link from "next/link";
import { LayoutGridIcon } from "lucide-react";

import { categoryIcon } from "@/components/catalog/category-icons";
import type { CategoryTag } from "@/lib/catalog/queries";
import { cn } from "@/lib/utils";

/**
 * Burbujas de categoría **colapsadas a ícono**, con la etiqueta que se despliega
 * al pasar el ratón (o al enfocar con teclado) — el patrón del home (P01), ahora
 * en todas las vistas de exploración (acuerdo 24-jul). La categoría **activa**
 * va siempre desplegada y resaltada. Si hay más de `limit`, una burbuja
 * "Ver todas" enlaza al índice para no acumular decenas de círculos.
 *
 * `tone`: "hero" (por defecto) para fondos oscuros/de color (la píldora blanca
 * aparece al hover, como en el home); "light" para fondos claros (añade sombra
 * y borde para que la píldora resalte).
 *
 * ── MÓVIL (correo de Verónica, 3-sep-2026) ──────────────────────────────────
 * Los chips **nunca** ocupan dos líneas en móvil: van en UNA fila con scroll
 * horizontal. Y en Explorar tutores y en el panel del alumno quiere NOMBRES en
 * vez de íconos; en Home y Categoría se quedan los íconos. De ahí dos props
 * nuevas, las dos opcionales y con el valor de hoy por defecto, para que los
 * consumidores actuales no cambien ni un píxel:
 *
 * - `layout="strip"`: por debajo de `lg` la lista es una `scroll-strip`
 *   (globals.css) que sangra hasta el borde del viewport —el último chip asoma
 *   cortado: es la señal de que hay más—; desde `lg` vuelve a envolver como
 *   hoy, porque el escritorio no se toca (R1, Doc 24 §24.2).
 * - `variant="text"`: por debajo de `lg` la píldora enseña siempre el nombre y
 *   no el círculo (P04 medido en el Figma «Mobile y Tablet»: píldora blanca de
 *   36 de alto —aquí 40 por tacto—, borde 1 px #d9d9d9, texto 13 px regular,
 *   16 px de padding, 8 px entre chips; la activa en azul marca con el texto
 *   en blanco, como el «Álgebra» de P06). Desde `lg` es el chip colapsado a
 *   ícono de hoy. Un solo DOM: son clases `max-lg:`, no dos renders.
 * - `scroll`: va tal cual al `<Link scroll>` de cada chip. Con `false`, elegir
 *   categoría no devuelve al usuario al principio de la página (queja de
 *   Verónica en las vistas con filtros).
 *
 * ⚠️ El sangrado (`-mx-5 … md:-mx-8`) da por hecho que el padre es un
 * `Container` (mismos paddings). Dentro de una tarjeta del panel, el consumidor
 * lo corrige con su propio `-mx-*`/`px-*` vía `className`.
 *
 * ponytail: en `strip` no hay JS que traiga la categoría activa a la vista si
 * queda fuera de la tira al cargar con `?cat=` profundo. El componente es de
 * servidor (recibe `hrefFor`, una función) y no puede llevar un efecto; y el
 * caso común —tocar un chip visible— no lo necesita. Si algún día hace falta,
 * es un cliente hijo de diez líneas, no un `order:-1` (rompería el orden de
 * tabulación).
 */
export function CategoryIconChips({
  categories,
  activeSlug,
  hrefFor,
  limit = 8,
  moreHref = "/categories",
  tone = "hero",
  layout = "wrap",
  variant = "icon",
  scroll,
  className,
}: {
  categories: CategoryTag[];
  activeSlug?: string;
  /** Enlace de cada burbuja. En filtros, alterna la categoría (undefined = quitar). */
  hrefFor: (slug: string) => string;
  /** Cuántas burbujas antes de "Ver todas" (0 = todas, sin corte). */
  limit?: number;
  moreHref?: string;
  tone?: "hero" | "light";
  /** "wrap" (hoy) o "strip": una fila con scroll horizontal por debajo de `lg`. */
  layout?: "wrap" | "strip";
  /** "icon" (hoy) o "text": por debajo de `lg` la píldora enseña el nombre, no el ícono. */
  variant?: "icon" | "text";
  /** Se pasa al `<Link scroll>` de cada chip (`false` = no saltar arriba al elegir). */
  scroll?: boolean;
  className?: string;
}) {
  const shown = limit > 0 ? categories.slice(0, limit) : categories;
  const hasMore = limit > 0 && categories.length > limit;
  const strip = layout === "strip";
  const text = variant === "text";

  // Píldora que envuelve al chip: blanca al hover (o fija si está activo). En
  // fondo claro necesita sombra/borde para despegarse del fondo.
  const pill =
    tone === "light"
      ? { hover: "hover:bg-card hover:shadow-sm focus-visible:bg-card", active: "bg-card shadow-sm ring-1 ring-border" }
      : { hover: "hover:bg-background focus-visible:bg-background", active: "bg-background shadow-sm" };

  // Píldora de TEXTO por debajo de `lg` (variant="text"). Van todas con
  // `max-lg:` y pisan a las de arriba solo en esa franja: desde 1024 no queda
  // ni una en pie y el chip es el de siempre.
  const textPill = {
    base: "max-lg:h-10 max-lg:border max-lg:px-4 max-lg:py-0 max-lg:whitespace-nowrap",
    idle: "max-lg:border-[#d9d9d9] max-lg:bg-card max-lg:font-normal max-lg:text-muted-foreground",
    active: cn(
      // `brand-foreground` (#036fda) y no `brand` (#0080ff): el nombre va en
      // blanco a 13 px y sobre #0080ff da 3,8:1, por debajo del 4,5 de AA.
      // Sobre #036fda son 4,9:1 y el azul es el mismo a ojo. Solo `max-lg:`:
      // el chip de escritorio no se toca (R1).
      "max-lg:border-brand-foreground max-lg:bg-brand-foreground max-lg:text-white max-lg:shadow-none",
      // Sobre el hero azul una píldora azul sería invisible: el anillo blanco
      // la recorta. En fondo claro sobra (y el `ring-border` de arriba, también).
      tone === "hero" ? "max-lg:ring-2 max-lg:ring-white/90" : "max-lg:ring-0",
    ),
  };
  // Círculo del ícono (oculto en texto), nombre (siempre visible en texto) y
  // el `px-2.5` del nombre, que en la píldora de texto ya lo pone el enlace.
  // ⚠️ El tamaño (13 px, `text-body`) va en el span del nombre y NO en el
  // enlace: `tailwind-merge` no conoce el token y lo toma por un COLOR, así
  // que junto a `max-lg:text-muted-foreground` se lo comía sin avisar
  // (medido: salía 14 px). En el span no hay color con el que chocar.
  const circleCls = text ? "max-lg:hidden" : undefined;
  const nameCls = text ? "max-lg:grid-cols-[1fr]" : undefined;
  const labelCls = text ? "max-lg:px-0 max-lg:text-body" : undefined;

  return (
    <ul
      className={cn(
        "flex gap-2",
        strip
          ? cn(
              // Sangrado hasta el borde: los tres pares son los `px-*` de
              // `Container`, y `scroll-px-*` iguala el anclaje al contenido.
              // `py-1 -my-1`: aire para que la tira no recorte el anillo de
              // foco. `self-stretch`: dentro de un padre `flex-col items-start`
              // (el estado vacío de /search) la tira se encogía a su contenido
              // y salía 20 px más ancha que la pantalla — medido: 410 en 390,
              // con scroll horizontal de página. `lg:` deshace todo — el
              // escritorio no se toca (R1).
              // ⚠️ SIN `justify-start` aquí, y no es un olvido. Forzarlo bajo
              // `lg` pisaba al `justify-center` que pasa el hero del home y a
              // 768 —donde las 10 categorías SÍ caben en 704 px— los dejaba
              // pegados al borde izquierdo debajo de un titular, un párrafo y
              // un buscador centrados: una regresión de tablet que nadie
              // pidió. `start` ya es el valor por defecto de un flex, así que
              // quien no diga nada lo tiene. Quien quiera centrarlos pasa
              // `justify-center-safe`, que centra si cabe y arranca desde la
              // izquierda si desborda — que es justo lo que hace falta en una
              // tira: con `center` a secas, el primer chip queda fuera de
              // alcance por la izquierda al desbordar.
              "max-lg:scroll-strip max-lg:self-stretch max-lg:py-1 max-lg:-my-1",
              "-mx-5 px-5 scroll-px-5 sm:-mx-6 sm:px-6 sm:scroll-px-6 md:-mx-8 md:px-8 md:scroll-px-8",
              "lg:mx-0 lg:px-0 lg:flex-wrap",
            )
          : "flex-wrap",
        className,
      )}
    >
      {shown.map((c) => {
        const Icon = categoryIcon(c.icon);
        const active = c.slug === activeSlug;
        return (
          <li key={c.slug}>
            <Link
              href={hrefFor(c.slug)}
              scroll={scroll}
              // En texto el nombre ya ES el contenido del enlace: un aria-label
              // igual sería redundante (y en escritorio el nombre sigue en el
              // DOM, recortado a 0 de ancho, así que el lector lo lee igual).
              aria-label={text ? undefined : c.name}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center rounded-full p-1 text-sm font-semibold text-foreground transition-colors",
                active ? pill.active : pill.hover,
                text && textPill.base,
                text && (active ? textPill.active : textPill.idle),
              )}
            >
              {/* Círculo naranja; azul al desplegarse (hover) o si está activo. */}
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full text-primary-foreground transition-colors",
                  active
                    ? "bg-brand"
                    : "bg-primary group-hover:bg-brand group-focus-visible:bg-brand",
                  circleCls,
                )}
              >
                <Icon className="size-4.5" />
              </span>
              {/* El nombre solo ocupa sitio al desplegarse (o si está activo). */}
              <span
                className={cn(
                  "grid transition-[grid-template-columns] duration-200",
                  active
                    ? "grid-cols-[1fr]"
                    : "grid-cols-[0fr] group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]",
                  nameCls,
                )}
              >
                <span className="min-w-0 overflow-hidden whitespace-nowrap">
                  <span className={cn("px-2.5", labelCls)}>{c.name}</span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}

      {hasMore ? (
        <li>
          <Link
            href={moreHref}
            aria-label="Ver todas las categorías"
            className={cn(
              "group flex items-center rounded-full p-1 text-sm font-semibold text-foreground transition-colors",
              pill.hover,
              text && textPill.base,
              text && textPill.idle,
            )}
          >
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-brand group-hover:text-white group-focus-visible:bg-brand group-focus-visible:text-white",
                circleCls,
              )}
            >
              <LayoutGridIcon className="size-4.5" />
            </span>
            <span
              className={cn(
                "grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]",
                nameCls,
              )}
            >
              <span className="min-w-0 overflow-hidden whitespace-nowrap">
                <span className={cn("px-2.5", labelCls)}>Ver todas</span>
              </span>
            </span>
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
