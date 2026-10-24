import type { Metadata } from "next";
import {
  BadgeCheckIcon,
  CalendarClockIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TagsIcon,
  UserPlusIcon,
  VideoIcon,
  WalletIcon,
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

/**
 * Señales de confianza. Cada una es algo que el producto HACE hoy:
 * · Verificación: KYC con documentos y aprobación manual del admin (C-14,
 *   US-203/RN-24); el rol `tutor` se concede al aprobar (`20260714120000`).
 * · Cobro por adelantado: la reserva nace pagada (checkout antes de la reserva;
 *   `confirm_payment` del webhook, regla de oro 2).
 * · PayPal o banco: las dos tarjetas de payout de `docs/DICTADO-PAGOS.md` §3;
 *   banco solo donde hay fila en `payout_country_rules` → «según tu país».
 * · 7 días y lunes: `run_payout_batch(p_retention_days default 7)`
 *   (`20261009190100`) con cron `0 3 * * 1` (`20260716140000`); es la misma
 *   frase que enseña `/tutor/payouts`.
 * · Grabación obligatoria y avisada (RN-42 reformulada el 2-sep).
 */
const GARANTIAS = [
  {
    icon: ShieldCheckIcon,
    title: "Perfil verificado",
    text: "Revisamos tu identidad y tus credenciales antes de aprobar tu perfil. Los alumnos saben que hay un filtro detrás.",
  },
  {
    icon: CreditCardIcon,
    title: "El alumno paga al reservar",
    text: "Cada reserva llega ya pagada a través de la plataforma. No tienes que cobrar ni perseguir a nadie.",
  },
  {
    icon: WalletIcon,
    title: "Cobras por PayPal o banco",
    text: "Lo que ganas se libera 7 días después de cada mentoría y se paga cada lunes, a PayPal o a tu cuenta bancaria según tu país.",
  },
  {
    icon: VideoIcon,
    title: "Sala propia y grabada",
    text: "Das tus mentorías en una sala de video privada dentro de la plataforma. Todas se graban y las dos partes lo saben antes de entrar.",
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

/**
 * Las dos primeras son del cliente (copy de Néstor). Las demás contestan las
 * objeciones de dinero sin dar cifras que el código no garantice:
 * · La comisión NO se dice en número: sale del tier del tutor (`tutor_tiers`,
 *   C-09 sin cerrar, editable desde /admin/tiers) y `/tutor/payouts` le enseña
 *   «Te quedas con el X % de cada reserva».
 * · El cargo por servicio lo paga el alumno por encima (`SERVICE_FEE_PCT`,
 *   `20260916120000`: gross = comisión + neto del tutor + cargo).
 */
const PREGUNTAS = [
  {
    q: "¿Tengo que ser profesor de profesión?",
    a: "También puedes compartir conocimientos que has desarrollado en tu carrera profesional o como estudiante avanzado. Lo esencial es dominar lo que enseñas y saber ayudar a otros a comprenderlo.",
  },
  {
    q: "¿Qué puedo enseñar?",
    a: "Piensa en aquello que sabes explicar, resolver o hacer bien, y en cómo ese conocimiento puede ayudar a alguien a alcanzar una meta concreta.",
  },
  {
    q: "¿Cuánto puedo cobrar?",
    a: "Tú fijas la tarifa de cada mentoría. De cada reserva, Enséñame Ya se queda una comisión que depende de tu nivel como tutor; el porcentaje que te quedas lo ves siempre en tu panel de cobros.",
  },
  {
    q: "¿El cargo por servicio sale de mi tarifa?",
    a: `No. El cargo por servicio del ${SERVICE_FEE_PCT}% lo paga el alumno aparte, encima del precio de la mentoría.`,
  },
  {
    q: "¿Cómo y cuándo me pagan?",
    a: "Eliges dónde recibir tu dinero: PayPal o una cuenta bancaria, según lo que esté disponible en tu país. Lo que ganas se libera 7 días después de cada mentoría y se paga cada lunes.",
  },
  {
    q: "¿Cuándo empiezo a recibir reservas?",
    a: "Cuando completes tu perfil y nuestro equipo apruebe tu verificación. Para eso subes documentos que acrediten tu identidad y tu experiencia.",
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
        beneficio="Registrarte es gratis. Tú defines tu tarifa y tus horarios."
        sellos={["Perfil verificado", "Cobros por PayPal o banco", "Pagos cada lunes"]}
      />

      <LandingGarantias
        title="Enseña con respaldo desde la primera mentoría"
        items={GARANTIAS}
      />

      <TrustCards
        title="Tú aportas el conocimiento. Nosotros te ayudamos a compartirlo."
        points={BENEFICIOS}
        tone="peach"
      />
      <LandingCta para="tutor" nota="Registrarte es gratis." />

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

      {/* Ancla del CTA secundario del hero; `scroll-mt` por la cabecera sticky. */}
      <div id={COMO_FUNCIONA_ID} className="scroll-mt-20 bg-muted">
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
        />
        <LandingCta para="tutor" nota="Empieza por el paso 1: crea tu cuenta." />
      </div>

      <HomeFaq
        items={PREGUNTAS}
        aside={{
          title: "¿Es para ti?",
          cta: { href: "/contacto", label: "¿Otra duda? Escríbenos" },
        }}
      />

      <LandingCierre
        para="tutor"
        title="Hay alguien que quiere aprender lo que tú sabes."
        text="Da el primer paso para convertir tu experiencia en nuevas oportunidades."
        nota="Crea tu cuenta de tutor en Enséñame YA."
      />

      <LandingBarraMovil para="tutor" />
    </>
  );
}
