import Link from "next/link";
import {
  BadgeCheckIcon,
  GraduationCapIcon,
  ShieldCheckIcon,
  TagIcon,
} from "lucide-react";

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
import type { DocState } from "../verification/verification-form";

export const metadata = { title: "Enseñar en Enséñame Ya · Onboarding tutor" };

/**
 * US-202 (SCR-TU01) — Onboarding del tutor. Crea/edita el perfil de vitrina
 * (headline, bio, redes) → `approval_status='pending'` hasta que el admin lo
 * apruebe (US-1101). Foto (Storage) y categorías (al crear productos) → diferidas.
 */
const WELCOME_POINTS = [
  { icon: TagIcon, text: "Tú decides tus tarifas y tus horarios" },
  { icon: ShieldCheckIcon, text: "Cobros garantizados y respaldados" },
  { icon: BadgeCheckIcon, text: "Perfil y credenciales verificados" },
];

export default async function TutorOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const { user } = await requireUser();
  const { start } = await searchParams;

  const supabase = await createClient();
  const [
    { data: tp },
    { data: prof },
    { data: cats },
    { data: myCats },
    { data: mats },
    { data: docs },
  ] = await Promise.all([
    supabase
      .from("tutor_profiles")
      .select("headline, bio, socials, approval_status, teaching_level")
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name, timezone, phone, avatar_path")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("categories").select("id, name").order("sort_order"),
    supabase.from("tutor_categories").select("category_id").eq("tutor_id", user.id),
    supabase
      .from("tutor_materials")
      .select("id, file_name, size_bytes")
      .eq("tutor_id", user.id)
      .order("created_at"),
    supabase
      .from("verification_documents")
      .select("doc_type, status, link_url")
      .eq("tutor_id", user.id),
  ]);

  // Estado de los documentos KYC → el paso de verificación reusa el módulo TU02.
  const docsByType: Record<string, DocState> = Object.fromEntries(
    (docs ?? []).map((d) => [d.doc_type, { status: d.status, linkUrl: d.link_url }]),
  );

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

  // Pantalla cero (24-jul): la primera vez —sin perfil aún y sin venir de pulsar
  // "Comenzar"— una bienvenida que invita a crear la cuenta de tutor, antes del
  // asistente. `?start=1` entra ya al formulario.
  if (!tp && !start) {
    return (
      <div className="bg-muted pt-14 pb-10 sm:pt-[105px] sm:pb-[120px]">
        <Container>
          <div className="mx-auto flex max-w-xl flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-full bg-brand/10 text-brand">
              <GraduationCapIcon className="size-7" />
            </span>
            <h1 className="mt-5 text-2xl font-bold text-[#19191f] sm:text-3xl">
              Conviértete en tutor <span className="text-primary">YA</span>
            </h1>
            <p className="mt-3 text-pretty text-[15px] text-[#5c5c5c]">
              Todavía no tienes una cuenta de tutor. Crea tu perfil, define tus
              tarifas y empieza a enseñar en vivo a alumnos de toda Latinoamérica.
            </p>
            <ul className="mt-7 flex w-full flex-col gap-3 text-left">
              {WELCOME_POINTS.map(({ icon: Icon, text }) => (
                <li
                  key={text}
                  className="flex items-center gap-3 rounded-[12px] border border-[#e6e6e6] bg-card px-4 py-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ffeddb] text-[#db5400]">
                    <Icon className="size-4.5" />
                  </span>
                  <span className="text-sm font-medium text-[#333333]">{text}</span>
                </li>
              ))}
            </ul>
            <Button
              asChild
              className="mt-8 h-[45px] w-full max-w-xs bg-brand text-white hover:bg-brand/90"
            >
              <Link href="/tutor/onboarding?start=1">Comenzar registro</Link>
            </Button>
            <Link
              href="/app"
              className="mt-3 text-[13px] text-[#6b6b6b] transition-colors hover:text-foreground"
            >
              Ahora no
            </Link>
          </div>
        </Container>
      </div>
    );
  }

  const s = (tp?.socials ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  return (
    // TU01: cuerpo sobre #f9fafc con ~105 px de aire arriba (185:13 y=178).
    <div className="bg-muted pt-14 pb-10 sm:pt-[105px] sm:pb-[120px]">
      <Container>
        <div>
          <TutorOnboardingForm
            userId={user.id}
            exists={!!tp}
            headline={tp?.headline ?? ""}
            bio={tp?.bio ?? ""}
            instagram={str(s.instagram)}
            linkedin={str(s.linkedin)}
            fullName={prof?.full_name ?? ""}
            avatarPath={prof?.avatar_path ?? null}
            avatarUrl={avatarUrl}
            timezone={prof?.timezone ?? "UTC"}
            phone={prof?.phone ?? ""}
            level={tp?.teaching_level ?? null}
            categories={(cats ?? []).map((c) => ({ id: c.id, label: c.name }))}
            selectedCategories={(myCats ?? []).map((r) => r.category_id)}
            materials={mats ?? []}
            docsByType={docsByType}
          />
        </div>
      </Container>
    </div>
  );
}
