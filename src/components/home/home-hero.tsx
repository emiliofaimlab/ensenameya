import Image from "next/image";

import { Container } from "@/components/layout/container";
import { SearchAutocomplete } from "@/components/layout/search-autocomplete";
import { TRUST_POINTS } from "@/components/home/trust";
import { CategoryIconChips } from "@/components/catalog/category-icon-chips";
import type { CategoryTag } from "@/lib/catalog/queries";

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
          {/* 910px es el ancho del titular en el Figma: entra en dos líneas. */}
          <h1 className="max-w-[910px] text-3xl font-semibold text-balance sm:text-5xl">
            Aprende a tu ritmo y conviértete en un PRO impulsando tu{" "}
            <em className="text-primary">talento</em>
          </h1>
          <p className="max-w-2xl text-pretty text-white/90">
            Tú eliges el objetivo que quieres alcanzar. Nosotros te conectamos
            con el talento ideal para asegurar resultados desde el primer día.
          </p>

          {/* Mismo buscador con sugerencias que el header (R24-05), con el
              look del hero: caja blanca y "Buscar" dentro. Sigue siendo un form
              GET a /search, así que funciona igual sin JS. */}
          <SearchAutocomplete
            className="w-full max-w-[700px] text-left"
            formClassName="gap-2 rounded-lg bg-background p-2"
            inputClassName="h-10 min-w-0 flex-1 border-0 bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0"
            placeholder="¿Qué meta vas a conquistar hoy? (ej. hablar inglés fluido, dominar cálculo…)"
            submitLabel="Buscar"
          />

          {/* Burbujas de categoría: círculo naranja que despliega el nombre al
              hover (mismo componente que el resto del sitio, R24-03). */}
          <CategoryIconChips
            className="justify-center"
            categories={categories}
            hrefFor={(slug) => `/categories/${slug}`}
            limit={0}
          />
        </Container>
      </div>

      {/* Banda de garantías: en el Figma cabalga el borde inferior del hero. */}
      <Container className="relative z-10 -mt-10 sm:-mt-12">
        {/* Degradado del Figma (fondo de la banda, muestreado del asset): #0072ff → #49a9ff. */}
        <ul className="grid gap-6 rounded-[22px] bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% px-6 py-10 text-white sm:grid-cols-2 sm:px-9 lg:grid-cols-4 lg:divide-x lg:divide-white/25">
          {TRUST_POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-center gap-3 lg:px-5">
              {/* Icono naranja, no azul: en el Figma el trazo es #fe6a00. */}
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/95 text-primary">
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
