"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PhoneInput } from "@/components/form/phone-input";
import { TimezoneSelect } from "@/components/form/timezone-select";
import {
  WizardShell,
  ChipGroup,
  Field,
  FIELD_CLASS,
} from "@/components/onboarding/wizard";
import { AvatarUpload } from "@/components/onboarding/avatar-upload";
import { MaterialsUpload } from "@/components/onboarding/materials-upload";
import { VerificationForm, type DocState } from "../verification/verification-form";
import type { Database } from "@/lib/database.types";

type TeachingLevel = Database["public"]["Enums"]["teaching_level"];

const LEVELS: { id: TeachingLevel; label: string }[] = [
  { id: "basico", label: "Básico" },
  { id: "intermedio", label: "Intermedio" },
  { id: "avanzado", label: "Avanzado" },
];

/**
 * US-202 / UX-202 (SCR-TU01) — asistente de 6 pasos: perfil, categorías,
 * contacto, materiales, **verificación de identidad** (penúltimo, 24-jul) y
 * primera oferta.
 *
 * Cada paso persiste al avanzar, así que "Guardar y salir" no necesita lógica
 * propia: lo escrito ya está guardado. `approval_status` NO se toca aquí (fuera
 * del column-grant, US-1403): el perfil nace y queda `pending`.
 */
