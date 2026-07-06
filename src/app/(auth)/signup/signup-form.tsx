"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/auth/google-button";
import { AuthDivider } from "@/components/auth/auth-divider";

type Intent = "alumno" | "tutor";

const intentOptions: { value: Intent; label: string }[] = [
  { value: "alumno", label: "Quiero aprender" },
  { value: "tutor", label: "Quiero enseñar" },
];

export function SignupForm({
  next,
  referralCode,
}: {
  next: string | null;
  referralCode: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState<Intent>("alumno");
  const [accepted, setAccepted] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accepted) {
      toast.error("Debes aceptar los términos para continuar.");
      return;
    }
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          // El rol real lo asigna el trigger (=alumno); la intención (S-37)
          // se guarda para el onboarding por rol (AL01 / TU01).
          intended_role: intent,
          referral_code: referralCode, // S-18 (atribución; se persiste abajo)
        },
      },
    });

    if (error) {
      const msg = /registered|already/i.test(error.message)
        ? "Ese correo ya tiene una cuenta. Inicia sesión."
        : "No se pudo crear la cuenta. Revisa los datos e intenta de nuevo.";
      toast.error(msg);
      setLoading(false);
      return;
    }

    if (data.session) {
      // Sesión inmediata (sin confirmación por correo).
      if (referralCode && data.user) {
        // RLS profiles_update_own permite escribir el propio perfil.
        await supabase
          .from("profiles")
          .update({ referral_code: referralCode })
          .eq("id", data.user.id);
      }
      // US-201: onboarding obligatorio tras registrarse; conserva el destino previo.
      router.push(`/onboarding${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      router.refresh();
      return;
    }

    // Cloud con confirmación de correo activa: no hay sesión todavía.
    toast.success("Te enviamos un correo para confirmar tu cuenta.");
    router.push("/login");
  }

  return (
    <div className="flex flex-col gap-4">
      <GoogleButton next={next} label="Registrarme con Google" />
      <AuthDivider />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label>¿Cómo quieres empezar?</Label>
          <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
            {intentOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setIntent(opt.value)}
                aria-pressed={intent === opt.value}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  intent === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

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
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 size-4 rounded border-input accent-primary"
          />
          <span>
            Acepto los{" "}
            <Link href="/terms" className="text-foreground hover:underline">
              términos y condiciones
            </Link>
            .
          </span>
        </label>

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Creando cuenta…" : "Crear cuenta"}
        </Button>
      </form>
    </div>
  );
}
