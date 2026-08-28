"use client";

import { useState } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { AvatarUpload } from "@/components/onboarding/avatar-upload";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Foto pública y biografía del tutor, editables allí donde se están mirando.
 *
 * Nacieron como campos OBLIGATORIOS del paso 1 del asistente. Desde el 28-ago
 * son opcionales por petición del cliente ("la foto y la bio deben ser
 * OPCIONALES… y luego llenadas desde mi cuenta"), y poder posponerlas obliga a
 * que ese "luego" exista de verdad: es esto. El mismo bloque se monta en el
 * paso de repaso del asistente y en «Verificación» del panel, en vez del texto
 * que antes decía "vuelve al paso 1" —que además era el único sitio donde se
 * podían tocar—.
 *
 * ⚠️ Guarda AL MOMENTO, cada campo por su lado. Aquí no hay un «Continuar»
 * detrás que persista lo escrito: en el repaso del asistente «Finalizar» ya no
 * vuelve a pasar por `saveProfile`, y en el panel no hay ningún botón de paso.
 *
 * ⚠️ La foto es la del TUTOR (`tutor_profiles.avatar_path`), independiente de la
 * personal de `profiles` que se edita en «Mi cuenta» (R24-23). De ahí el
 * `fileBase="tutor-avatar"`: escribir sobre `avatar.*` pisaría la otra.
 */
export function TutorProfileBasics({
  userId,
  avatarUrl,
  fullName,
  bio: bio0,
  onChange,
}: {
  userId: string;
  /** URL pública ya resuelta (`storageUrl`), o `null` si aún no hay foto. */
  avatarUrl: string | null;
  /** Solo para las iniciales del hueco sin foto. */
  fullName: string;
  bio: string;
  /**
   * El asistente lleva su propia copia de los dos valores —los usa el checklist
   * y la pantalla de cierre—, así que sin este aviso su repaso seguiría
   * diciendo «falta» justo después de rellenarlo aquí. En el panel no hace
   * falta: la página se vuelve a pedir.
   */
  onChange?: (patch: { avatarPath?: string; bio?: string }) => void;
}) {
  const [bio, setBio] = useState(bio0);
  // Lo último que sabemos que está en la BD; la diferencia es lo que queda por
  // guardar (y lo que habilita el botón).
  const [guardada, setGuardada] = useState(bio0.trim());
  const [busy, setBusy] = useState(false);

  const supabase = createClient();

  /** La subida al bucket ya la hizo `AvatarUpload`; falta apuntar la ruta. */
  async function guardarFoto(path: string) {
    const { error } = await supabase
      .from("tutor_profiles")
      .update({ avatar_path: path })
      .eq("profile_id", userId);
    if (error) {
      toast.error("La foto se subió, pero no se pudo guardar en tu perfil.");
      return;
    }
    onChange?.({ avatarPath: path });
  }

  async function guardarBio() {
    setBusy(true);
    const texto = bio.trim();
    const { error } = await supabase
      .from("tutor_profiles")
      .update({ bio: texto || null })
      .eq("profile_id", userId);
    setBusy(false);
    if (error) {
      toast.error("No se pudo guardar tu biografía.");
      return;
    }
    setBio(texto);
    setGuardada(texto);
    onChange?.({ bio: texto });
    toast.success("Biografía guardada.");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label className="text-[12.5px] font-normal text-[#6b6b6b]">
          Foto de perfil
        </Label>
        <AvatarUpload
          userId={userId}
          initialUrl={avatarUrl}
          onUploaded={(path) => void guardarFoto(path)}
          name={fullName}
          large
          fileBase="tutor-avatar"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tutor-bio" className="text-[12.5px] font-normal text-[#6b6b6b]">
          Biografía
        </Label>
        <Textarea
          id="tutor-bio"
          rows={4}
          value={bio}
          disabled={busy}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Resume tu experiencia y el resultado que ayudas a lograr…"
          className="rounded-[8px] px-3.5 placeholder:text-[#8c8c8c]"
        />
        {/* Botón explícito y no guardado al perder el foco: el resto de la
            pantalla ya guarda al pulsar, y un texto largo que se salva solo
            deja al tutor sin saber si lo hizo. */}
        <Button
          type="button"
          variant="outline"
          disabled={busy || bio.trim() === guardada}
          onClick={guardarBio}
          className="h-10 w-fit rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
        >
          {busy
            ? "Guardando…"
            : bio.trim() === guardada
              ? "Biografía guardada"
              : "Guardar biografía"}
        </Button>
      </div>
    </div>
  );
}
