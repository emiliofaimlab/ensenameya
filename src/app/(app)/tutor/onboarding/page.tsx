import Link from "next/link";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TutorOnboardingForm } from "./tutor-onboarding-form";

export const metadata = { title: "Enseñar en Enséñame Ya · Onboarding tutor" };

/**
 * US-202 (SCR-TU01) — Onboarding del tutor. Crea/edita el perfil de vitrina
 * (headline, bio, redes) → `approval_status='pending'` hasta que el admin lo
 * apruebe (US-1101). Foto (Storage) y categorías (al crear productos) → diferidas.
 */
export default async function TutorOnboardingPage() {
  const { user } = await requireUser();

  const supabase = await createClient();
  const { data: tp } = await supabase
    .from("tutor_profiles")
    .select("headline, bio, socials, approval_status")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (tp?.approval_status === "approved") {
    return (
      <Container>
        <Section className="mx-auto flex w-full max-w-lg flex-col">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Ya eres tutor</CardTitle>
              <CardDescription>Tu perfil está publicado.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/tutors/${user.id}`}>Ver mi perfil público</Link>
              </Button>
            </CardContent>
          </Card>
        </Section>
      </Container>
    );
  }

  const s = (tp?.socials ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  return (
    <Container>
      <Section className="mx-auto flex w-full max-w-lg flex-col">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Enseña en Enséñame Ya</CardTitle>
            <CardDescription>
              {tp
                ? "Tu solicitud está en revisión. Puedes ajustar tu perfil mientras tanto."
                : "Crea tu perfil de tutor. Un admin lo revisará antes de publicarlo."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {tp ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                En revisión — te avisaremos cuando esté aprobado.
              </p>
            ) : null}
            <TutorOnboardingForm
              userId={user.id}
              exists={!!tp}
              headline={tp?.headline ?? ""}
              bio={tp?.bio ?? ""}
              instagram={str(s.instagram)}
              linkedin={str(s.linkedin)}
              youtube={str(s.youtube)}
              website={str(s.website)}
            />
            {tp ? (
              <Button asChild variant="outline">
                <Link href="/tutor/verification">Verificar mi identidad →</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
