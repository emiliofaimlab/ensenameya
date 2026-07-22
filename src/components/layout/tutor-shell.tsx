import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { AppSidebar, TUTOR_ITEMS } from "@/components/layout/app-sidebar";

/**
 * Shell de las pantallas del tutor (TU03…TU09): fondo gris + menú lateral.
 * Sin él, el sidebar solo salía en el dashboard y las demás quedaban sin
 * navegación entre sí.
 */
export function TutorShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-muted">
      <Container>
        <Section className="grid gap-6 lg:grid-cols-[232px_1fr]">
          <AppSidebar items={TUTOR_ITEMS} />

          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start gap-3">
              <div>
                <h1 className="text-[26px] font-bold tracking-tight">{title}</h1>
                {description ? (
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {description}
                  </p>
                ) : null}
              </div>
              {actions ? <div className="ml-auto">{actions}</div> : null}
            </div>

            {children}
          </div>
        </Section>
      </Container>
    </div>
  );
}
