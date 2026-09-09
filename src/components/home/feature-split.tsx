import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { cn } from "@/lib/utils";

/**
 * Bloque texto + imagen de P01. Lo usan "Clases en vivo 1 a 1" (imagen a la
 * derecha) y "¿Sabes enseñar algo?" (imagen a la izquierda): misma estructura,
 * distinto lado.
 */
export function FeatureSplit({
  title,
  titleClassName,
  text,
  points,
  cta,
  image,
  badge,
  tone = "plain",
  reverse = false,
}: {
  title: string;
  /**
   * Clases extra del <h2>. Existe porque el Figma «Mobile y Tablet» no da el
   * mismo cuerpo a los dos títulos de P01: «Mentorías en vivo 1 a 1…» va a 24
   * (lo que `text-2xl` ya pinta) y «¿Eres un crack…?» a 22, para que quepa en
   * dos líneas. El consumidor decide; el componente no adivina por longitud.
   */
  titleClassName?: string;
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
          <h2
            className={cn(
              "text-2xl font-semibold text-balance sm:text-[32px]",
              titleClassName,
            )}
          >
            {title}
          </h2>
          <p className="mt-4 text-[15px] text-pretty text-muted-foreground">
            {text}
          </p>

          <ul className="mt-6 space-y-2">
            {points.map(({ icon: Icon, text: point, desc }) =>
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
                  // El realce gris es un HOVER, no un estado fijo de la primera
                  // fila (24-jul): en el Figma marca la fila sobre la que está
                  // el ratón, igual que las tarjetas de garantía (R24-02).
                  //
                  // Móvil: 14 px, como el Figma «Mobile y Tablet» (P01 §
                  // Monetiza: cajas de 45 con tinta de 14). A 17 dos de las
                  // tres filas se partían en dos líneas a 390 y las tres a
                  // 375. Es el único cuerpo que las deja en UNA línea en el
                  // móvil más estrecho: «Ingresos garantizados y respaldados»
                  // mide 278 px a 15 y 259 a 14, con 271 disponibles a 375
                  // (335 − 32 de padding − 20 de icono − 12 de hueco). El paso
                  // de 25 deja la fila en 10 + 25 + 10 = 45, la caja del
                  // archivo. Desde `sm` sigue 17 (R1).
                  className="flex items-center gap-3 rounded-lg px-4 py-2.5 text-[17px] transition-colors hover:bg-secondary max-sm:text-sm/[25px]"
                >
                  <Icon className="size-5 shrink-0 text-primary" />
                  {point}
                </li>
              ),
            )}
          </ul>

          {/* CTA azul (no naranja): en P01 el naranja queda para el buscador.

              Correo de Verónica (3-sep-2026): «Alargar y centrar botón» (los
              dos: «Explorar tutores YA» y «Quiero enseñar YA»). Por debajo de
              `sm` va a ancho completo, como en el Figma «Mobile y Tablet»
              (P01 § Por qué en vivo / § Monetiza, medido a escala 2): 350 × 45,
              radio 8 —el `rounded-lg` que el botón ya trae— y etiqueta de 14 px
              semibold (tinta de 132 px para «Explorar tutores YA»; Poppins 600
              a 14 avanza 134,7). `justify-center` ya viene del botón. Desde
              `sm` sigue el botón de hoy (R1). La variante `outline` (P02) recibe
              lo mismo para que un bloque no rompa la fila. */}
          <Button
            asChild
            variant={cta.variant === "outline" ? "outline" : "default"}
            className={cn(
              "mt-6 h-11 px-6 max-sm:h-[46px] max-sm:w-full max-sm:font-semibold",
              cta.variant === "outline"
                ? "border-brand text-brand hover:bg-brand-muted hover:text-brand"
                : "bg-brand hover:bg-brand-foreground",
            )}
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
