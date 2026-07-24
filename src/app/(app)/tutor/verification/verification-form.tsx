"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileTextIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type DocStatus = "pending" | "approved" | "rejected";

/**
 * C-14 — set final confirmado por el cliente (UX-203 / EY-100): 6 documentos
 * de archivo + redes como ENLACE (tarjeta aparte, 190:98). `social_media`
 * viaja por `link_url`, no por Storage.
 * Ampliar o reordenar el set = tocar esta lista. La BD (`doc_type` es texto) y
 * la pantalla de revisión del admin son genéricas y no se enteran.
 */
const KYC_DOCS = [
  { type: "id_document", label: "Documento de identidad", hint: "Cédula o pasaporte · PDF/JPG, máx 10 MB" },
  { type: "degree", label: "Título académico", hint: "PDF, máx 10 MB" },
  { type: "certificate", label: "Certificado", hint: "PDF, máx 10 MB" },
  { type: "diploma", label: "Diploma", hint: "PDF/JPG, máx 10 MB" },
  { type: "transcript", label: "Corte de notas (transcript)", hint: "PDF, máx 10 MB" },
  { type: "cv", label: "Currículum vitae", hint: "PDF, máx 10 MB" },
] as const;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (S-42)
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export type DocState = { status: DocStatus; linkUrl: string | null };

/** Píldoras del Figma (190:23/37/65/93): color por estado del documento. */
const DOC_PILL: Record<DocStatus | "none", { label: string; tone: PillTone }> = {
  approved: { label: "Aprobado", tone: "green" },
  pending: { label: "En revisión", tone: "blue" },
  rejected: { label: "Rechazado", tone: "red" },
  none: { label: "Pendiente", tone: "neutral" },
};

/** Fila de documento del Figma (190:14): icono, nombre + hint, píldora, botón. */
function FileRow({
  userId,
  type,
  label,
  hint,
  status,
}: {
  userId: string;
  type: string;
  label: string;
  hint: string;
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

  const pill = DOC_PILL[status ?? "none"];
  // Figma: "Subir" azul sin doc, "Volver a subir" azul si rechazado,
  // "Reemplazar" outline en el resto.
  const action = !status
    ? { label: "Subir", solid: true }
    : status === "rejected"
      ? { label: "Volver a subir", solid: true }
      : { label: "Reemplazar", solid: false };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-[#666666]">
          <FileTextIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-[#333333]">
            {label}
          </p>
          <p className="text-xs text-[#6b6b6b]">{hint}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <StatusPill tone={pill.tone} className="h-7">
          {pill.label}
        </StatusPill>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          className="hidden"
          onChange={onFile}
        />
        <Button
          variant={action.solid ? "default" : "outline"}
          disabled={loading}
          onClick={() => inputRef.current?.click()}
          className={
            action.solid
              ? "h-10 rounded-[8px] bg-brand px-4 text-[13.5px] font-semibold hover:bg-brand/90"
              : "h-10 rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
          }
        >
          {loading ? "Subiendo…" : action.label}
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
    <div className="divide-y divide-[#e0e0e0]">
      {KYC_DOCS.map((d) => (
        <FileRow
          key={d.type}
          userId={userId}
          type={d.type}
          label={d.label}
          hint={d.hint}
          status={docsByType[d.type]?.status}
        />
      ))}
    </div>
  );
}

/** Redes sociales: enlace, no archivo (UX-203, tarjeta 190:98). */
export function SocialLinkCard({
  docsByType,
}: {
  docsByType: Record<string, DocState>;
}) {
  const router = useRouter();
  const doc = docsByType.social_media;
  const [value, setValue] = useState(doc?.linkUrl ?? "");
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
      p_doc_type: "social_media",
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

  const pill = DOC_PILL[doc?.status ?? "none"];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[#6b6b6b]">
          LinkedIn, Instagram u otra red donde se vea tu experiencia.
        </p>
        <StatusPill tone={pill.tone} className="h-7">
          {pill.label}
        </StatusPill>
      </div>
      <div className="flex gap-2">
        <Input
          type="url"
          inputMode="url"
          placeholder="https://linkedin.com/in/…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-[45px] rounded-[8px] bg-muted px-3.5 text-sm placeholder:text-[#8c8c8c]"
        />
        <Button
          variant="outline"
          disabled={loading}
          onClick={save}
          className="h-[45px] rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
        >
          {loading ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
