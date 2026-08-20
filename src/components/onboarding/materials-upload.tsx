"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileTextIcon, UploadCloudIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
// MN-11a · Este paso del asistente y el formulario de mentoría suben al MISMO
// bucket (`tutor-materials`), así que comparten formatos, tope y frase: salen
// de la fuente única, que es también donde está apuntado qué hay que hacer en
// la BD si el número cambia (P-8).
import {
  MATERIAL_HINT,
  MATERIAL_MAX_BYTES,
  MATERIAL_TYPES,
  fileProblem,
  humanSize,
} from "@/components/tutor/upload-formats";

type Material = { id: string; file_name: string; size_bytes: number };

/**
 * TU01 paso 4 — materiales de clase. Van al bucket PRIVADO `tutor-materials`
 * (no confundir con `kyc-documents`: esto es material didáctico, no identidad).
 * La RLS de Storage exige que la carpeta sea el uid del tutor.
 */
export function MaterialsUpload({
  userId,
  initial,
  productId,
}: {
  userId: string;
  initial: Material[];
  /** Producto al que cuelgan (R24-16). Sin él, materiales sueltos del tutor. */
  productId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Material[]>(initial);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList) {
    setBusy(true);
    const supabase = createClient();

    for (const file of Array.from(files)) {
      // Archivo a archivo, no la tanda entera: si arrastra cinco y uno es un
      // .zip, los otros cuatro sí valen.
      const problema = fileProblem(file, {
        types: MATERIAL_TYPES,
        maxBytes: MATERIAL_MAX_BYTES,
        hint: MATERIAL_HINT,
      });
      if (problema) {
        toast.error(problema);
        continue;
      }

      // Prefijo aleatorio: dos archivos con el mismo nombre no se pisan.
      const path = `${userId}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("tutor-materials")
        .upload(path, file, { contentType: file.type });
      if (upErr) {
        toast.error(`No se pudo subir ${file.name}.`);
        continue;
      }

      const { data, error } = await supabase
        .from("tutor_materials")
        .insert({
          tutor_id: userId,
          product_id: productId ?? null,
          storage_path: path,
          file_name: file.name,
          size_bytes: file.size,
        })
        .select("id, file_name, size_bytes")
        .single();

      if (error || !data) {
        toast.error(`No se pudo registrar ${file.name}.`);
        continue;
      }
      setItems((prev) => [...prev, data]);
    }

    setBusy(false);
  }

  async function remove(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("tutor_materials")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("No se pudo eliminar.");
      return;
    }
    setItems((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={MATERIAL_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files);
        }}
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center transition-colors hover:border-brand hover:bg-brand-muted/40"
      >
        <UploadCloudIcon className="size-7 text-muted-foreground" />
        <span className="text-sm font-medium">
          {busy ? "Subiendo…" : "Arrastra tus archivos aquí o haz clic para subir"}
        </span>
        <span className="text-xs text-muted-foreground">{MATERIAL_HINT}</span>
      </button>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3"
            >
              <FileTextIcon className="size-5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {m.file_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {humanSize(m.size_bytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(m.id)}
                aria-label={`Quitar ${m.file_name}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <XIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
