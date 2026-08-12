"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/auth/roles";
import { Input } from "@/components/ui/input";
import {
  PhoneInput,
  countryFromTimezone,
} from "@/components/form/phone-input";
import { TimezoneSelect } from "@/components/form/timezone-select";
import {
  WizardShell,
  ChipGroup,
  Field,
  FIELD_CLASS,
} from "@/components/onboarding/wizard";
import { AvatarUpload } from "@/components/onboarding/avatar-upload";

// E.164: '+' + 7–15 dígitos, el primero no cero (RN-44).
const E164 = /^\+[1-9]\d{6,14}$/;

/** Objetivo del alumno (AL01 p2). Las seis las confirmó el cliente el 24-jul;
 *  las claves son las del check de `profiles.primary_goal`. */
const PRIMARY_GOALS = [
  { value: "reforzar_materia", label: "Reforzar o aprobar una materia" },
  { value: "examen_certificacion", label: "Prepararme para un examen o certificación" },
  { value: "habilidad_nueva", label: "Aprender una habilidad nueva" },
  { value: "trabajo_carrera", label: "Mejorar en mi trabajo o carrera" },
  { value: "practicar_idioma", label: "Practicar un idioma" },
  { value: "hobby_personal", label: "Interés o hobby personal" },
];

/**
 * US-201 / AL01 — asistente de 3 pasos del Figma. Nombre y teléfono siguen
 * siendo obligatorios (RN-44); la foto y los intereses son opcionales, como
 * dice el diseño. `onboarding_complete` se marca al terminar el paso 3, que es
 * lo que abre el resto de la app (gate en `requireUser`).
 */
