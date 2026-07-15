"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export type DocStatus = "pending" | "approved" | "rejected";

/**
 * C-14 — set final confirmado por el cliente (UX-203 / EY-100): 7 documentos en
 * orden lógico. `social_media` es un ENLACE (input de texto), no un uploader;
 * viaja por `link_url`, no por Storage.
 * Ampliar o reordenar el set = tocar esta lista. La BD (`doc_type` es texto) y
 * la pantalla de revisión del admin son genéricas y no se enteran.
 */
const KYC_DOCS = [
  { type: "id_document", label: "Documento de identidad (cédula o pasaporte)", kind: "file" },
  { type: "degree", label: "Título académico", kind: "file" },
  { type: "certificate", label: "Certificado", kind: "file" },
  { type: "diploma", label: "Diploma", kind: "file" },
  { type: "transcript", label: "Expediente académico", kind: "file" },
  { type: "cv", label: "Currículum vitae", kind: "file" },
  { type: "social_media", label: "Redes sociales (enlace)", kind: "link" },
] as const;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (S-42)
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export type DocState = { status: DocStatus; linkUrl: string | null };

function badgeFor(status?: DocStatus) {
  switch (status) {
    case "approved":
      return { label: "Aprobado", variant: "default" as const };
    case "rejected":
      return { label: "Rechazado", variant: "destructive" as const };
    case "pending":
      return { label: "En revisión", variant: "secondary" as const };
    default:
      return { label: "Sin enviar", variant: "outline" as const };
  }
}

function StatusBadge({ status }: { status?: DocStatus }) {
  const b = badgeFor(status);
  return (
    <Badge variant={b.variant} className="mt-1">
      {b.label}
    </Badge>
  );
}

/** Documento de archivo: sube a Storage y registra la fila por RPC. */
function FileRow({
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

    // Vía RPC, no upsert: las column-grants no permiten UPDATE de `tutor_id`/
    // `doc_type` (US-1403), así que un upsert falla siempre. La RPC además
    // devuelve el documento a `pending` al re-subirlo (repostular).
    const db = await supabase.rpc("submit_document", {
      p_doc_type: type,
      p_storage_path: path,
    });
    if (db.error) {
      toast.error("No se pudo registrar el documento.");
      setLoading(false);
      return;
    }

    toast.success("Documento subido. Queda en revisión.");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <StatusBadge status={status} />
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

/** Redes sociales: enlace, no archivo (UX-203). No pasa por Storage. */
function LinkRow({
  type,
  label,
  status,
  linkUrl,
}: {
  type: string;
  label: string;
  status?: DocStatus;
  linkUrl: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(linkUrl ?? "");
  const [loading, setLoading] = useState(false);

  async function save() {
    const url = value.trim();
    if (!url) {
      toast.error("Escribe el enlace de tu perfil.");
      return;
    }
    // ponytail: validación de forma con el parser del navegador, sin regex ni
    // dependencia. El contenido lo juzga el admin al revisar.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      toast.error("El enlace no es una URL válida (incluye https://).");
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      toast.error("El enlace debe empezar por https://");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_document", {
      p_doc_type: type,
      p_link_url: parsed.toString(),
    });
    setLoading(false);

    if (error) {
      toast.error("No se pudo guardar el enlace.");
      return;
    }
    toast.success("Enlace guardado. Queda en revisión.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <StatusBadge status={status} />
      </div>
      <div className="flex gap-2">
        <Input
          type="url"
          inputMode="url"
          placeholder="https://instagram.com/tu_perfil"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button variant="outline" size="sm" disabled={loading} onClick={save}>
          {loading ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

export function VerificationForm({
  userId,
  docsByType,
}: {
  userId: string;
  docsByType: Record<string, DocState>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {KYC_DOCS.map((d) =>
        d.kind === "link" ? (
          <LinkRow
            key={d.type}
            type={d.type}
            label={d.label}
            status={docsByType[d.type]?.status}
            linkUrl={docsByType[d.type]?.linkUrl ?? null}
          />
        ) : (
          <FileRow
            key={d.type}
            userId={userId}
            type={d.type}
            label={d.label}
            status={docsByType[d.type]?.status}
          />
        ),
      )}
      <p className="text-xs text-muted-foreground">
        Formatos: PNG, JPG, WebP o PDF · máx. 10 MB. Tus documentos son privados;
        solo el equipo de revisión los ve.
      </p>
    </div>
  );
}
