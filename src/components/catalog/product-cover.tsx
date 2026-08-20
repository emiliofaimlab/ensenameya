import { createElement } from "react";

import Image from "next/image";

import { categoryIcon } from "@/components/catalog/category-icons";
import { storageUrl } from "@/lib/catalog/format";
import type { ProductCardData } from "@/lib/catalog/queries";
import { cn } from "@/lib/utils";

/**
 * MN-09 · la portada de una mentoría, con o sin foto.
 *
 * `products.image_path` es OPCIONAL y hasta hoy cada superficie improvisaba lo
 * suyo: banda gris en la tarjeta de catálogo, banda gris (de otro tono) en la
 * portada, y directamente NADA en la ficha de detalle, que se abría por la
 * descripción. Tres conductas para el mismo dato. Este componente existe
 * para que **no vuelvan a divergir**: las tres pasan por aquí y lo único que
 * cada una decide es la CAJA (alto/aspecto/redondeo, que vienen del Figma de
 * EP-22 y no se tocan). Si mañana hay que cambiar el relleno, se cambia una vez.
 *
 * El relleno es el **icono de la categoría** que ya está en la base de datos
 * (`categories.icon`, migración `20260805120000`) sobre un fondo de marca. Cero
 * arte nueva a propósito: el Figma no tiene design system ni asset para esto, y
 * esperar a que lo hubiera dejaba el hueco vacío en producción mientras tanto.
 *
 * ⚠️ Hay una CUARTA lectura del mismo dato que se queda fuera a propósito: el
 * panel del propio tutor (`(app)/tutor/products/page.tsx`) pinta la portada a
 * 64×64 y sin foto cae a las INICIALES del título. Es una miniatura tipo
 * avatar, no una portada, y no es superficie pública. Si algún día se unifica,
 * que sea aquí — y que este párrafo deje de ser cierto.
 */
export function ProductCover({
  product,
  width,
  height,
  className,
  priority = false,
}: {
  /** Solo lo que se pinta: la ruta de la foto y las categorías. */
  product: Pick<ProductCardData, "imagePath" | "categories">;
  /** Tamaño declarado del hueco (el que pide `next/image`), en px del Figma. */
  width: number;
  height: number;
  /**
   * Clases de **la caja**, no del contenido: alto o `aspect-*`, redondeo. Las
   * recibe igual la foto y el placeholder — es lo que garantiza que el layout
   * no salte según haya imagen o no.
   */
  className?: string;
  /** Solo la ficha de detalle: su portada está sobre el pliegue. */
  priority?: boolean;
}) {
  const src = storageUrl("product-images", product.imagePath);

  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={width}
        height={height}
        className={cn("w-full object-cover", className)}
        /* ⚠️ `unoptimized` es OBLIGATORIO aquí y solo aquí: la URL es del
           Storage de Supabase y ese host no está declarado en `next.config.ts`,
           así que el optimizador de Next la rechazaría en tiempo de ejecución.
           NO se hereda a la otra rama —el placeholder es un SVG en línea, ni
           siquiera pasa por `next/image`—, y si algún día el placeholder pasa a
           ser un asset propio en `/public`, ese sí se sirve local y sí debe
           optimizarse: no le copies este `unoptimized`. */
        unoptimized
        priority={priority}
      />
    );
  }

  /*
   * Sin foto: el icono de la PRIMERA categoría. Las tarjetas ya enseñan como
   * mucho dos etiquetas y la primera es la que manda en el resto del catálogo.
   *
   * El caso "ni siquiera hay categoría" no necesita rama propia: `categoryIcon`
   * devuelve el genérico (`SparklesIcon`) tanto para la categoría sin icono
   * puesto como para `undefined`. Un solo genérico en todo el producto —el
   * mismo que ya pintan las burbujas de `CategoryIconChips`— en vez de dos que
   * habría que mantener sincronizados.
   */
  /*
   * Se resuelve con `createElement` y NO con `const Icon = categoryIcon(...)`,
   * que es lo natural de escribir: la regla `react-hooks/static-components` lo
   * marca como ERROR —"componente creado durante el render"— y CI corre
   * `npm run lint` en cada push. Es un falso positivo (el mapa `CATEGORY_ICONS`
   * es de módulo y devuelve siempre la misma referencia), pero la regla no
   * puede saberlo. Los otros usos de `categoryIcon` del repo la esquivan sin
   * querer porque resuelven dentro de un callback de `.map`.
   */
  const icono = createElement(categoryIcon(product.categories[0]?.icon), {
    className: "size-full",
    // `strokeWidth` menor que el 2 de lucide: el trazo va en unidades del
    // `viewBox` de 24, o sea que escala con el icono — a 150px, un 2 se ve
    // como un rotulador.
    strokeWidth: 1.5,
  });

  return (
    <div
      /* Decorativo: el título de la mentoría va justo debajo en las tres
         superficies, así que anunciarlo al lector de pantalla sería ruido. */
      aria-hidden="true"
      className={cn(
        // Fondo de marca en TINTA, no a plena saturación: en la portada son
        // cuatro tarjetas en fila y un #fe6a00 macizo repetido le gritaría por
        // encima a las mentorías que sí tienen foto. El par
        // primary-muted/primary-muted-foreground ya viene emparejado del Figma
        // (es el del chip de modelo de precio), así que el icono se lee.
        "grid w-full place-items-center bg-linear-to-br from-primary-muted to-brand-muted text-primary-muted-foreground",
        className,
      )}
    >
      {/*
        El tamaño del icono es el único detalle con miga de todo esto.

        · Va en **% del ancho**, no en px, porque la ficha de detalle usa
          `aspect-[764/360]`: su alto real lo pone el viewport y un icono en px
          fijo salía gigante en móvil. Un `%` de ALTO no serviría — se
          resolvería contra un alto que la caja no declara.
        · Pero un % a secas se desmadra al revés: la tarjeta tiene el alto
          clavado (140px) y el ancho elástico, así que en la rejilla de dos
          columnas de `/classes` a ~424px el icono ocupaba dos tercios del alto.
          De ahí el `min()` con un tope en px sacado del alto declarado: la
          proporción queda en ~45 % del alto en las cuatro superficies.
        · Y el cuadrado lo pone un `span`, no el propio `<svg>`: lucide escribe
          `width="24" height="24"` como atributos de presentación, así que darle
          el tamaño al SVG obliga a pisar los dos y a fiarse de que el navegador
          deduzca el alto del `viewBox`. Con el envoltorio, el `size-full` los
          pisa a mano y el cuadrado lo decide una caja normal y corriente.
      */}
      <span
        className="grid aspect-square place-items-center"
        style={{ width: `min(22%, ${Math.round(height * 0.42)}px)` }}
      >
          {icono}
      </span>
    </div>
  );
}
