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
    title: "Expertos verificados",
    text: "Talento, identidad y credenciales verificadas por nuestro equipo.",
  },
  {
    icon: WalletIcon,
    title: "Pago seguro",
    text: "Checkout 100% seguro; tus datos y tu inversión están totalmente protegidos.",
  },
  {
    icon: RotateCcwIcon,
    title: "Reembolso claro",
    text: "Flexibilidad total: cancela con 24h de anticipación y recibes el 100%.",
  },
  {
    icon: SparklesIcon,
    title: "Reserva garantizada",
    text: "Si el tutor no acepta en 24h, tu dinero regresa de inmediato.",
  },
];

/** P03 reescribe las cuatro garantías con su propio texto (386:797…828). */
export const TRUST_POINTS_COMO_FUNCIONA = [
  {
    icon: ShieldCheckIcon,
    title: "Tutores verificados",
    text: "Identidad y experiencia seleccionadas a mano antes de su primera clase.",
  },
  {
    icon: WalletIcon,
    title: "Pago seguro",
    text: "Checkout protegido; tu dinero y tu inversión se gestionan de forma transparente y segura.",
  },
  {
    icon: RotateCcwIcon,
    title: "Reembolso claro",
    text: "Flexibilidad total: cancela con 24 horas de anticipación y recibes el 100%.",
  },
  {
    icon: SparklesIcon,
    title: "Reserva garantizada",
    text: "Ventana de aceptación de 24 horas. Si el tutor no confirma, tu dinero regresa intacto de inmediato.",
  },
];

/**
 * Variante en tarjetas (P02/P03). La primera va en naranja, como el Figma.
 * `tone="peach"` es P03: las cuatro dentro de una caja #ffe5cc con el título
 * centrado, y el check de la primera en azul en vez de verde.
 */
export function TrustCards({
  title,
  points = TRUST_POINTS,
  tone = "plain",
}: {
  title?: string;
  points?: typeof TRUST_POINTS;
  tone?: "plain" | "peach";
}) {
  const peach = tone === "peach";
  return (
    <div className={peach ? undefined : "bg-muted"}>
      <Container>
        <Section
          className={peach ? "rounded-[17px] bg-[#ffe5cc] px-6 sm:px-8" : ""}
        >
          {title ? (
            <h2
              className={`text-2xl font-semibold ${peach ? "text-center" : ""}`}
            >
              {title}
            </h2>
          ) : null}
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {points.map(({ icon: Icon, title: t, text }, i) => (
              <li
                key={t}
                className={`flex flex-col gap-4 rounded-[19px] p-5 ${
                  i === 0 ? "bg-primary" : "border border-[#bfbfbf] bg-card"
                }`}
              >
                {/* La primera lleva check verde sobre blanco (el diseño usa el
                    mismo #298c52 del token de éxito); el resto, naranja. */}
                <span
                  className={`grid size-10 place-items-center rounded-full ${
                    i === 0
                      ? `bg-card ${peach ? "text-brand" : "text-success"}`
                      : "bg-[#ffeddb] text-[#db5400]"
                  }`}
                >
                  <Icon className="size-5" />
                </span>
                <div
                  className={`rounded-[14px] p-4 ${
                    i === 0 ? "bg-card" : "bg-[#f5f5f2]"
                  }`}
                >
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
