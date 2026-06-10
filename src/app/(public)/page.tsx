import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

const features = [
  {
    title: "Descubre",
    description: "Explora tutores y clases por categoría o búsqueda.",
  },
  {
    title: "Reserva",
    description: "Agenda en tu hora local y paga de forma segura.",
  },
  {
    title: "Aprende en vivo",
    description: "Clase 1:1 por videollamada y deja tu reseña.",
  },
];

export default function HomePage() {
  return (
    <Container>
      <Section className="flex flex-col items-start gap-6">
        <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Tutorías 1:1 en vivo
        </span>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Aprende lo que te propones, con un tutor para ti
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground text-pretty">
          Descubre tutores, reserva clases en vivo y avanza hacia un resultado
          concreto.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/tutors">Explorar tutores</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/how-it-works">Cómo funciona</Link>
          </Button>
        </div>
      </Section>

      <Section className="border-t">
        <div className="grid gap-4 sm:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <CardTitle>{feature.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {feature.description}
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    </Container>
  );
}
