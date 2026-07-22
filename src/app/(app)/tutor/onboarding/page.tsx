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
  const [{ data: tp }, { data: prof }, { data: cats }, { data: myCats }, { data: mats }] =
    await Promise.all([
      supabase
        .from("tutor_profiles")
        .select("headline, bio, socials, approval_status, teaching_level")
        .eq("profile_id", user.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("timezone, phone, avatar_path")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.from("categories").select("id, name").order("sort_order"),
      supabase.from("tutor_categories").select("category_id").eq("tutor_id", user.id),
      supabase
        .from("tutor_materials")
        .select("id, file_name, size_bytes")
        .eq("tutor_id", user.id)
        .order("created_at"),
    ]);

  const avatarUrl = prof?.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(prof.avatar_path).data.publicUrl
    : null;

  if (tp?.approval_status === "approved") {
    return (
      <Container>
        <Section className="mx-auto flex w-full max-w-lg flex-col">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Ya eres tutor</CardTitle>
              <CardDescription>Tu perfil está publicado.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/tutor/products">Mis productos</Link>
              </Button>
              <Button asChild variant="outline">
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
    <div className="bg-muted">
      <Container>
        <Section>
          <TutorOnboardingForm
            userId={user.id}
            exists={!!tp}
            headline={tp?.headline ?? ""}
            bio={tp?.bio ?? ""}
            instagram={str(s.instagram)}
            linkedin={str(s.linkedin)}
            avatarPath={prof?.avatar_path ?? null}
            avatarUrl={avatarUrl}
            timezone={prof?.timezone ?? "UTC"}
            phone={prof?.phone ?? ""}
            level={tp?.teaching_level ?? null}
            categories={(cats ?? []).map((c) => ({ id: c.id, label: c.name }))}
            selectedCategories={(myCats ?? []).map((r) => r.category_id)}
            materials={mats ?? []}
          />
        </Section>
      </Container>
    </div>
  );
}
