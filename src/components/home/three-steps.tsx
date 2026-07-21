import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

const STEPS = [
  {
    n: "01",
    title: "Busca tu resultado",
    text: "Dinos qué quieres lograr. Filtra por tutores o por productos con un objetivo concreto.",
  },
  {
    n: "02",
    title: "Reserva y paga",
    text: "Eliges horario y pagas en un checkout protegido. Tu reserva espera la aceptación del tutor (hasta 24h); si no acepta, te devolvemos el 100%.",
  },
  {
    n: "03",
    title: "Aprende en vivo",
    text: "Tomas tu clase 1 a 1 en video. Al terminar dejas tu reseña y reservas tu próxima sesión.",
  },
];

export function ThreeSteps() {
  return (
    <Container>
      <Section>
        <div className="rounded-2xl bg-primary px-6 py-10 sm:px-10">
          <h2 className="text-center text-2xl font-semibold text-primary-foreground">
            Reserva tu resultado en 3 pasos
          </h2>

          <ol className="mt-8 grid gap-6 lg:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-2xl bg-card p-6">
                <p className="text-2xl font-bold text-brand">{s.n}</p>
                <h3 className="mt-3 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>
    </Container>
  );
}
