"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileTextIcon, UploadCloudIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB por archivo, como dice el Figma
const TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/msword",
  "application/vnd.ms-excel",
];

type Material = { id: string; file_name: string; size_bytes: number };

const humanSize = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

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
      if (!TYPES.includes(file.type)) {
        toast.error(`${file.name}: formato no admitido.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name}: supera los 10 MB.`);
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
        accept={TYPES.join(",")}
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
        <span className="text-xs text-muted-foreground">
          PDF, PPT, DOCX o XLSX · máx. 10 MB por archivo
        </span>
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
