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
    icon: GlobeIcon,
    title: "Acceso para todos",
    text: "Aprender algo nuevo no debería depender de dónde vives ni de tu horario.",
  },
  {
    icon: TargetIcon,
    title: "Resultados, no horas",
    text: "Medimos el éxito por lo que logras, no por los minutos que pasas en clase.",
  },
  {
    icon: BadgeCheckIcon,
    title: "Confianza verificada",
    text: "Cada tutor pasa por revisión de identidad y experiencia antes de enseñar.",
  },
  {
    icon: SparklesIcon,
    title: "Transparencia total",
    text: "Precios claros y reglas de reembolso sin letra pequeña ni sorpresas.",
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
            Enséñame Ya nació para que aprender algo nuevo sea tan simple como
            reservar una clase. Sin cursos pregrabados ni promesas vagas:
            tutores reales, verificados, enfocados en el resultado que tú
            eliges.
          </p>
        </Container>
      </section>

      <TrustCards title="Reserva con la tranquilidad de siempre" />

      <FeatureSplit
        title="Nacimos para transformar la forma de aprender"
        text="Los cursos grabados muchas veces se abandonan y las academias tradicionales pueden ser rígidas y costosas. Por eso creamos una alternativa más cercana: acceso directo a buenos tutores, justo cuando los necesitas y enfocada en lo que quieres lograr."
        points={[
          {
            icon: UserIcon,
            text: "Aprendizaje 1 a 1",
            desc: "Clases personalizadas, no contenido masivo grabado.",
          },
          {
            icon: TargetIcon,
            text: "Enfocados en tu resultado",
            desc: "Avanzas hacia tu objetivo, no recorres un temario.",
          },
          {
            icon: ClockIcon,
            text: "Flexible, a tu ritmo",
            desc: "Tú eliges cuándo, con quién y a qué velocidad.",
          },
        ]}
        cta={{ href: "/tutors", label: "Explorar tutores", variant: "outline" }}
        image={{
          src: "/img/about-mission.jpg",
          alt: "Alumna tomando una clase en vivo",
        }}
      />

      <FeatureSplit
        reverse
        title="El tutor vende el resultado, no el proceso"
        text="Es el principio que guía todo lo que construimos. Cuando reservas, no compras horas de clase: compras avanzar hacia un objetivo concreto. Por eso cada tutor describe lo que vas a lograr, no solo lo que sabe."
        points={[
          {
            icon: TargetIcon,
            text: "Resultado claro",
            desc: "Cada producto promete lo que vas a lograr.",
          },
          {
            icon: ShieldCheckIcon,
            text: "Tutores verificados",
            desc: "Identidad y experiencia revisadas antes de enseñar.",
          },
          {
            icon: WalletIcon,
            text: "Pagos protegidos",
            desc: "Reembolsos con reglas claras, sin sorpresas.",
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
