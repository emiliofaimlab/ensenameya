import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

/**
 * Bloque texto + imagen de P01. Lo usan "Clases en vivo 1 a 1" (imagen a la
 * derecha) y "¿Sabes enseñar algo?" (imagen a la izquierda): misma estructura,
 * distinto lado.
 */
export function FeatureSplit({
  title,
  text,
  points,
  cta,
  image,
  badge,
  tone = "plain",
  reverse = false,
}: {
  title: string;
  text: string;
  /** Con `desc` se renderiza como bloque titulado (P02); sin él, como fila (P01). */
  points: { icon: LucideIcon; text: string; desc?: string }[];
  cta: { href: string; label: string; variant?: "solid" | "outline" };
  image: { src: string; alt: string };
  /** Tarjetita flotante montada sobre el borde de la imagen (P02). */
  badge?: {
    value: string;
    label: string;
    icon?: LucideIcon;
    position: "bottom-left" | "top-right";
  };
  /** `soft` = el bloque azul claro con esquinas redondeadas de P02. */
  tone?: "plain" | "soft";
  reverse?: boolean;
}) {
  const body = (
    <Container>
      <Section className="grid items-center gap-10 lg:grid-cols-2">
        <div className={reverse ? "lg:order-2" : undefined}>
          <h2 className="text-2xl font-semibold text-balance sm:text-[32px]">
            {title}
          </h2>
          <p className="mt-4 text-[15px] text-pretty text-muted-foreground">
            {text}
          </p>

          <ul className="mt-6 space-y-2">
            {points.map(({ icon: Icon, text: point, desc }, i) =>
              desc ? (
                <li key={point} className="flex items-start gap-3 py-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-brand-muted text-brand">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <p className="font-semibold">{point}</p>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                  </div>
                </li>
              ) : (
                <li
                  key={point}
                  // La primera fila va resaltada en el Figma; el resto, sobre el fondo.
                  className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-[17px] ${
                    i === 0 ? "bg-secondary" : ""
                  }`}
                >
                  <Icon className="size-5 shrink-0 text-primary" />
                  {point}
                </li>
              ),
            )}
          </ul>

          {/* CTA azul (no naranja): en P01 el naranja queda para el buscador. */}
          <Button
            asChild
            variant={cta.variant === "outline" ? "outline" : "default"}
            className={
              cta.variant === "outline"
                ? "mt-6 h-11 border-brand px-6 text-brand hover:bg-brand-muted hover:text-brand"
                : "mt-6 h-11 bg-brand px-6 hover:bg-brand-foreground"
            }
          >
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        </div>

        {/* El badge se sale de la imagen, así que el recorte vive en el hijo. */}
        <div className={`relative ${reverse ? "lg:order-1" : ""}`}>
          <div
            // r24 + sombra suave: en el Figma son dos fotos superpuestas, pero la
            // de delante tapa a la de detrás — el resultado visible es este.
            className="relative aspect-[592/420] overflow-hidden rounded-[24px] shadow-[0_2px_4px_rgb(0_0_0/0.31)]"
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes="(min-width: 1024px) 592px, 100vw"
              className="object-cover"
            />
          </div>

          {badge ? (
            <div
              className={`absolute flex items-center gap-3 rounded-[14px] bg-card px-5 py-4 shadow-[0_6px_20px_rgb(0_0_0/0.16)] ${
                badge.position === "bottom-left"
                  ? "bottom-4 -left-4 sm:-left-7"
                  : "-top-6 right-8"
              }`}
            >
              {badge.icon ? (
                <badge.icon className="size-5 shrink-0 fill-primary text-primary" />
              ) : null}
              <div>
                <p
                  className={`font-bold ${
                    badge.icon
                      ? "text-[15px] text-foreground"
                      : "text-[22px] text-brand"
                  }`}
                >
                  {badge.value}
                </p>
                <p className="text-[11px] text-[#666666]">{badge.label}</p>
              </div>
            </div>
          ) : null}
        </div>
      </Section>
    </Container>
  );

  // El bloque azul de P02 va a sangre completa, solo con las esquinas redondeadas.
  return tone === "soft" ? (
    <div className="rounded-[17px] bg-[#f5f9ff]">{body}</div>
  ) : (
    body
  );
}
