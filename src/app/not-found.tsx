import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";

/**
 * 404 de toda la aplicación — «G01a — Error 404» del Figma «Mobile y Tablet»
 * (390x1165 y 768x877), US-1601.
 *
 * ⚠️ **Por qué se crea ahora:** hasta hoy este archivo NO EXISTÍA, ni aquí ni
 * anidado en ningún segmento, y en el repo hay **22 llamadas vivas a
 * `notFound()`** —desde `/tutors/[id]` y `/products/[id]` hasta media docena de
 * pantallas de `/admin`—. Todas caían en el 404 por defecto de Next: fondo
 * blanco, sin cabecera, sin pie, sin marca y **en inglés** («This page could
 * not be found»). O sea que una de las salidas más frecuentes de la app era la
 * única pantalla que no parecía nuestra.
 *
 * ## Por qué aquí NO se monta el cromo, aunque el Figma lo dibuje
 *
 * El frame trae cabecera y pie completos, y la primera versión de esta pantalla
 * los montaba ella misma. **Sale doble.** Medido en el navegador a 390 sobre
 * `/tutors/<uuid-que-no-existe>`: `document.querySelectorAll('header').length`
 * daba **2** y `footer` otros **2**, con los dos logos apilados uno encima del
 * otro.
 *
 * El motivo es que `notFound()` **no tira abajo los layouts de arriba**: la
 * frontera sustituye a la PÁGINA, así que `(public)/layout.tsx` —o el de
 * `(app)`— sigue en pie con su `SiteHeader` y su `SiteFooter` ya pintados. Y
 * eso es lo que queremos: el cromo heredado es el bueno, porque conoce la
 * sesión (un alumno identificado ve su avatar, no «Iniciar sesión»), trae la
 * campana, el carrito y el FAB de chat. Montar una copia aquí no añadía nada:
 * duplicaba.
 *
 * Queda un caso sin cabecera ni pie: la URL que **no casa con ninguna ruta**
 * (`/loquesea`). Ésa se sirve por `/_not-found`, que solo tiene encima el layout
 * raíz, y ahí sí sale la pantalla desnuda. Se arregla —fuera de este encargo,
 * porque crea una ruta— con un `(public)/[...rest]/page.tsx` que llame a
 * `notFound()`: al vivir dentro del grupo público, hereda su cromo igual que
 * las otras 22 llamadas. Mientras tanto la pantalla sigue siendo nuestra: en
 * castellano, con la marca y con dos salidas.
 */
export default function NotFound() {
  return (
    // `error-content` del Figma: banda a ancho completo con fondo #f9fafc
    // (= --muted) y el bloque de texto centrado. El `flex-1` es para cuando
    // cuelga del `main` flexible de `(app)`; el `min-h-[60vh]` para que entre
    // cabecera y pie no quede una tira aplastada.
    //
    // ⚠️ `[body>&]:min-h-svh` NO es un adorno: es el segundo sitio donde se
    // monta esta pantalla. Con la URL suelta (`/loquesea`) no hay layout de
    // grupo, así que la sección cuelga DIRECTAMENTE del `<body>` —comprobado en
    // el navegador— y sin esto el fondo gris se cortaba a media pantalla y
    // dejaba media pantalla en blanco debajo. Dentro de un `main` la regla no
    // aplica y manda el 60vh de siempre.
    //
    // Padding vertical del diseño: 48/40 a 390 y 80/80 a 768 (`md:`). De 1024
    // en adelante no hay ni un frame —Diana entregó 390 y 768—, así que se deja
    // un escalón más de aire y ya.
    <section className="flex min-h-[60vh] flex-1 flex-col items-center justify-center bg-muted py-12 text-center [body>&]:min-h-svh md:py-20 lg:py-24">
      {/* El aire lateral lo pone `Container`, el mismo de todo el sitio; aquí
          solo se limita la columna de texto al ancho del Figma tablet
          (648 = 768 − 2×60). */}
      <Container className="flex max-w-[648px] flex-col items-center">
        {/* El número es decoración: quien va con lector de pantalla ya tiene el
            <h1> justo debajo, y oír «cuatro cero cuatro» antes no aporta nada.
            Escala del Figma: 56/lh84 a 390 → 64/lh96 a 768. */}
        <p
          aria-hidden="true"
          className="text-[56px] leading-[84px] font-bold text-foreground md:text-[64px] md:leading-[96px]"
        >
          404
        </p>

        <h1 className="mt-4 text-[22px] leading-[33px] font-bold md:mt-5 md:text-[26px] md:leading-[39px]">
          No encontramos esta página
        </h1>

        <p className="mt-4 text-[14px] leading-[21px] text-muted-foreground md:mt-5">
          La página que buscas no existe o cambió de lugar.
        </p>

        {/* Botones: apilados y a todo el ancho a 390 (el Figma los pone de 350,
            o sea el contenido entero) y en fila a partir de 768. Los 45 px de
            alto son los del diseño y de paso arreglan el problema que ya señala
            el informe del sistema: la talla `default` de shadcn es h-8 = 32, y
            32 está por debajo del mínimo táctil de 44 (WCAG 2.5.5). */}
        <div className="mt-7 flex w-full flex-col gap-4 md:mt-8 md:w-auto md:flex-row md:gap-3">
          <Button asChild className="h-[45px] w-full px-6 md:w-auto">
            <Link href="/">Volver al inicio</Link>
          </Button>
          {/* ⚠️ El Figma pinta el botón principal en #19191f (negro) y el
              secundario en blanco. Se usan las variantes del producto —naranja
              `--primary` + `outline`— porque ese negro no aparece como relleno
              de botón en ninguna otra de las 115 pantallas del archivo: es un
              suelto de estos dos frames, y copiarlo dejaría la única CTA negra
              de toda la app justo en la pantalla de error. */}
          <Button
            variant="outline"
            asChild
            className="h-[45px] w-full px-6 md:w-auto"
          >
            <Link href="/tutors">Explorar tutores</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
