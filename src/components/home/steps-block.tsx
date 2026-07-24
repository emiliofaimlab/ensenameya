import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

/**
 * Bloques de P03: imagen a un lado y los 3 pasos en lista vertical al otro, con
 * el número grande y una línea que encadena un paso con el siguiente. El bloque
 * del alumno va en azul y el del tutor en naranja — no es decorativo, es cómo
 * el diseño distingue los dos recorridos.
 */
export function StepsBlock({
  eyebrow,
  title,
  steps,
  image,
  cta,
  accent = "brand",
  background,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  steps: { icon: LucideIcon; title: string; text: string }[];
  image: { src: string; alt: string };
  cta?: { href: string; label: string };
  /** Color de números, líneas e iconos: alumno azul, tutor naranja. */
  accent?: "brand" | "primary";
  /** Fondo de la sección (#e8f2ff en el bloque del alumno, #fafafa en el otro). */
  background?: string;
  /** `true` = texto a la izquierda e imagen a la derecha (bloque del tutor). */
  reverse?: boolean;
}) {
  // Clases completas y literales: Tailwind escanea texto, así que un
  // `${var}/85` interpolado nunca llega a generarse (los números salían negros).
  const isBrand = accent === "brand";
  const num = isBrand ? "text-brand/85" : "text-primary/85";
  const line = isBrand ? "bg-brand/20" : "bg-primary/25";
  const icon = isBrand ? "text-brand" : "text-primary";
  // El eyebrow va del color CONTRARIO al del recorrido: alumno naranja sobre
  // pasos azules, tutor azul sobre pasos naranjas (386:704 / 386:746).
  const eyebrowColor = isBrand ? "text-primary" : "text-brand";

  return (
    <div className={background}>
      <Container>
        <Section className="grid items-center gap-12 lg:grid-cols-2 lg:gap-[72px]">
          <div
            className={`relative aspect-[494/500] overflow-hidden rounded-[24px] shadow-[0_2px_4px_rgb(0_0_0/0.2)] ${
              reverse ? "lg:order-2" : ""
            }`}
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes="(min-width: 1024px) 500px, 100vw"
              className="object-cover"
            />
          </div>

          <div className={reverse ? "lg:order-1" : undefined}>
            <p
              className={`text-[13px] font-medium tracking-[0.18em] ${eyebrowColor}`}
            >
              {eyebrow}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-balance sm:text-[27px]">
              {title}
            </h2>

            <ol className="mt-8">
              {steps.map(({ icon: Icon, title: t, text: body }, i) => (
                <li key={t} className="flex gap-5">
                  <div className="flex shrink-0 flex-col items-center">
                    <span
                      className={`text-[34px] leading-none font-bold ${num}`}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {/* La línea encadena este paso con el siguiente. */}
                    {i < steps.length - 1 ? (
                      <span className={`mt-3 w-0.5 flex-1 ${line}`} />
                    ) : null}
                  </div>
                  <div className={i < steps.length - 1 ? "pb-8" : undefined}>
                    <div className="flex items-center gap-2">
                      <Icon className={`size-[19px] shrink-0 ${icon}`} />
                      <h3 className="text-[18.5px] font-semibold">{t}</h3>
                    </div>
                    <p className="mt-1.5 text-sm text-[#5c5c5c]">{body}</p>
                  </div>
                </li>
              ))}
            </ol>

            {cta ? (
              <Button
                asChild
                className={`mt-2 h-11 px-6 ${
                  accent === "brand"
                    ? "bg-brand hover:bg-brand-foreground"
                    : "bg-primary hover:bg-primary/80"
                }`}
              >
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
            ) : null}
          </div>
        </Section>
      </Container>
    </div>
  );
}
