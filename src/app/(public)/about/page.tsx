import Image from "next/image";
import {
  BadgeCheckIcon,
  ClockIcon,
  GlobeIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TargetIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { FeatureSplit } from "@/components/home/feature-split";
import { TrustCards } from "@/components/home/trust";
import { HomeFaq } from "@/components/home/home-faq";
import { FinalCta } from "@/components/home/final-cta";

export const metadata = {
  title: "Sobre nosotros · Enséñame Ya",
  description:
    "Conectamos a quien quiere aprender con quien sabe enseñar: tutorías 1:1 en vivo, con tutores verificados y enfoque en el resultado.",
};

const VALUES = [
  {
    icon: TargetIcon,
    title: "Resultados validados",
    text: "Evaluamos el éxito por tus metas cumplidas y por las nuevas habilidades que logras dominar.",
  },
  {
    icon: BadgeCheckIcon,
    title: "Talento garantizado",
    text: "Validamos manualmente a cada tutor para asegurar su experiencia y energía propia antes de su primera sesión.",
  },
  {
    icon: SparklesIcon,
    title: "Transparencia total",
    text: "Cuentas claras y honestidad absoluta. Pagas exactamente por el resultado que decides aprender.",
  },
  {
    icon: GlobeIcon,
    title: "Conocimiento sin fronteras",
    text: "Acercamos el aprendizaje de primer nivel a cada rincón de la comunidad hispanohablante.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="relative isolate overflow-hidden bg-brand text-white">
        <Image
          src="/img/about-hero.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover opacity-25"
        />
        <Container className="py-20 sm:py-28">
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            Conectamos a quien quiere aprender con quien sabe enseñar
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-white/90 sm:text-lg">
            Enséñame Ya nació para garantizar que dominar un nuevo idioma,
            materia o habilidad sea una experiencia emocionante y efectiva.
            Consigue resultados reales de la mano de expertos que potencian tu
            talento.
          </p>
        </Container>
      </section>

      <TrustCards title="Reserva con tranquilidad garantizada" />

      <FeatureSplit
        title="Transformamos la forma de aprender para llevarte al siguiente nivel"
        text="Diseñamos un espacio dinámico, moderno e interactivo donde avanzas con paso firme de la mano de un tutor enfocado exclusivamente en tu éxito."
        points={[
          {
            icon: UserIcon,
            text: "Mentoría 1 a 1",
            desc: "Clases totalmente personalizadas y adaptadas a tu propio ritmo de aprendizaje.",
          },
          {
            icon: TargetIcon,
            text: "Avanza con agilidad",
            desc: "Ve directo hacia la meta elegida mediante explicaciones prácticas y dinámicas.",
          },
          {
            icon: ClockIcon,
            text: "Control de tu agenda",
            desc: "Tú decides cuándo y con quién conectarte con total libertad y flexibilidad.",
          },
        ]}
        cta={{ href: "/tutors", label: "Explorar tutorías", variant: "outline" }}
        image={{
          src: "/img/about-mission.jpg",
          alt: "Alumna tomando una clase en vivo",
        }}
      />

      <FeatureSplit
        reverse
        title="Enfocados en tus logros y en el valor de tus resultados"
        text="Tu tutor diseña una ruta con objetivos claros para que cada sesión sea un paso certero hacia el éxito que planificaron."
        points={[
          {
            icon: TargetIcon,
            text: "Resultados asegurados",
            desc: "Cada tutoría detalla con precisión la meta real que vas a conquistar.",
          },
          {
            icon: ShieldCheckIcon,
            text: "Filtro de confianza",
            desc: "Colaboramos únicamente con profesionales calificados y aprobados por nuestro equipo.",
          },
          {
            icon: WalletIcon,
            text: "Tu inversión protegida",
            desc: "Gestión de cobros y payouts con total claridad, transparencia y seguridad.",
          },
        ]}
        cta={{ href: "/how-it-works", label: "Conoce cómo funciona" }}
        image={{
          src: "/img/about-outcome.jpg",
          alt: "Tutor explicando durante una sesión 1 a 1",
        }}
      />

      <Container>
        <Section>
          <h2 className="text-center text-[28px] font-bold tracking-tight">
            En qué creemos
          </h2>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-2xl bg-muted p-6">
                <span className="grid size-10 place-items-center rounded-full bg-brand-muted text-brand">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-[13px] text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </Section>
      </Container>

      {/* TODO IV-03: aquí va "Resultados reales de nuestros alumnos" — 7
          testimonios inventados en el Figma (cuatro firmados "Marina G."),
          pendientes de contenido real. */}

      <HomeFaq />
      <FinalCta />
    </>
  );
}
