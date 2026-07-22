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
  reverse = false,
}: {
  title: string;
  text: string;
  /** Con `desc` se renderiza como bloque titulado (P02); sin él, como fila (P01). */
  points: { icon: LucideIcon; text: string; desc?: string }[];
  cta: { href: string; label: string; variant?: "solid" | "outline" };
  image: { src: string; alt: string };
  reverse?: boolean;
}) {
  return (
    <Container>
      <Section className="grid items-center gap-10 lg:grid-cols-2">
        <div className={reverse ? "lg:order-2" : undefined}>
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-[32px]">
            {title}
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground">{text}</p>

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
                  className={`flex items-center gap-3 rounded-lg px-4 py-2.5 ${
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

        <div
          className={`relative aspect-[592/420] overflow-hidden rounded-3xl ${
            reverse ? "lg:order-1" : ""
          }`}
        >
          <Image
            src={image.src}
            alt={image.alt}
            fill
            sizes="(min-width: 1024px) 592px, 100vw"
            className="object-cover"
          />
        </div>
      </Section>
    </Container>
  );
}
