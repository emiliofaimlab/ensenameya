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
import { FinalCta } from "@/components/home/final-cta";
import {
  listActiveCategories,
  listActiveProducts,
  listFeaturedTutors,
} from "@/lib/catalog/queries";

export default async function HomePage() {
  const [categories, featuredTutors, { products }] = await Promise.all([
    listActiveCategories(),
    listFeaturedTutors(),
    listActiveProducts({ page: 1 }),
  ]);

  return (
    <>
      <HomeHero categories={categories} />

      <FeatureSplit
        title="Clases en vivo 1 a 1, no videos pregrabados"
        text="Cada sesión es por video y en tiempo real con tu tutor. Preguntas, practicas y avanzas a tu ritmo, siempre enfocados en el resultado que tú elegiste."
        points={[
          { icon: VideoIcon, text: "Video en vivo de alta calidad" },
          { icon: TargetIcon, text: "Enfoque en tu objetivo concreto" },
          { icon: CalendarSyncIcon, text: "Reprograma sin coste con 24h" },
        ]}
        cta={{ href: "/tutors", label: "Explorar tutores" }}
        image={{
          src: "/img/home-live.jpg",
          alt: "Alumna en una clase 1 a 1 por videollamada",
        }}
      />

      <FeaturedTutors tutors={featuredTutors} />
      <ThreeSteps />
      <FeaturedProducts products={products.slice(0, 4)} />

      <FeatureSplit
        reverse
        title="¿Sabes enseñar algo? Cobra por tus resultados"
        text="Crea tu perfil, publica lo que enseñas y define tu precio y horario. Nosotros ponemos los pagos seguros y la confianza; tú pones el conocimiento."
        points={[
          { icon: TagIcon, text: "Tú fijas tu precio y tu disponibilidad" },
          { icon: ShieldCheckIcon, text: "Pagos seguros y reembolsos" },
          { icon: BadgeCheckIcon, text: "Verificación que genera confianza" },
        ]}
        // El Figma reutiliza aquí el botón "Explorar tutores" del bloque de
        // arriba; es un copy-paste del diseño. En una llamada a tutores el
        // destino correcto es el alta.
        cta={{ href: "/signup", label: "Quiero enseñar" }}
        image={{
          src: "/img/home-teach.jpg",
          alt: "Tutor impartiendo una clase desde su portátil",
        }}
      />

      {/* TODO IV-03: faltan las cifras y los testimonios de P01 — contenido
          inventado en el diseño, pendiente de decisión del cliente. */}

      <HomeFaq />
      <FinalCta />
    </>
  );
}
