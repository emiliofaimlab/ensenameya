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
import {
  AUTH_FIELD,
  AUTH_LABEL,
  AUTH_SUBMIT,
} from "@/components/auth/field-classes";

export function LoginForm({
  next,
  oauthError,
}: {
  next: string | null;
  oauthError: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

    // Enruta por rol (RLS deja leer lo propio). Se pregunta también por el
    // perfil de tutor: el rol `tutor` solo llega con la aprobación, y quien
    // está en revisión debe entrar igualmente por su panel, no por el de
    // alumno. Las dos consultas van en paralelo, que son independientes.
    const [{ data: rolesData }, { data: tutorProfile }] = await Promise.all([
      supabase.from("user_roles").select("role"),
      supabase.from("tutor_profiles").select("profile_id").maybeSingle(),
    ]);
    const roles = (rolesData ?? []).map((r) => r.role as AppRole);
    router.push(
      safeNext(next, pickHome(roles, { esTutor: Boolean(tutorProfile) })),
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <GoogleButton
        next={next}
        label="Continuar con Google"
        className={`${AUTH_FIELD} font-medium`}
      />
      <AuthDivider />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="email" className={AUTH_LABEL}>
            Correo
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="tucorreo@ejemplo.com"
            className={AUTH_FIELD}
          />
        </div>
        <div className="grid gap-2">
          <Label
            htmlFor="password"
            className={AUTH_LABEL}
          >
            Contraseña
          </Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              placeholder="Tu contraseña"
              className={`${AUTH_FIELD} pr-20`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          <Link
            href="/reset"
            className="text-right text-[13px] font-medium text-brand hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        {oauthError ? (
          <p className="text-sm text-destructive">
            No se pudo completar el inicio con Google. Intenta de nuevo.
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={loading}
          className={AUTH_SUBMIT}
        >
          {loading ? "Entrando…" : "Iniciar sesión"}
        </Button>
      </form>
    </div>
  );
}
