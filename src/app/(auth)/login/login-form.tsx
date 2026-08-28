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
import { FieldError } from "@/components/form/field-error";
import { describedBy, emailError, requiredError } from "@/components/form/validation";

/** Errores por campo (RV-14) + el del intento fallido, que no es de un campo. */
type Errores = Partial<Record<"email" | "password" | "form", string>>;

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
  const [errores, setErrores] = useState<Errores>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    // RV-14 · Mensajes propios bajo cada campo. Aquí NO se valida el largo de
    // la contraseña: las cuentas anteriores a RV-12 tienen 6 caracteres y
    // rechazarlas en el login las dejaría fuera de su propia cuenta.
    const fallos: Errores = {
      email: emailError(email) ?? undefined,
      password: requiredError(password, "Escribe tu contraseña.") ?? undefined,
    };
    setErrores(fallos);
    if (Object.values(fallos).some(Boolean)) {
      document.getElementById(fallos.email ? "email" : "password")?.focus();
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // `!data.user` sin `error` no debería ocurrir, pero sin id no hay a quién
    // enrutar: se trata igual que unas credenciales malas.
    if (error || !data.user) {
      // Mensaje genérico y NO colgado del correo: decir "ese correo no existe"
      // revelaría qué direcciones tienen cuenta (S-40).
      const msg = "Correo o contraseña incorrectos.";
      setErrores({ form: msg });
      toast.error(msg);
      setLoading(false);
      return;
    }

    // Enruta por rol (RLS deja leer lo propio). Se pregunta también por el
    // perfil de tutor: el rol `tutor` solo llega con la aprobación, y quien
    // está en revisión debe entrar igualmente por su panel, no por el de
    // alumno. Las dos consultas van en paralelo, que son independientes.
    //
    // ⚠️ El `.eq()` de `tutor_profiles` NO sobra por tener RLS: la política
    // `tutor_profiles_select_public` deja leer la fila de CUALQUIER tutor
    // aprobado, así que sin filtro esto traía todas y `maybeSingle()` devolvía
    // error —nunca la propia—, dejando `esTutor` en falso siempre.
    const [{ data: rolesData }, { data: tutorProfile }] = await Promise.all([
      supabase.from("user_roles").select("role"),
      supabase
        .from("tutor_profiles")
        .select("profile_id")
        .eq("profile_id", data.user.id)
        .maybeSingle(),
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
      {/* `noValidate`: valida `onSubmit` y el mensaje se pinta bajo el campo,
          en español y anunciable (RV-14). Ver signup-form. */}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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
            aria-invalid={Boolean(errores.email)}
            aria-describedby={describedBy(errores.email && "email-error")}
            placeholder="tucorreo@ejemplo.com"
            className={AUTH_FIELD}
          />
          <FieldError id="email-error" message={errores.email} />
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
              aria-invalid={Boolean(errores.password)}
              aria-describedby={describedBy(errores.password && "password-error")}
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
          <FieldError id="password-error" message={errores.password} />
          <Link
            href="/reset"
            className="text-right text-[13px] font-medium text-brand hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        {/* Fallo del intento (credenciales): no cuelga de ningún campo, pero
            sigue siendo `role="alert"` para que se anuncie. Antes solo existía
            como aviso flotante, que se va solo y no siempre se lee. */}
        <FieldError id="login-error" message={errores.form} className="text-sm" />
        {oauthError ? (
          <p role="alert" className="text-sm text-destructive">
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
