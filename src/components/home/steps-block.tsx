import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { cn } from "@/lib/utils";

/**
 * Bloques de P03: imagen a un lado y los 3 pasos en lista vertical al otro, con
 * el número grande y una línea que encadena un paso con el siguiente. El bloque
 * del alumno va en azul y el del tutor en naranja — no es decorativo, es cómo
 * el diseño distingue los dos recorridos.
 *
 * ── MÓVIL (correo de Verónica, 3-sep-2026 · Figma «P03 · para-quien-aprende» y
 * «P03 · para-quien-ensena», PNG a escala 2 ÷ 2) ───────────────────────────
 * Por debajo de `lg:` el bloque es UNA columna y el orden es eyebrow → título
 * → foto APAISADA (350 × 220, radio 16) → pasos. La foto va ENTRE el título y
 * los pasos, no encima de todo como quedaba al apilar la rejilla de
 * escritorio. Para no duplicar la foto ni tocar el DOM de escritorio (R1), el
 * div de texto pasa a `display: contents` bajo `lg` y cada hijo se coloca con
 * `order`: eyebrow y título (0) · foto (1) · pasos (2). Lo único que cambia de
 * sitio respecto al DOM es la foto, que no recibe foco, así que el orden de
 * tabulación es el mismo.
 *
 * Tipografías medidas sobre la tinta del PNG con las métricas de Poppins
 * (asc 1,05 · desc 0,35 · caja alta 0,70 · dígitos 0,745): título 22/30 bold,
 * eyebrow 12 sin tracking, números 22, título de paso 16/24, cuerpo 13,5/20.
 * Huecos: 8 eyebrow→título, 12 título→foto, 10 foto→primer paso, 4
 * título→cuerpo, 24 entre pasos, y 48 de aire arriba y abajo del bloque.
 * Desde `lg:` se restituye lo de hoy valor a valor (27/36, 13 con tracking,
 * 34, 18,5/27,75, 14/20, 32 entre pasos).
 *
 * El Figma móvil no dibuja ni los iconos de cada paso ni la línea que los
 * encadena: bajo `lg` van ocultos (son decorativos). Lo que SÍ se conserva del
 * escritorio son los colores: el Figma móvil pinta los dos eyebrows en azul y
 * todos los números en naranja, pero azul/naranja es cómo el diseño distingue
 * alumno y tutor (386:704 / 386:746) y un color que cambia con el ancho de
 * pantalla no es un sistema.
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
  image: {
    src: string;
    alt: string;
    /**
     * Clase literal de `object-position` para el encuadre APAISADO de móvil
     * (p. ej. `max-lg:object-[50%_15%]`). Literal y no un número porque
     * Tailwind escanea texto: un valor interpolado no genera la clase.
     */
    focus?: string;
  };
  /** Solo escritorio: bajo `lg` la página pone en su lugar el bloque CTA de P03. */
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
  // Sin el `/85` que tenían: a 22 px bold el azul al 85 % daba 2,83:1 y el
  // naranja 2,44:1, por debajo del 3:1 que AA pide al texto grande. A pleno
  // son 3,68 y 2,76 — el azul cumple y el naranja sigue sin cumplir, pero eso
  // ya es el par de marca (ver la deuda anotada en `docs/25`). El número
  // además va `aria-hidden`: la lista ya numera y el lector decía «cero uno»
  // antes de «1 de 3».
  const num = isBrand ? "text-brand" : "text-primary";
  const line = isBrand ? "bg-brand/20" : "bg-primary/25";
  const icon = isBrand ? "text-brand" : "text-primary";
  // El eyebrow va del color CONTRARIO al del recorrido: alumno naranja sobre
  // pasos azules, tutor azul sobre pasos naranjas (386:704 / 386:746).
  //
  // Con los tokens OSCUROS de cada par, no con los de marca: a 12-13 px el
  // naranja #fe6a00 sobre el azul claro del bloque del alumno da 2,55:1 y el
  // azul #0080ff sobre el gris del bloque del tutor 3,64:1, y AA pide 4,5.
  // `primary-muted-foreground` (#803800) da 7,48:1 y `brand-foreground`
  // (#036fda) 4,69:1, conservando la pareja naranja-alumno / azul-tutor.
  const eyebrowColor = isBrand
    ? "text-primary-muted-foreground"
    : "text-brand-foreground";

  return (
    <div className={background}>
      <Container>
        {/* `gap-0` bajo lg: con el div de texto en `contents` el hueco de la
            rejilla se colaría entre eyebrow, título, foto y pasos; los huecos
            del Figma van como márgenes en cada pieza. `max-sm:py-12`: a 390 el
            bloque lleva 48 de aire arriba y abajo (la caja del eyebrow empieza
            a 47,7 del borde del frame), no los 32 del sistema. */}
        <Section className="grid items-center gap-0 max-sm:py-12 lg:grid-cols-2 lg:gap-[72px]">
          <div
            className={cn(
              "relative aspect-[35/22] overflow-hidden rounded-[16px] shadow-[0_2px_4px_rgb(0_0_0/0.2)]",
              "max-lg:order-1 max-lg:mt-3 lg:aspect-[494/500] lg:rounded-[24px]",
              reverse && "lg:order-2",
            )}
          >
            {/* Verónica (3-sep-2026): «estos espacios en las imágenes». No era
                el marco: los JPG traían una línea negra de 2-6 px y las esquinas
                redondeadas cocinadas en el propio fichero, y con `object-cover`
                ese filo quedaba dentro del marco. Se recortaron sin recomprimir
                (jpegtran, origen en bloque de 16): 502×508 → 474×480 y
                508×488 → 480×460. En apaisado el recorte centrado dejaba la
                cara de la pantalla en el filo y cortaba los cascos de la
                tutora: cada página manda su `focus`. Desde lg, centrado. */}
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes="(min-width: 1024px) 500px, 100vw"
              className={cn("object-cover lg:object-center", image.focus)}
            />
          </div>

          <div className={cn("max-lg:contents", reverse && "lg:order-1")}>
            <p
              className={cn(
                "text-[12px] font-medium lg:text-[13px] lg:tracking-[0.18em]",
                eyebrowColor,
              )}
            >
              {eyebrow}
            </p>
            <h2 className="mt-2 text-[22px]/[30px] font-bold text-balance lg:text-[27px]/9">
              {title}
            </h2>

            <ol className="mt-2.5 max-lg:order-2 lg:mt-8">
              {steps.map(({ icon: Icon, title: t, text: body }, i) => (
                <li key={t} className="flex gap-3 lg:gap-5">
                  {/* Bajo lg los números van pegados a la izquierda (sin línea
                      que centrar) y 6 px más abajo: el Figma deja la caja alta
                      del número 1,5 px por debajo de la del título. */}
                  <div className="flex shrink-0 flex-col items-start lg:items-center">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 text-[22px] leading-none font-bold lg:mt-0 lg:text-[34px]",
                        num,
                      )}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {/* La línea encadena este paso con el siguiente (solo escritorio). */}
                    {i < steps.length - 1 ? (
                      <span className={cn("mt-3 w-0.5 flex-1 max-lg:hidden", line)} />
                    ) : null}
                  </div>
                  <div className={i < steps.length - 1 ? "pb-6 lg:pb-8" : undefined}>
                    <div className="flex items-center gap-2">
                      <Icon className={cn("size-[19px] shrink-0 max-lg:hidden", icon)} />
                      <h3 className="text-base font-semibold lg:text-[18.5px]">{t}</h3>
                    </div>
                    <p className="mt-1 text-[13.5px]/5 text-[#5c5c5c] lg:mt-1.5 lg:text-sm">
                      {body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {cta ? (
              <Button
                asChild
                className={cn(
                  "mt-2 hidden h-11 px-6 lg:inline-flex",
                  accent === "brand"
                    ? "bg-brand hover:bg-brand-foreground"
                    : "bg-primary hover:bg-primary/80",
                )}
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
