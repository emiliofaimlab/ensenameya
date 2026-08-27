"use client";

import { useEffect, useRef, useState } from "react";
import {
  FileTextIcon,
  ImageIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import {
  MATERIAL_HINT,
  MATERIAL_MAX_BYTES,
  MATERIAL_TYPES,
  PRODUCT_IMAGE_HINT,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_TYPES,
  fileProblem,
  humanSize,
} from "./upload-formats";

/** Material ya guardado en `tutor_materials` (solo existe al editar). */
export type SavedMaterial = {
  id: string;
  file_name: string;
  size_bytes: number;
  /** Ruta en el bucket: hace falta para borrar el objeto, no solo la fila. */
  storage_path: string;
};

/**
 * Archivo elegido y aún NO subido. La `key` es de React, no de la BD: dos
 * archivos pueden llamarse igual y el índice del array se desordena al quitar
 * uno del medio.
 */
export type StagedFile = { key: string; file: File };

export const stage = (file: File): StagedFile => ({
  key: crypto.randomUUID(),
  file,
});

/** Píldora del archivo que está en memoria; la misma que usa la verificación. */
function SinGuardar() {
  return (
    <StatusPill tone="amber" className="h-6 shrink-0">
      Sin guardar
    </StatusPill>
  );
}

/**
 * Zona de subida compartida por portada y materiales (N-06): borde punteado,
 * clic o arrastre. El `<input type="file">` va oculto porque el control nativo
 * no se puede maquetar y cada navegador lo pinta a su manera — era justo la
 * diferencia entre la portada y el resto de campos del formulario.
 */
function DropZone({
  accept,
  multiple,
  disabled,
  icon,
  title,
  hint,
  onFiles,
}: {
  accept: string[];
  multiple?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept.join(",")}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Se vacía SIEMPRE: sin esto, volver a elegir el mismo archivo tras
          // quitarlo no dispara `change` y parece que el botón no funciona.
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled) return;
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) onFiles(multiple ? files : files.slice(0, 1));
        }}
        className={cn(
          "flex w-full flex-col items-center gap-1.5 rounded-[12px] border border-dashed border-[#d4d4d4] p-6 text-center transition-colors",
          disabled
            ? "cursor-not-allowed opacity-60"
            : "hover:border-brand hover:bg-brand-muted/40",
        )}
      >
        {icon}
        <span className="text-[13px] font-medium text-[#333333]">{title}</span>
        {/* N-07: los formatos se leen ANTES de elegir, no al fallar. */}
        <span className="text-xs text-[#6b6b6b]">{hint}</span>
      </button>
    </>
  );
}

/**
 * N-06 · portada de la mentoría.
 *
 * Antes era un `<input type="file">` a pelo dentro del `FormData` del submit,
 * el único control de archivo del proyecto que no se parecía a los demás. Ahora
 * el `File` vive en el estado del formulario y se sube al guardar, como los
 * materiales (N-05) y como la verificación del tutor.
 *
 * Y al editar se VE la que ya hay: antes solo ponía "ya tienes una", así que
 * para saber cuál había que abrir el catálogo en otra pestaña.
 */
