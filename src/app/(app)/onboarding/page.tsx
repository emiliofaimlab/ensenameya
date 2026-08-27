import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { storageUrl } from "@/lib/catalog/format";
import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/roles";
import { Container } from "@/components/layout/container";
import { resolveStep, stepCookie } from "@/components/onboarding/wizard-step";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Completa tu perfil · Enséñame Ya" };

/** Pasos del asistente de alumno; lo sabe la página para saturar `?paso=`. */
const TOTAL_STEPS = 3;

/**
 * US-201 (SCR-AL01) — Onboarding del alumno. Nombre, `timezone` (RN-01) y
 * teléfono E.164 (RN-44) obligatorios → `onboarding_complete=true`. Quien ya lo
 * completó no vuelve aquí (va a su destino / panel).
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; paso?: string }>;
}) {
  const { next, paso } = await searchParams;
  const { user } = await requireUser();

  // M-03 · El paso se resuelve en el SERVIDOR (URL → cookie → 1) para que el
  // primer HTML ya venga con el paso correcto. Resolverlo al hidratar pintaría
  // "Paso 1 de 3" durante un instante, que es justo la impresión que hay que
  // quitar.
  const initialStep = resolveStep({
    param: paso,
    cookie: (await cookies()).get(stepCookie("alumno"))?.value,
    total: TOTAL_STEPS,
  });

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, timezone, phone, avatar_path, onboarding_complete, primary_goal")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_complete) redirect(safeNext(next, "/app"));

  const [{ data: cats }, { data: mine }] = await Promise.all([
    supabase.from("categories").select("id, name").order("sort_order"),
    supabase.from("student_interests").select("category_id").eq("student_id", user.id),
  ]);

  const avatarUrl = storageUrl("avatars", profile?.avatar_path);

  return (
    // AL01: el cuerpo va sobre #f9fafc con ~148 px de aire arriba y ~108 abajo
    // (149:7 / 150:7), no los 64 px de una sección normal.
    <div className="bg-muted pt-14 pb-10 sm:pt-[148px] sm:pb-[108px]">
      <Container>
        <div>
          <OnboardingForm
            userId={user.id}
            next={next ?? null}
            initialStep={initialStep}
            totalSteps={TOTAL_STEPS}
            intendedRole={
              (user.user_metadata?.intended_role as string | undefined) ?? null
            }
            fullName={profile?.full_name ?? ""}
            timezone={await getUserTimezone()}
            phone={profile?.phone ?? ""}
            avatarPath={profile?.avatar_path ?? null}
            avatarUrl={avatarUrl}
            categories={(cats ?? []).map((c) => ({ id: c.id, label: c.name }))}
            selectedInterests={(mine ?? []).map((r) => r.category_id)}
            primaryGoal={profile?.primary_goal ?? null}
          />
        </div>
      </Container>
    </div>
  );
}
