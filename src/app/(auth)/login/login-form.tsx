"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { pickHome, safeNext, type AppRole } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/auth/google-button";
import { AuthDivider } from "@/components/auth/auth-divider";

export function LoginForm({
  next,
  oauthError,
}: {
  next: string | null;
  oauthError: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Mensaje genérico: no revelar si la cuenta existe (S-40).
      toast.error("Correo o contraseña incorrectos.");
      setLoading(false);
      return;
    }

    // Enruta por rol (RLS deja leer los roles propios). En M0 = alumno → /app.
    const { data } = await supabase.from("user_roles").select("role");
    const roles = (data ?? []).map((r) => r.role as AppRole);
    router.push(safeNext(next, pickHome(roles)));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <GoogleButton next={next} label="Continuar con Google" />
      <AuthDivider />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="tu@correo.com"
          />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Contraseña</Label>
            <Link
              href="/reset"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              ¿La olvidaste?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {oauthError ? (
          <p className="text-sm text-destructive">
            No se pudo completar el inicio con Google. Intenta de nuevo.
          </p>
        ) : null}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
