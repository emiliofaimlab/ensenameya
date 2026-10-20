import type { Metadata } from "next";
import {
  CalendarCheckIcon,
  CompassIcon,
  MessageCircleQuestionIcon,
  SearchIcon,
  ShieldCheckIcon,
  TargetIcon,
  TrendingUpIcon,
  UserPlusIcon,
  UsersIcon,
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
 * EY-236 · Landing de campaña para ALUMNOS. Aquí aterrizan las campañas de
 * marketing y los enlaces de «Invita y gana» de la campaña de alumnos
 * (`/aprende?ref=<code>`: el proxy guarda el `ref` en cualquier ruta). Copy del
 * cliente, tal cual.
 */
export const metadata: Metadata = {
  title: "Aprende en Enséñame Ya · Clases 1 a 1 a tu ritmo",
  description:
    "Aprende de la mano de profesores, profesionales y estudiantes avanzados en clases personalizadas según lo que estés buscando y dónde estés actualmente. 100% a tu ritmo.",
  alternates: { canonical: "/aprende" },
};

const BENEFICIOS = [
  {
    icon: TargetIcon,
    title: "Atención centrada en ti",
    text: "Las sesiones se adaptan a tus dudas, tu nivel y tus objetivos. Pide otro ejemplo, refresca un concepto o profundiza en lo que más te interesa. Completamente a tu ritmo.",
  },
  {
    icon: UsersIcon,
    title: "Aprende de distintas experiencias",
    text: "Conecta con profesores que saben explicar, profesionales que aplican sus conocimientos y estudiantes avanzados que conocen de cerca los retos de aprender.",
  },
  {
    icon: MessageCircleQuestionIcon,
    title: "Pregunta hasta que tenga sentido",
    text: "Conversa con tu tutor en vivo, contrasta ideas y recibe orientación mientras practicas. Una pregunta a tiempo puede ayudarte a salir del bloqueo.",
  },
  {
    icon: TrendingUpIcon,
    title: "Construye confianza mientras aprendes",
    text: "Entender por qué y cómo se hace algo te ayuda a enfrentar el siguiente ejercicio, proyecto o reto con más autonomía.",
  },
  {
    icon: CompassIcon,
    title: "Encuentra una opción que encaje contigo",
    text: "Revisa perfiles, tarifas y disponibilidad para elegir un tutor según lo que quieres aprender y el tiempo que tienes.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Reserva con tranquilidad",
    text: "Consulta la experiencia de tutores verificados y realiza el pago de tu sesión de forma segura dentro de la plataforma.",
  },
];

const PASOS = [
  {
    icon: UserPlusIcon,
    title: "Crea tu cuenta de estudiante.",
    text: "Regístrate para comenzar.",
  },
  {
    icon: SearchIcon,
    title: "Encuentra a tu tutor.",
    text: "Explora opciones según el tema y el objetivo que quieres trabajar.",
  },
  {
    icon: CalendarCheckIcon,
    title: "Reserva y conéctate.",
    text: "Elige un horario disponible y llega a tu sesión con tus preguntas y una meta en mente.",
  },
];

const PREGUNTAS = [
  {
    q: "¿Puedo buscar ayuda para una duda puntual?",
    a: "Sí. Puedes buscar una tutoría enfocada en un tema específico o en una habilidad que quieras desarrollar.",
  },
  {
    q: "¿Es solo para estudiantes de colegio o universidad?",
    a: "También es para quienes quieren crecer profesionalmente, explorar un interés o aprender algo nuevo.",
  },
  {
    q: "¿Cómo elijo a mi tutor?",
    a: "Revisa su perfil y lo que ofrece. Busca una propuesta que se ajuste a tu nivel, tu objetivo y el tipo de ayuda que necesitas.",
  },
];

export default function AprendePage() {
  return (
    <>
      <LandingHero
        para="alumno"
        title="Eso que hoy te cuesta, empieza a entenderlo con la ayuda adecuada."
        text="Aprende de la mano de profesores, profesionales y estudiantes avanzados en clases personalizadas según lo que estés buscando y dónde estés actualmente. 100% a tu ritmo."
        image={{
          src: "/img/home-live.jpg",
          alt: "Alumna en una mentoría 1 a 1 por videollamada",
        }}
      />

      <LandingTexto
        title="Tu meta marca el rumbo."
        paragraphs={[
          "Entender una materia. Prepararte para un examen. Desarrollar una habilidad para tu trabajo. O aprender algo que siempre te ha llamado la atención.",
          "En Enséñame YA puedes encontrar a alguien que te ayude a dar ese siguiente paso.",
        ]}
      />

      <TrustCards points={BENEFICIOS} tone="peach" />

      <LandingTexto para="alumno" nota="Tu próximo paso empieza con una cuenta." />

      <StepsBlock
        eyebrow="ESTUDIANTE"
        title="Empieza en tres pasos"
        steps={PASOS}
        image={{
          src: "/img/how-alumno.jpg",
          alt: "Alumna en una mentoría por videollamada",
          focus: "max-lg:object-[50%_30%]",
        }}
        accent="brand"
        background="bg-[#e8f2ff]"
      />

      <HomeFaq
        items={PREGUNTAS}
        aside={{ title: "No necesitas tenerlo todo claro para empezar." }}
      />

      <LandingCierre
        para="alumno"
        title="Tu próxima pregunta puede ser el comienzo de algo grande."
        text="Encuentra apoyo para entender, practicar y seguir avanzando."
        nota="Crea tu cuenta de estudiante en Enséñame YA."
      />
    </>
  );
}
