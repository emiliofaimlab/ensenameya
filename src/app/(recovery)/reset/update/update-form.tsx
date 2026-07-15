"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { pickHome, type AppRole } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function UpdatePasswordForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    if (password !== confirm) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error("El enlace expiró o no es válido. Solicita uno nuevo.");
      setLoading(false);
      return;
    }

    toast.success("Contraseña actualizada.");
    // Ya hay sesión válida: enruta por rol como el login.
    const { data } = await supabase.from("user_roles").select("role");
    const roles = (data ?? []).map((r) => r.role as AppRole);
    router.push(pickHome(roles));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Guardando…" : "Guardar contraseña"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        ¿El enlace no funciona?{" "}
        <Link href="/reset" className="text-foreground hover:underline">
          Pide uno nuevo
        </Link>
        .
      </p>
    </form>
  );
}
