import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import {
  PanelCard,
  PanelShell,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import { DocumentReview, TierPicker, TutorReview, type ReviewDoc } from "./review-actions";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Revisar tutor · Enséñame Ya" };

type Approval = Database["public"]["Enums"]["tutor_approval_status"];

/** Los enlaces al bucket privado caducan pronto: se ven, no se comparten (S-19). */
const SIGNED_URL_TTL = 300; // 5 min

const APPROVAL_PILL: Record<Approval, { label: string; tone: PillTone }> = {
  pending: { label: "Pendiente", tone: "amber" },
  approved: { label: "Aprobado", tone: "green" },
  rejected: { label: "Rechazado", tone: "red" },
  suspended: { label: "Suspendido", tone: "red" },
};

const APPROVAL_LABEL: Record<Approval, string> = {
  pending: "Pendiente de aprobación",
  approved: "Aprobado",
  rejected: "Rechazado",
  suspended: "Suspendido",
};

/**
 * US-1101 (SCR-AD05) — revisión de un tutor con el layout del Figma: perfil y
 * documentos KYC a la izquierda, acciones e historial a la derecha (214:51).
 * La lectura del bucket privado usa la sesión del admin; la escritura va por
 * RPC (`review_document`/`review_tutor`), nunca por PATCH.
 */
export default async function AdminTutorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;

  const supabase = await createClient();
  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select(
      "profile_id, headline, bio, socials, approval_status, identity_verification_status, approval_notes, tier_id, created_at, profiles(full_name, timezone, phone)",
    )
    .eq("profile_id", id)
    .maybeSingle();

  if (!tutor) notFound();

  // US-1103 / RN-06: el tier decide el split de sus próximas reservas.
  const { data: tierRows } = await supabase
    .from("tutor_tiers")
    .select("id, name, split_pct")
    .order("split_pct");

  const { data: docRows } = await supabase
    .from("verification_documents")
    .select("id, doc_type, storage_path, link_url, status, review_notes, created_at")
    .eq("tutor_id", id)
    // Los borradores del tutor no son cosa del admin: solo lo ENVIADO a
    // revisión entra en la cola (TU02).
    .neq("status", "draft")
    .order("doc_type");

  // Un enlace firmado por documento-archivo, en lote. `social_media` es un
  // enlace externo (link_url) y no pasa por Storage: firmarlo daría error.
  const paths = (docRows ?? [])
    .map((d) => d.storage_path)
    .filter((p): p is string => p !== null);
  const { data: signed } = paths.length
    ? await supabase.storage.from("kyc-documents").createSignedUrls(paths, SIGNED_URL_TTL)
    : { data: null };

  const urlByPath = new Map(
    (signed ?? []).map((s) => [s.path ?? "", s.signedUrl] as const),
  );

  const docs: ReviewDoc[] = (docRows ?? []).map((d) => ({
    id: d.id,
    docType: d.doc_type,
    status: d.status,
    reviewNotes: d.review_notes,
    url: d.link_url ?? (d.storage_path ? (urlByPath.get(d.storage_path) ?? null) : null),
    isExternal: d.link_url !== null,
  }));

  const pill = APPROVAL_PILL[tutor.approval_status];
  const socials = (tutor.socials ?? {}) as Record<string, string>;
  const socialLinks = Object.entries(socials).filter(([, v]) => Boolean(v));
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });

  return (
    <PanelShell
      items={ADMIN_ITEMS}
      back={{ href: "/admin/tutores", label: "Volver a tutores" }}
    >
      <div>
        <p className="text-xs text-[#6b6b6b]">Tutores / Detalle</p>
        <h1 className="mt-1 text-[24px] font-bold tracking-tight text-[#19191f]">
          {tutor.profiles?.full_name ?? "Tutor sin nombre"}
        </h1>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          {/* Perfil (214:53). */}
          <PanelCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#19191f]">Perfil</h2>
                {tutor.headline ? (
                  <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
                    {tutor.headline}
                  </p>
                ) : null}
              </div>
              <StatusPill tone={pill.tone} className="h-7">
                {pill.label}
              </StatusPill>
            </div>

            <hr className="my-4 border-[#e0e0e0]" />

            {tutor.bio ? (
              <div className="mb-4">
                <p className="text-xs text-[#6b6b6b]">Bio</p>
                <p className="mt-0.5 text-[13px] whitespace-pre-line text-[#4d4d4d]">
                  {tutor.bio}
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-x-10 gap-y-4">
              {tutor.profiles?.timezone ? (
                <div>
                  <p className="text-xs text-[#6b6b6b]">Zona horaria</p>
                  <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                    {tutor.profiles.timezone}
                  </p>
                </div>
              ) : null}
              {tutor.profiles?.phone ? (
                <div>
                  <p className="text-xs text-[#6b6b6b]">Teléfono</p>
                  <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                    {tutor.profiles.phone}
                  </p>
                </div>
              ) : null}
              {socialLinks.length ? (
                <div className="min-w-0">
                  <p className="text-xs text-[#6b6b6b]">Redes</p>
                  <p className="mt-0.5 text-[13px] font-medium break-all text-[#404040]">
                    {socialLinks.map(([, v]) => v).join(" · ")}
                  </p>
                </div>
              ) : null}
            </div>
          </PanelCard>

          {/* Documentos KYC — visor seguro (215:2). */}
          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f]">
              Documentos KYC (visor seguro)
            </h2>
            {docs.length === 0 ? (
              <p className="mt-4 text-[13px] text-[#6b6b6b]">
                El tutor todavía no ha subido documentos.
              </p>
            ) : (
              <div className="mt-2 flex flex-col divide-y divide-[#e0e0e0]">
                {docs.map((d) => (
                  <div key={d.id} className="py-3 first:pt-0 last:pb-0">
                    <DocumentReview doc={d} />
                  </div>
                ))}
              </div>
            )}
          </PanelCard>
        </div>

        <div className="flex flex-col gap-5">
          {/* Acciones de tutor (215:50). */}
          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f]">
              Acciones de tutor
            </h2>
            <div className="mt-4">
              <p className="text-xs text-[#6b6b6b]">Estado actual</p>
              <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                {APPROVAL_LABEL[tutor.approval_status]}
              </p>
            </div>
            <div className="mt-4">
              <TierPicker
                tutorId={tutor.profile_id}
                tierId={tutor.tier_id}
                tiers={(tierRows ?? []).map((t) => ({
                  id: t.id,
                  name: t.name,
                  splitPct: Number(t.split_pct),
                }))}
              />
            </div>
            <p className="mt-4 text-xs text-[#6b6b6b]">
              Aprobar tutor requiere identidad aprobada (RN-29). En cualquier
              resultado se notifica al tutor (NTF-03).
            </p>
            <div className="mt-4">
              <TutorReview
                tutorId={tutor.profile_id}
                approvalStatus={tutor.approval_status}
                identityStatus={tutor.identity_verification_status}
                approvalNotes={tutor.approval_notes}
              />
            </div>
          </PanelCard>

          {/* Historial (215:70): derivado de los timestamps reales. */}
          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f]">Historial</h2>
            {/* Orden inverso (24-jul): lo más reciente arriba —
                decisión → documentos → solicitud. */}
            <dl className="mt-2 divide-y divide-[#e0e0e0]">
              <div className="py-2.5 first:pt-0">
                <dt className="text-[13px] font-medium text-[#404040]">
                  {tutor.approval_status === "pending"
                    ? "Sin decisiones aún"
                    : `Decisión: ${APPROVAL_PILL[tutor.approval_status].label}`}
                </dt>
                <dd className="text-xs text-[#6b6b6b]">
                  {tutor.approval_status === "pending" ? "—" : ""}
                </dd>
              </div>
              <div className="py-2.5">
                <dt className="text-[13px] font-medium text-[#404040]">
                  Documentos subidos
                </dt>
                <dd className="text-xs text-[#6b6b6b]">
                  {docRows?.length
                    ? fmtDate(
                        [...docRows]
                          .map((d) => d.created_at)
                          .sort()
                          .at(-1)!,
                      )
                    : "—"}
                </dd>
              </div>
              <div className="py-2.5 last:pb-0">
                <dt className="text-[13px] font-medium text-[#404040]">
                  Solicitud enviada
                </dt>
                <dd className="text-xs text-[#6b6b6b]">
                  {fmtDate(tutor.created_at)}
                </dd>
              </div>
            </dl>
          </PanelCard>
        </div>
      </div>
    </PanelShell>
  );
}
