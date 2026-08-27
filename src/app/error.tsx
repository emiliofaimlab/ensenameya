"use client";

import { useEffect } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { COMPANY } from "@/lib/company";

/**
 * Error boundary de toda la aplicación.
 *
 * ⚠️ **Por qué existe:** hasta el 17-ago el proyecto no tenía NINGUNO —ni
 * `error.tsx`, ni `global-error.tsx`, ni `not-found.tsx`—, y eso convertía
 * cualquier error de cliente en **una pantalla en blanco**. Sin traza, sin
 * mensaje y sin salida: el usuario se queda mirando el fondo y nosotros nos
 * enteramos solo si alguien nos manda una captura.
 *
 * Es justo lo que pasó al encender el acceso con Google: la sesión se creaba
 * bien y `/onboarding` se quedaba en blanco. El error existía desde antes; lo
 * que faltaba era algo que lo enseñara. Con esto, el mismo fallo se ve como un
 * mensaje con un botón de reintentar y el `digest` que permite encontrarlo en
 * los logs de Vercel.
 *
 * No sustituye a arreglar la causa (M-03 / RV-18): es la red que hace que la
 * próxima causa se pueda diagnosticar en un minuto en vez de en una tarde.
 *
 * ## US-1601 · qué se tocó del Figma «G01b — Error 500» y qué no
 *
 * De aquí solo salió la **maquetación de móvil y tablet**: el archivo tenía UN
 * `sm:` en todo el fichero, o sea que saltaba de 640 a escritorio y la banda de
 * tablet (768-1023, que es justo la que define este Figma) no existía. Los
 * escalones de ahora son los del diseño —22/26px de titular, 14px de cuerpo,
 * botones de 45px apilados a 390 y en fila a 768— y **todos restituyen el
 * escritorio con `lg:`**, así que de 1024 en adelante esta pantalla es la misma
 * que el 17-ago, píxel a píxel (R1).
 *
 * Lo que el Figma pide y NO se ha hecho, a propósito:
 *
 * - **La cabecera y el pie.** El frame los dibuja completos, pero esto es una
 *   frontera de ERROR: algo ya se rompió. `SiteHeader` arrastra el buscador con
 *   autocompletado (que hace red), el cajón, el carrito y la campana; montar
 *   todo eso dentro del boundary es multiplicar por cuatro las formas de que el
 *   fallo escale a `global-error.tsx`, que es la pantalla en blanco que este
 *   archivo existe para evitar. La 404 sí lo lleva —ver `not-found.tsx`— porque
 *   allí no se ha roto nada y además el cromo lo pone el layout de arriba.
 * - **El «500» gigante.** Añadirlo cambia el escritorio y no se puede restituir
 *   con un breakpoint (R1). Y sería mentira la mitad de las veces: aquí caen
 *   errores de render de cliente que nunca produjeron un 500 en el servidor.
 * - **El botón principal en negro (#19191f).** Ese relleno no aparece como
 *   botón en ninguna otra de las 115 pantallas del archivo; manda `--primary`.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // En producción el mensaje llega minificado (React #418, #423…) y el `digest`
    // es lo único que casa esta pantalla con la traza completa del servidor.
    console.error("[error boundary]", error.digest ?? "", error);
  }, [error]);

  return (
    // Aire vertical del Figma: 48 arriba a 390 y 80 a 768. `lg:py-16` devuelve
    // los 64 de siempre a partir de 1024.
    <Container className="flex min-h-[60vh] flex-col items-center justify-center gap-5 py-12 text-center md:py-20 lg:py-16">
      <div className="max-w-[520px]">
        {/* Titular: 22/700 a 390 y 26/700 a 768 en el Figma. El peso se queda en
            600 —cambiarlo movería también el escritorio— y el tamaño de ≥1024
            sigue siendo el de siempre. Ojo al `sm:` que había aquí: partía en
            640, un ancho del que no hay ni un frame; la banda del diseño es
            `md:` (768 clavado). */}
        <h1 className="text-[22px] font-semibold md:text-[26px] lg:text-[32px]">
          Algo se rompió por nuestra parte
        </h1>
        <p className="mt-3 text-[14px] text-muted-foreground lg:text-[15px]">
          No es culpa tuya y no hemos perdido nada de lo que tengas guardado.
          Puedes reintentar; si vuelve a pasar, escríbenos y lo miramos.
        </p>

        {/* A 390 los dos botones van apilados y a todo el ancho, con los 45px
            de alto del diseño —la talla `default` de shadcn es h-8 = 32, por
            debajo del mínimo táctil de 44 (WCAG 2.5.5)—. De 768 en adelante
            vuelven a la fila de siempre, y en `lg:` recuperan altura y padding
            originales, así que el escritorio no se entera. El orden no se
            toca: «Reintentar» es la acción que resuelve la mayoría de los casos
            y va primera. */}
        <div className="mt-7 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:justify-center md:gap-3">
          <Button
            onClick={reset}
            className="h-[45px] w-full px-6 md:w-auto lg:h-8 lg:px-2.5"
          >
            Reintentar
          </Button>
          <Button
            variant="outline"
            asChild
            className="h-[45px] w-full px-6 md:w-auto lg:h-8 lg:px-2.5"
          >
            <Link href="/">Ir al inicio</Link>
          </Button>
        </div>

        <p className="mt-6 text-[13px] text-muted-foreground">
          <a
            href={`mailto:${COMPANY.email}`}
            className="font-medium text-foreground transition-colors hover:text-brand"
          >
            {COMPANY.email}
          </a>
          {error.digest ? (
            <>
              {" · "}
              <span className="font-mono text-[12px]">
                ref. {error.digest}
              </span>
            </>
          ) : null}
        </p>
      </div>
    </Container>
  );
}
