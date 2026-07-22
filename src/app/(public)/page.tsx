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
        title="Clases en vivo 1 a 1: interactúa en tiempo real"
        text="Avanza con total confianza y cara a cara con tu tutor, dedicando cada minuto exclusivamente al objetivo que elegiste lograr."
        points={[
          { icon: VideoIcon, text: "Video en vivo con alta calidad" },
          { icon: TargetIcon, text: "Foco en tu meta concreta" },
          { icon: CalendarSyncIcon, text: "Agenda flexible y a tu medida" },
        ]}
        cta={{ href: "/tutors", label: "Explorar tutores YA" }}
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
        title="¿Eres un crack en lo que haces? Monetiza tu talento YA"
        text="Crea tu perfil de tutor, comparte tu formación, certificaciones y pasiones, y define tus tarifas con total libertad. Nosotros impulsamos tu crecimiento, aseguramos tus cobros y te conectamos con alumnos listos para aprender de ti."
        points={[
          { icon: TagIcon, text: "Tú decides tu valor y tus horarios" },
          { icon: ShieldCheckIcon, text: "Ingresos garantizados y respaldados" },
          { icon: BadgeCheckIcon, text: "Verificación de perfil y credenciales" },
        ]}
        cta={{ href: "/signup", label: "Quiero enseñar YA" }}
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
