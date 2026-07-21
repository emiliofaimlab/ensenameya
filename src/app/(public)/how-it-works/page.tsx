import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { StepsBlock } from "@/components/home/steps-block";
import { TrustCards } from "@/components/home/trust";
import { HomeFaq } from "@/components/home/home-faq";
import { FinalCta } from "@/components/home/final-cta";

export const metadata = {
  title: "¿Cómo funciona? · Enséñame Ya",
  description:
    "Encuentras al tutor correcto, reservas con pago protegido y aprendes en vivo. Si enseñas, publicas tus resultados y cobras seguro.",
};

const STUDENT_STEPS = [
  {
    title: "Busca tu resultado",
    text: "Filtra por tutores o productos con un objetivo concreto. Cada producto promete un resultado claro, no solo un temario.",
  },
  {
    title: "Reserva y paga seguro",
    text: "Eliges horario y pagas en un checkout protegido. La reserva espera la aceptación del tutor hasta 24h; si no acepta, te devolvemos el 100%.",
  },
  {
    title: "Aprende en vivo y avanza",
    text: "Tomas tu clase 1 a 1 en video, enfocada en tu objetivo. Al terminar dejas tu reseña y reservas tu próxima sesión.",
  },
];

const TUTOR_STEPS = [
  {
    title: "Crea tu perfil y verifícate",
    text: "Completa tu bio y tu headline de resultado. Pasa la verificación de identidad y experiencia que genera confianza.",
  },
  {
    title: "Publica tus resultados",
    text: "Crea productos con un objetivo claro para el alumno. Tú fijas tu precio y tu disponibilidad.",
  },
  {
    title: "Imparte y cobra seguro",
    text: "Aceptas la reserva y das tu clase en vivo 1 a 1. Retiras tus ganancias al banco con pagos gestionados.",
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
            Reserva tu resultado, de principio a fin
          </h1>
          <p className="mt-6 max-w-3xl text-pretty text-muted-foreground sm:text-lg">
            Te explicamos cómo funciona Enséñame Ya en pocos pasos: encuentras
            al tutor correcto, reservas con pago protegido y aprendes en vivo.
            Si enseñas, publicas tus resultados y cobras seguro.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="h-11 bg-brand px-6 hover:bg-brand-foreground">
              <Link href="/tutors">Explorar tutores</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 border-brand px-6 text-brand hover:bg-brand-muted hover:text-brand"
            >
              <Link href="/signup">Quiero enseñar</Link>
            </Button>
          </div>
        </Section>
      </Container>

      <StepsBlock
        muted
        eyebrow="ESTUDIANTE"
        title="Para quien aprende: reserva en 3 pasos"
        steps={STUDENT_STEPS}
      />

      <Container>
        <Section>
          <p className="mx-auto max-w-3xl text-center text-2xl font-semibold tracking-tight text-balance sm:text-4xl">
            Cada paso está pensado para que llegues rápido a tu resultado.
          </p>
        </Section>
      </Container>

      <StepsBlock
        muted
        eyebrow="TUTOR"
        title="Para quien enseña: empieza a cobrar en 3 pasos"
        steps={TUTOR_STEPS}
      />

      <TrustCards title="Reserva con la tranquilidad de siempre" />
      <HomeFaq />
      <FinalCta />
    </>
  );
}
