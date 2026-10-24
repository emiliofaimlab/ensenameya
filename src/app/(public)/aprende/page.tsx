import type { Metadata } from "next";
import {
  BadgeCheckIcon,
  CalendarCheckIcon,
  CompassIcon,
  CreditCardIcon,
  MessageCircleQuestionIcon,
  SearchIcon,
  RotateCcwIcon,
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
  COMO_FUNCIONA_ID,
  LandingBarraMovil,
  LandingCierre,
  LandingCta,
  LandingGarantias,
  LandingHero,
  LandingTexto,
} from "@/components/landing/landing";
import { SERVICE_FEE_PCT } from "@/lib/booking";
import { CANCELLATION_POLICY } from "@/lib/policy";

const { cutoffHours: HORAS } = CANCELLATION_POLICY;
const {
  studentEarly: PCT_ANTES,
  studentLate: PCT_TARDE,
  tutorCancels: PCT_TUTOR,
} = CANCELLATION_POLICY.refundPct;

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

/**
 * Señales de confianza, cada una con su fuente en el código:
 * · Verificación manual con documentos (KYC, C-14 · US-203/RN-24).
 * · Pago dentro de la plataforma; el importe sale del servidor (regla de oro 2).
 * · Reembolsos: `CANCELLATION_POLICY` de `lib/policy.ts` (RN-37), que es la
 *   copia que enseña lo que aplica `cancel_booking`.
 * · 24 h para confirmar o reembolso del 100 %: `expire_stale_bookings`,
 *   `p_acceptance_cutoff = 24 hours` (`20260709190000`, US-605).
 */
const GARANTIAS = [
  {
    icon: BadgeCheckIcon,
    title: "Tutores verificados",
    text: "Revisamos la identidad y las credenciales de cada tutor antes de aprobar su perfil.",
  },
  {
    icon: CreditCardIcon,
    title: "Pago seguro",
    text: "Pagas dentro de la plataforma al reservar y ves el total antes de confirmar.",
  },
  {
    icon: RotateCcwIcon,
    title: "Reembolso claro",
    text: `Cancela con ${HORAS} h o más de anticipación y recibes el ${PCT_ANTES}%. Con menos aviso, el ${PCT_TARDE}%.`,
  },
  {
    icon: ShieldCheckIcon,
    title: "Reserva garantizada",
    text: `Si el tutor no confirma tu reserva en ${HORAS} h, se cancela sola y recuperas el 100%.`,
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

/**
 * Las tres últimas son del cliente. Las primeras contestan precio, cancelación
 * y cómo es la mentoría con los números del código (`SERVICE_FEE_PCT`,
 * `CANCELLATION_POLICY`) y lo que hace la sala (Daily en el navegador,
 * grabación obligatoria y avisada · RN-42; borrado a los 30 días, el mismo
 * texto que ya publica `HomeFaq`).
 */
const PREGUNTAS = [
  {
    q: "¿Cuánto cuesta una mentoría?",
    a: `Cada tutor fija su tarifa y la ves en su perfil antes de reservar. Al pagar se suma un cargo por servicio del ${SERVICE_FEE_PCT}%, y ves el total antes de confirmar. Crear tu cuenta es gratis.`,
  },
  {
    q: "¿Puedo cancelar si me surge algo?",
    a: `Sí. Con ${HORAS} h o más de anticipación recuperas el ${PCT_ANTES}%; con menos aviso, el ${PCT_TARDE}%. Si quien cancela es el tutor, se te devuelve el ${PCT_TUTOR}%.`,
  },
  {
    q: "¿Cómo es la mentoría?",
    a: "Es por videollamada, en una sala privada dentro de la plataforma: a la hora de tu sesión entras desde el navegador, sin instalar nada. Todas las sesiones se graban y se avisa a las dos partes antes de entrar; la grabación es privada y se borra a los 30 días.",
  },
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
        beneficio="Crear tu cuenta es gratis. Solo pagas las mentorías que reservas."
        sellos={[
          "Tutores verificados",
          "Pago seguro",
          `Reembolso del ${PCT_ANTES}% cancelando con ${HORAS} h`,
        ]}
        // `/tutores` es la lista PÚBLICA (sin guarda): mirar antes de registrarse.
        secundario={{ href: "/tutores", label: "Explorar tutores" }}
      />

      <LandingGarantias title="Reserva con tranquilidad" items={GARANTIAS} />

      <LandingTexto
        title="Tu meta marca el rumbo."
        paragraphs={[
          "Entender una materia. Prepararte para un examen. Desarrollar una habilidad para tu trabajo. O aprender algo que siempre te ha llamado la atención.",
          "En Enséñame YA puedes encontrar a alguien que te ayude a dar ese siguiente paso.",
        ]}
      />

      <TrustCards points={BENEFICIOS} tone="peach" />

      <LandingTexto para="alumno" nota="Tu próximo paso empieza con una cuenta." />

      {/* Ancla del CTA secundario del hero; `scroll-mt` por la cabecera sticky. */}
      <div id={COMO_FUNCIONA_ID} className="scroll-mt-20 bg-[#e8f2ff]">
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
        />
        <LandingCta para="alumno" nota="Crear tu cuenta es gratis." />
      </div>

      <HomeFaq
        items={PREGUNTAS}
        aside={{
          title: "No necesitas tenerlo todo claro para empezar.",
          cta: { href: "/contacto", label: "¿Otra duda? Escríbenos" },
        }}
      />

      <LandingCierre
        para="alumno"
        title="Tu próxima pregunta puede ser el comienzo de algo grande."
        text="Encuentra apoyo para entender, practicar y seguir avanzando."
        nota="Crea tu cuenta de estudiante en Enséñame YA."
      />

      <LandingBarraMovil para="alumno" />
    </>
  );
}
