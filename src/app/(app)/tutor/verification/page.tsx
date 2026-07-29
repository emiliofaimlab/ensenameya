import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { parseSocials } from "@/lib/socials";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { VerificationForm, type DocState } from "./verification-form";

export const metadata = { title: "Verificación de identidad · Enséñame Ya" };

/** Estado global de la verificación → píldora del Figma (190:10). */
const IDENTITY_PILL: Record<string, { label: string; tone: PillTone; note: string }> = {
  pending: {
    label: "En revisión",
    tone: "blue",
    note: "Tus documentos están siendo revisados. Te avisaremos cuando terminemos.",
  },
  approved: {
    label: "Verificada",
    tone: "green",
    note: "Tu identidad está verificada.",
  },
  rejected: {
    label: "Rechazada",
    tone: "red",
    note: "Algún documento fue rechazado. Vuelve a subirlo para continuar.",
  },
  not_submitted: {
    label: "Sin enviar",
    tone: "neutral",
    note: "Aún no has enviado documentos a revisión.",
  },
};

/**
 * US-203 (SCR-TU02) — Verificación de identidad del tutor, dentro del panel
 * (el Figma la cuelga del menú con "Cuenta" activo). Sube documentos a un
 * bucket privado → `identity_verification_status='pending'` (por trigger).
 */
export default async function VerificationPage() {
  const { user } = await requireUser();
  const supabase = await createClient();

  // Requiere haber hecho el onboarding de tutor (existe la fila tutor_profiles).
  const { data: tp } = await supabase
    .from("tutor_profiles")
    .select("identity_verification_status, socials")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!tp) redirect("/tutor/onboarding");

  const { data: docs } = await supabase
    .from("verification_documents")
    .select("doc_type, status, link_url")
    .eq("tutor_id", user.id);

  const docsByType: Record<string, DocState> = Object.fromEntries(
    (docs ?? []).map((d) => [d.doc_type, { status: d.status, linkUrl: d.link_url }]),
  );

  // Con puros borradores la identidad es 'not_submitted' pero el tutor SÍ tiene
  // trabajo guardado: se lo decimos para que no parezca que empieza de cero.
  const hasDrafts = (docs ?? []).some((d) => d.status === "draft");
  const pill = IDENTITY_PILL[tp.identity_verification_status];
  const note =
    tp.identity_verification_status === "not_submitted" && hasDrafts
      ? "Tienes borradores guardados. Envíalos a revisión cuando estén listos."
      : pill?.note;

  return (
    <TutorShell
      title="Verifica tu identidad"
      description="Sube los documentos requeridos. El onboarding forma parte de tu entrevista de ingreso."
    >
      {pill ? (
        <PanelCard className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#19191f]">
              Estado de tu verificación
            </p>
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">{note}</p>
          </div>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </PanelCard>
      ) : null}

      <VerificationForm
        userId={user.id}
        docsByType={docsByType}
        socials={parseSocials(tp.socials)}
      />
    </TutorShell>
  );
}
