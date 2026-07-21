import Image from "next/image";
import Link from "next/link";
import {
  BriefcaseIcon,
  CodeIcon,
  FlaskConicalIcon,
  GraduationCapIcon,
  LanguagesIcon,
  MusicIcon,
  PaletteIcon,
  SearchIcon,
  SigmaIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { TRUST_POINTS } from "@/components/home/trust";
import type { CategoryTag } from "@/lib/catalog/queries";

/** Icono por categoría del seed; `SparklesIcon` cubre las que se añadan luego. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  idiomas: LanguagesIcon,
  matematicas: SigmaIcon,
  programacion: CodeIcon,
  ciencias: FlaskConicalIcon,
  musica: MusicIcon,
  "arte-y-diseno": PaletteIcon,
  negocios: BriefcaseIcon,
  "preparacion-examenes": GraduationCapIcon,
};

export function HomeHero({ categories }: { categories: CategoryTag[] }) {
  return (
    <section className="relative">
      <div className="relative isolate overflow-hidden">
        <Image
          src="/img/hero-home.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover"
        />
        {/* Velo negro al 60%, como en el Figma: el texto va en blanco encima. */}
        <div className="absolute inset-0 -z-10 bg-black/60" />

        <Container className="flex flex-col items-center gap-6 py-20 text-center text-white sm:py-28">
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            Aprende lo que quieres lograr, con{" "}
            <em className="text-primary not-italic">el tutor correcto</em>
          </h1>
          <p className="max-w-2xl text-pretty text-white/90">
            Tú eliges el resultado. Nosotros te conectamos con el tutor
            verificado para lograrlo.
          </p>

          {/* Form GET nativo: mismo destino que el buscador del header. */}
          <form
            action="/search"
            className="flex w-full max-w-[700px] items-center gap-2 rounded-lg bg-background p-2"
          >
            <SearchIcon className="ml-2 size-4 shrink-0 text-muted-foreground" />
            <input
              type="search"
              name="q"
              placeholder="¿Qué quieres lograr? (ej. aprobar cálculo, hablar inglés…)"
              aria-label="¿Qué quieres lograr?"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
            />
            <Button type="submit" className="h-10 shrink-0 px-6">
              Buscar
            </Button>
          </form>

          <ul className="flex flex-wrap justify-center gap-2">
            {categories.map((c) => {
              const Icon = CATEGORY_ICONS[c.slug] ?? SparklesIcon;
              return (
                <li key={c.slug}>
                  <Link
                    href={`/categories/${c.slug}`}
                    className="flex items-center gap-2 rounded-full bg-background/95 py-1.5 pr-4 pl-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-background"
                  >
                    <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Icon className="size-4.5" />
                    </span>
                    {c.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Container>
      </div>

      {/* Banda de garantías: en el Figma cabalga el borde inferior del hero. */}
      <Container className="relative z-10 -mt-10 sm:-mt-12">
        <ul className="grid gap-6 rounded-[22px] bg-brand px-6 py-6 text-white sm:grid-cols-2 sm:px-10 lg:grid-cols-4 lg:divide-x lg:divide-white/25">
          {TRUST_POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-center gap-3 lg:px-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/95 text-brand">
                <Icon className="size-5" />
              </span>
              <div>
                <p className="text-[15px] font-semibold">{title}</p>
                <p className="text-xs text-white/85">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
