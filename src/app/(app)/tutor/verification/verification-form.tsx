"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileTextIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  MAX_SOCIALS,
  SOCIAL_PLATFORMS,
  type SocialLink,
} from "@/lib/socials";
import { PanelCard, StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type DocStatus = "pending" | "approved" | "rejected" | "draft";

/**
 * C-14 — set final confirmado por el cliente (UX-203 / EY-100): 6 documentos
 * de archivo. Las redes ya NO son un documento: viven en `tutor_profiles.socials`
 * como lista (R29-02), en la tarjeta de abajo.
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
  socials,
}: {
  userId: string;
  docsByType: Record<string, DocState>;
  /** R29-02: redes y portafolio ya guardados (`tutor_profiles.socials`). */
  socials: SocialLink[];
}) {
  const router = useRouter();
  const [staged, setStaged] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState<null | "draft" | "review">(null);
  // Siempre hay una fila en pantalla: la primera es la obligatoria.
  const [links, setLinks] = useState<SocialLink[]>(() =>
    socials.length > 0 ? socials : [{ platform: "", url: "" }],
  );

  const filled = links.filter((l) => l.platform || l.url.trim());
  const linksDirty =
    JSON.stringify(filled.map((l) => ({ ...l, url: l.url.trim() }))) !==
    JSON.stringify(socials);
  const stagedTypes = Object.keys(staged);
  const hasNew = stagedTypes.length > 0 || linksDirty;
  const hasDrafts = Object.values(docsByType).some((d) => d.status === "draft");

  /**
   * Filas completas y con URL válida, o `null` si alguna está a medias (con su
   * aviso ya mostrado). Una fila del todo vacía no estorba: se ignora.
   */
  function cleanLinks(): SocialLink[] | null {
    const out: SocialLink[] = [];
    for (const l of filled) {
      if (!l.platform) {
        toast.error("Elige la plataforma de cada enlace.");
        return null;
      }
      // ponytail: validación de forma con el parser del navegador, sin regex ni
      // dependencia. El contenido lo juzga el admin al revisar.
      let url: string;
      try {
        const u = new URL(l.url.trim());
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          toast.error("Los enlaces deben empezar por https://");
          return null;
        }
        url = u.toString();
      } catch {
        toast.error("Hay un enlace que no es una URL válida (incluye https://).");
        return null;
      }
      out.push({ platform: l.platform, url });
    }
    return out;
  }

  /** Sube y guarda lo pendiente. Devuelve false si algo falló (deja lo demás). */
  async function persist(draft: boolean): Promise<boolean> {
    const supabase = createClient();

    const cleaned = cleanLinks();
    if (!cleaned) return false;
    // La primera red es obligatoria para ENVIAR a revisión; el borrador puede
    // quedarse a medias (el módulo se completa poco a poco, R24-15).
    if (!draft && cleaned.length === 0) {
      toast.error("Añade al menos una red social o tu portafolio.");
      return false;
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

    if (linksDirty) {
      // Perfil de vitrina, no documento: va a `tutor_profiles` (column-grant de
      // `socials`), no por `submit_document`.
      const { error } = await supabase
        .from("tutor_profiles")
        .update({ socials: cleaned })
        .eq("profile_id", userId);
      if (error) {
        toast.error("No se pudieron guardar tus enlaces.");
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

  const setLink = (i: number, patch: Partial<SocialLink>) =>
    setLinks((prev) => prev.map((l, j) => (i === j ? { ...l, ...patch } : l)));

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

      {/* R29-02 — redes Y portafolio en UN módulo (190:98). Antes esto era un
          enlace suelto aquí y dos campos más en el paso 3 del asistente. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Redes sociales y portafolio
        </h2>
        <p className="mt-1 text-xs text-[#6b6b6b]">
          La primera es obligatoria para enviar tu perfil a revisión. Puedes
          añadir hasta {MAX_SOCIALS}; si tienes portafolio o web propia, elige
          «Sitio web / Portafolio» y pega el enlace que quieras.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {links.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Plataforma del enlace ${i + 1}`}
                value={l.platform}
                disabled={busy !== null}
                onChange={(e) => setLink(i, { platform: e.target.value })}
                className="h-[45px] w-full rounded-[8px] border border-input bg-muted px-3 text-sm text-[#333333] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-[190px]"
              >
                <option value="">Plataforma…</option>
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Input
                type="url"
                inputMode="url"
                aria-label={`Enlace ${i + 1}`}
                placeholder="https://…"
                value={l.url}
                disabled={busy !== null}
                onChange={(e) => setLink(i, { url: e.target.value })}
                className="h-[45px] min-w-0 flex-1 rounded-[8px] bg-muted px-3.5 text-sm placeholder:text-[#8c8c8c]"
              />
              {/* La fila 1 no se quita: siempre queda algo que rellenar. */}
              {i > 0 ? (
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() =>
                    setLinks((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="h-10 rounded-[8px] px-3 text-[13.5px] text-[#6b6b6b]"
                >
                  Quitar
                </Button>
              ) : null}
            </div>
          ))}
          {links.length < MAX_SOCIALS ? (
            <Button
              variant="outline"
              disabled={busy !== null}
              // El tope se comprueba sobre `prev`, no sobre el render: con el
              // guard solo en el JSX, dos clicks seguidos metían la fila 6.
              onClick={() =>
                setLinks((prev) =>
                  prev.length >= MAX_SOCIALS
                    ? prev
                    : [...prev, { platform: "", url: "" }],
                )
              }
              className="h-10 w-fit rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
            >
              Añadir otra
            </Button>
          ) : (
            <p className="text-xs text-[#6b6b6b]">
              Máximo {MAX_SOCIALS} enlaces.
            </p>
          )}
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
