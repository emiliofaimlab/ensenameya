import Image from "next/image";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { ScrollCarousel } from "@/components/ui/scroll-carousel";
import { AcademyCard } from "@/components/catalog/academy-card";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import type { AcademyCardData } from "@/lib/catalog/queries";

/**
 * Mínimo de piezas que tiene que haber en la banda de logos ANTES de
 * duplicarla.
 *
 * La marquesina funciona porque la pista va dos veces y a `-50 %` el segundo
 * juego cae justo donde arrancó el primero. Eso solo es invisible si UN juego
 * ya es más ancho que la pantalla: con dos academias la pista mediría ~500 px,
 * y en un monitor de 1920 se vería el hueco y el salto. Repitiendo hasta ocho
 * piezas la banda llena cualquier ancho razonable, y el día que haya ocho
 * academias de verdad cada una aparece una sola vez.
 */
const MIN_PIEZAS = 8;

/** El logo, o la marca tipográfica: iniciales en el color de la academia. */
function Logo({ academy, size }: { academy: AcademyCardData; size: number }) {
  const src = storageUrl("avatars", academy.logoPath);
  const marca = academy.brandColor ?? "var(--color-brand)";

  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-[14px] bg-white font-bold shadow-[0_2px_10px_rgb(0_0_0/0.08)]"
      style={{ color: marca, width: size, height: size, fontSize: size * 0.34 }}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          width={size}
          height={size}
          style={{ width: size, height: size }}
          className="object-cover"
          unoptimized
        />
      ) : (
        initialsFrom(academy.name)
      )}
    </span>
  );
}

/**
 * P01 · «Conoce nuestras academias aliadas» (pedido del 15-sep).
 *
 * Son las dos cosas que se pidieron, en una sección con un solo título:
 *
 *  1. una BANDA DE LOGOS en bucle, la marquesina de CSS puro de
 *     `testimonials.tsx` —pista duplicada y `translateX(-50%)`, sin JS—. Es
 *     decorativa y por eso no lleva enlaces: en una pista duplicada habría dos
 *     destinos idénticos, uno de ellos oculto al lector de pantalla;
 *  2. un CARRUSEL de las tarjetas de academia, que son las mismas de
 *     `/academias` —la que el jefe ya dio por buena— con sus flechas y su
 *     anclaje (`ScrollCarousel`).
 *
 * ⚠️ Mientras las academias no suban un logo, la banda pinta la MARCA
 * TIPOGRÁFICA: iniciales en su color sobre blanco. No es un hueco a la espera
 * de un asset — es lo que se verá el día que se publique una academia nueva, y
 * por eso se diseña, no se deja para después.
 *
 * Sin academias publicadas la sección no se pinta, como hace `Testimonials`
 * sin reseñas: una banda vacía es peor que ninguna banda.
 */
export function HomeAcademies({
  academies,
}: {
  academies: AcademyCardData[];
}) {
  if (academies.length === 0) return null;

  // Una pasada de la banda: las academias repetidas hasta llenar el ancho.
  const pasada = Array.from(
    { length: Math.ceil(MIN_PIEZAS / academies.length) },
    () => academies,
  ).flat();

  return (
    <div className="bg-muted">
      <Container>
        <Section>
          {/* Misma cabecera que «Tutores destacados»: `min-w-0` en el título y
              `shrink-0 whitespace-nowrap` en el enlace, que es lo que impide
              que «Ver todas →» se parta en tres líneas a 390. */}
          <div className="flex items-center justify-between gap-4">
            <h2 className="min-w-0 text-xl font-semibold sm:text-2xl">
              Conoce nuestras academias aliadas
            </h2>
            <Link
              href="/academias"
              className="-my-3 shrink-0 py-3 text-[13px] font-medium whitespace-nowrap text-brand hover:underline sm:text-sm"
            >
              Ver todas →
            </Link>
          </div>

          <p className="mt-2 max-w-2xl text-[14.5px] text-[#525252]">
            Escuelas con marca y método propios que imparten sus mentorías aquí.
          </p>

          {/* ── 1 · la banda de logos ─────────────────────────────────────── */}
          {/* `overflow-hidden` recorta la pista por los dos lados, que es lo
              que hace que parezca infinita. Las máscaras laterales la funden
              con el fondo en vez de cortarla a cuchillo. */}
          <div
            className="relative mt-7 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]"
            role="group"
            aria-label="Academias aliadas"
          >
            <ul className="flex w-max animate-marquee items-center gap-10">
              {[...pasada, ...pasada].map((a, i) => (
                <li
                  key={`${a.id}-${i}`}
                  // La segunda mitad es la copia que cierra el bucle: existe
                  // para el ojo, no para quien escucha la página.
                  aria-hidden={i >= pasada.length}
                  className="flex shrink-0 items-center gap-3"
                >
                  <Logo academy={a} size={52} />
                  <span
                    className="text-[15px] font-semibold whitespace-nowrap"
                    style={{ color: a.brandColor ?? "var(--color-brand)" }}
                  >
                    {a.name}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── 2 · el carrusel de tarjetas ───────────────────────────────── */}
          {/* `py-4 -my-4`: un contenedor con `overflow-x: auto` recorta también
              en vertical y la sombra de las tarjetas baja 12 px. El padding la
              deja pasar sin mover nada de sitio. */}
          <ScrollCarousel
            label="Academias aliadas"
            className="mt-8 -my-4 py-4"
          >
            {academies.map((a) => (
              // El ancho fijo es lo que hace que haya algo que desplazar.
              <li key={a.id} className="w-[288px] shrink-0 snap-start">
                <AcademyCard academy={a} />
              </li>
            ))}
          </ScrollCarousel>
        </Section>
      </Container>
    </div>
  );
}
