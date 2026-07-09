import Link from "next/link";

import { getUser } from "@/lib/auth/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Mi panel · Enséñame Ya" };

/**
 * AL02 — Dashboard del Alumno. Placeholder de M0 (sólo confirma la sesión):
 * el panel completo (próximas/pasadas sesiones, acceso a sala) llega en M4.
 */
export default async function AppHome() {
  const user = await getUser();
  const greeting =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email;

  return (
    <Container>
      <Section className="flex flex-col gap-8">
        <PageHeader
          title={greeting ? `Hola, ${greeting}` : "Tu panel"}
          description="Aquí verás tus próximas clases. Por ahora, empieza explorando."
        />
        <Card>
          <CardHeader>
            <CardTitle>Aún no tienes clases reservadas</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
            <p>
              Descubre tutores y reserva tu primera clase 1:1 en vivo. El panel
              completo con tus sesiones llega pronto.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/tutors">Explorar tutores</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/reservas">Mis reservas</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/classes">Ver clases</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
