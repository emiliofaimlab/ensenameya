"use client";

import { useState } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { ChipGroup, Field, FIELD_CLASS } from "@/components/onboarding/wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/lib/database.types";

type TeachingLevel = Database["public"]["Enums"]["teaching_level"];

const LEVELS: { id: TeachingLevel; label: string }[] = [
  { id: "basico", label: "Básico" },
  { id: "intermedio", label: "Intermedio" },
  { id: "avanzado", label: "Avanzado" },
];

/**
 * EY-226 · Nombre público, titular, nivel y categorías, editables DESPUÉS del
 * asistente. El asistente se cierra con el perfil `approved` («Ya eres tutor»),
 * y hasta aquí solo la foto, la bio y las redes tenían un «luego» (esta misma
 * pantalla): el titular se quedaba congelado —«Estudiante de Ingeniería» para
 * siempre aunque el tutor se graduara—.
 *
 * Editar no devuelve el perfil a revisión: `approval_status` está fuera del
 * column-grant (US-1403), igual que en el asistente.
 */
export function TutorProfileFields({
  userId,
  displayName: name0,
  headline: headline0,
  level: level0,
  categories,
  selectedCategories,
}: {
  userId: string;
  displayName: string;
  headline: string;
  level: TeachingLevel | null;
  categories: { id: string; label: string }[];
  selectedCategories: string[];
}) {
  const [name, setName] = useState(name0);
  const [headline, setHeadline] = useState(headline0);
  const [level, setLevel] = useState(level0);
  const [cats, setCats] = useState(new Set(selectedCategories));
  const [busy, setBusy] = useState(false);

  async function guardar() {
    if (!name.trim()) return void toast.error("Escribe tu nombre.");
    if (!headline.trim()) return void toast.error("Escribe un titular para tu perfil.");
    if (cats.size === 0) return void toast.error("Elige al menos una categoría.");

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("tutor_profiles")
      .update({ display_name: name.trim(), headline: headline.trim(), teaching_level: level })
      .eq("profile_id", userId);
    // Reemplazo en bloque, como el asistente (paso 2).
    const catsError =
      error ??
      (await supabase.from("tutor_categories").delete().eq("tutor_id", userId)).error ??
      (
        await supabase
          .from("tutor_categories")
          .insert([...cats].map((category_id) => ({ tutor_id: userId, category_id })))
      ).error;
    setBusy(false);
    if (catsError) return void toast.error("No se pudo guardar tu perfil.");
    toast.success("Perfil guardado.");
  }

  return (
    <div className="flex flex-col gap-5">
      <Field label="Nombre público" htmlFor="tutor-name">
        <Input
          id="tutor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>
      <Field
        label="Titular"
        htmlFor="tutor-headline"
        hint="Con un « · » en medio se parte en dos: delante el titular, detrás una línea de apoyo de unos 40 caracteres."
      >
        <Input
          id="tutor-headline"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="Ej.: Ingeniero de software · 8 años enseñando Python"
          className={FIELD_CLASS}
        />
      </Field>
      <Field label="Nivel que enseñas">
        <ChipGroup
          ariaLabel="Nivel que enseñas"
          options={LEVELS}
          selected={new Set(level ? [level] : [])}
          onToggle={(id) => setLevel(level === id ? null : (id as TeachingLevel))}
        />
      </Field>
      <Field label="Categorías">
        <ChipGroup
          ariaLabel="Categorías"
          options={categories}
          selected={cats}
          onToggle={(id) =>
            setCats((prev) => {
              const next = new Set(prev);
              if (!next.delete(id)) next.add(id);
              return next;
            })
          }
        />
      </Field>
      <Button
        type="button"
        disabled={busy}
        onClick={guardar}
        className="h-10 w-fit rounded-[8px] bg-brand px-4 text-[13.5px] hover:bg-brand/90"
      >
        {busy ? "Guardando…" : "Guardar perfil"}
      </Button>
    </div>
  );
}
