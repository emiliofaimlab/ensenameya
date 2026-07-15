"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function TutorOnboardingForm({
  userId,
  exists,
  headline,
  bio,
  instagram,
  linkedin,
  youtube,
  website,
}: {
  userId: string;
  exists: boolean;
  headline: string;
  bio: string;
  instagram: string;
  linkedin: string;
  youtube: string;
  website: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
    const headlineVal = String(form.get("headline") ?? "").trim();
    if (!headlineVal) {
      toast.error("Escribe un titular para tu perfil.");
      return;
    }

    // Solo redes no vacías → jsonb limpio.
    const socials: Record<string, string> = {};
    for (const key of ["instagram", "linkedin", "youtube", "website"]) {
      const v = String(form.get(key) ?? "").trim();
      if (v) socials[key] = v;
    }

    setLoading(true);
    const supabase = createClient();
    const payload = {
      headline: headlineVal,
      bio: String(form.get("bio") ?? "").trim() || null,
      socials,
    };

    // approval_status/tier NO se tocan aquí (fuera del column-grant, US-1403):
    // nace/queda 'pending' hasta la aprobación del admin.
    const { error } = exists
      ? await supabase
          .from("tutor_profiles")
          .update(payload)
          .eq("profile_id", userId)
      : await supabase
          .from("tutor_profiles")
          .insert({ profile_id: userId, ...payload });

    if (error) {
      toast.error("No se pudo guardar tu perfil. Intenta de nuevo.");
      setLoading(false);
      return;
    }
    toast.success(
      exists ? "Perfil actualizado." : "Perfil enviado a revisión.",
    );
    setLoading(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="headline">Titular</Label>
        <Input
          id="headline"
          name="headline"
          defaultValue={headline}
          required
          maxLength={120}
          placeholder="Ej. Profesora de Matemáticas"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="bio">Biografía</Label>
        <Textarea
          id="bio"
          name="bio"
          defaultValue={bio}
          rows={4}
          placeholder="Cuenta tu experiencia y cómo ayudas a tus alumnos."
        />
      </div>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">Redes (opcional)</legend>
        <div className="grid gap-2">
          <Label htmlFor="instagram">Instagram</Label>
          <Input id="instagram" name="instagram" defaultValue={instagram} placeholder="https://instagram.com/…" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="linkedin">LinkedIn</Label>
          <Input id="linkedin" name="linkedin" defaultValue={linkedin} placeholder="https://linkedin.com/in/…" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="youtube">YouTube</Label>
          <Input id="youtube" name="youtube" defaultValue={youtube} placeholder="https://youtube.com/@…" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="website">Sitio web</Label>
          <Input id="website" name="website" defaultValue={website} placeholder="https://…" />
        </div>
      </fieldset>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Guardando…" : exists ? "Guardar cambios" : "Enviar a revisión"}
      </Button>
    </form>
  );
}
