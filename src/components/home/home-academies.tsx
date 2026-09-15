import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { AcademyCard } from "@/components/catalog/academy-card";
import type { AcademyCardData } from "@/lib/catalog/queries";

/**
 * P01 · «Conoce nuestras academias aliadas» (pedido del 15-sep).
 *
 * ── LO QUE SE PROBÓ Y SE QUITÓ ──────────────────────────────────────────────
 * Se pidieron DOS sliders: una banda de logos en bucle y un carrusel de
 * tarjetas. Los dos se construyeron (`411daed`) y los dos se cayeron, porque
 * con dos academias publicadas ninguno hacía su trabajo:
 *
 *  · el CARRUSEL no tenía nada que desplazar —ni siquiera montaba sus flechas—
 *    y sus tarjetas de ancho fijo dejaban 900 px de vacío a la derecha en un
 *    monitor de 1920;
 *  · la BANDA de logos repetía «AN · Academia Nexo / PB · Project Blue» seis
 *    veces para llenar el ancho, y decía exactamente lo mismo que las tarjetas
 *    que tenía justo debajo. Dos representaciones del mismo par de nombres,
 *    una encima de la otra, se leen como relleno.
 *
 * Los dos vuelven a tener sentido a partir de cinco o seis academias, y el
 * código de la banda está en el historial (`git show 529bfff`) para
 * recuperarlo tal cual ese día. Hoy la sección son las tarjetas y ya.
 *
 * Sin academias publicadas no se pinta nada, como hace `Testimonials` sin
 * reseñas: una sección vacía es peor que ninguna sección.
 */
export function HomeAcademies({
  academies,
}: {
  academies: AcademyCardData[];
}) {
  if (academies.length === 0) return null;

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

          {/* Ancho fijo por tarjeta + `justify-center`: con dos quedan
              centradas y con veinte envuelven solas en filas centradas. A 390
              el ancho lo manda `max-w-full`, no los 300. */}
          <ul className="mt-8 flex flex-wrap justify-center gap-5">
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
