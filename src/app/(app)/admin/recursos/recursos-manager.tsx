"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileTextIcon, LinkIcon, PlusIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SOCIAL_RESOURCE_HINT,
  SOCIAL_RESOURCE_MAX_BYTES,
  SOCIAL_RESOURCE_TYPES,
  fileProblem,
  humanSize,
} from "@/components/tutor/upload-formats";
import {
  AUDIENCIAS,
  BUCKET_RECURSOS,
  CATEGORIAS_SUGERIDAS,
  nombreSeguro,
  type Audiencia,
} from "@/lib/recursos-redes";

export type RecursoRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  kind: "file" | "link";
  filePath: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  externalUrl: string | null;
  audience: Audiencia;
  tierIds: string[];
  tutorIds: string[];
  isPublished: boolean;
  sortOrder: number;
  thumbUrl: string | null;
};

type Opcion = { id: string; name: string };
type TutorOpcion = Opcion & { approved: boolean };

type Draft = {
  id: string | null;
  title: string;
  description: string;
  category: string;
  kind: "file" | "link";
  externalUrl: string;
  /** Fichero NUEVO elegido en este modal (sustituye al que hubiera). */
  file: File | null;
  /** El que ya estaba guardado, para conservarlo o retirarlo. */
  currentFile: { path: string; name: string | null } | null;
  audience: Audiencia;
  tierIds: string[];
  tutorIds: string[];
  isPublished: boolean;
  sortOrder: string;
};

const EMPTY: Draft = {
  id: null,
  title: "",
  description: "",
  category: "",
  kind: "file",
  externalUrl: "",
  file: null,
  currentFile: null,
  audience: "approved",
  tierIds: [],
  tutorIds: [],
  isPublished: false,
  sortOrder: "0",
};

