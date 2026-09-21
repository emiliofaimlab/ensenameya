import Image from "next/image";
import Link from "next/link";
import { PrecioEnLinea } from "@/components/precio/precio";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { RatingStars } from "@/components/catalog/rating";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import type { FeaturedTutor } from "@/lib/catalog/queries";

export function FeaturedTutors({ tutors }: { tutors: FeaturedTutor[] }) {
  if (tutors.length === 0) return null;

  return (
    <div className="bg-muted">
      <Container>
        <Section>
          {/* Cabecera. Móvil (Figma «Mobile y Tablet», P01 § Tutores
              destacados, escala 2): título de 20 px (tinta de 200,5 px;
              Poppins 600 a 20 avanza 202,3) y «Ver todos →» de 13 px a la
              derecha, en UNA línea. `min-w-0` + `shrink-0 whitespace-nowrap`
              es lo que impide que el enlace se parta en tres («Ver / todos /
              →», captura 04 de Verónica): el que cede ancho es el título. El
              `-my-3 py-3` no mueve nada: agranda la zona táctil del enlace a
              44 px sin tocar el alto de la fila. */}
          <div className="flex items-center justify-between gap-4">
            <h2 className="min-w-0 text-xl font-semibold sm:text-2xl">
              Tutores destacados
            </h2>
            <Link
              href="/tutors"
              className="-my-3 shrink-0 py-3 text-[13px] font-medium whitespace-nowrap text-brand hover:underline sm:text-sm"
            >
              Ver todos →
            </Link>
          </div>

          {/* Correo de Verónica (3-sep-2026): «En diseño está como slider (me
              parece mejor opción también)». Por debajo de `sm` la rejilla pasa
              a ser una tira con scroll horizontal y anclaje (`scroll-strip`,
              globals.css) que sangra hasta el borde de la pantalla (`-mx-5
              px-5` = el padding del Container a 390): la siguiente tarjeta
              asoma cortada, que es la señal de que hay más. Medido en el Figma
              (P01 § Tutores destacados, escala 2): tarjeta de 220 de ancho y 14
              de hueco (`gap-3.5`). El `py-4` con `-mb-4` y `mt-2` (en vez de
              `mt-6`) es para la SOMBRA: un contenedor con `overflow-x: auto`
              recorta también en vertical, y `shadow-card` baja 12 px; los 16 de
              padding la dejan pasar sin cambiar ni el hueco con la cabecera (8
              + 16 = 24) ni el de abajo (16 − 16). Desde `sm` vuelve la rejilla
              de hoy (R1). */}
          <ul className="mt-6 gap-3.5 max-sm:scroll-strip max-sm:-mx-5 max-sm:mt-2 max-sm:-mb-4 max-sm:px-5 max-sm:py-4 max-sm:scroll-px-5 sm:grid sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {tutors.map((t) => {
              const avatar = storageUrl("avatars", t.avatarPath);
              const name = t.displayName ?? t.headline ?? "Tutor";
              return (
                <li
                  key={t.id}
                  // El ancho fijo solo vale en la tira; en la rejilla lo pone la columna.
                  className="relative flex flex-col gap-2 rounded-[20px] bg-card p-5 shadow-card transition-shadow focus-within:ring-2 focus-within:ring-brand/40 hover:shadow-card-hover max-sm:w-[220px]"
                >
                  {/* Cabecera del Figma: foto a la izquierda, nombre + titular al lado. */}
                  <div className="flex items-start gap-3">
                    <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-semibold">
                      {avatar ? (
                        <Image
                          src={avatar}
                          alt=""
                          width={56}
                          height={56}
                          className="size-14 object-cover"
                          unoptimized
                        />
                      ) : (
                        initialsFrom(name)
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{name}</p>
                      <p className="line-clamp-2 text-[13px] text-muted-foreground">
                        {t.headline ?? t.bio ?? "Sin biografía todavía."}
                      </p>
                    </div>
                  </div>

                  <RatingStars avg={t.ratingAvg} count={t.ratingCount} />
                  {t.priceFromMinor !== null && t.currency ? (
                    <p className="text-sm font-semibold">
                      Desde{" "}
                      <PrecioEnLinea
                        amountMinor={t.priceFromMinor}
                        currency={t.currency}
                      />
                    </p>
                  ) : null}
                  {/* Tarjeta clickeable entera: ver `catalog/product-card.tsx`.
                      ⚠️ Y enlace PELADO, no `<Button asChild>`: el
                      `active:…translate-y-px` de `buttonVariants` encoge este
                      overlay justo al pulsarlo. El porqué entero, en
                      `catalog/tutor-card.tsx`. */}
                  <Link
                    href={`/tutors/${t.id}`}
                    aria-label={`Ver perfil de ${name}`}
                    className="mt-auto inline-flex h-10 w-fit shrink-0 items-center justify-center rounded-[10px] border border-brand bg-background px-4 text-sm font-medium text-brand transition-colors before:absolute before:inset-0 hover:bg-brand-muted"
                  >
                    Ver perfil
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      </Container>
    </div>
  );
}
