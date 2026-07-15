import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { APPROVAL_BADGE, IDENTITY_BADGE } from "../../badges";
import { DocumentReview, TutorReview, type ReviewDoc } from "./review-actions";

export const metadata = { title: "Revisar tutor · Enséñame Ya" };

/** Los enlaces al bucket privado caducan pronto: se ven, no se comparten (S-19). */
const SIGNED_URL_TTL = 300; // 5 min

/**
 * US-1101 (SCR-AD05) — revisión de un tutor y sus documentos KYC.
 * La lectura del bucket privado usa la sesión del admin (`kyc_objects_select_admin`).
 * La escritura va por RPC (`review_document`/`review_tutor`), nunca por PATCH.
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
      "profile_id, headline, bio, socials, approval_status, identity_verification_status, approval_notes, profiles(full_name)",
    )
    .eq("profile_id", id)
    .maybeSingle();

  if (!tutor) notFound();

  const { data: docRows } = await supabase
    .from("verification_documents")
    .select("id, doc_type, storage_path, link_url, status, review_notes")
    .eq("tutor_id", id)
    .order("doc_type");

  // Un enlace firmado por documento-archivo, en lote. `social_media` es un
  // enlace externo (link_url) y no pasa por Storage: firmarlo daría error.
  // Si Storage falla, la fila se muestra igual sin enlace: el admin ve el
  // estado aunque no pueda abrirlo.
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
    // Externo → se abre tal cual y se avisa en la UI; interno → enlace firmado.
    url: d.link_url ?? (d.storage_path ? (urlByPath.get(d.storage_path) ?? null) : null),
    isExternal: d.link_url !== null,
  }));

  const approval = APPROVAL_BADGE[tutor.approval_status];
  const identity = IDENTITY_BADGE[tutor.identity_verification_status];
  const socials = (tutor.socials ?? {}) as Record<string, string>;
  const socialLinks = Object.entries(socials).filter(([, v]) => Boolean(v));

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title={tutor.profiles?.full_name ?? "Tutor sin nombre"}
          description={tutor.headline ?? "Sin titular"}
          actions={
            <Button asChild variant="outline">
              <Link href="/admin">Volver a la cola</Link>
            </Button>
          }
        />

        <div className="flex flex-wrap gap-2">
          <Badge variant={approval.variant}>{approval.label}</Badge>
          <Badge variant={identity.variant}>Identidad: {identity.label}</Badge>
        </div>

        {tutor.bio ? (
          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-medium">Bio</h2>
            <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
              {tutor.bio}
            </p>
          </div>
        ) : null}

        {socialLinks.length ? (
          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-medium">Redes</h2>
            <ul className="mt-1 flex flex-col gap-1">
              {socialLinks.map(([k, v]) => (
                <li key={k} className="text-sm">
                  <span className="text-muted-foreground">{k}: </span>
                  <span className="break-all">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">
            Documentos de identidad ({docs.length})
          </h2>
          {docs.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              El tutor todavía no ha subido documentos.
            </p>
          ) : (
            docs.map((d) => <DocumentReview key={d.id} doc={d} />)
          )}
        </div>

        <TutorReview
          tutorId={tutor.profile_id}
          approvalStatus={tutor.approval_status}
          identityStatus={tutor.identity_verification_status}
          approvalNotes={tutor.approval_notes}
        />
      </Section>
    </Container>
  );
}