export function TutorOnboardingForm({
  userId,
  exists,
  headline: headline0,
  bio: bio0,
  instagram: ig0,
  linkedin: li0,
  fullName,
  avatarPath,
  avatarUrl,
  timezone: tz0,
  phone: phone0,
  level: level0,
  categories,
  selectedCategories,
  materials,
  docsByType,
}: {
  userId: string;
  exists: boolean;
  headline: string;
  bio: string;
  instagram: string;
  linkedin: string;
  fullName: string;
  avatarPath: string | null;
  avatarUrl: string | null;
  timezone: string;
  phone: string;
  level: TeachingLevel | null;
  categories: { id: string; label: string }[];
  selectedCategories: string[];
  materials: { id: string; file_name: string; size_bytes: number }[];
  docsByType: Record<string, DocState>;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  // `exists` viene del server y no se entera del INSERT del paso 1: sin este
  // estado, el paso 2 reintenta insertar la misma fila y choca contra la PK.
  const [hasProfile, setHasProfile] = useState(exists);

  const [headline, setHeadline] = useState(headline0);
  const [bio, setBio] = useState(bio0);
  const [avatar, setAvatar] = useState<string | null>(avatarPath);
  const [cats, setCats] = useState<Set<string>>(new Set(selectedCategories));
  const [level, setLevel] = useState<TeachingLevel | null>(level0);
  const [timezone, setTimezone] = useState(tz0);
  const [phone, setPhone] = useState(phone0);
  const [instagram, setInstagram] = useState(ig0);
  const [linkedin, setLinkedin] = useState(li0);

  const supabase = createClient();

  /** Perfil de vitrina: se reescribe entero en cada paso que lo toca. */
  async function saveProfile() {
    const socials: Record<string, string> = {};
    if (instagram.trim()) socials.instagram = instagram.trim();
    if (linkedin.trim()) socials.linkedin = linkedin.trim();

    const payload = {
      headline: headline.trim(),
      bio: bio.trim() || null,
      socials,
      teaching_level: level,
      // Copia pública del nombre y la foto (DD-01): `profiles` no es visible
      // para anon, así que la tarjeta del catálogo lee estas dos columnas.
      display_name: fullName.trim() || null,
      avatar_path: avatar,
    };

    const { error } = hasProfile
      ? await supabase.from("tutor_profiles").update(payload).eq("profile_id", userId)
      : await supabase.from("tutor_profiles").insert({ profile_id: userId, ...payload });
    if (!error) setHasProfile(true);
    return error;
  }

  async function next() {
    setBusy(true);

    if (step === 1) {
      if (!headline.trim()) return fail("Escribe un titular para tu perfil.");
      if (!avatar) return fail("La foto de perfil es obligatoria.");
      if (!bio.trim()) return fail("Escribe tu biografía.");
      if (await saveProfile()) return fail("No se pudo guardar tu perfil.");
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_path: avatar })
        .eq("id", userId);
      if (error) return fail("No se pudo guardar la foto.");
    }

    if (step === 2) {
      if (cats.size === 0) return fail("Elige al menos una categoría.");
      if (await saveProfile()) return fail("No se pudo guardar.");
      // Reemplaza el conjunto entero: más simple que calcular el diff.
      await supabase.from("tutor_categories").delete().eq("tutor_id", userId);
      const rows = [...cats].map((category_id) => ({ tutor_id: userId, category_id }));
      const { error } = await supabase.from("tutor_categories").insert(rows);
      if (error) return fail("No se pudieron guardar las categorías.");
    }

    if (step === 3) {
      if (!phone.trim()) return fail("El teléfono es obligatorio (RN-44).");
      const { error } = await supabase
        .from("profiles")
        .update({ timezone, phone: phone.trim() })
        .eq("id", userId);
      if (error) return fail("No se pudo guardar tu contacto.");
      if (await saveProfile()) return fail("No se pudo guardar.");
    }

    setBusy(false);

    if (step === 6) {
      toast.success("¡Listo! Tu perfil pasó a revisión.");
      router.push("/tutor");
      router.refresh();
      return;
    }
    setStep((s) => s + 1);
  }

  function fail(msg: string) {
    toast.error(msg);
    setBusy(false);
  }

  const back = () => setStep((s) => Math.max(1, s - 1));
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  if (step === 1) {
    return (
      <WizardShell
        step={1}
        total={6}
        title="Crea tu perfil de tutor"
        description="Empecemos por lo básico. Esta info es parte de tu entrevista de ingreso."
        onNext={next}
        busy={busy}
      >
        <Field label="Foto de perfil (obligatoria)">
          <AvatarUpload
            userId={userId}
            initialUrl={avatarUrl}
            onUploaded={setAvatar}
            name={fullName}
            large
          />
        </Field>
        <Field label="Headline (obligatorio)" htmlFor="headline">
          <Input
            id="headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Ej: Profesora de inglés para entrevistas tech"
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Bio (obligatoria)" htmlFor="bio">
          <Textarea
            id="bio"
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Resume tu experiencia y el resultado que ayudas a lograr…"
            className="rounded-[8px] px-3.5 placeholder:text-[#8c8c8c]"
          />
        </Field>
      </WizardShell>
    );
  }

  if (step === 2) {
    return (
      <WizardShell
        step={2}
        total={6}
        title="¿Qué enseñas?"
        description="Elige al menos una categoría. Podrás ajustarlas luego."
        onBack={back}
        onNext={next}
        busy={busy}
      >
        <Field label="Categorías">
          <ChipGroup
            ariaLabel="Categorías que enseñas"
            options={categories}
            selected={cats}
            onToggle={(id) => setCats((p) => toggle(p, id))}
          />
        </Field>
        {/* El Figma lo pinta como select (186:44), no como chips. */}
        <Field label="Nivel principal" htmlFor="teaching_level">
          <select
            id="teaching_level"
            value={level ?? ""}
            onChange={(e) =>
              setLevel((e.target.value || null) as TeachingLevel | null)
            }
            className={cn(
              FIELD_CLASS,
              "w-full border border-input bg-transparent outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          >
            <option value="">Sin especificar</option>
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </WizardShell>
    );
  }

  if (step === 3) {
    return (
      <WizardShell
        step={3}
        total={6}
        title="Zona horaria y contacto"
        description="Usamos tu zona horaria para mostrar tus horarios correctamente (RN-44)."
        onBack={back}
        onNext={next}
        busy={busy}
      >
        <Field label="Zona horaria" htmlFor="timezone">
          <TimezoneSelect
            value={timezone}
            onChange={setTimezone}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Teléfono" htmlFor="phone">
          <PhoneInput id="phone" value={phone} onChange={setPhone} />
        </Field>
        <Field label="LinkedIn" htmlFor="linkedin">
          <Input
            id="linkedin"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="https://linkedin.com/in/…"
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Instagram / otra red (opcional)" htmlFor="instagram">
          <Input
            id="instagram"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
            placeholder="https://instagram.com/…"
            className={FIELD_CLASS}
          />
        </Field>
      </WizardShell>
    );
  }

  if (step === 4) {
    return (
      <WizardShell
        step={4}
        total={6}
        title="Sube tus materiales de clase"
        description="Comparte los archivos que usarás en tus sesiones. Podrás agregar más después."
        onBack={back}
        onNext={next}
        busy={busy}
      >
        <MaterialsUpload userId={userId} initial={materials} />
        <p className="mt-4 text-xs text-muted-foreground">
          Puedes agregar más materiales desde tu panel cuando quieras.
        </p>
      </WizardShell>
    );
  }

  // Penúltimo paso (24-jul): verificación de identidad reusando el módulo TU02
  // (con su borrador / "enviar a revisión"). El asistente solo lleva a la
  // siguiente pantalla; los documentos los guarda el propio módulo.
  if (step === 5) {
    return (
      <WizardShell
        step={5}
        total={6}
        title="Verifica tu identidad"
        description="Sube tus documentos con el mismo módulo de tu panel. Guárdalos como borrador y continúa; puedes terminar cuando quieras."
        onBack={back}
        onNext={next}
        busy={busy}
        bare
        maxWidth={760}
      >
        <VerificationForm userId={userId} docsByType={docsByType} />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      step={6}
      total={6}
      title="Tu primera oferta"
      description="Puedes crear tu primera mentoría ahora o hacerlo más tarde desde tu panel."
      onBack={back}
      onNext={next}
      nextLabel="Finalizar"
      busy={busy}
    >
      {/* 186:119 — texto, CTA azul a lo ancho y la nota de revisión. */}
      <p className="text-[13px] text-[#4d4d4d]">
        Crea una oferta con su resultado, precio y disponibilidad.
      </p>
      <Button
        asChild
        className="h-[45px] w-full rounded-[8px] bg-brand text-sm font-semibold hover:bg-brand/90"
      >
        <Link href="/tutor/products/new">Crear oferta ahora</Link>
      </Button>
      <p className="text-xs text-[#6b6b6b]">
        Al finalizar, tu perfil pasa a revisión.
      </p>
    </WizardShell>
  );
}
