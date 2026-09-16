"use client";

import { useState, type FormEvent } from "react";
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
    /*
     * 🔴 CARGA ENTERA, NO `router.push()` — REGLA DE ORO 13.
     *
     * `pickHome` mira los ROLES y no el onboarding, así que puede devolver
     * `/app` o `/tutor`; las dos cuelgan de `(app)/layout.tsx`, que llama a
     * `requireUser()`, que hace `redirect()` cuando el asistente está a medias.
     * Un `redirect()` de servidor alcanzado por una navegación de CLIENTE que
     * cruza de grupo de rutas —de `(recovery)` a `(app)`— deja el árbol vacío y
     * el router pidiendo el RSC en bucle: pantalla en blanco.
     *
     * ⚠️ Y ESTO ES NUEVO DESDE EL 16-sep-2026, aunque la línea llevara meses
     * ahí: hasta hoy, quien tenía el asistente a medias NUNCA llegaba a este
     * formulario —`/auth/callback` lo desviaba antes—, así que el caso no
     * existía. Al arreglar ese desvío, esta población empieza a pasar por aquí,
     * que es precisamente la que dispara el `redirect()`.
     *
     * Una carga de documento entera lo resuelve por definición: la misma URL
     * cargada de cero renderiza perfecta. Es la misma salida que ya toma
     * `auth/callback/callback-status.tsx` y por el mismo motivo. El coste es un
     * viaje, justo después de guardar una contraseña. Se cae también el
     * `router.refresh()`, que estaba para que el servidor releyera las cookies.
     */
    window.location.assign(pickHome(roles));
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
