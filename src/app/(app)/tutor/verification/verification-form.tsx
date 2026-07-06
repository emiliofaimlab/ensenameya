"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type DocStatus = "pending" | "approved" | "rejected";

// C-14: el set final de documentos puede ampliarse (CV, título, etc.) —
// solo se agregan entradas aquí; el mecanismo (Storage + tabla) no cambia.
const KYC_DOCS = [
  { type: "id_front", label: "Documento de identidad — frente" },
  { type: "id_back", label: "Documento de identidad — reverso" },
  { type: "selfie", label: "Selfie sosteniendo tu documento" },
] as const;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (S-42)
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

function badgeFor(status?: DocStatus) {
  switch (status) {
    case "approved":
      return { label: "Aprobado", variant: "default" as const };
    case "rejected":
      return { label: "Rechazado", variant: "destructive" as const };
    case "pending":
      return { label: "En revisión", variant: "secondary" as const };
    default:
      return { label: "Sin subir", variant: "outline" as const };
  }
}

function DocRow({
  userId,
  type,
  label,
  status,
}: {
  userId: string;
  type: string;
  label: string;
  status?: DocStatus;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-seleccionar el mismo archivo
    if (!file) return;

    if (!ACCEPT.includes(file.type)) {
      toast.error("Solo imágenes (PNG/JPG/WebP) o PDF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("El archivo supera 10 MB.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const path = `${userId}/${type}`; // carpeta = uid → lo exige la RLS de Storage

    const up = await supabase.storage
      .from("kyc-documents")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) {
      toast.error("No se pudo subir el archivo. Intenta de nuevo.");
      setLoading(false);
      return;
    }

    const db = await supabase
      .from("verification_documents")
      .upsert(
        { tutor_id: userId, doc_type: type, storage_path: path },
        { onConflict: "tutor_id,doc_type" },
      );
    if (db.error) {
      toast.error("No se pudo registrar el documento.");
      setLoading(false);
      return;
    }

    toast.success("Documento subido. Queda en revisión.");
    setLoading(false);
    router.refresh();
  }

  const b = badgeFor(status);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <Badge variant={b.variant} className="mt-1">
          {b.label}
        </Badge>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(",")}
        className="hidden"
        onChange={onFile}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
      >
        {loading ? "Subiendo…" : status ? "Reemplazar" : "Subir"}
      </Button>
    </div>
  );
}

export function VerificationForm({
  userId,
  statusByType,
}: {
  userId: string;
  statusByType: Record<string, DocStatus>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {KYC_DOCS.map((d) => (
        <DocRow
          key={d.type}
          userId={userId}
          type={d.type}
          label={d.label}
          status={statusByType[d.type]}
        />
      ))}
      <p className="text-xs text-muted-foreground">
        Formatos: PNG, JPG, WebP o PDF · máx. 10 MB. Tus documentos son privados;
        solo el equipo de revisión los ve.
      </p>
    </div>
  );
}
