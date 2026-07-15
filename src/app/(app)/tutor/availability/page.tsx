import Link from "next/link";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { AvailabilityManager } from "./availability-manager";
import { ExceptionsManager } from "./exceptions-manager";

export const metadata = { title: "Mi disponibilidad · Enséñame Ya" };

/**
 * US-501 (SCR-TU05) — Disponibilidad recurrente del tutor. CRUD de reglas
 * semanales (día/hora, `end_time > start_time`) en el timezone del tutor. Las
 * excepciones puntuales (block/open) llegan en US-502.
 */
export default async function TutorAvailabilityPage() {
  const { userId, approvalStatus } = await requireTutorProfile();

  const supabase = await createClient();
  const [{ data: rules }, { data: exceptions }] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("id, weekday, start_time, end_time, is_active")
      .eq("tutor_id", userId)
      .order("weekday")
      .order("start_time"),
    supabase
      .from("availability_exceptions")
      .select("id, date, type, start_time, end_time, reason")
      .eq("tutor_id", userId)
      .gte("date", new Date().toISOString().slice(0, 10))
      .order("date"),
  ]);

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Mi disponibilidad"
          description="Define los bloques semanales en los que puedes dar clases (tu hora local)."
          actions={
            <Button asChild variant="outline">
              <Link href="/tutor/products">Mis productos</Link>
            </Button>
          }
        />

        {approvalStatus !== "approved" ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            Tus horarios serán visibles para los alumnos cuando tu perfil de tutor
            esté aprobado.
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Horario semanal</h2>
          <AvailabilityManager userId={userId} rules={rules ?? []} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Excepciones puntuales</h2>
            <p className="text-sm text-muted-foreground">
              Sobrescriben tu horario semanal en una fecha concreta: bloquea un día
              o abre un horario extra.
            </p>
          </div>
          <ExceptionsManager userId={userId} exceptions={exceptions ?? []} />
        </div>
      </Section>
    </Container>
  );
}
