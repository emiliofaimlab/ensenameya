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

export function HomeFaq() {
  return (
    <div className="bg-muted">
      <Container>
        <Section>
          <h2 className="text-center text-2xl font-semibold tracking-tight text-primary">
            Preguntas frecuentes
          </h2>

          {/* ponytail: <details> nativo — acordeón accesible sin JS ni librería. */}
          <div className="mx-auto mt-8 max-w-4xl divide-y divide-border">
            {FAQ.map(({ q, a }) => (
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
