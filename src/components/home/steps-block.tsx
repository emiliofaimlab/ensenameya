import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

/** Bloques numerados de P03: uno para el alumno y otro para el tutor. */
export function StepsBlock({
  eyebrow,
  title,
  steps,
  muted = false,
}: {
  eyebrow: string;
  title: string;
  steps: { title: string; text: string }[];
  muted?: boolean;
}) {
  return (
    <div className={muted ? "bg-muted" : undefined}>
      <Container>
        <Section>
          <p className="text-[13px] font-medium tracking-wide text-brand">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-balance sm:text-[27px]">
            {title}
          </h2>

          <ol className="mt-8 grid gap-6 lg:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-2xl bg-card p-6">
                <p className="text-3xl font-bold text-brand">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </Section>
      </Container>
    </div>
  );
}
