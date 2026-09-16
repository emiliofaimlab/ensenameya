"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { pickHome, destinoDeAsistente, type AppRole } from "@/lib/auth/roles";
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
    const { data: actualizado, error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error("El enlace expiró o no es válido. Solicita uno nuevo.");
      setLoading(false);
      return;
    }

    toast.success("Contraseña actualizada.");

    /*
     * EL DESTINO SE RESUELVE AQUÍ, NO SE DELEGA EN UN `redirect()`.
     *
     * 🔴 CARGA ENTERA, NO `router.push()` — REGLA DE ORO 13.
     *
     * Un `redirect()` de servidor alcanzado por una navegación de CLIENTE que
     * cruza de grupo de rutas —de `(recovery)` a `(app)`— deja el árbol vacío y
     * el router pidiendo el RSC en bucle: pantalla en blanco. Aquí se evita por
     * las dos vías, que es lo mismo que hace `auth/callback/callback-status`:
     * se apunta a una ruta que RENDERIZA, y se llega a ella con una carga de
     * documento entera.
     *
     * ⚠️ ESTE CASO ES NUEVO DESDE EL 16-sep-2026, aunque la navegación llevara
     * meses aquí: hasta hoy, quien tenía el asistente a medias NUNCA llegaba a
     * este formulario —`/auth/callback` lo desviaba antes—, así que nadie
     * disparaba el `redirect()`. Al arreglar ese desvío, esta población empieza
     * a pasar por aquí, que es justo la que lo dispara.
     *
     * ⚠️ Y `pickHome` SOLO MIRA LOS ROLES. Para una cuenta con el onboarding a
     * medias devuelve `/app`, que existe y renderiza… después de que
     * `requireUser()` la mande al asistente. O sea un viaje de más: medido el
     * 16-sep con una cuenta `intended_role='tutor'`, guardar la contraseña
     * aterrizaba en `/tutor/onboarding?start=1` pasando antes por `/app`.
     * `destinoDeAsistente` es el MISMO helper que usa `requireUser()` en
     * servidor para decidirlo, así que preguntárselo antes da el destino final
     * de una: una sola carga y cero redirects.
     */
    // ⚠️ El usuario sale de lo que ACABA de devolver `updateUser`, no de un
    // `auth.getUser()` aparte: ese es un viaje de 250-400 ms a la API de Auth
    // (CLAUDE.md · Rendimiento) para preguntar algo que ya tenemos en la mano.
    //
    // Y el perfil se lee SIN `.eq(id)` porque `profiles` es own-only por RLS:
    // esta consulta solo puede devolver la fila propia.
    const [{ data: roleRows }, { data: perfil }] = await Promise.all([
      supabase.from("user_roles").select("role"),
      supabase.from("profiles").select("onboarding_complete").maybeSingle(),
    ]);
    const roles = (roleRows ?? []).map((r) => r.role as AppRole);

    // ⚠️ Regla de oro 10: si la lectura del perfil falla, `perfil` es null y el
    // `?? true` asume «onboarding hecho». Es el respaldo correcto — manda al
    // panel, y desde ahí `requireUser()` rescata con su redirect. O sea que
    // falla hacia el camino que ya funcionaba, no hacia uno nuevo.
    const asistente = destinoDeAsistente(
      perfil?.onboarding_complete ?? true,
      actualizado?.user?.user_metadata?.intended_role,
    );
    window.location.assign(asistente ?? pickHome(roles));
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
