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
      redirectTo: `${window.location.origin}/auth/callback?next=/reset/update`,
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
