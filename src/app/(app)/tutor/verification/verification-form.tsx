"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileTextIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { PanelCard, StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type DocStatus = "pending" | "approved" | "rejected" | "draft";

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
  draft: { label: "Borrador", tone: "neutral" },
  none: { label: "Pendiente", tone: "neutral" },
};
/** Archivo elegido pero aún sin subir (vive solo en memoria hasta el botón). */
const STAGED_PILL = { label: "Sin guardar", tone: "amber" as PillTone };

/** Fila de documento del Figma (190:14): icono, nombre + hint, píldora, botón. */
function FileRow({
  label,
  hint,
  status,
  stagedName,
  onPick,
  onClear,
  disabled,
}: {
  label: string;
  hint: string;
  status?: DocStatus;
  stagedName?: string;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
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
    onPick(file); // solo lo dejamos listo; sube al pulsar un botón de abajo
  }

  const pill = stagedName ? STAGED_PILL : DOC_PILL[status ?? "none"];
  // Un archivo elegido esta sesión manda sobre el estado guardado (aún sin
  // subir). Sin archivo elegido, el botón depende del estado en la BD.
  const pickLabel = stagedName
    ? "Cambiar"
    : !status
      ? "Seleccionar"
      : status === "rejected"
        ? "Volver a subir"
        : "Reemplazar";
  const solid = !stagedName && status === "rejected";

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
          <p className="truncate text-xs text-[#6b6b6b]">{stagedName ?? hint}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
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
        {stagedName ? (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={onClear}
            className="h-10 rounded-[8px] px-3 text-[13.5px] text-[#6b6b6b]"
          >
            Quitar
          </Button>
        ) : null}
        <Button
          variant={solid ? "default" : "outline"}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={
            solid
              ? "h-10 rounded-[8px] bg-brand px-4 text-[13.5px] font-semibold hover:bg-brand/90"
              : "h-10 rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
          }
        >
          {pickLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * TU02 — Verificación con subida DIFERIDA. Elegir un archivo solo lo deja listo
 * (en memoria); nada sube hasta pulsar un botón:
 *   · "Guardar borrador" → sube y guarda como `draft` (no llega al admin).
 *   · "Guardar y enviar a revisión" → sube y pasa TODO a `pending`.
 * Así el tutor completa su expediente poco a poco. Documentos y enlace de redes
 * comparten estado para que los dos botones actúen sobre todo a la vez.
 */
export function VerificationForm({
  userId,
  docsByType,
}: {
  userId: string;
  docsByType: Record<string, DocState>;
}) {
  const router = useRouter();
  const [staged, setStaged] = useState<Record<string, File>>({});
  const savedLink = docsByType.social_media?.linkUrl ?? "";
  const [link, setLink] = useState(savedLink);
  const [busy, setBusy] = useState<null | "draft" | "review">(null);

  const linkTrimmed = link.trim();
  const linkDirty = linkTrimmed !== "" && linkTrimmed !== savedLink;
  const stagedTypes = Object.keys(staged);
  const hasNew = stagedTypes.length > 0 || linkDirty;
  const hasDrafts = Object.values(docsByType).some((d) => d.status === "draft");

  function validLink(): string | null {
    // ponytail: validación de forma con el parser del navegador, sin regex ni
    // dependencia. El contenido lo juzga el admin al revisar.
    try {
      const u = new URL(linkTrimmed);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        toast.error("El enlace debe empezar por https://");
        return null;
      }
      return u.toString();
    } catch {
      toast.error("El enlace no es una URL válida (incluye https://).");
      return null;
    }
  }

  /** Sube y guarda lo pendiente. Devuelve false si algo falló (deja lo demás). */
  async function persist(draft: boolean): Promise<boolean> {
    const supabase = createClient();

    let parsedLink: string | null = null;
    if (linkDirty) {
      parsedLink = validLink();
      if (!parsedLink) return false;
    }

    const saved: string[] = [];
    for (const [type, file] of Object.entries(staged)) {
      const path = `${userId}/${type}`; // carpeta = uid → lo exige la RLS
      const up = await supabase.storage
        .from("kyc-documents")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) {
        toast.error("No se pudo subir un archivo. Intenta de nuevo.");
        break;
      }
      const { error } = await supabase.rpc("submit_document", {
        p_doc_type: type,
        p_storage_path: path,
        p_draft: draft,
      });
      if (error) {
        toast.error("No se pudo guardar un documento.");
        break;
      }
      saved.push(type);
    }
    // Quita del staging solo lo que sí se guardó (un fallo deja el resto listo).
    if (saved.length) {
      setStaged((prev) => {
        const next = { ...prev };
        saved.forEach((t) => delete next[t]);
        return next;
      });
    }
    if (saved.length !== stagedTypes.length) return false;

    if (parsedLink) {
      const { error } = await supabase.rpc("submit_document", {
        p_doc_type: "social_media",
        p_link_url: parsedLink,
        p_draft: draft,
      });
      if (error) {
        toast.error("No se pudo guardar el enlace.");
        return false;
      }
    }
    return true;
  }

  async function saveDraft() {
    setBusy("draft");
    const ok = await persist(true);
    setBusy(null);
    if (ok) {
      toast.success("Borrador guardado. Envíalo a revisión cuando esté listo.");
      router.refresh();
    }
  }

  async function submitReview() {
    setBusy("review");
    const ok = await persist(false);
    if (ok) {
      // Barre los borradores de sesiones anteriores que no se re-subieron ahora.
      const supabase = createClient();
      const { error } = await supabase.rpc("submit_documents_for_review");
      if (error) {
        setBusy(null);
        toast.error("No se pudo enviar a revisión.");
        return;
      }
    }
    setBusy(null);
    if (ok) {
      toast.success("Documentos enviados a revisión.");
      router.refresh();
    }
  }

  const linkPill = linkDirty ? STAGED_PILL : DOC_PILL[docsByType.social_media?.status ?? "none"];

  return (
    <>
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Documentos obligatorios
        </h2>
        <div className="mt-4 divide-y divide-[#e0e0e0]">
          {KYC_DOCS.map((d) => (
            <FileRow
              key={d.type}
              label={d.label}
              hint={d.hint}
              status={docsByType[d.type]?.status}
              stagedName={staged[d.type]?.name}
              onPick={(file) => setStaged((p) => ({ ...p, [d.type]: file }))}
              onClear={() =>
                setStaged((p) => {
                  const next = { ...p };
                  delete next[d.type];
                  return next;
                })
              }
              disabled={busy !== null}
            />
          ))}
        </div>
      </PanelCard>

      {/* 190:98 — las redes van en tarjeta aparte, como enlace, no archivo. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Redes sociales (enlace)
        </h2>
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[#6b6b6b]">
              LinkedIn, Instagram u otra red donde se vea tu experiencia.
            </p>
            <StatusPill tone={linkPill.tone} className="h-7">
              {linkPill.label}
            </StatusPill>
          </div>
          <Input
            type="url"
            inputMode="url"
            placeholder="https://linkedin.com/in/…"
            value={link}
            disabled={busy !== null}
            onChange={(e) => setLink(e.target.value)}
            className="h-[45px] rounded-[8px] bg-muted px-3.5 text-sm placeholder:text-[#8c8c8c]"
          />
        </div>
      </PanelCard>

      {/* El envío es en bloque (Figma: "Enviar a revisión / Guardar borrador"):
          nada llega al admin hasta "Guardar y enviar a revisión". */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="outline"
          disabled={busy !== null || !hasNew}
          onClick={saveDraft}
          className="h-[45px] rounded-[8px] px-5 text-[13.5px] text-[#4d4d4d]"
        >
          {busy === "draft" ? "Guardando…" : "Guardar borrador"}
        </Button>
        <Button
          disabled={busy !== null || !(hasNew || hasDrafts)}
          onClick={submitReview}
          className="h-[45px] rounded-[8px] bg-brand px-5 text-[13.5px] font-semibold hover:bg-brand/90"
        >
          {busy === "review" ? "Enviando…" : "Guardar y enviar a revisión"}
        </Button>
      </div>

      <p className="text-xs text-[#6b6b6b]">
        Formatos: PNG, JPG, WebP o PDF · máx. 10 MB. Tus documentos son privados;
        solo el equipo de revisión los ve. Elige tus archivos y guárdalos como
        borrador para seguir más tarde: nada llega a revisión hasta que pulses
        «Guardar y enviar a revisión».
      </p>
    </>
  );
}
