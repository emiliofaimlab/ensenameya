import { ChevronDownIcon } from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

/** Las respuestas siguen RN-37 (reembolsos), RN-38 (24h) y RN-42 (grabación). */
const FAQ = [
  {
    q: "¿Necesito tarjeta para reservar?",
    a: "Sí. El pago se realiza en un checkout protegido al reservar. Tu reserva espera la aceptación del tutor; si no acepta en 24h, te devolvemos el 100%.",
  },
  {
    q: "¿Y si el tutor no acepta mi reserva?",
    a: "Tienes hasta 24h de espera. Si no confirma a tiempo, el reembolso es automático y total. Nunca pagas por una clase que no ocurre.",
  },
  {
    q: "¿Puedo cancelar una clase?",
    a: "Sí. Con 24h o más de anticipación recibes el 100%. Con menos de 24h, recibes el 50%.",
  },
  {
    q: "¿Las clases se graban?",
    a: "Las clases son privadas 1 a 1. Cualquier grabación requiere el consentimiento explícito de ambas partes.",
  },
  {
    q: "¿Cómo elijo al tutor correcto?",
    a: "Filtra por resultado, materia, precio y rating. Cada tutor está verificado en identidad y experiencia.",
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
