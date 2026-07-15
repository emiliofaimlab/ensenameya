"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimezoneSelect } from "@/components/form/timezone-select";

// E.164: '+' + 7–15 dígitos, el primero no cero (RN-44).
const E164 = /^\+[1-9]\d{6,14}$/;

export function OnboardingForm({
  userId,
  next,
  intendedRole,
  fullName,
  timezone,
  phone,
}: {
  userId: string;
  next: string | null;
  intendedRole: string | null;
  fullName: string;
  timezone: string;
  phone: string;
}) {
  const router = useRouter();
  // 'UTC' es el default de la BD → si no lo tocaron, proponemos la zona del navegador.
  const defaultTz = useMemo(
    () =>
      timezone && timezone !== "UTC"
        ? timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
    [timezone],
  );
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
    const full_name = String(form.get("full_name") ?? "").trim();
    const tz = String(form.get("timezone") ?? "");
    const phoneVal = String(form.get("phone") ?? "").trim();

    if (!full_name) {
      toast.error("Escribe tu nombre.");
      return;
    }
    if (!E164.test(phoneVal)) {
      toast.error("Teléfono en formato internacional, p. ej. +584121234567.");
      return;
    }
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name,
        timezone: tz,
        phone: phoneVal,
        onboarding_complete: true,
      })
      .eq("id", userId); // RLS profiles_update_own limita a la fila propia.

    if (error) {
      toast.error("No se pudo guardar. Intenta de nuevo.");
      setLoading(false);
      return;
    }
    // Espeja el nombre en el metadata de Auth → header/saludo sin query extra.
    await supabase.auth.updateUser({ data: { full_name } });
    // Intención "tutor" (S-37) → sigue al onboarding de tutor; si no, su destino/panel.
    const dest =
      intendedRole === "tutor" ? "/tutor/onboarding" : safeNext(next, "/app");
    router.push(dest);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="full_name">Nombre</Label>
        <Input
          id="full_name"
          name="full_name"
          defaultValue={fullName}
          autoComplete="name"
          required
          placeholder="Tu nombre"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="timezone">Zona horaria</Label>
        <TimezoneSelect name="timezone" defaultValue={defaultTz} />
        <p className="text-xs text-muted-foreground">
          Tus clases se muestran en esta hora local.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="phone">Teléfono</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={phone}
          autoComplete="tel"
          required
          placeholder="+584121234567"
        />
        <p className="text-xs text-muted-foreground">
          Formato internacional (E.164), con código de país.
        </p>
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Guardando…" : "Continuar"}
      </Button>
    </form>
  );
}
