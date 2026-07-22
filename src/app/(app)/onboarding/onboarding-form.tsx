"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/auth/roles";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimezoneSelect } from "@/components/form/timezone-select";
import { WizardShell, ChipGroup } from "@/components/onboarding/wizard";
import { AvatarUpload } from "@/components/onboarding/avatar-upload";

// E.164: '+' + 7–15 dígitos, el primero no cero (RN-44).
const E164 = /^\+[1-9]\d{6,14}$/;

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
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState(name0);
  const [avatar, setAvatar] = useState<string | null>(avatarPath);
  const [interests, setInterests] = useState<Set<string>>(
    new Set(selectedInterests),
  );
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
        return fail("Teléfono en formato internacional, p. ej. +584121234567.");
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
        title="Bienvenido a Enséñame Ya"
        description="Completa tu perfil para reservar tu primera clase."
        onNext={next_}
        busy={busy}
      >
        <div className="flex flex-col gap-6">
          <div className="grid gap-2">
            <Label htmlFor="full_name" className="text-[13px]">
              ¿Cómo te llamas?
            </Label>
            <Input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              placeholder="Ej: María Fernández"
            />
          </div>

          <div>
            <Label className="text-[13px]">Foto (opcional)</Label>
            <div className="mt-2">
              <AvatarUpload userId={userId} initialUrl={avatarUrl} onUploaded={setAvatar} />
            </div>
          </div>
        </div>
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
        <div>
          <Label className="text-[13px]">Intereses</Label>
          <div className="mt-2">
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
          </div>
        </div>
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
      <div className="flex flex-col gap-5">
        <div className="grid gap-2">
          <Label className="text-[13px]">Zona horaria</Label>
          <TimezoneSelect value={timezone} onChange={setTimezone} />
          <p className="text-xs text-muted-foreground">
            Tus clases se muestran en esta hora local.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="phone" className="text-[13px]">
            Teléfono
          </Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="+584121234567"
          />
          <p className="text-xs text-muted-foreground">
            Formato internacional (E.164), con código de país.
          </p>
        </div>
      </div>
    </WizardShell>
  );
}
