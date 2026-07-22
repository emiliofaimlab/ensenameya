"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { pickHome, type AppRole } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AUTH_FIELD,
  AUTH_LABEL,
  AUTH_SUBMIT,
} from "@/components/auth/field-classes";

const LEVELS = ["baja", "media", "alta"] as const;

/**
 * Medidor orientativo de 3 tramos (AU03 estado 2). Es un aviso visual, no una
 * validación: la regla real es `minLength` + la política de Supabase Auth.
 * ponytail: sin test — si el rótulo se equivoca no rompe nada.
 */
function strength(password: string): { score: number; level: string } {
  const score = [
    password.length >= 8,
    /\d/.test(password),
    /[^a-zA-Z0-9]/.test(password) ||
      (/[a-z]/.test(password) && /[A-Z]/.test(password)),
  ].filter(Boolean).length;
  return { score, level: LEVELS[Math.max(score - 1, 0)] };
}

export function UpdatePasswordForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const { score, level } = strength(password);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
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
        <Label htmlFor="password" className={AUTH_LABEL}>
          Nueva contraseña
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={AUTH_FIELD}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm" className={AUTH_LABEL}>
          Confirmar contraseña
        </Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          className={AUTH_FIELD}
        />
      </div>

      {password ? (
        <div className="grid gap-1.5">
          <div className="flex gap-1.5" aria-hidden="true">
            {LEVELS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i < score ? "bg-brand" : "bg-border",
                )}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Seguridad: {level}
            {score < 3 ? " · usa 8+ caracteres con número" : null}
          </p>
        </div>
      ) : null}

      <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
        {loading ? "Guardando…" : "Guardar contraseña"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        ¿El enlace no funciona?{" "}
        <Link href="/reset" className="text-brand hover:underline">
          Pide uno nuevo
        </Link>
        .
      </p>
    </form>
  );
}
