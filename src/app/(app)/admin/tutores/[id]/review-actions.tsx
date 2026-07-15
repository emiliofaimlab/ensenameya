"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DOC_BADGE } from "../../badges";

type Approval = Database["public"]["Enums"]["tutor_approval_status"];
type Identity = Database["public"]["Enums"]["identity_verification_status"];
type DocStatus = Database["public"]["Enums"]["document_status"];

export type ReviewDoc = {
  id: string;
  docType: string;
  status: DocStatus;
  reviewNotes: string | null;
  url: string | null;
  isExternal: boolean;
};

// C-14: los tipos vienen de la BD (`doc_type` es texto). Este mapa solo traduce
// los que conocemos; uno nuevo se muestra con su propio identificador, sin
// romper la pantalla. Set final de 7 confirmado en UX-203 (EY-100).
const DOC_LABELS: Record<string, string> = {
  id_document: "Documento de identidad (cédula o pasaporte)",
  degree: "Título académico",
  certificate: "Certificado",
  diploma: "Diploma",
  transcript: "Expediente académico",
  cv: "Currículum vitae",
  social_media: "Redes sociales (enlace)",
};

/** Revisión de UN documento. La identidad la recalcula la RPC, no la UI. */
export function DocumentReview({ doc }: { doc: ReviewDoc }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(doc.reviewNotes ?? "");
  const badge = DOC_BADGE[doc.status];

  async function review(approve: boolean) {
    if (!approve && !notes.trim()) {
      toast.error("Indica el motivo del rechazo.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("review_document", {
      p_doc_id: doc.id,
      p_approve: approve,
      p_notes: notes.trim() || undefined,
    });
    setBusy(false);

    if (error) {
      toast.error(error.message || "No se pudo revisar el documento.");
      return;
    }
    toast.success(`Documento ${approve ? "aprobado" : "rechazado"}. Identidad: ${data}.`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {DOC_LABELS[doc.docType] ?? doc.docType}
          </p>
          <Badge variant={badge.variant} className="mt-1">
            {badge.label}
          </Badge>
        </div>
        {doc.url ? (
          <Button asChild variant="outline" size="sm">
            {/* Interno: enlace firmado y efímero al bucket privado.
                Externo (redes): URL que escribió el tutor — `noreferrer` evita
                filtrarle la ruta del panel admin. */}
            <a href={doc.url} target="_blank" rel="noreferrer">
              {doc.isExternal ? "Abrir enlace ↗" : "Ver documento"}
            </a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Enlace no disponible</span>
        )}
      </div>

      {doc.isExternal ? (
        <p className="break-all text-xs text-muted-foreground">
          Enlace externo aportado por el tutor: {doc.url}
        </p>
      ) : null}

      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Motivo (obligatorio al rechazar)"
        rows={2}
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => review(true)}>
          Aprobar
        </Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => review(false)}>
          Rechazar
        </Button>
      </div>
    </div>
  );
}

/** Aprobación del tutor (M1). RN-29: exige identidad aprobada — la BD lo fuerza. */
export function TutorReview({
  tutorId,
  approvalStatus,
  identityStatus,
  approvalNotes,
}: {
  tutorId: string;
  approvalStatus: Approval;
  identityStatus: Identity;
  approvalNotes: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(approvalNotes ?? "");

  const identityBlocks = identityStatus !== "approved";

  async function review(approve: boolean) {
    if (!approve && !reason.trim()) {
      toast.error("Indica el motivo del rechazo.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("review_tutor", {
      p_tutor_id: tutorId,
      p_approve: approve,
      p_reason: reason.trim() || undefined,
    });
    setBusy(false);

    if (error) {
      // La RPC rechaza aprobar sin identidad aprobada aunque se fuerce (RN-29).
      toast.error(error.message || "No se pudo revisar el tutor.");
      return;
    }
    toast.success(`Tutor ${data === "approved" ? "aprobado" : "rechazado"}.`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Decisión sobre el tutor</h2>
      <p className="text-sm text-muted-foreground">
        {identityBlocks
          ? "RN-29: para aprobar, la identidad debe estar aprobada (aprueba primero todos sus documentos)."
          : "Al aprobar, el tutor recibe el rol y puede publicar sus productos."}
      </p>

      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo (obligatorio al rechazar)"
        rows={2}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || identityBlocks || approvalStatus === "approved"}
          title={identityBlocks ? "La identidad debe estar aprobada (RN-29)" : undefined}
          onClick={() => review(true)}
        >
          Aprobar tutor
        </Button>
        <Button
          variant="destructive"
          disabled={busy || approvalStatus === "rejected"}
          onClick={() => review(false)}
        >
          Rechazar tutor
        </Button>
      </div>
    </div>
  );
}
