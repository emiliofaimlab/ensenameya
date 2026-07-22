import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

const STEPS = [
  {
    n: "01",
    title: "Elige tu meta",
    text: "Cuéntanos qué quieres lograr. Encuentra tutorías diseñadas específicamente para alcanzar un objetivo real.",
  },
  {
    n: "02",
    title: "Asegura tu espacio",
    text: "Elige tu horario favorito y reserva en un checkout protegido, con la tranquilidad de que tu inversión está respaldada.",
  },
  {
    n: "03",
    title: "Alcanza el éxito",
    text: "Conéctate a tu videollamada privada, evoluciona a tu propio ritmo y califica tu experiencia.",
  },
];

export function ThreeSteps() {
  return (
    <Container>
      <Section>
        <div className="rounded-2xl bg-primary px-6 py-10 sm:px-10">
          <h2 className="text-center text-2xl font-semibold text-primary-foreground">
            Tu resultado asegurado en 3 simples pasos
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
