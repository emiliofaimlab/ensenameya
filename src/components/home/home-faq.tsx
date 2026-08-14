import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

/** Las respuestas siguen RN-37 (reembolsos), RN-38 (24h) y RN-42 (grabación). */
const FAQ = [
  {
    q: "¿Necesito tarjeta para reservar?",
    a: "Sí. El pago se realiza de manera segura al reservar para garantizar tu lugar. Tu inversión queda completamente protegida en la plataforma y el tutor confirma el bloque en un máximo de 24h; si por alguna razón no puede asistir, se te reembolsa el 100% de inmediato.",
  },
  {
    q: "¿Y si el tutor no acepta mi reserva?",
    a: "El tutor cuenta con un tiempo límite de 24h para confirmar. Si no está disponible en ese horario, la reserva se cancela de forma automática y tu dinero regresa íntegro al 100% para que elijas otra opción.",
  },
  {
    q: "¿Puedo cambiar o cancelar una mentoría?",
    a: "Por supuesto. Si lo haces con 24h o más de anticipación, recibes un reembolso completo del 100%. Para cancelaciones realizadas con menos de 24h de aviso, se te reembolsará el 50% para compensar el tiempo reservado por el tutor.",
  },
  {
    q: "¿Las mentorías se graban?",
    // ⚠️ El Figma y el documento de contenido añaden aquí "y la tendrás
    // disponible en tu perfil para repasar todo el contenido durante 30 días".
    // Eso es US-1802 (EY-86), que sigue en To Do, y el add-on de grabación de
    // Daily ni siquiera está contratado. Se omite para no prometerlo.
    a: "Son sesiones interactivas 100% privadas. Las grabaciones se realizan únicamente con el consentimiento de ambas partes.",
  },
  {
    q: "¿Cómo elegir al tutor correcto?",
    a: "Puedes filtrar con total facilidad según el resultado específico que buscas, materia, precio y las excelentes valoraciones de la comunidad. Además, cada tutor cuenta con una verificación manual de identidad y experiencia para tu máxima seguridad.",
  },
];

/** P03 usa su propio set. Verificadas contra el código: zona horaria (RN-01/02),
 *  ventana de 24h (RN-38), sala Daily (US-801), reembolsos (RN-37) y payouts en
 *  lote semanal (US-1002). */
export const FAQ_COMO_FUNCIONA = [
  {
    q: "¿Cómo se coordinan los horarios de las mentorías?",
    a: "La plataforma sincroniza las agendas de forma automática convirtiendo las horas a tu zona horaria local para que programar sea rápido y sencillo.",
  },
  {
    q: "¿Qué pasa tras pagar mi mentoría?",
    a: "Tu reserva queda confirmada y lista. El tutor cuenta con una ventana de hasta 24 horas para aceptarla. Al confirmar, todo queda agendado; si por algún motivo expira el tiempo, se cancela y tu dinero se reembolsa al 100% de inmediato.",
  },
  {
    q: "¿Cómo accedo a las salas de video 1 a 1?",
    a: "Entras directamente de forma nativa en la web. A la hora de tu sesión, ingresas a tu panel de control y tendrás un botón directo para conectarte a nuestra sala privada de video.",
  },
  {
    q: "¿Puedo reprogramar o cambiar mi mentoría si me surge un imprevisto?",
    a: "Por supuesto. Si avisas con 24 horas o más de anticipación, recuperas el 100% de tu inversión. Si es una modificación realizada con menos de 24 horas de aviso, la plataforma te reembolsa el 50% de la sesión.",
  },
  {
    q: "¿Cómo y cuándo cobran los tutores?",
    a: "Tus ingresos se acumulan de forma segura. Tras el periodo de retención para garantizar el éxito de la experiencia, procesamos tus payouts en lotes semanales listos para ser retirados desde tu panel.",
  },
];

/** P02 trae su propio set de 5 (no el del home). Verificadas contra el código:
 *  KYC manual (US-203/RN-24), producto = resultado (Doc 00), sala privada Daily
 *  (US-801) y retención del pago hasta impartir (RN-26). */
