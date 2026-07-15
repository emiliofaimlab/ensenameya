import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { VerificationForm, type DocStatus } from "./verification-form";

export const metadata = { title: "Verificación de identidad · Enséñame Ya" };

const IDENTITY_NOTE: Record<string, { text: string; cls: string }> = {
  pending: {
    text: "Tus documentos están en revisión — te avisaremos cuando terminemos.",
    cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  approved: {
    text: "Tu identidad está verificada. ✓",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  rejected: {
    text: "Algún documento fue rechazado. Vuelve a subirlo para continuar.",
    cls: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};

/**
 * US-203 (SCR-TU02) — Verificación de identidad del tutor. Sube documentos a un
 * bucket privado → `identity_verification_status='pending'` (por trigger). La
 * revisión del admin (aprobar/rechazar) llega en US-1101 (S3). NTF-06 = stub.
 */
export default async function VerificationPage() {
  const { user } = await requireUser();
  const supabase = await createClient();

  // Requiere haber hecho el onboarding de tutor (existe la fila tutor_profiles).
  const { data: tp } = await supabase
    .from("tutor_profiles")
    .select("identity_verification_status")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!tp) redirect("/tutor/onboarding");

  const { data: docs } = await supabase
    .from("verification_documents")
    .select("doc_type, status")
    .eq("tutor_id", user.id);

  const statusByType: Record<string, DocStatus> = Object.fromEntries(
    (docs ?? []).map((d) => [d.doc_type, d.status]),
  );

  const note = IDENTITY_NOTE[tp.identity_verification_status];

  return (
    <Container>
      <Section className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <PageHeader
          title="Verifica tu identidad"
          description="Sube tus documentos. Un admin los revisa antes de aprobarte como tutor."
        />
        {note ? (
          <p className={`rounded-lg border px-3 py-2 text-sm ${note.cls}`}>
            {note.text}
          </p>
        ) : null}
        <VerificationForm userId={user.id} statusByType={statusByType} />
      </Section>
    </Container>
  );
}
