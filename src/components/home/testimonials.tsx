import { StarIcon } from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import type { Testimonial } from "@/lib/catalog/queries";

/**
 * "Resultados reales de nuestros alumnos" (P01). Los textos del Figma son de
 * maqueta: aquí salen de reseñas de verdad (`home_testimonials`, ≥4★ y con
 * comentario), con el nombre enmascarado en la propia RPC. Sin reseñas, la
 * sección no se pinta — mejor que rellenarla con testimonios inventados.
 *
 * Medidas del Figma: bloque 1221×599 r17, título 29px, estrellas 36px, tarjetas
 * 423×133 r15.6 en dos filas que se salen del bloque por ambos lados. Ese
 * desbordamiento es lo que delata que las filas se mueven: se resuelve con dos
 * pistas duplicadas y un `translateX(-50%)` en bucle, sin JS.
 */
export function Testimonials({ items }: { items: Testimonial[] }) {
  if (items.length === 0) return null;

  // Dos filas, como el Figma. Con pocas reseñas la segunda puede quedar vacía.
  const half = Math.ceil(items.length / 2);
  const rows = [items.slice(0, half), items.slice(half)].filter(
    (r) => r.length > 0,
  );

  return (
    // R24-01: el ancho lo manda `Container`, como el resto del sitio. Antes
    // llevaba un `max-w-[1221px]` propio —la medida del bloque en el Figma de
    // 1280— y en pantallas grandes se quedaba estrecho al lado de las bandas
    // vecinas, que sí crecen.
    <Container>
      <Section>
        <div className="relative overflow-hidden rounded-[17px] bg-black py-12">
          {/* Patrón de ondas del Figma. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-[url('/img/testimonials-bg.png')] bg-cover bg-center"
          />

          <div className="relative">
            <h2 className="text-center text-[29px] leading-tight font-semibold text-white">
              Resultados reales
              <br />
              de nuestros alumnos
            </h2>
            <div
              className="mt-4 flex justify-center gap-1"
              aria-label="Valoración media de nuestros alumnos: 5 de 5"
            >
              {Array.from({ length: 5 }, (_, i) => (
                <StarIcon
                  key={i}
                  className="size-9 fill-primary text-primary"
                  aria-hidden
                />
              ))}
            </div>

            <div className="mt-12 flex flex-col gap-7">
              {rows.map((row, i) => (
                <ul
                  key={i}
                  // La pista va duplicada: al llegar a -50% el segundo juego
                  // está justo donde arrancó el primero y el salto no se ve.
                  className={`flex w-max gap-6 ${
                    i % 2 === 0
                      ? "animate-marquee"
                      : "-ml-[212px] animate-marquee-reverse"
                  }`}
                >
                  {[...row, ...row].map((t, j) => (
                    <li
                      key={`${t.id}-${j}`}
                      aria-hidden={j >= row.length}
                      className="flex h-[133px] w-[423px] shrink-0 flex-col justify-between rounded-[15px] bg-card px-5 py-4 shadow-card"
                    >
                      <p className="line-clamp-3 text-[13px] text-[#404040]">
                        “{t.comment}”
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="size-[30px] shrink-0 rounded-full bg-brand" />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-[#a7a7a7]">
                            {t.author}
                          </p>
                          <p className="truncate text-[11px] text-[#666666]">
                            {t.context}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </Container>
  );
}
