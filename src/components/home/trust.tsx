import {
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WalletIcon,
} from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

/** Las cuatro garantías. Aparecen en P01 (banda azul), P02 y P03 (tarjetas). */
export const TRUST_POINTS = [
  {
    icon: ShieldCheckIcon,
    title: "Tutores verificados",
    text: "Identidad y experiencia revisadas antes de su primera clase.",
  },
  {
    icon: WalletIcon,
    title: "Pago seguro",
    text: "Checkout protegido; tu tarjeta no se comparte.",
  },
  {
    icon: RotateCcwIcon,
    title: "Reembolso claro",
    text: "Cancela ≥24h y recibe el 100%.",
  },
  {
    icon: SparklesIcon,
    title: "Reserva sin riesgo",
    text: "Si el tutor no acepta, te devolvemos el 100%.",
  },
];

/** Variante en tarjetas (P02/P03). La primera va en naranja, como el Figma. */
export function TrustCards({ title }: { title?: string }) {
  return (
    <div className="bg-muted">
      <Container>
        <Section>
          {title ? (
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          ) : null}
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_POINTS.map(({ icon: Icon, title: t, text }, i) => (
              <li
                key={t}
                className={`flex flex-col gap-4 rounded-[20px] p-5 ${
                  i === 0 ? "bg-primary" : "bg-card"
                }`}
              >
                <span
                  className={`grid size-10 place-items-center rounded-full ${
                    i === 0 ? "bg-card text-primary" : "bg-primary-muted text-primary"
                  }`}
                >
                  <Icon className="size-5" />
                </span>
                <div className="rounded-xl bg-card p-4">
                  <p className="text-[15px] font-semibold">{t}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </Container>
    </div>
  );
}