export function CoverImagePicker({
  currentUrl,
  file,
  onPick,
  onClear,
  disabled,
}: {
  /** URL pública de la portada guardada (`storageUrl`), si la hay. */
  currentUrl: string | null;
  /** Portada nueva elegida en esta sesión, aún sin subir. */
  file: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const vivo = useRef<string | null>(null);
  const shown = preview ?? currentUrl;

  // Único efecto del componente, y solo para limpiar al desmontar. La vista
  // previa NO se deriva del render con un `useEffect`: el `blob:` nace de un
  // clic, así que se crea y se revoca en el propio manejador. Si se hiciera en
  // un efecto, cada "Elegir otra" dejaría el anterior vivo hasta recargar.
  useEffect(
    () => () => {
      if (vivo.current) URL.revokeObjectURL(vivo.current);
    },
    [],
  );

  function usar(file: File | null) {
    if (vivo.current) URL.revokeObjectURL(vivo.current);
    vivo.current = file ? URL.createObjectURL(file) : null;
    setPreview(vivo.current);
  }

  function pick(files: File[]) {
    const problema = fileProblem(files[0], {
      types: PRODUCT_IMAGE_TYPES,
      maxBytes: PRODUCT_IMAGE_MAX_BYTES,
      hint: PRODUCT_IMAGE_HINT,
    });
    if (problema) return toast.error(problema);
    usar(files[0]);
    onPick(files[0]);
  }

  function clear() {
    usar(null);
    onClear();
  }

  if (!shown) {
    return (
      <DropZone
        accept={PRODUCT_IMAGE_TYPES}
        disabled={disabled}
        icon={<ImageIcon className="size-6 text-muted-foreground" />}
        title="Arrastra la portada o haz clic para elegirla"
        hint={PRODUCT_IMAGE_HINT}
        onFiles={pick}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[12px] border border-[#e0e0e0] p-3.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- la vista previa
          es un `blob:` local: `next/image` no puede optimizar lo que aún no
          existe en ningún servidor. */}
      <img
        src={shown}
        alt={file ? "Portada que acabas de elegir" : "Portada actual"}
        className="size-20 shrink-0 rounded-[10px] object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[13px] font-medium text-[#333333]">
            {file ? file.name : "Portada actual"}
          </p>
          {file ? <SinGuardar /> : null}
        </div>
        <p className="text-xs text-[#6b6b6b]">
          {file ? `${humanSize(file.size)} · ` : ""}
          {PRODUCT_IMAGE_HINT}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <CoverPickButton
          disabled={disabled}
          label={file ? "Elegir otra" : "Reemplazar"}
          onPick={pick}
        />
        {/* Solo se descarta lo elegido ahora: la portada guardada se cambia
            subiendo otra, no se puede dejar la mentoría sin miniatura. */}
        {file ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={clear}
            className="h-9 rounded-[8px] px-3 text-[13px] text-[#6b6b6b]"
          >
            Descartar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Botón "Reemplazar" con su input oculto (mismo patrón que `DropZone`). */
function CoverPickButton({
  label,
  disabled,
  onPick,
}: {
  label: string;
  disabled?: boolean;
  onPick: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={PRODUCT_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onPick(files);
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
      >
        {label}
      </Button>
    </>
  );
}

/**
 * N-05 · materiales de la mentoría, adjuntables YA en el alta.
 *
 * Antes había que guardar la oferta y volver a editarla, porque el componente
 * subía al elegir y necesitaba un `product_id` que en el alta todavía no
 * existe. Aquí los archivos se quedan en memoria y los sube el formulario al
 * guardar, igual que hace la verificación del tutor con los documentos KYC.
 *
 * Los ya guardados (solo al editar) sí se borran en el acto: ahí el producto
 * existe y no hay nada que diferir.
 */
export function MaterialsPicker({
  saved,
  staged,
  onAdd,
  onRemoveStaged,
  onRemoveSaved,
  disabled,
}: {
  saved: SavedMaterial[];
  staged: StagedFile[];
  onAdd: (files: File[]) => void;
  onRemoveStaged: (key: string) => void;
  onRemoveSaved: (id: string) => void;
  disabled?: boolean;
}) {
  function add(files: File[]) {
    // Se filtra archivo a archivo en vez de rechazar la tanda entera: si
    // arrastra cinco y uno es un .zip, los otros cuatro sí valen.
    const validos: File[] = [];
    for (const f of files) {
      const problema = fileProblem(f, {
        types: MATERIAL_TYPES,
        maxBytes: MATERIAL_MAX_BYTES,
        hint: MATERIAL_HINT,
      });
      if (problema) toast.error(problema);
      else validos.push(f);
    }
    if (validos.length) onAdd(validos);
  }

  return (
    <div className="flex flex-col gap-3">
      <DropZone
        accept={MATERIAL_TYPES}
        multiple
        disabled={disabled}
        icon={<UploadCloudIcon className="size-6 text-muted-foreground" />}
        title="Arrastra tus archivos aquí o haz clic para elegirlos"
        hint={MATERIAL_HINT}
        onFiles={add}
      />

      {saved.length > 0 || staged.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {saved.map((m) => (
            <MaterialRow
              key={m.id}
              name={m.file_name}
              size={m.size_bytes}
              disabled={disabled}
              onRemove={() => onRemoveSaved(m.id)}
            />
          ))}
          {staged.map((s) => (
            <MaterialRow
              key={s.key}
              name={s.file.name}
              size={s.file.size}
              pending
              disabled={disabled}
              onRemove={() => onRemoveStaged(s.key)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MaterialRow({
  name,
  size,
  pending,
  disabled,
  onRemove,
}: {
  name: string;
  size: number;
  pending?: boolean;
  disabled?: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-[10px] bg-muted px-4 py-3">
      <FileTextIcon className="size-5 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-[#333333]">{name}</p>
        <p className="text-xs text-muted-foreground">{humanSize(size)}</p>
      </div>
      {pending ? <SinGuardar /> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Quitar ${name}`}
        className="shrink-0 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
      >
        <XIcon className="size-4" />
      </button>
    </li>
  );
}
