import Image from "next/image";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
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
const MIN_PIEZAS = 6;

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
 *  2. las tarjetas de academia debajo, las mismas de `/academias`.
 *
 * ⚠️ Las tarjetas NO van en `ScrollCarousel`, y se probó: un carrusel de dos
 * tarjetas de ancho fijo deja 900 px de vacío a la derecha en un monitor de
 * 1920 y no tiene nada que desplazar, así que ni siquiera monta sus flechas.
 * Un `flex-wrap justify-center` con ancho fijo por tarjeta se ve centrado y
 * deliberado con dos, y envuelve en filas centradas cuando haya veinte —sin
 * componente de por medio—. El día que no quepan, el sitio para desplazarlas
 * es `/academias`, que es a donde lleva «Ver todas».
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
            className="relative mt-7 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]"
            role="group"
            aria-label="Academias aliadas"
          >
            <ul className="flex w-max animate-marquee items-center gap-4">
              {[...pasada, ...pasada].map((a, i) => (
                <li
                  key={`${a.id}-${i}`}
                  // La segunda mitad es la copia que cierra el bucle: existe
                  // para el ojo, no para quien escucha la página.
                  aria-hidden={i >= pasada.length}
                  className="flex shrink-0 items-center gap-3 rounded-full border border-[#e8e8e8] bg-card py-2.5 pr-6 pl-2.5"
                >
                  <Logo academy={a} size={40} />
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

          {/* ── 2 · las tarjetas ──────────────────────────────────────────── */}
          {/* Ancho fijo por tarjeta + `justify-center`: con dos quedan
              centradas bajo la banda y con veinte envuelven solas en filas
              centradas. A 390 el ancho lo manda `max-w-full`, no los 300. */}
          <ul className="mt-10 flex flex-wrap justify-center gap-5">
            {academies.map((a) => (
              <li key={a.id} className="w-[300px] max-w-full">
                <AcademyCard academy={a} />
              </li>
            ))}
          </ul>
        </Section>
      </Container>
    </div>
  );
}
