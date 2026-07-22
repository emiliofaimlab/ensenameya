"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { UserRoundIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB, como dice el Figma
const TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Foto de perfil (AL01 p1 / TU01 p1). Sube al bucket público `avatars` en la
 * carpeta del propio usuario — la RLS de Storage exige que el primer segmento
 * sea su uid, así que la ruta no es decorativa.
 */
export function AvatarUpload({
  userId,
  initialUrl,
  onUploaded,
}: {
  userId: string;
  initialUrl: string | null;
  onUploaded: (path: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    if (!TYPES.includes(file.type)) {
      toast.error("Solo JPG, PNG o WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("La imagen supera los 5 MB.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${userId}/avatar.${ext}`;

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
      <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-muted">
        {url ? (
          <Image
            src={url}
            alt="Tu foto de perfil"
            width={80}
            height={80}
            className="size-20 object-cover"
            unoptimized
          />
        ) : (
          <UserRoundIcon className="size-8 text-muted-foreground" />
        )}
      </span>

      <div>
        <input
          ref={inputRef}
          type="file"
          accept={TYPES.join(",")}
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
        >
          {busy ? "Subiendo…" : url ? "Cambiar foto" : "Subir foto"}
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">
          JPG o PNG · máx 5 MB
        </p>
      </div>
    </div>
  );
}
