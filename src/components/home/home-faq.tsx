import { ChevronDownIcon } from "lucide-react";

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
    q: "¿Puedo cambiar o cancelar una clase?",
    a: "Por supuesto. Si lo haces con 24h o más de anticipación, recibes un reembolso completo del 100%. Para cancelaciones realizadas con menos de 24h de aviso, se te reembolsará el 50% para compensar el tiempo reservado por el tutor.",
  },
  {
    q: "¿Las clases se graban?",
    // ⚠️ El Figma añade aquí "y la tendrás disponible en tu perfil para
    // repasar durante 30 días". Eso es US-1802 (EY-86), que está en To Do: la
    // grabación no existe todavía. Se omite esa frase para no prometerla.
    a: "Son sesiones interactivas 100% privadas. Las grabaciones se realizan únicamente con el consentimiento de ambas partes.",
  },
  {
    q: "¿Cómo elegir al tutor correcto?",
    a: "Puedes filtrar con total facilidad según el resultado específico que buscas, materia, precio y las valoraciones de la comunidad. Además, cada tutor cuenta con una verificación manual de identidad y experiencia para tu máxima seguridad.",
  },
];

/** P03 usa su propio set. Verificadas contra el código: zona horaria (RN-01/02),
 *  ventana de 24h (RN-38), sala Daily (US-801), reembolsos (RN-37) y payouts en
 *  lote semanal (US-1002). */
export const FAQ_COMO_FUNCIONA = [
  {
    q: "¿Cómo se coordinan los horarios de las tutorías?",
    a: "La plataforma sincroniza las agendas de forma automática convirtiendo las horas a tu zona horaria local para que programar sea rápido y sencillo.",
  },
  {
    q: "¿Qué pasa tras pagar mi clase?",
    a: "Tu reserva queda confirmada y lista. El tutor cuenta con una ventana de hasta 24 horas para aceptarla. Al confirmar, todo queda agendado; si por algún motivo expira el tiempo, se cancela y tu dinero se reembolsa al 100% de inmediato.",
  },
  {
    q: "¿Cómo accedo a las salas de video 1 a 1?",
    a: "Entras directamente de forma nativa en la web. A la hora de tu sesión, ingresas a tu panel de control y tendrás un botón directo para conectarte a nuestra sala privada de video.",
  },
  {
    q: "¿Puedo reprogramar o cambiar mi clase si me surge un imprevisto?",
    a: "Por supuesto. Si avisas con 24 horas o más de anticipación, recuperas el 100% de tu inversión. Si es una modificación realizada con menos de 24 horas de aviso, la plataforma te reembolsa el 50% de la sesión.",
  },
  {
    q: "¿Cómo y cuándo cobran los tutores?",
    a: "Tus ingresos se acumulan de forma segura. Tras el periodo de retención para garantizar el éxito de la experiencia, procesamos tus payouts en lotes semanales listos para ser retirados desde tu panel.",
  },
];

export function HomeFaq({ items = FAQ }: { items?: typeof FAQ }) {
  return (
    <div className="bg-muted">
      <Container>
        <Section>
          <h2 className="text-center text-2xl font-semibold tracking-tight text-primary">
            Preguntas frecuentes
          </h2>

          {/* ponytail: <details> nativo — acordeón accesible sin JS ni librería. */}
          <div className="mx-auto mt-8 max-w-4xl divide-y divide-border">
            {items.map(({ q, a }) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold marker:hidden">
                  {q}
                  <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-2 pr-8 text-sm text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </Section>
      </Container>
    </div>
  );
}
