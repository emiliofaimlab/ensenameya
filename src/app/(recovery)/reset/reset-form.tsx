"use client";

import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AUTH_FIELD,
  AUTH_LABEL,
  AUTH_SUBMIT,
} from "@/components/auth/field-classes";

export function ResetForm() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const email = String(
      new FormData(e.currentTarget).get("email") ?? "",
    ).trim();

    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      // 🔑 `flujo=recovery` NO ES DECORATIVO, y es todo el arreglo del 16-sep-2026.
      //
      // `/auth/callback` lo comparten tres caminos (Google, confirmar cuenta y
      // esto), y su reparto de recién llegados tiene una regla —«si es
      // aspirante a tutor, al asistente de tutor»— que GANA sobre el `?next=`
      // (`callback-status.tsx`). Escrita para las altas, donde es lo correcto.
      //
      // Una recuperación no lleva `intent`, así que esa regla la decidía
      // `user_metadata.intended_role`: cualquiera que se hubiera registrado
      // para enseñar aterrizaba en `/tutor/onboarding?start=1` con el `next`
      // tirado — sesión iniciada, contraseña vieja intacta y sin forma de
      // llegar al formulario. Reproducido en producción el 16-sep-2026.
      //
      // Con esta marca el callback sabe que esto NO es un recién llegado al que
      // haya que repartir, y obedece el destino sin opinar.
      redirectTo: `${window.location.origin}/auth/callback?next=/reset/update&flujo=recovery`,
    });

    // Respuesta genérica: nunca revelar si el correo existe (S-40, igual que login).
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        Si ese correo tiene una cuenta, te enviamos un enlace para restablecer la
        contraseña. Revisa tu bandeja de entrada (y el spam).
      </p>
    );
  }

  return (
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
      <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
        {loading ? "Enviando…" : "Enviar enlace"}
      </Button>
    </form>
  );
}
