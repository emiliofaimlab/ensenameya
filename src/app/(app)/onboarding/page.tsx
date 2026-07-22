import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/roles";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
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
    .select("full_name, timezone, phone, avatar_path, onboarding_complete")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_complete) redirect(safeNext(next, "/app"));

  const [{ data: cats }, { data: mine }] = await Promise.all([
    supabase.from("categories").select("id, name").order("sort_order"),
    supabase.from("student_interests").select("category_id").eq("student_id", user.id),
  ]);

  const avatarUrl = profile?.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl
    : null;

  return (
    <div className="bg-muted">
      <Container>
        <Section>
          <OnboardingForm
            userId={user.id}
            next={next ?? null}
            intendedRole={
              (user.user_metadata?.intended_role as string | undefined) ?? null
            }
            fullName={profile?.full_name ?? ""}
            timezone={profile?.timezone ?? "UTC"}
            phone={profile?.phone ?? ""}
            avatarPath={profile?.avatar_path ?? null}
            avatarUrl={avatarUrl}
            categories={(cats ?? []).map((c) => ({ id: c.id, label: c.name }))}
            selectedInterests={(mine ?? []).map((r) => r.category_id)}
          />
        </Section>
      </Container>
    </div>
  );
}
