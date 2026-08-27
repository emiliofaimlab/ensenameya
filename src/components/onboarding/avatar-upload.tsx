"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { UserRoundIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { initialsFrom } from "@/lib/catalog/format";
import { Button } from "@/components/ui/button";
// MN-11a · El tope y los formatos del bucket `avatars` no se escriben aquí:
// salen de la fuente única, que es también donde está apuntado qué hay que
// hacer en la BD si el número cambia (P-8).
import {
  AVATAR_HINT,
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  fileProblem,
} from "@/components/tutor/upload-formats";

/**
 * Foto de perfil (AL01 p1 / TU01 p1). Sube al bucket público `avatars` en la
 * carpeta del propio usuario — la RLS de Storage exige que el primer segmento
 * sea su uid, así que la ruta no es decorativa.
 */
export function AvatarUpload({
  userId,
  initialUrl,
  onUploaded,
  name,
  large = false,
  fileBase = "avatar",
}: {
  userId: string;
  initialUrl: string | null;
  onUploaded: (path: string) => void;
  /** Sin foto se pintan las iniciales, como en el resto del sitio. */
  name?: string;
  /** TU01 (185:28) pinta la foto a 72 px; AL01 (180:1302) a 64. */
  large?: boolean;
  /** Nombre base del fichero. La foto de tutor usa uno propio ("tutor-avatar")
   *  para NO pisar la personal: son 100% independientes (R24-23). */
  fileBase?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    const problema = fileProblem(file, {
      types: AVATAR_TYPES,
      maxBytes: AVATAR_MAX_BYTES,
      hint: AVATAR_HINT,
    });
    if (problema) {
      toast.error(problema);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${userId}/${fileBase}.${ext}`;

    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (error) {
      toast.error("No se pudo subir la foto.");
      setBusy(false);
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    // Sufijo anti-caché: la ruta se reutiliza al reemplazar la foto.
    setUrl(`${data.publicUrl}?v=${Date.now()}`);
    onUploaded(path);
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-4">
      <span
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-lg font-semibold text-[#6b6b6b]",
          large ? "size-[72px]" : "size-16",
        )}
      >
        {url ? (
          <Image
            src={url}
            alt="Tu foto de perfil"
            width={large ? 72 : 64}
            height={large ? 72 : 64}
            className={cn("object-cover", large ? "size-[72px]" : "size-16")}
            unoptimized
          />
        ) : name?.trim() ? (
          initialsFrom(name)
        ) : (
          <UserRoundIcon className="size-7 text-muted-foreground" />
        )}
      </span>

      <div>
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="h-[42px] rounded-[8px] px-5 text-[13.5px] text-[#404040]"
        >
          {busy ? "Subiendo…" : url ? "Cambiar foto" : "Subir foto"}
        </Button>
        {/* La frase la genera la fuente única: decía "JPG o PNG" mientras el
            `accept` y el bucket admitían también WebP. */}
        <p className="mt-1.5 text-xs text-[#6b6b6b]">{AVATAR_HINT}</p>
      </div>
    </div>
  );
}
