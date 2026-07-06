import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/roles";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Completa tu perfil · Enséñame Ya" };

/**
 * US-201 (SCR-AL01) — Onboarding del alumno. Nombre, `timezone` (RN-01) y
 * teléfono E.164 (RN-44) obligatorios → `onboarding_complete=true`. Quien ya lo
 * completó no vuelve aquí (va a su destino / panel).
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const { user } = await requireUser();

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, timezone, phone, onboarding_complete")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_complete) redirect(safeNext(next, "/app"));

  return (
    <Container>
      <Section className="mx-auto flex w-full max-w-md flex-col">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Completa tu perfil</CardTitle>
            <CardDescription>
              Un par de datos para empezar a reservar clases.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingForm
              userId={user.id}
              next={next ?? null}
              intendedRole={
                (user.user_metadata?.intended_role as string | undefined) ??
                null
              }
              fullName={profile?.full_name ?? ""}
              timezone={profile?.timezone ?? "UTC"}
              phone={profile?.phone ?? ""}
            />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
