import {
  BadgeCheckIcon,
  CalendarSyncIcon,
  ShieldCheckIcon,
  TagIcon,
  TargetIcon,
  VideoIcon,
} from "lucide-react";

import { HomeHero } from "@/components/home/home-hero";
import { FeatureSplit } from "@/components/home/feature-split";
import { FeaturedTutors } from "@/components/home/featured-tutors";
import { ThreeSteps } from "@/components/home/three-steps";
import { FeaturedProducts } from "@/components/home/featured-products";
import { HomeFaq } from "@/components/home/home-faq";
import { HomeStats } from "@/components/home/home-stats";
import { Testimonials } from "@/components/home/testimonials";
import { FinalCta } from "@/components/home/final-cta";
import { hrefSignup } from "@/components/auth/auth-links";
import { getVisitorState } from "@/components/auth/visitor-state";
import {
  getHomeStats,
  listActiveCategories,
  listActiveProducts,
  listFeaturedTutors,
  listTestimonials,
} from "@/lib/catalog/queries";

export default async function HomePage() {
  const [
    categories,
    featuredTutors,
    { products },
    stats,
    testimonials,
    visitante,
  ] = await Promise.all([
    listActiveCategories(),
    listFeaturedTutors(),
    listActiveProducts({ page: 1 }),
    getHomeStats(),
    listTestimonials(),
    getVisitorState(),
  ]);

  /*
   * N-01 · "Quiero enseñar YA": el destino depende de quién mire. Apuntando
   * fijo a `/signup`, el guarda `requireGuest()` del layout `(auth)` rebotaba a
   * cualquiera con sesión a `pickHome(roles)`: el tutor aprobado llegaba a
   * `/tutor` dando un rodeo, y el que aún NO tiene el rol —el que está
   * esperando aprobación— acababa en `/app`, el panel de ALUMNO. "Obviamente
   * causa confusión": el botón dice enseñar y te deja en el sitio de aprender.
   *
   * Al anónimo se le sigue mandando a la PANTALLA de alta y no al modal: aquí
   * el CTA es de conversión y `FeatureSplit` pinta un `<Link href>`, así que
   * colgarle un diálogo obligaría a tocar ese componente, que es de otro
   * carril. El `intent=tutor` deja el alta abierta ya por su lado.
   */
  const teachHref = visitante.teachHref ?? hrefSignup(null, "tutor");

  return (
    <>
      <HomeHero categories={categories} />

      {/* B1.9 · Los tres puntos de esta sección pasan a ser CAJAS.
          Petición del cliente («cajas en la 2.ª sección»). El componente ya
          sabía pintarlas —es la variante con `desc`— pero solo la usaba P02
          (`/about`); aquí eran filas de una línea. La diferencia es que una
          fila nombra la ventaja y una caja la explica, y esta es la sección
          donde se decide si la plataforma se entiende.

          ⚠️ Las imágenes NO estaban bloqueadas por diseño: `home-live.jpg`
          lleva en disco desde el 21-jul y ya se usaba. Lo que faltaba era esto.

          Los textos son borrador de desarrollo: describen lo que la plataforma
          hace de verdad (vídeo con pantalla compartida, la meta de la mentoría,
          huecos reales del tutor), pero el tono es de Verónica. */}
      <FeatureSplit
        title="Mentorías en vivo 1 a 1: interactúa en tiempo real"
        text="Avanza con total confianza y cara a cara con tu tutor, dedicando cada minuto exclusivamente al objetivo que elegiste lograr."
        points={[
          {
            icon: VideoIcon,
            text: "Video en vivo con alta calidad",
            // «Se ven / se escuchan» y no «os veis / os escucháis»: el sitio
            // habla de usted(es) implícito —mercado LATAM, C-13—; el voseo de
            // España era un resto del borrador (revisión de copy, 8-sep).
            desc: "Se ven y se escuchan sin cortes, y el tutor comparte su pantalla en la misma llamada.",
          },
          {
            icon: TargetIcon,
            text: "Foco en tu meta concreta",
            desc: "Cada mentoría dice qué vas a conseguir, así que la sesión trabaja eso y no un temario general.",
          },
          {
            icon: CalendarSyncIcon,
            text: "Agenda flexible y a tu medida",
            desc: "Eliges día y hora entre los huecos reales del tutor, en tu propia zona horaria.",
          },
        ]}
        cta={{ href: "/tutors", label: "Explorar tutores YA" }}
        image={{
          src: "/img/home-live.jpg",
          alt: "Alumna en una mentoría 1 a 1 por videollamada",
        }}
      />

      <FeaturedTutors tutors={featuredTutors} />
      <ThreeSteps />
      <FeaturedProducts products={products.slice(0, 4)} />
      <HomeStats stats={stats} overlap={products.length > 0} />

      {/* Correo de Verónica (3-sep-2026): «Disminuir tamaño de título para que
          cubra 2 líneas». A 390 con 24 px salían tres («¿Eres un crack / en lo
          que haces? / Monetiza tu talento YA», captura 05). El Figma «Mobile y
          Tablet» (P01 § Monetiza) lo escribe a 22 —dos líneas a 390—, pero a 375
          (335 px de contenido) 22 sigue dando tres: «haces? Monetiza tu talento
          YA» mide 336 px. A 21 caben las dos líneas en los dos anchos (medido
          con `text-balance`). El paso de línea va explícito (30 = la razón 1,45
          que el Figma da a este título, 32/22) porque `text-2xl` deja un
          `line-height` SIN unidad (calc(2/1.5)) y con 21 px salían 28. Solo por
          debajo de `sm`: el escritorio no se toca (R1). El otro bloque no lo
          necesita: a 24 ya sale en dos. */}
      <FeatureSplit
        reverse
        title="¿Eres un crack en lo que haces? Monetiza tu talento YA"
        titleClassName="max-sm:text-[21px]/[30px]"
        text="Crea tu perfil de tutor, comparte tu formación, certificaciones y pasiones, finalmente define tus tarifas con total libertad. Nosotros impulsamos tu crecimiento, aseguramos tus cobros y te conectamos con alumnos listos para aprender de ti."
        points={[
          { icon: TagIcon, text: "Tú decides tu valor y tus horarios" },
          { icon: ShieldCheckIcon, text: "Ingresos garantizados y respaldados" },
          { icon: BadgeCheckIcon, text: "Verificación de perfil y credenciales" },
        ]}
        cta={{ href: teachHref, label: "Quiero enseñar YA" }}
        image={{
          src: "/img/home-teach.jpg",
          alt: "Tutor impartiendo una mentoría desde su portátil",
        }}
      />

      <Testimonials items={testimonials} />
      <HomeFaq />
      <FinalCta />
    </>
  );
}
