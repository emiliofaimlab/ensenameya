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
import {
  AUTH_FIELD,
  AUTH_LABEL,
  AUTH_SUBMIT,
} from "@/components/auth/field-classes";

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
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accepted) {
      toast.error("Debes aceptar los términos para continuar.");
      return;
    }
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const fullName = String(form.get("full_name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          // El trigger handle_new_user copia full_name a profiles.
          full_name: fullName,
          // El rol real lo asigna el trigger (=alumno); la intención (S-37)
          // se guarda para el onboarding por rol (AL01 / TU01).
          intended_role: intent,
          // S-18: lo persiste `handle_new_user` al crear el perfil — también
          // cuando el alta espera confirmación por correo y aquí no hay sesión.
          referral_code: referralCode,
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
      // US-201: onboarding obligatorio tras registrarse; conserva el destino previo.
      // Quien se registra para ENSEÑAR va directo a su asistente: el de alumno
      // le pediría nombre y foto y luego el de tutor volvería a pedirle nombre,
      // zona horaria y teléfono. El de tutor recoge los básicos igual, así que
      // pasar por los dos era pura repetición.
      const destino = intent === "tutor" ? "/tutor/onboarding" : "/onboarding";
      router.push(`${destino}${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      router.refresh();
      return;
    }

    // Cloud con confirmación de correo activa: no hay sesión todavía.
    toast.success("Te enviamos un correo para confirmar tu cuenta.");
    router.push("/login");
  }

  return (
    <div className="flex flex-col gap-5">
      {/* El selector va antes de Google: aplica a los dos caminos de alta. */}
      <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-accent p-1">
        {intentOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setIntent(opt.value)}
            aria-pressed={intent === opt.value}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              intent === opt.value
                ? "bg-card font-semibold text-foreground shadow-sm"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <GoogleButton
        next={next}
        intent={intent}
        referralCode={referralCode}
        label="Registrarme con Google"
        className={`${AUTH_FIELD} font-medium`}
      />
      <AuthDivider />

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label
            htmlFor="full_name"
            className={AUTH_LABEL}
          >
            Nombre
          </Label>
          <Input
            id="full_name"
            name="full_name"
            autoComplete="name"
            required
            placeholder="Tu nombre"
            className={AUTH_FIELD}
          />
        </div>
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
              autoComplete="new-password"
              required
              minLength={6}
              placeholder="Crea una contraseña"
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
        </div>

        <label className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 size-[18px] rounded-[5px] border-input accent-primary"
          />
          <span>
            Acepto los{" "}
            <Link href="/terms" className="text-brand hover:underline">
              Términos
            </Link>{" "}
            y la{" "}
            <Link href="/privacy" className="text-brand hover:underline">
              Política de privacidad
            </Link>
            .
          </span>
        </label>

        <Button
          type="submit"
          disabled={loading}
          className={AUTH_SUBMIT}
        >
          {loading ? "Creando cuenta…" : "Crear cuenta"}
        </Button>
      </form>
    </div>
  );
}
