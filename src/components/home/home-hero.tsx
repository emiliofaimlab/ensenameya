import { Container } from "@/components/layout/container";
import { SearchAutocomplete } from "@/components/layout/search-autocomplete";
import { TRUST_POINTS } from "@/components/home/trust";
import { RotatingWord, RotatingWordGhost } from "@/components/home/rotating-word";
import { CategoryIconChips } from "@/components/catalog/category-icon-chips";
import type { CategoryTag } from "@/lib/catalog/queries";

// Titular del hero. El texto fijo y las clases salen a constantes porque los
// pintan DOS elementos —el <h1> y su fantasma— y solo sirven si rompen las
// líneas exactamente igual. Editar uno y no el otro rompe la reserva de alto en
// silencio: se ve como un hueco de más (o un salto que vuelve).
const TITULAR_TEXTO =
  "Aprende a tu ritmo y conviértete en un PRO impulsando tu";
const TITULAR_CLASES =
  "col-start-1 row-start-1 text-3xl font-semibold text-balance sm:text-5xl";

export function HomeHero({ categories }: { categories: CategoryTag[] }) {
  return (
    <section className="relative">
      <div className="relative isolate overflow-hidden">
        {/* Fondo en video (reunión 7-ago). `poster` es el JPG que había antes:
            pinta en el primer frame y se queda como fondo si el navegador se
            niega a autoreproducir (iOS con ahorro de batería, "reducir datos").
            `muted` + `playsInline` son obligatorios para que autoPlay funcione. */}
        <video
          className="absolute inset-0 -z-10 size-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/img/hero-home.jpg"
          aria-hidden
        >
          <source src="/video/hero-home.mp4" type="video/mp4" />
        </video>
        {/* Velo negro al 60%, como en el Figma: el texto va en blanco encima. */}
        <div className="absolute inset-0 -z-10 bg-black/60" />

        <Container className="flex flex-col items-center gap-6 py-20 text-center text-white sm:py-28">
          {/* MN-15 · El titular no puede cambiar de alto al rotar la palabra.

              960px, y no los 910 del Figma: a 910 «emprendimiento» —la más
              larga de las ocho— se caía a una tercera línea y las otras siete
              no. Entra en dos desde 938px (métricas de Poppins SemiBold, y
              comprobado en navegador: a 910 tres, a 940 dos), así que 960 deja
              22px de margen. Si vuelves al Figma y lees 910, no lo devuelvas.

              Y por debajo de ~1066px de viewport "dos líneas" no existe: a
              375px harían falta ~17px de letra. Ahí el objetivo no es cuántas
              líneas son, sino que no se mueva nada — de eso vive el fantasma
              de abajo. Cuesta hueco muerto bajo el titular con las palabras
              cortas (una línea) y la frase duplicada en el DOM. Reservar el
              ANCHO de la palabra más larga, que es el otro camino evidente,
              descoloca hasta 100px la última línea de un titular centrado.

              El `lg:-mx-8` cierra el agujero de iPad apaisado. A partir de
              1024px el `Container` pasa a `lg:px-16` y deja 896px de contenido
              —por debajo de los 938 que pide «emprendimiento»—, así que entre
              1024 y 1065px volvían las tres líneas. Y el efecto era NO
              monótono: a 1023px mandaba `sm:px-6` y salían dos, a 1024
              ensanchar la ventana lo empeoraba. Los 32px negativos por lado
              devuelven 64 de los 128 que quita el gutter (896 → 960) y el
              `max-w-[960px]` sigue capando por arriba, así que en pantallas
              anchas no cambia nada. Va solo en el titular a propósito: el
              buscador, los chips y la banda de garantías se quedan alineados a
              64px, como pide el Figma.

              ⚠️ Hacen falta las DOS clases. `-mx-8` a solas no ensancha nada:
              con `w-full` el ancho ya está clavado al 100% del padre, así que
              el margen negativo solo lo DESPLAZA. El `calc(100%+4rem)` es el
              que devuelve los 64px; el margen negativo es el que los reparte a
              los dos lados para que siga centrado. Quitar una y dejar la otra
              descoloca el titular sin arreglar el corte. */}
          <div className="grid w-full max-w-[960px] lg:-mx-8 lg:w-[calc(100%+4rem)]">
            <h1 className={TITULAR_CLASES}>
              {TITULAR_TEXTO} <RotatingWord />
            </h1>
            {/* El fantasma: ocupa sitio, no se ve (`invisible`) y no se lee
                (`aria-hidden`). Con "reducir movimiento" la palabra no rota, así
                que no hay nada que reservar y desaparece. */}
            <span
              aria-hidden
              className={`${TITULAR_CLASES} invisible motion-reduce:hidden`}
            >
              {TITULAR_TEXTO} <RotatingWordGhost />
            </span>
          </div>
          <p className="max-w-2xl text-pretty text-white/90">
            Tú eliges el objetivo que quieres alcanzar. Nosotros te conectamos
            con el talento ideal para llevar tus habilidades al siguiente nivel
            desde el primer día.
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