export const FAQ_SOBRE_NOSOTROS = [
  {
    q: "¿Cuál es la misión de Enséñame Ya?",
    a: "Queremos que cada persona en la comunidad hispanohablante domine las habilidades esenciales para su vida y su carrera. Logramos esto conectando a alumnos motivados con tutores que guían hacia resultados prácticos y transformaciones reales.",
  },
  {
    q: "¿Cómo aseguran que los tutores realmente sepan enseñar?",
    a: "Validamos manualmente la identidad, títulos, certificaciones y trayectoria de cada tutor. Contamos con profesionales verificados que superan con éxito nuestros filtros de calidad y comparten la vibra de la plataforma.",
  },
  {
    q: '¿A qué nos referimos con "aprender con un objetivo claro"?',
    a: "Significa que te enfocas en metas concretas. En lugar de acumular horas de videos estáticos o clases teóricas interminables, en Enséñame Ya eliges un plan orientado a un logro específico —como preparar una entrevista en inglés o dominar un tema puntual— para que aproveches al máximo tu tiempo.",
  },
  {
    q: "¿Cómo garantizan que las mentorías en vivo sean seguras?",
    a: "Contamos con salas de video privadas 1 a 1 integradas de forma nativa en la plataforma para tu comodidad. Además, tu inversión se resguarda de manera segura hasta que la sesión se imparte con total éxito.",
  },
  {
    q: "¿Puedo emprender y ganar dinero enseñando?",
    a: "Por supuesto. Si eres un pro en tu área, Enséñame Ya es el espacio ideal para consolidar tu negocio independiente como tutor. Nosotros nos encargamos de la tecnología y los cobros para que tú te enfoques en inspirar a tus alumnos.",
  },
];

export function HomeFaq({
  items = FAQ,
  aside,
}: {
  items?: typeof FAQ;
  /** P03 lo monta a dos columnas, con un panel de contacto a la izquierda. */
  aside?: {
    title: string;
    text: string;
    /** El Figma pinta aquí "Contactar a soporte", pero no hay canal al que
     *  enlazar todavía (es DD-07, la bandeja de mensajería). Sin `cta` el panel
     *  se queda solo con el texto en vez de colar un botón muerto. */
    cta?: { href: string; label: string };
  };
}) {
  /* ponytail: <details> nativo — acordeón accesible sin JS ni librería.
     Abiertos de salida, que es como los pinta el Figma. */
  const list = (
    <div
      className={
        aside
          ? "divide-y divide-border"
          // R24-01: sin `max-w` propio — el `Container` de fuera ya pone el
          // ancho, y el 1016 del Figma dejaba el acordeón encogido frente a las
          // secciones de al lado.
          : "mt-8 divide-y divide-border"
      }
    >
      {items.map(({ q, a }) => (
        <details key={q} open className="group py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold marker:hidden">
            {q}
            <ChevronDownIcon className="size-4 shrink-0 text-brand transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-2 pr-8 text-sm text-muted-foreground">{a}</p>
        </details>
      ))}
    </div>
  );

  if (aside) {
    return (
      <Container>
        <Section className="grid gap-12 lg:grid-cols-[340px_1fr] lg:gap-20">
          <div>
            <h2 className="text-[27px] font-bold">{aside.title}</h2>
            <p className="mt-4 text-sm text-muted-foreground">{aside.text}</p>
            {aside.cta ? (
              <Button
                asChild
                variant="outline"
                className="mt-6 h-11 border-brand px-5 text-brand hover:bg-brand-muted hover:text-brand"
              >
                <Link href={aside.cta.href}>{aside.cta.label}</Link>
              </Button>
            ) : null}
          </div>
          {list}
        </Section>
      </Container>
    );
  }

  return (
    <div className="bg-muted">
      <Container>
        <Section>
          <h2 className="text-center text-[26px] font-semibold text-primary">
            Preguntas frecuentes
          </h2>
          {list}
        </Section>
      </Container>
    </div>
  );
}