const SPEC = {
  types: SOCIAL_RESOURCE_TYPES,
  maxBytes: SOCIAL_RESOURCE_MAX_BYTES,
  hint: SOCIAL_RESOURCE_HINT,
};

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function RecursosManager({
  recursos,
  tiers,
  tutores,
}: {
  recursos: RecursoRow[];
  tiers: Opcion[];
  tutores: TutorOpcion[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buscar, setBuscar] = useState("");

  const editing = draft.id !== null;
  const tierName = useMemo(() => new Map(tiers.map((t) => [t.id, t.name])), [tiers]);

  const tutoresFiltrados = useMemo(() => {
    const q = buscar.trim().toLocaleLowerCase("es");
    return q ? tutores.filter((t) => t.name.toLocaleLowerCase("es").includes(q)) : tutores;
  }, [buscar, tutores]);

  function openNew() {
    setDraft(EMPTY);
    setBuscar("");
    setOpen(true);
  }

  function openEdit(r: RecursoRow) {
    setDraft({
      id: r.id,
      title: r.title,
      description: r.description ?? "",
      category: r.category ?? "",
      kind: r.kind,
      externalUrl: r.externalUrl ?? "",
      file: null,
      currentFile: r.filePath ? { path: r.filePath, name: r.fileName } : null,
      audience: r.audience,
      tierIds: r.tierIds,
      tutorIds: r.tutorIds,
      isPublished: r.isPublished,
      sortOrder: String(r.sortOrder),
    });
    setBuscar("");
    setOpen(true);
  }

  function audienciaResumen(r: RecursoRow): string {
    switch (r.audience) {
      case "all":
        return "Todos los tutores";
      case "approved":
        return "Tutores aprobados";
      case "tiers":
        return `Nivel: ${r.tierIds.map((id) => tierName.get(id) ?? "nivel borrado").join(", ")}`;
      case "tutors":
        return `${r.tutorIds.length} ${r.tutorIds.length === 1 ? "tutor concreto" : "tutores concretos"}`;
    }
  }

  async function save() {
    const title = draft.title.trim();
    if (!title) return void toast.error("El recurso necesita un título.");
    const orden = Number(draft.sortOrder || "0");
    if (!Number.isInteger(orden)) return void toast.error("El orden tiene que ser un número entero.");

    const url = draft.externalUrl.trim();
    if (draft.kind === "link" && !/^https:\/\/\S+$/i.test(url)) {
      return void toast.error("El enlace tiene que empezar por https://");
    }
    if (draft.kind === "file" && !draft.file && !draft.currentFile) {
      return void toast.error("Elige el archivo que verán los tutores.");
    }
    if (draft.audience === "tiers" && draft.tierIds.length === 0) {
      return void toast.error("Marca al menos un nivel.");
    }
    if (draft.audience === "tutors" && draft.tutorIds.length === 0) {
      return void toast.error("Elige al menos un tutor.");
    }

    setBusy(true);
    const supabase = createClient();
    // El id se fija aquí para que la carpeta del fichero sea la del recurso
    // también al crearlo.
    const id = draft.id ?? crypto.randomUUID();

    // ── 1 · El fichero, a Storage (si hay uno nuevo) ────────────────────────
    let fileFields: {
      file_path: string | null;
      file_name: string | null;
      mime_type: string | null;
      size_bytes: number | null;
    } = { file_path: null, file_name: null, mime_type: null, size_bytes: null };
    let subido: string | null = null;

    if (draft.kind === "file") {
      if (draft.file) {
        const path = `${id}/${crypto.randomUUID()}-${nombreSeguro(draft.file.name)}`;
        const { error } = await supabase.storage
          .from(BUCKET_RECURSOS)
          .upload(path, draft.file, { contentType: draft.file.type });
        if (error) {
          setBusy(false);
          return void toast.error(`No se pudo subir «${draft.file.name}»: ${error.message}`);
        }
        subido = path;
        fileFields = {
          file_path: path,
          file_name: draft.file.name,
          mime_type: draft.file.type,
          size_bytes: draft.file.size,
        };
      } else if (draft.currentFile) {
        // Se conserva el que había: no se tocan sus columnas.
        const original = recursos.find((r) => r.id === draft.id);
        fileFields = {
          file_path: draft.currentFile.path,
          file_name: original?.fileName ?? draft.currentFile.name,
          mime_type: original?.mimeType ?? null,
          size_bytes: original?.sizeBytes ?? null,
        };
      }
    }

    // ── 2 · La fila ──────────────────────────────────────────────────────────
    const values = {
      title,
      description: draft.description.trim() || null,
      category: draft.category.trim() || null,
      kind: draft.kind,
      ...fileFields,
      external_url: draft.kind === "link" ? url : null,
      audience: draft.audience,
      // Las listas que no tocan a la audiencia elegida se vacían: así la fila
      // dice una sola cosa y no queda una lista vieja «dormida».
      tier_ids: draft.audience === "tiers" ? draft.tierIds : [],
      tutor_ids: draft.audience === "tutors" ? draft.tutorIds : [],
      is_published: draft.isPublished,
      sort_order: orden,
    };

    const { error } = editing
      ? await supabase.from("social_resources").update(values).eq("id", id)
      : await supabase.from("social_resources").insert({ id, ...values });

    if (error) {
      // El fichero recién subido se quedaría huérfano: se retira (mejor esfuerzo).
      if (subido) await supabase.storage.from(BUCKET_RECURSOS).remove([subido]);
      setBusy(false);
      return void toast.error(error.message || "No se pudo guardar el recurso.");
    }

    // ── 3 · El fichero anterior, si se sustituyó o el recurso pasó a enlace ──
    const viejo = draft.currentFile?.path;
    if (viejo && viejo !== fileFields.file_path) {
      await supabase.storage.from(BUCKET_RECURSOS).remove([viejo]);
    }

    setBusy(false);
    toast.success(editing ? "Recurso actualizado." : "Recurso creado.");
    setOpen(false);
    setDraft(EMPTY);
    router.refresh();
  }

  async function setPublished(r: RecursoRow, value: boolean) {
    setBusy(true);
    const { error } = await createClient()
      .from("social_resources")
      .update({ is_published: value })
      .eq("id", r.id);
    setBusy(false);
    if (error) return void toast.error(error.message || "No se pudo cambiar el estado.");
    toast.success(value ? "Publicado: los tutores ya lo ven." : "Oculto: los tutores ya no lo ven.");
    router.refresh();
  }

  async function remove(r: RecursoRow) {
    if (!window.confirm(`¿Eliminar «${r.title}»? Los tutores dejarán de verlo.`)) return;
    setBusy(true);
    // Baja lógica (`deleted_at`): ver la cabecera de `20261013140000`.
    const { error } = await createClient()
      .from("social_resources")
      .update({ deleted_at: new Date().toISOString(), is_published: false })
      .eq("id", r.id);
    setBusy(false);
    if (error) return void toast.error(error.message || "No se pudo eliminar.");
    toast.success("Recurso eliminado.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-[#6b6b6b]">
          {recursos.length} {recursos.length === 1 ? "recurso" : "recursos"} ·{" "}
          {recursos.filter((r) => r.isPublished).length} publicados
        </p>
        <Button onClick={openNew} className="gap-1.5" disabled={busy}>
          <PlusIcon className="size-4" />
          Nuevo recurso
        </Button>
      </div>

      {recursos.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-[#e0e0e0] bg-card p-8 text-center text-[13px] text-[#6b6b6b]">
          Aún no hay recursos. Crea el primero: una imagen, un PDF o el enlace a
          una plantilla de Canva.
        </div>
      ) : (
        <div className="rounded-[16px] border border-[#e0e0e0] bg-card px-5 py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {recursos.map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4 sm:grid-cols-[56px_minmax(0,1fr)_auto]"
              >
                <div className="flex size-14 items-center justify-center overflow-hidden rounded-[10px] bg-[#f5f5f7]">
                  {r.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumbUrl} alt="" className="size-full object-cover" />
                  ) : r.kind === "link" ? (
                    <LinkIcon className="size-6 text-[#0080ff]" aria-hidden />
                  ) : (
                    <FileTextIcon className="size-6 text-[#fe6a00]" aria-hidden />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                    {r.title}
                    {r.category ? (
                      <span className="ml-2 rounded-full bg-[#fff0e5] px-2 py-0.5 text-[11px] font-semibold text-[#c2410c]">
                        {r.category}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-[#6b6b6b]">
                    {r.kind === "link"
                      ? r.externalUrl
                      : `${r.fileName ?? "Archivo"}${r.sizeBytes ? ` · ${humanSize(r.sizeBytes)}` : ""}`}
                  </p>
                  <p className="truncate text-xs text-[#6b6b6b]">
                    Orden {r.sortOrder} · {audienciaResumen(r)}
                  </p>
                </div>
                <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 sm:col-span-1">
                  <span
                    className={cn(
                      "inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold",
                      r.isPublished ? "bg-[#e3f7ea] text-[#1a7f3c]" : "bg-[#f0f0f0] text-[#595959]",
                    )}
                  >
                    {r.isPublished ? "Publicado" : "Oculto"}
                  </span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    className="h-9 rounded-[8px] px-3 text-[13px] text-[#595959]"
                    onClick={() => setPublished(r, !r.isPublished)}
                  >
                    {r.isPublished ? "Ocultar" : "Publicar"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    className="h-9 rounded-[8px] px-3 text-[13px] text-[#595959]"
                    onClick={() => openEdit(r)}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    className="h-9 rounded-[8px] px-3 text-[13px] text-[#b42318]"
                    onClick={() => remove(r)}
                  >
                    Eliminar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          if (!o) setDraft(EMPTY);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar «${draft.title || "recurso"}»` : "Nuevo recurso"}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-title">Título</Label>
            <Input
              id="rec-title"
              maxLength={120}
              value={draft.title}
              placeholder="Post de bienvenida"
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-desc">Descripción breve (opcional)</Label>
            <Textarea
              id="rec-desc"
              rows={2}
              maxLength={500}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-cat">Categoría (opcional)</Label>
              <Input
                id="rec-cat"
                list="rec-cat-sugerencias"
                maxLength={40}
                value={draft.category}
                placeholder="Post, Story, Banner…"
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              />
              <datalist id="rec-cat-sugerencias">
                {CATEGORIAS_SUGERIDAS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-orden">Orden</Label>
              <Input
                id="rec-orden"
                type="number"
                step={1}
                value={draft.sortOrder}
                onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Menor = sale antes en la galería.</p>
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Tipo</legend>
            <div className="flex gap-4 text-sm">
              {(
                [
                  ["file", "Archivo (imagen o PDF)"],
                  ["link", "Enlace externo (p. ej. Canva)"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="rec-kind"
                    checked={draft.kind === value}
                    onChange={() => setDraft((d) => ({ ...d, kind: value }))}
                  />
                  {label}
                </label>
              ))}
            </div>

            {draft.kind === "file" ? (
              <div className="flex flex-col gap-1.5">
                {draft.currentFile && !draft.file ? (
                  <p className="text-xs text-[#6b6b6b]">
                    Actual: {draft.currentFile.name ?? "archivo"}. Elige otro solo si quieres sustituirlo.
                  </p>
                ) : null}
                <Input
                  type="file"
                  accept={SOCIAL_RESOURCE_TYPES.join(",")}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f) {
                      const problema = fileProblem(f, SPEC);
                      if (problema) {
                        toast.error(problema);
                        e.target.value = "";
                        return;
                      }
                    }
                    setDraft((d) => ({ ...d, file: f }));
                  }}
                />
                <p className="text-xs text-muted-foreground">{SOCIAL_RESOURCE_HINT}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Input
                  type="url"
                  inputMode="url"
                  value={draft.externalUrl}
                  placeholder="https://www.canva.com/design/…"
                  onChange={(e) => setDraft((d) => ({ ...d, externalUrl: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Comprueba que el enlace se pueda abrir sin iniciar sesión con tu cuenta.
                </p>
              </div>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">¿Quién lo ve?</legend>
            {AUDIENCIAS.map((a) => (
              <label key={a.value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="rec-audience"
                  className="mt-1"
                  checked={draft.audience === a.value}
                  onChange={() => setDraft((d) => ({ ...d, audience: a.value }))}
                />
                <span>
                  {a.label}
                  <span className="block text-xs text-muted-foreground">{a.hint}</span>
                </span>
              </label>
            ))}

            {draft.audience === "tiers" ? (
              <div className="ml-6 flex flex-wrap gap-3 rounded-[10px] border border-[#e0e0e0] p-3">
                {tiers.length === 0 ? (
                  <p className="text-xs text-[#6b6b6b]">No hay niveles configurados.</p>
                ) : (
                  tiers.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.tierIds.includes(t.id)}
                        onChange={() => setDraft((d) => ({ ...d, tierIds: toggle(d.tierIds, t.id) }))}
                      />
                      {t.name}
                    </label>
                  ))
                )}
              </div>
            ) : null}

            {draft.audience === "tutors" ? (
              <div className="ml-6 flex flex-col gap-2 rounded-[10px] border border-[#e0e0e0] p-3">
                <Input
                  value={buscar}
                  placeholder="Buscar tutor por nombre"
                  onChange={(e) => setBuscar(e.target.value)}
                />
                <p className="text-xs text-[#6b6b6b]">
                  {draft.tutorIds.length} {draft.tutorIds.length === 1 ? "elegido" : "elegidos"}
                </p>
                <ul className="max-h-48 overflow-y-auto">
                  {tutoresFiltrados.map((t) => (
                    <li key={t.id}>
                      <label className="flex items-center gap-2 py-1 text-sm">
                        <input
                          type="checkbox"
                          checked={draft.tutorIds.includes(t.id)}
                          onChange={() =>
                            setDraft((d) => ({ ...d, tutorIds: toggle(d.tutorIds, t.id) }))
                          }
                        />
                        <span className="truncate">{t.name}</span>
                        {!t.approved ? (
                          <span className="text-xs text-[#8a8a93]">(pendiente)</span>
                        ) : null}
                      </label>
                    </li>
                  ))}
                  {tutoresFiltrados.length === 0 ? (
                    <li className="py-1 text-xs text-[#6b6b6b]">Ningún tutor coincide.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isPublished}
              onChange={(e) => setDraft((d) => ({ ...d, isPublished: e.target.checked }))}
            />
            Publicado (si no, queda oculto y solo lo ves tú)
          </label>

          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={busy} onClick={save}>
              {busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear recurso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
