import Image from "next/image";
import Link from "next/link";

import { ProductCover } from "@/components/catalog/product-cover";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import {
  initialsFrom,
  modelLabel,
  priceDisplay,
  sessionsLabel,
  storageUrl,
} from "@/lib/catalog/format";
import type { ProductCardData } from "@/lib/catalog/queries";

export function FeaturedProducts({
  products,
}: {
  products: ProductCardData[];
}) {
  if (products.length === 0) return null;

  return (
    <div className="bg-muted">
      <Container>
        {/* El hueco de abajo es donde cabalga la tarjeta de cifras (ver HomeStats).
            Con `sm:` porque si no gana el `sm:py-16` de Section y las tarjetas
            quedan tapadas.

            US-1601 · y por lo mismo hace falta `md:max-lg:`: Section estrenó
            ritmo de tablet (`md:max-lg:py-10`) y ese `py` gana al `sm:pb` por
            orden de variante, así que entre 768 y 1023 el hueco se quedaba en
            40px y la tarjeta de cifras —que tira 99px hacia arriba y no
            depende del ancho— tapaba 59px de la última mentoría (medido).
            El 164 no es ritmo, es la holgura que necesita ese solape. */}
        <Section className="pb-[124px] sm:pb-[164px] md:max-lg:pb-[164px]">
          {/* Cabecera. En la captura 04 de Verónica el «Ver todos →» se partía
              en TRES líneas junto al título de dos: `min-w-0` en el título y
              `shrink-0 whitespace-nowrap` en el enlace lo dejan en una, y el
              que cede es el título. Móvil (Figma «Mobile y Tablet», P01 §
              Productos destacados, escala 2): el título va a dos líneas con
              paso de 27,5 y el enlace, de 13 px, centrado verticalmente en
              ellas (`items-center`). El Figma escribe este título a 18 y el de
              «Tutores destacados» a 20 —mismo papel, dos cuerpos—: se unifica en
              20 (`text-xl`, 20/28), que a 335 y 350 sigue dando dos líneas
              (medido). El `-my-3 py-3` agranda la zona táctil del enlace a 44
              px sin mover la fila. */}
          <div className="flex items-center justify-between gap-4">
            <h2 className="min-w-0 text-xl font-semibold sm:text-2xl">
              Mentorías destacadas listas para reservar
            </h2>
            <Link
              href="/classes"
              className="-my-3 shrink-0 py-3 text-[13px] font-medium whitespace-nowrap text-brand hover:underline sm:text-sm"
            >
              Ver todos →
            </Link>
          </div>

          {/* Correo de Verónica (3-sep-2026): «Slider también». Misma tira que
              «Tutores destacados» (ver el comentario de featured-tutors.tsx
              para el porqué del sangrado y del `py-4`/`-mb-4`), con la medida
              del Figma para esta sección: tarjeta de 240 y 14 de hueco. El
              hueco inferior de la Section (pb-[124px]) queda igual: el `py-4`
              se compensa con `-mb-4`, así que la tarjeta de cifras cabalga el
              mismo borde que antes. Desde `sm` vuelve la rejilla de hoy (R1). */}
          <ul className="mt-6 gap-3.5 max-sm:scroll-strip max-sm:-mx-5 max-sm:mt-2 max-sm:-mb-4 max-sm:px-5 max-sm:py-4 max-sm:scroll-px-5 sm:grid sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {products.map((p) => {
              const sessions = sessionsLabel(p);
              // RV-08 · la portada enseñaba el importe a secas, sin unidad
              // siquiera: en una clase por hora de 90 min anunciaba 30 y el
              // checkout pedía 45. Mismo criterio que la tarjeta de catálogo.
              const precio = priceDisplay(p);
              return (
                <li
                  key={p.id}
                  // El ancho fijo solo vale en la tira; en la rejilla lo pone la columna.
                  className="flex min-w-0 flex-col overflow-hidden rounded-[20px] bg-card shadow-card max-sm:w-[240px]"
                >
                  {/* Miniatura 276×124 del Figma (DD-02). MN-09 · el hueco sin
                      foto lo rellena `ProductCover`, el MISMO componente que la
                      tarjeta de catálogo y la ficha: aquí había una banda gris
                      propia y ya divergía del resto. */}
                  <ProductCover
                    product={p}
                    width={276}
                    height={124}
                    className="h-[124px]"
                  />

                  <div className="flex flex-1 flex-col gap-3 p-5">
                    {/* N-12 · dos líneas y corta. Sin esto un título largo
                        estiraba la tarjeta y bajaba el "Ver detalle →" de las
                        cuatro columnas a alturas distintas. */}
                    <h3 className="line-clamp-2 text-[15px] font-semibold">
                      {p.title}
                    </h3>

                    {/* Tutor de la mentoría (DD-01): foto + nombre, como el Figma. */}
                    {p.tutor ? (
                      <div className="flex items-center gap-2">
                        <span className="grid size-[18px] shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[8px] font-semibold">
                          {storageUrl("avatars", p.tutor.avatarPath) ? (
                            <Image
                              src={storageUrl("avatars", p.tutor.avatarPath)!}
                              alt=""
                              width={18}
                              height={18}
                              className="size-[18px] object-cover"
                              unoptimized
                            />
                          ) : (
                            initialsFrom(
                              p.tutor.displayName ?? p.tutor.headline,
                            )
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {p.tutor.displayName ?? p.tutor.headline ?? "Tutor"}
                        </span>
                      </div>
                    ) : null}
                    {p.outcome ? (
                      <p className="line-clamp-2 text-[13px] text-muted-foreground">
                        {p.outcome}
                      </p>
                    ) : null}

                    <span className="w-fit rounded-full bg-primary-muted px-3 py-1 text-xs font-semibold text-primary-muted-foreground">
                      {modelLabel(p)}
                    </span>

                    <div className="mt-auto flex items-baseline justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-lg font-semibold">
                          {precio.amount}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {precio.note}
                        </span>
                      </span>
                      {sessions ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {sessions}
                        </span>
                      ) : null}
                    </div>

                    <Link
                      href={`/products/${p.id}`}
                      /* `-my-3 py-3`: en la tira móvil este enlace es el ÚNICO
                         control de la tarjeta y medía 19,5 px de alto. Los 24
                         px de padding lo llevan a 43,5 de zona tocable y el
                         margen negativo se los devuelve al hueco de la
                         columna, así que la maqueta no se mueve. */
                      className="-my-3 inline-block py-3 text-[13px] font-semibold text-brand hover:underline"
                    >
                      Ver detalle →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      </Container>
    </div>
  );
}
