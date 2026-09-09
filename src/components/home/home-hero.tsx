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
// Correo de Verónica (3-sep-2026): «Hero: tratar de que no pase a 4 líneas
// (reducir tamaño)». A 390 con `text-3xl` (30/36) salían 4 líneas (147 px,
// medido). El Figma «Mobile y Tablet» (P01 § Hero) lo pinta a 26/39 y en 3
// líneas… con «talento». Pero el fantasma reserva el alto de «emprendimiento»
// (MN-15), así que "3 líneas" tiene que cumplirse con la palabra MÁS LARGA y en
// el móvil más estrecho que soportamos (375 → 335 px de contenido):
//
//   línea 3 = «impulsando tu emprendimiento» + cursor (4 px), Poppins 600
//     20 px → 332 px  (cabe en 335 y en 350)
//     21 px → 348,6   (cabe en 350, NO en 335: 4 líneas en un iPhone SE/mini)
//     26 px → 4 líneas incluso a 390 (filas medidas 249/253/252/232)
//
// Y no hay reparto mejor: la línea 2 «conviértete en un PRO impulsando» ya se
// pasa a 21 px. De ahí 20, el mayor que cumple. El paso de línea conserva la
// razón 1,5 del archivo (39/26) → 30 px. Desde `sm` no cambia nada (R1).
//
// ⚠️ Consecuencia asumida (revisión 8-sep): a 390 este h1 queda por DEBAJO de
// los h2 de la misma página (24, 26 y 29 px). No es un descuido: con las siete
// palabras cortas cabría el 26 del Figma (medido: «profesión», la más ancha de
// ellas, entra en tres líneas hasta 26), pero el fantasma reserva el alto de
// «emprendimiento», que a 22 ya rompe en cuatro incluso a 390. La salida no
// es CSS: es quitar o acortar esa palabra en `rotating-word.tsx` (contenido
// del cliente, §01.1 — no se toca sin su sí) y subir esto a
// `text-[26px]/[39px]`. Mientras tanto la jerarquía se recupera por el otro
// lado: el párrafo baja al 14/21 del Figma (ver el <p>).
const TITULAR_CLASES =
  "col-start-1 row-start-1 text-[20px]/[30px] font-semibold text-balance sm:text-5xl";

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
          {/* Móvil: 14/21 como el Figma «Mobile y Tablet» (P01 § Hero, escala
              2: filas de párrafo cada 42 px → paso 21; tinta de ≈290 px para
              «Tú eliges el objetivo que quieres alcanzar.» = Poppins 400 a 14).
              Con el h1 a 20 (ver TITULAR_CLASES) el cuerpo a 16 le comía la
              jerarquía: 20/16 = 1,25 frente al 1,86 del archivo. Desde `sm`
              sigue el 16 de hoy (R1). */}
          <p className="max-w-2xl text-pretty text-white/90 max-sm:text-sm/[21px]">
            Tú eliges el objetivo que quieres alcanzar. Nosotros te conectamos
            con el talento ideal para llevar tus habilidades al siguiente nivel
            desde el primer día.
          </p>

          {/* Mismo buscador con sugerencias que el header (R24-05), con el
              look del hero: caja blanca y "Buscar" dentro. Sigue siendo un form
              GET a /search, así que funciona igual sin JS.

              Móvil (correo de Verónica 3-sep · Figma P01 § Hero, escala 2):
              la tarjeta blanca mide 350 × 121 con 16 px de padding, y el
              «Buscar» va DEBAJO del input a 318 de ancho con 12 px de hueco
              (674−650 = 24/2). La columna la pone el propio buscador cuando
              lleva botón; aquí solo el padding y el hueco. En el Figma el
              placeholder ocupa dos líneas porque es una caja de texto; un
              <input> no parte, así que se recorta —con el botón fuera de la
              fila ya se lee «¿Qué meta vas a conquistar hoy? (ej. hab…», que
              es lo que Verónica echaba en falta.

              Foco (WCAG 2.4.7, revisión 8-sep): el input lleva `border-0` y
              `focus-visible:ring-0` porque la caja visible es la TARJETA, no
              él; pero así al tabular hasta el campo no se veía nada. El anillo
              va en la tarjeta con `has-[input:focus-visible]` —solo cuando el
              foco está en el campo, no en «Buscar», que ya trae el suyo— y
              sin offset: un offset semitransparente sobre la foto del hero
              ensucia el azul. En reposo no cambia ni un píxel (R1). */}
          <SearchAutocomplete
            className="w-full max-w-[700px] text-left"
            formClassName="gap-2 rounded-lg bg-background p-2 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring max-sm:gap-3 max-sm:p-4"
            inputClassName="h-10 min-w-0 flex-1 border-0 bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0 max-sm:pl-7"
            // La lupa se mide desde el input, que aquí va 8 px dentro de la
            // tarjeta (`p-2`): `left-1` (4) la deja a los 12 del borde de
            // siempre en escritorio. En móvil, a ras del padding (`left-0` →
            // x = 36), donde el Figma pinta su 🔍 (73/2 = 36,5), con 12 px
            // hasta el texto (`pl-7`), el mismo aire que en escritorio.
            iconClassName="left-0 sm:left-1"
            placeholder="¿Qué meta vas a conquistar hoy? (ej. hablar inglés fluido, dominar cálculo…)"
            submitLabel="Buscar"
          />

          {/* Burbujas de categoría: círculo naranja que despliega el nombre al
              hover (mismo componente que el resto del sitio, R24-03).

              Correo de Verónica (3-sep-2026): «Eliminar 2 líneas en categorías
              - en su lugar hacerlo slider si es necesario». Con 10 categorías
              a 390 salían dos filas de círculos (medido: 44 + 8 + 44). Con
              `layout="strip"` van en UNA fila con scroll horizontal que sangra
              hasta el borde y empieza pegada al contenido (x = 20, como la
              píldora «Idiomas» del Figma P01 § Hero: círculos de 34 con 8 px
              entre ellos). El centrado se conserva desde `lg`: el componente
              pone `max-lg:justify-start` y `lg:flex-wrap`, así que en
              escritorio no se mueve nada (R1). */}
          <CategoryIconChips
            /* `justify-center-safe` y no `justify-center`: en la tira de móvil
               las burbujas desbordan, y centrar un contenido que desborda deja
               las primeras FUERA de alcance por la izquierda. `safe` centra
               cuando caben (768 y escritorio, como hasta ahora) y arranca
               desde el borde cuando no (390). */
            className="justify-center-safe"
            categories={categories}
            hrefFor={(slug) => `/categories/${slug}`}
            limit={0}
            layout="strip"
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
