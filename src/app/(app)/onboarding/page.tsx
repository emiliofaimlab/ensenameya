import { redirect } from "next/navigation";

import { storageUrl } from "@/lib/catalog/format";
import {
  destinoDeUsuario,
  getUserTimezone,
  requireUser,
} from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/roles";
import { Container } from "@/components/layout/container";
import { resolveStep } from "@/components/onboarding/wizard-step";
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
  const { user, roles, onboardingComplete } = await requireUser();

  // ⚠️ El flag sale de `requireUser()` y NO de una segunda consulta a
  // `profiles`, que es de donde salía. Eran dos fuentes de verdad para el mismo
  // dato y podían contradecirse: `requireUser()` manda aquí a quien ve
  // `onboarding_complete = false` —incluido todo el mundo si `session_bootstrap`
  // falla, ver `lib/auth/server.ts`— y esta pantalla, leyendo la columna por su
  // cuenta, se veía completa y devolvía a `/app`. Rebote infinito y mudo.
  // Ahora la respuesta es una sola, así que o entra o no entra.
  // ⚠️ El respaldo era `"/app"` escrito a pelo, y por eso un TUTOR que entrara
  // por `/signup` —cuyo botón de Google lleva `intent=alumno` por defecto—
  // acababa en el panel de alumno: el callback lo mandaba aquí, esto veía el
  // onboarding hecho y lo soltaba en `/app`. El mismo tutor entrando por
  // `/login` iba a `/tutor`. Verificado en vivo el 11-sep-2026.
  if (onboardingComplete) {
    redirect(safeNext(next, await destinoDeUsuario(user.id, roles)));
  }

  // El paso se resuelve en el SERVIDOR para que el primer HTML ya venga con el
  // correcto y no parpadee otro número al hidratar. Solo mira `?paso=`, que es
  // la navegación interna del asistente: entrar aquí sin parámetro da el paso 1
  // SIEMPRE (28-ago-2026, ver `wizard-step.ts`).
  const initialStep = resolveStep({ param: paso, total: TOTAL_STEPS });

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, timezone, phone, avatar_path, primary_goal")
    .eq("id", user.id)
    .single();

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
