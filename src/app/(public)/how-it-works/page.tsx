import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { StepsBlock } from "@/components/home/steps-block";
import { TrustCards } from "@/components/home/trust";
import { FAQ_COMO_FUNCIONA, HomeFaq } from "@/components/home/home-faq";
import { FinalCta } from "@/components/home/final-cta";

export const metadata = {
  title: "¿Cómo funciona? · Enséñame Ya",
  description:
    "Encuentras al tutor ideal, reservas con pago protegido y aseguras el éxito en vivo. Si vienes a enseñar, lanzas tus tutorías y cobras seguro.",
};

const STUDENT_STEPS = [
  {
    title: "Encuentra tu meta",
    text: "Cuéntanos qué quieres lograr. Filtra por tutores o tutorías con un objetivo concreto. Cada mentor te asegura un resultado claro y un aprendizaje dinámico.",
  },
  {
    title: "Reserva y paga seguro",
    text: "Eliges tu horario favorito y pagas en un checkout blindado. Tu reserva recibe la confirmación del tutor en menos de 24 horas; si por alguna razón no puede asistir, te devolvemos el 100% de inmediato.",
  },
  {
    title: "Aprende en vivo y avanza",
    text: "Conéctate en salas de video privadas 1 a 1. Avanzas a tu propio ritmo, logras el objetivo, dejas tu reseña y agendas la siguiente meta.",
  },
];

const TUTOR_STEPS = [
  {
    title: "Postúlate como tutor",
    text: "Arma tu biografía y sube tus documentos en un clic. Nuestro equipo activa tu perfil tras una revisión manual para mantener la confianza en la comunidad bien arriba.",
  },
  {
    title: "Lanza tus tutorías",
    text: "Diseña ofertas enfocadas en un resultado real. Tú pones las reglas: manejas tu propia disponibilidad y fijas tus precios por sesión con total libertad.",
  },
  {
    title: "Imparte la clase y cobra seguro",
    text: "Aceptas la reserva en menos de 24 horas y das tu sesión en vivo 1 a 1. Retiras tus ganancias de forma rápida, transparente y garantizada.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <Container>
        <Section className="py-16 sm:py-20">
          <p className="text-[13px] font-semibold tracking-wide text-brand">
            En vivo, 1 a 1
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-5xl">
            Elige tu meta, y asegura tu resultado de principio a fin
          </h1>
          <p className="mt-6 max-w-3xl text-pretty text-muted-foreground sm:text-lg">
            Lo que ya sabes vale oro y lo que puedes aprender también. En
            Enséñame Ya encuentras al tutor ideal, reservas con pago protegido y
            aseguras el éxito en vivo. Si vienes a enseñar, lanzas tus tutorías
            y cobras seguro.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="h-11 bg-brand px-6 hover:bg-brand-foreground">
              <Link href="/tutors">Aprende YA</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 border-brand px-6 text-brand hover:bg-brand-muted hover:text-brand"
            >
              <Link href="/signup">Enseña YA</Link>
            </Button>
          </div>
        </Section>
      </Container>

      <StepsBlock
        muted
        eyebrow="ESTUDIANTE"
        title="Para quien aprende: habilidades pro en 3 pasos"
        steps={STUDENT_STEPS}
      />

      <Container>
        <Section>
          <p className="mx-auto max-w-3xl text-center text-2xl font-semibold tracking-tight text-balance sm:text-4xl">
            Cada paso está diseñado para que saques tu versión más pro y
            multipliques tu talento.
          </p>
        </Section>
      </Container>

      <StepsBlock
        muted
        eyebrow="TUTOR"
        title="Para quien enseña: emprende y factura en 3 pasos"
        steps={TUTOR_STEPS}
        cta={{ href: "/signup", label: "Regístrate YA" }}
      />

      <TrustCards title="Aprende y enseña con la tranquilidad de siempre" />
      <HomeFaq items={FAQ_COMO_FUNCIONA} />
      <FinalCta />
    </>
  );
}
