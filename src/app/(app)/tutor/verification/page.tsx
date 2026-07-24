import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { VerificationForm, SocialLinkCard, type DocState } from "./verification-form";

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
    note: "Aún no has subido documentos.",
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
    .select("identity_verification_status")
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

  const pill = IDENTITY_PILL[tp.identity_verification_status];

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
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">{pill.note}</p>
          </div>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </PanelCard>
      ) : null}

      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Documentos obligatorios
        </h2>
        <div className="mt-4">
          <VerificationForm userId={user.id} docsByType={docsByType} />
        </div>
      </PanelCard>

      {/* 190:98 — las redes van en tarjeta aparte, como enlace, no archivo. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Redes sociales (enlace)
        </h2>
        <div className="mt-4">
          <SocialLinkCard docsByType={docsByType} />
        </div>
      </PanelCard>

      {/* El Figma cierra con "Enviar a revisión / Guardar borrador": aquí no
          hay envío en bloque — cada documento queda en revisión al subirse. */}
      <p className="text-xs text-[#6b6b6b]">
        Formatos: PNG, JPG, WebP o PDF · máx. 10 MB. Tus documentos son privados;
        solo el equipo de revisión los ve. Cada documento queda en revisión al
        subirlo, no hace falta un paso extra.
      </p>
    </TutorShell>
  );
}
