"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { SignOutDialog } from "@/components/layout/sign-out-dialog";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimezoneSelect } from "@/components/form/timezone-select";
import { AvatarUpload } from "@/components/onboarding/avatar-upload";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";

/**
 * US-104 (SCR-G03) — "Mi cuenta" en módulos (24-jul): foto, información
 * personal (nombre, correo, zona horaria), contraseña, rol tutor y sesión.
 * Todo por RLS (`profiles_update_own` / auth propio); nada privilegiado.
 */
export function AccountForm({
  userId,
  email,
  fullName,
  timezone,
  avatarUrl,
  isTutor,
}: {
  userId: string;
  email: string;
  fullName: string;
  timezone: string;
  avatarUrl: string | null;
  isTutor: boolean;
}) {
  const router = useRouter();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // La foto se guarda al instante: AvatarUpload sube al bucket y devuelve la
  // ruta; aquí se apunta `profiles.avatar_path` (no hay "submit" como en el
  // onboarding).
  async function onAvatarUploaded(path: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_path: path })
      .eq("id", userId);
    if (error) {
      toast.error("No se pudo guardar la foto.");
      return;
    }
    toast.success("Foto actualizada.");
    router.refresh();
  }

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingProfile(true);

    const form = new FormData(e.currentTarget);
    const full_name = String(form.get("full_name") ?? "").trim();
    const tz = String(form.get("timezone") ?? "UTC");

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: full_name || null, timezone: tz })
      .eq("id", userId); // RLS profiles_update_own ya limita a la fila propia.

    if (error) {
      toast.error("No se pudo guardar el perfil. Intenta de nuevo.");
      setSavingProfile(false);
      return;
    }
    toast.success("Perfil actualizado.");
    setSavingProfile(false);
    router.refresh();
  }

  async function savePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = e.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    if (password !== confirm) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }
    setSavingPassword(true);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error("No se pudo cambiar la contraseña. Intenta de nuevo.");
      setSavingPassword(false);
      return;
    }
    toast.success("Contraseña actualizada.");
    form.reset();
    setSavingPassword(false);
  }

  const [signOutOpen, setSignOutOpen] = useState(false);

  return (
    <>
      {/* Foto */}
      <PanelCard>
        <PanelCardTitle>Foto de perfil</PanelCardTitle>
        <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
          Se muestra en tu perfil y en tus reservas.
        </p>
        <div className="mt-4">
          <AvatarUpload
            userId={userId}
            initialUrl={avatarUrl}
            name={fullName}
            large
            onUploaded={onAvatarUploaded}
          />
        </div>
      </PanelCard>

      {/* Información personal */}
      <PanelCard>
        <PanelCardTitle>Información personal</PanelCardTitle>
        <form onSubmit={saveProfile} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="full_name">Nombre</Label>
            <Input
              id="full_name"
              name="full_name"
              defaultValue={fullName}
              autoComplete="name"
              placeholder="Tu nombre"
              className="h-[45px] rounded-[8px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              defaultValue={email}
              disabled
              className="h-[45px] rounded-[8px] opacity-70"
            />
            <p className="text-xs text-muted-foreground">
              El correo no se puede cambiar aquí.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="timezone">Zona horaria</Label>
            <TimezoneSelect name="timezone" defaultValue={timezone} />
            <p className="text-xs text-muted-foreground">
              Tus mentorías se muestran en esta hora local.
            </p>
          </div>
          <Button
            type="submit"
            disabled={savingProfile}
            className="h-[45px] self-start rounded-[8px] bg-brand px-5 hover:bg-brand/90"
          >
            {savingProfile ? "Guardando…" : "Guardar cambios"}
          </Button>
        </form>
      </PanelCard>

      {/* Contraseña */}
      <PanelCard>
        <PanelCardTitle>Contraseña</PanelCardTitle>
        <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
          Cambia tu contraseña cuando lo necesites.
        </p>
        <form onSubmit={savePassword} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="password">Nueva contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              className="h-[45px] rounded-[8px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm">Repite la contraseña</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              className="h-[45px] rounded-[8px]"
            />
          </div>
          <Button
            type="submit"
            disabled={savingPassword}
            className="h-[45px] self-start rounded-[8px] px-5"
          >
            {savingPassword ? "Guardando…" : "Cambiar contraseña"}
          </Button>
        </form>
      </PanelCard>

      {/* Rol tutor */}
      <PanelCard>
        <PanelCardTitle>Enseñar en Enséñame Ya</PanelCardTitle>
        <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
          {isTutor
            ? "Ya tienes el rol de tutor activo."
            : "Conviértete en tutor para empezar a ofrecer tus mentorías."}
        </p>
        {isTutor ? null : (
          <div className="mt-4">
            <Button
              asChild
              variant="outline"
              className="h-[45px] rounded-[8px] px-5"
            >
              <Link href="/tutor/onboarding">Quiero enseñar</Link>
            </Button>
          </div>
        )}
      </PanelCard>

      {/* Sesión */}
      <PanelCard>
        <PanelCardTitle>Sesión</PanelCardTitle>
        <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
          Cierra la sesión en este dispositivo.
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => setSignOutOpen(true)}
            className="h-[45px] rounded-[8px] px-5 text-[#bf3333]"
          >
            Cerrar sesión
          </Button>
        </div>
        <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
      </PanelCard>
    </>
  );
}
