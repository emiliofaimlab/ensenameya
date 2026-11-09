"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileTextIcon, Trash2Icon, UploadIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DOWNLOAD_HINT,
  DOWNLOAD_MAX_BYTES,
  DOWNLOAD_MAX_COUNT,
  DOWNLOAD_TYPES,
  fileProblem,
  humanSize,
} from "@/components/tutor/upload-formats";

export type Descargable = {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  size_bytes: number;
};

/**
 * EY-248 · Subir y retirar los PDFs del perfil público. El fichero va directo
 * del navegador al bucket privado `tutor-downloads` (la RLS exige la carpeta
 * `<uid>/`) y luego se inserta la fila; el tope de 4 lo impone el trigger.
 */
export function DescargablesManager({ userId, items }: { userId: string; items: Descargable[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const lleno = items.length >= DOWNLOAD_MAX_COUNT;

  function elegir(f: File | undefined) {
    if (!f) return;
    const problema = fileProblem(f, { types: DOWNLOAD_TYPES, maxBytes: DOWNLOAD_MAX_BYTES, hint: DOWNLOAD_HINT });
    if (problema) {
      toast.error(problema);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, "").slice(0, 80));
  }

  async function publicar(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const path = `${userId}/${crypto.randomUUID()}.pdf`;

    const { error: errorSubida } = await supabase.storage
      .from("tutor-downloads")
      .upload(path, file, { contentType: file.type });
    if (errorSubida) {
      toast.error("No se pudo subir el archivo.");
      setBusy(false);
      return;
    }

    const { error } = await supabase.from("tutor_downloads").insert({
      tutor_id: userId,
      title: title.trim(),
      description: description.trim() || null,
      file_path: path,
      file_name: file.name,
      size_bytes: file.size,
    });
    if (error) {
      // Sin fila el fichero queda huérfano: se quita para no ocupar sitio.
      await supabase.storage.from("tutor-downloads").remove([path]);
      toast.error(
        error.code === "23514"
          ? `Puedes tener como máximo ${DOWNLOAD_MAX_COUNT} documentos publicados.`
          : "No se pudo publicar el documento.",
      );
      setBusy(false);
      return;
    }

    toast.success("Documento publicado en tu perfil.");
    setFile(null);
    setTitle("");
    setDescription("");
    if (fileRef.current) fileRef.current.value = "";
    setBusy(false);
    router.refresh();
  }

  async function retirar(id: string) {
    if (!confirm("¿Retirar este documento de tu perfil? Los contactos que ya dejó se conservan.")) return;
    const { error } = await createClient()
      .from("tutor_downloads")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("No se pudo retirar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {items.length > 0 ? (
        <ul className="divide-y divide-[#f0f0f0] rounded-lg border border-[#ececec]">
          {items.map((d) => (
            <li key={d.id} className="flex items-center gap-3 p-3">
              <FileTextIcon className="size-5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#19191f]">{d.title}</p>
                <p className="truncate text-xs text-[#6b6b6b]">
                  {d.file_name} · {humanSize(d.size_bytes)}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Retirar ${d.title}`} onClick={() => retirar(d.id)}>
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {lleno ? (
        <p className="text-[13px] text-[#6b6b6b]">
          Ya tienes {DOWNLOAD_MAX_COUNT} documentos publicados. Retira uno para subir otro.
        </p>
      ) : (
        <form onSubmit={publicar} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="desc-file">Archivo</Label>
            <Input
              id="desc-file"
              ref={fileRef}
              type="file"
              accept={DOWNLOAD_TYPES.join(",")}
              onChange={(e) => elegir(e.target.files?.[0])}
            />
            <p className="text-xs text-[#6b6b6b]">{DOWNLOAD_HINT}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc-title">Título</Label>
            <Input id="desc-title" value={title} maxLength={80} required onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc-description">Descripción (opcional)</Label>
            <Input
              id="desc-description"
              value={description}
              maxLength={200}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || !file || !title.trim()}>
            <UploadIcon /> {busy ? "Publicando…" : "Publicar documento"}
          </Button>
        </form>
      )}
    </div>
  );
}
