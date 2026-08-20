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
            quedan tapadas. */}
        <Section className="pb-[124px] sm:pb-[164px]">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold">
              Mentorías destacadas listas para reservar
            </h2>
            <Link
              href="/classes"
              className="text-sm font-medium text-brand hover:underline"
            >
              Ver todos →
            </Link>
          </div>

          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((p) => {
              const sessions = sessionsLabel(p);
              // RV-08 · la portada enseñaba el importe a secas, sin unidad
              // siquiera: en una clase por hora de 90 min anunciaba 30 y el
              // checkout pedía 45. Mismo criterio que la tarjeta de catálogo.
              const precio = priceDisplay(p);
              return (
                <li
                  key={p.id}
                  className="flex min-w-0 flex-col overflow-hidden rounded-[20px] bg-card shadow-card"
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
                      className="text-[13px] font-semibold text-brand hover:underline"
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
