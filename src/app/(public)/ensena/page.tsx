import type { Metadata } from "next";
import {
  BadgeCheckIcon,
  CalendarClockIcon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TagsIcon,
  UserPlusIcon,
} from "lucide-react";

import { StepsBlock } from "@/components/home/steps-block";
import { TrustCards } from "@/components/home/trust";
import { HomeFaq } from "@/components/home/home-faq";
import {
  LandingCierre,
  LandingHero,
  LandingTexto,
} from "@/components/landing/landing";

/**
 * EY-236 · Landing de campaña para TUTORES. Aquí aterrizan las campañas de
 * marketing y los enlaces de «Invita y gana» de la campaña de tutores
 * (`/ensena?ref=<code>`: el proxy guarda el `ref` en cualquier ruta). Copy del
 * cliente, tal cual.
 */
export const metadata: Metadata = {
  title: "Enseña en Enséñame Ya · Lo que sabes vale",
  description:
    "Comparte tu experiencia, ayuda a otros a avanzar y genera ingresos enseñando lo que dominas. Define tus tarifas y tu disponibilidad, y cobra de forma segura.",
  alternates: { canonical: "/ensena" },
};

const BENEFICIOS = [
  {
    icon: SparklesIcon,
    title: "Tu experiencia tiene valor",
    text: "¿Eres profesor, profesional o estudiante avanzado? Lo que has aprendido puede ser justo lo que otra persona necesita para entender un tema, desarrollar una habilidad o dar su siguiente paso.",
  },
  {
    icon: TagsIcon,
    title: "Enseña a tu manera",
    text: "Define tus tarifas y tu disponibilidad. Crea una propuesta de enseñanza que refleje tus fortalezas y el valor que puedes aportar.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Pagos seguros",
    text: "Gestiona los pagos de tus sesiones a través de la plataforma, con un proceso seguro para ti y tus estudiantes.",
  },
  {
    icon: LayoutDashboardIcon,
    title: "La infraestructura para enfocarte en enseñar",
    text: "Perfil, reservas y sesiones en vivo en un mismo lugar. Cuenta con las herramientas para organizar tus tutorías y dedicar tu atención a quien está aprendiendo contigo.",
  },
];

const PASOS = [
  {
    icon: UserPlusIcon,
    title: "Regístrate como tutor.",
    text: "Crea tu cuenta para iniciar el proceso.",
  },
  {
    icon: BadgeCheckIcon,
    title: "Dale forma a tu perfil.",
    text: "Presenta tu experiencia, qué puedes enseñar y a quién puedes ayudar. Completa el proceso de verificación.",
  },
  {
    icon: CalendarClockIcon,
    title: "Prepara tus tutorías.",
    text: "Define tu oferta, tus tarifas y tus horarios para recibir reservas.",
  },
];

const PREGUNTAS = [
  {
    q: "¿Tengo que ser profesor de profesión?",
    a: "También puedes compartir conocimientos que has desarrollado en tu carrera profesional o como estudiante avanzado. Lo esencial es dominar lo que enseñas y saber ayudar a otros a comprenderlo.",
  },
  {
    q: "¿Qué puedo enseñar?",
    a: "Piensa en aquello que sabes explicar, resolver o hacer bien, y en cómo ese conocimiento puede ayudar a alguien a alcanzar una meta concreta.",
  },
];

export default function EnsenaPage() {
  return (
    <>
      <LandingHero
        para="tutor"
        title="Lo que sabes vale. Es hora de convertirlo en oportunidades."
        text="Comparte tu experiencia, ayuda a otros a avanzar y genera ingresos enseñando lo que dominas. En Enséñame Ya tienes un espacio para convertir tus conocimientos en oportunidades."
        image={{
          src: "/img/home-teach.jpg",
          alt: "Tutor impartiendo una mentoría desde su computadora",
        }}
      />

      <TrustCards
        title="Tú aportas el conocimiento. Nosotros te ayudamos a compartirlo."
        points={BENEFICIOS}
        tone="peach"
      />

      <LandingTexto
        title="Tu crecimiento también merece acompañamiento."
        paragraphs={[
          "Enseñar es tu especialidad. Dar a conocer lo que ofreces y construir tu camino como tutor también requiere atención.",
          "Por eso contamos con el Tutor Success Program, nuestro programa de acompañamiento para ayudarte a desarrollar tu presencia en Enséñame YA y avanzar como tutor.",
          "Trae tus conocimientos, tu experiencia y tus ganas de enseñar. Queremos ayudarte a dar el siguiente paso.",
        ]}
        para="tutor"
        nota="Empieza creando tu cuenta de tutor."
      />

      <StepsBlock
        reverse
        eyebrow="TUTOR"
        title="Así comienza tu camino"
        steps={PASOS}
        image={{
          src: "/img/how-tutor.jpg",
          alt: "Tutora preparando su mentoría",
          focus: "max-lg:object-[50%_15%]",
        }}
        accent="primary"
        background="bg-muted"
      />

      <HomeFaq items={PREGUNTAS} aside={{ title: "¿Es para ti?" }} />

      <LandingCierre
        para="tutor"
        title="Hay alguien que quiere aprender lo que tú sabes."
        text="Da el primer paso para convertir tu experiencia en nuevas oportunidades."
        nota="Crea tu cuenta de tutor en Enséñame YA."
      />
    </>
  );
}
