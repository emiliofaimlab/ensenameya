import Image from "next/image";
import Link from "next/link";
import {
  BadgeCheckIcon,
  CalendarCheckIcon,
  CreditCardIcon,
  MonitorPlayIcon,
  PlayIcon,
  QuoteIcon,
  SearchIcon,
  TagsIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { StepsBlock } from "@/components/home/steps-block";
import {
  TRUST_POINTS_COMO_FUNCIONA,
  TrustCards,
} from "@/components/home/trust";
import { FAQ_COMO_FUNCIONA, HomeFaq } from "@/components/home/home-faq";
import { FinalCta } from "@/components/home/final-cta";

export const metadata = {
  title: "¿Cómo funciona? · Enséñame Ya",
  description:
    "Encuentras al tutor ideal, reservas con pago protegido y aseguras el éxito en vivo. Si vienes a enseñar, lanzas tus mentorías y cobras seguro.",
};

const STUDENT_STEPS = [
  {
    icon: SearchIcon,
    title: "Encuentra tu meta",
    text: "Cuéntanos qué quieres lograr. Filtra por tutores o mentorías con un objetivo concreto. Cada tutor te asegura un resultado claro y un aprendizaje dinámico.",
  },
  {
    icon: CalendarCheckIcon,
    title: "Reserva y paga seguro",
    text: "Eliges tu horario favorito y pagas en un checkout blindado. Tu reserva recibe la confirmación del tutor en menos de 24 horas; si por alguna razón no puede asistir, te devolvemos el 100% de inmediato.",
  },
  {
    icon: MonitorPlayIcon,
    title: "Aprende en vivo y avanza",
    text: "Conéctate en salas de video privadas 1 a 1. Avanzas a tu propio ritmo, logras el objetivo, dejas tu reseña y agendas la siguiente meta.",
  },
];

const TUTOR_STEPS = [
  {
    icon: BadgeCheckIcon,
    title: "Postúlate como tutor",
    text: "Arma tu biografía y sube tus documentos en un clic. Nuestro equipo activa tu perfil tras una revisión manual para mantener la confianza en la comunidad bien arriba.",
  },
  {
    icon: TagsIcon,
    title: "Lanza tus mentorías",
    text: "Diseña ofertas enfocadas en un resultado real. Tú pones las reglas: manejas tu propia disponibilidad y fijas tus precios por sesión con total libertad.",
  },
  {
    icon: CreditCardIcon,
    title: "Imparte la sesión y cobra seguro",
    text: "Aceptas la reserva en menos de 24 horas y das tu sesión en vivo 1 a 1. Retiras tus ganancias de forma rápida, transparente y garantizada.",
  },
];

/** Píldora azul del hero: los tres pasos encadenados (buscar → agendar → clase). */
function StepsPill() {
  return (
    <div className="flex items-center gap-1.5 rounded-[8px] bg-brand px-2.5 py-2 shadow-[0_2px_7px_rgb(0_0_0/0.22)]">
      {[SearchIcon, CalendarCheckIcon, PlayIcon].map((Icon, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {i > 0 ? <span className="h-px w-8 bg-white/90" /> : null}
          <span className="grid size-[29px] place-items-center rounded-full border border-white/90 text-white">
            <Icon className="size-3" />
          </span>
        </div>
      ))}
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <>
      {/* Hero de P03: forma azul con el degradado + alumno recortado, y los dos
          adornos flotantes (píldora de pasos y chip "En vivo, 1 a 1"). */}
      <div className="relative isolate overflow-hidden bg-[#f9fafc] lg:h-[630px]">
        {/* Capa decorativa anclada a la rejilla de 1280 del Figma: la foto va
            pegada al borde inferior (mide 634 en un hero de 630, así que el
            recorte es intencional) y se sale 116px por la derecha. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 mx-auto hidden max-w-[1280px] lg:block"
        >
          <Image
            src="/img/how-hero-shape.png"
            alt=""
            width={1267}
            height={955}
            className="absolute top-1 left-[131px] w-[1561px] max-w-none"
          />
          <Image
            src="/img/how-hero-alumno.png"
            alt=""
            width={951}
            height={634}
            priority
            className="absolute -right-[116px] bottom-0 w-[951px] max-w-none"
          />
          <div className="absolute top-[110px] right-[86px] flex flex-col items-end gap-3">
            <StepsPill />
            <div className="flex items-center gap-2.5 rounded-[8px] bg-card px-4 py-3.5 shadow-[0_2px_7px_rgb(0_0_0/0.15)]">
              <span className="size-2.5 rounded-full bg-primary" />
              <span className="text-[12.5px] font-semibold">
                En vivo, 1 a 1
              </span>
            </div>
          </div>
        </div>

        <Container>
          <Section className="lg:max-w-[561px] lg:py-[117px]">
            {/* 386:699;205:1435 — el nombre de la capa en Figma ("Reserva tu
                resultado…") está viejo; manda el texto, que rompe en tres
                líneas fijas. Por debajo de lg fluye solo. */}
            <h1 className="text-3xl font-bold text-balance text-brand sm:text-[50px] sm:leading-[1.18]">
              Elige tu <em className="font-light">meta</em>
              <br className="hidden lg:inline" /> y avanza a tu ritmo
              <br className="hidden lg:inline" /> de principio a fin
            </h1>
            <p className="mt-6 text-pretty text-[18.6px] text-[#525252]">
              Lo que ya sabes vale oro y lo que puedes aprender también. En
              Enséñame Ya encuentras al tutor ideal, reservas con pago protegido
              y aseguras el éxito en vivo. Si vienes a enseñar, lanzas tus
              mentorías y cobras seguro.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Button
                asChild
                className="h-[54px] rounded-[9px] px-7 text-[17px]"
              >
                <Link href="/tutors">Aprende YA</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-[54px] rounded-[9px] border-[#cccccc] px-7 text-[17px]"
              >
                <Link href="/signup">Enseña YA</Link>
              </Button>
            </div>

            {/* Sin diseño móvil: por debajo de lg la foto entra en el flujo. */}
            <Image
              src="/img/how-hero-alumno.png"
              alt=""
              width={951}
              height={634}
              className="mt-10 h-auto w-full lg:hidden"
            />
          </Section>
        </Container>
      </div>

      <StepsBlock
        eyebrow="ESTUDIANTE"
        title="Para quien aprende: habilidades pro en 3 pasos"
        steps={STUDENT_STEPS}
        image={{
          src: "/img/how-alumno.jpg",
          alt: "Alumna en una mentoría por videollamada",
        }}
        accent="brand"
        background="bg-[#e8f2ff]"
      />

      {/* Frase de marca: bloque negro con el mismo patrón de ondas que los
          testimonios, comillas naranjas y la frase a 43px. */}
      <div className="relative isolate overflow-hidden bg-black">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[url('/img/testimonials-bg.png')] bg-cover bg-center"
        />
        <Container className="py-20 text-center">
          <QuoteIcon className="mx-auto size-8 rotate-180 fill-primary text-primary" />
          <p className="mx-auto mt-6 max-w-[958px] text-2xl font-semibold text-balance text-white sm:text-[43px] sm:leading-[1.33]">
            Cada paso está diseñado para que saques tu versión más pro y
            multipliques tu talento.
          </p>
        </Container>
      </div>

      <StepsBlock
        reverse
        eyebrow="TUTOR"
        title="Para quien enseña: emprende y factura en 3 pasos"
        steps={TUTOR_STEPS}
        image={{
          src: "/img/how-tutor.jpg",
          alt: "Tutora preparando su mentoría",
        }}
        accent="primary"
        background="bg-muted"
        cta={{ href: "/signup", label: "Regístrate YA" }}
      />

      <TrustCards
        title="Aprende y enseña con la tranquilidad de siempre"
        points={TRUST_POINTS_COMO_FUNCIONA}
        tone="peach"
      />

      <HomeFaq
        items={FAQ_COMO_FUNCIONA}
        aside={{
          title: "Preguntas frecuentes",
          text: "¿Buscas una respuesta específica? Nuestro equipo te responderá en menos de 24 horas para que sigas avanzando.",
          cta: { href: "/contacto", label: "Contactar a soporte" },
        }}
      />

      <FinalCta
        title="Empieza hoy y transforma tu futuro YA"
        primaryLabel="Regístrate YA"
        secondaryLabel="Quiero enseñar YA"
      />
    </>
  );
}
