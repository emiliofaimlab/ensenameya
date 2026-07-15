"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimezoneSelect } from "@/components/form/timezone-select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function AccountForm({
  userId,
  email,
  fullName,
  timezone,
  isTutor,
}: {
  userId: string;
  email: string;
  fullName: string;
  timezone: string;
  isTutor: boolean;
}) {
  const router = useRouter();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

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

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Perfil */}
      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>
            Tu correo ({email}) no se puede cambiar aquí.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="full_name">Nombre</Label>
              <Input
                id="full_name"
                name="full_name"
                defaultValue={fullName}
                autoComplete="name"
                placeholder="Tu nombre"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timezone">Zona horaria</Label>
              <TimezoneSelect name="timezone" defaultValue={timezone} />
              <p className="text-xs text-muted-foreground">
                Tus clases se muestran en esta hora local.
              </p>
            </div>
            <Button
              type="submit"
              disabled={savingProfile}
              className="self-start"
            >
              {savingProfile ? "Guardando…" : "Guardar perfil"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Contraseña */}
      <Card>
        <CardHeader>
          <CardTitle>Contraseña</CardTitle>
          <CardDescription>
            Cambia tu contraseña. Deja estos campos vacíos si no quieres tocarla.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">Nueva contraseña</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm">Repite la contraseña</Label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
              />
            </div>
            <Button
              type="submit"
              disabled={savingPassword}
              className="self-start"
            >
              {savingPassword ? "Guardando…" : "Cambiar contraseña"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Rol tutor */}
      <Card>
        <CardHeader>
          <CardTitle>Enseñar en Enséñame Ya</CardTitle>
          <CardDescription>
            {isTutor
              ? "Ya tienes el rol de tutor activo."
              : "Completa el onboarding de tutor para empezar a ofrecer clases."}
          </CardDescription>
        </CardHeader>
        {isTutor ? null : (
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/tutor/onboarding">Quiero enseñar</Link>
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Sesión */}
      <Card>
        <CardHeader>
          <CardTitle>Sesión</CardTitle>
          <CardDescription>Cierra la sesión en este dispositivo.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={signOut}>
            Cerrar sesión
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