export function OnboardingForm({
  userId,
  next,
  intendedRole,
  fullName: name0,
  timezone: tz0,
  phone: phone0,
  avatarPath,
  avatarUrl,
  categories,
  selectedInterests,
  primaryGoal,
}: {
  userId: string;
  next: string | null;
  intendedRole: string | null;
  fullName: string;
  timezone: string;
  phone: string;
  avatarPath: string | null;
  avatarUrl: string | null;
  categories: { id: string; label: string }[];
  selectedInterests: string[];
  primaryGoal: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState(name0);
  const [avatar, setAvatar] = useState<string | null>(avatarPath);
  const [interests, setInterests] = useState<Set<string>>(
    new Set(selectedInterests),
  );
  const [goal, setGoal] = useState(primaryGoal ?? "");
  // 'UTC' es el default de la BD → si no lo tocaron, proponemos la del navegador.
  const defaultTz = useMemo(
    () =>
      tz0 && tz0 !== "UTC"
        ? tz0
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
    [tz0],
  );
  const [timezone, setTimezone] = useState(defaultTz);
  const [phone, setPhone] = useState(phone0);
  // El prefijo sigue a la zona horaria mientras no haya número escrito; si ya
  // lo escribiste manda tu número. La librería no admite país controlado, así
  // que el cambio se aplica remontando el campo (`key`), que estando vacío no
  // pierde nada.
  const [country, setCountry] = useState(() => countryFromTimezone(defaultTz));
  function pickTimezone(tz: string) {
    setTimezone(tz);
    if (!phone.trim()) setCountry(countryFromTimezone(tz) ?? country);
  }

  const supabase = createClient();

  function fail(msg: string) {
    toast.error(msg);
    setBusy(false);
  }

  async function next_() {
    setBusy(true);

    if (step === 1) {
      if (!fullName.trim()) return fail("Escribe tu nombre.");
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim(), avatar_path: avatar })
        .eq("id", userId); // RLS profiles_update_own limita a la fila propia.
      if (error) return fail("No se pudo guardar tu nombre.");
    }

    if (step === 2) {
      // El objetivo va en `profiles` (decisión 30); vacío = "prefiero no
      // decirlo" y se guarda como nulo, que es lo que espera el check.
      const { error: goalError } = await supabase
        .from("profiles")
        .update({ primary_goal: goal || null })
        .eq("id", userId);
      if (goalError) return fail("No se pudo guardar tu objetivo.");

      // Reemplaza el conjunto entero: más simple que calcular el diff.
      await supabase.from("student_interests").delete().eq("student_id", userId);
      const rows = [...interests].map((category_id) => ({
        student_id: userId,
        category_id,
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from("student_interests").insert(rows);
        if (error) return fail("No se pudieron guardar tus intereses.");
      }
    }

    if (step === 3) {
      if (!E164.test(phone.trim())) {
        return fail("Escribe tu teléfono completo, sin el código de país.");
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          timezone,
          phone: phone.trim(),
          onboarding_complete: true,
        })
        .eq("id", userId);
      if (error) return fail("No se pudo guardar. Intenta de nuevo.");

      // Espeja el nombre en el metadata de Auth → header/saludo sin query extra.
      await supabase.auth.updateUser({ data: { full_name: fullName.trim() } });
      setBusy(false);

      // Intención "tutor" (S-37) → sigue al onboarding de tutor.
      router.push(
        intendedRole === "tutor" ? "/tutor/onboarding" : safeNext(next, "/app"),
      );
      router.refresh();
      return;
    }

    setBusy(false);
    setStep((s) => s + 1);
  }

  const back = () => setStep((s) => Math.max(1, s - 1));

  if (step === 1) {
    return (
      <WizardShell
        step={1}
        total={3}
        title="Te damos la bienvenida a Enséñame Ya"
        description="Completa tu perfil para reservar tu primera mentoría."
        onNext={next_}
        busy={busy}
      >
        <Field label="¿Cómo te llamas?" htmlFor="full_name">
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            placeholder="Ej: María Fernández"
            className={FIELD_CLASS}
          />
        </Field>

        <Field label="Foto (opcional)">
          <AvatarUpload
            userId={userId}
            initialUrl={avatarUrl}
            onUploaded={setAvatar}
            name={fullName}
          />
        </Field>
      </WizardShell>
    );
  }

  if (step === 2) {
    return (
      <WizardShell
        step={2}
        total={3}
        title="¿Qué quieres aprender?"
        description="Elige tus intereses para recomendarte mejores tutores."
        onBack={back}
        onNext={next_}
        busy={busy}
      >
        <Field label="Intereses">
          <ChipGroup
            ariaLabel="Tus intereses"
            options={categories}
            selected={interests}
            onToggle={(id) =>
              setInterests((prev) => {
                const n = new Set(prev);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
          />
        </Field>
        {/* "Tu objetivo principal" (149:36). La lista la confirmó el cliente el
            24-jul (decisión 30); el valor guardado es la clave, no la etiqueta. */}
        <Field label="Tu objetivo principal (opcional)" htmlFor="primary_goal">
          <select
            id="primary_goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">Prefiero no decirlo</option>
            {PRIMARY_GOALS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
      </WizardShell>
    );
  }

  return (
    <WizardShell
      step={3}
      total={3}
      title="Zona horaria y contacto"
      description="Usamos tu zona horaria para mostrarte los horarios correctos."
      onBack={back}
      onNext={next_}
      nextLabel="Empezar a explorar"
      busy={busy}
    >
      <Field
        label="Zona horaria"
        htmlFor="timezone"
        hint="Tus mentorías se muestran en esta hora local."
      >
        <TimezoneSelect
          value={timezone}
          onChange={pickTimezone}
          className={FIELD_CLASS}
        />
      </Field>

      {/* El Figma lo marca "(opcional)", pero RN-44 lo exige en E.164: manda la
          regla de negocio. Anotado para el cliente. */}
      <Field label="Teléfono" htmlFor="phone">
        <PhoneInput
    key={country}
    id="phone"
    value={phone}
    onChange={setPhone}
    defaultCountry={country}
  />
      </Field>
    </WizardShell>
  );
}
