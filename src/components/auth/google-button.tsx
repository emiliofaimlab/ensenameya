"use client";

import { useState } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

/**
 * Inicio de sesión / registro con Google (OAuth). Vuelve a /auth/callback
 * (AU04), que intercambia el código y enruta por rol. En local el provider
 * no está configurado (config.toml), así que sólo funciona en cloud.
 */
export function GoogleButton({
  next,
  label,
  className,
  intent,
  referralCode,
  terms,
  onTermsMissing,
}: {
  next: string | null;
  label: string;
  className?: string;
  /** AU02: el selector "quiero aprender/enseñar" está encima de este botón, así
   *  que la intención tiene que viajar también por OAuth (la lee AU04). */
  intent?: "alumno" | "tutor";
  /** US-1302: el `?ref=` no sobrevive al viaje a Google; se lo pasamos al
   *  callback por la URL de vuelta, igual que la intención. */
  referralCode?: string | null;
  /**
   * Solo en el REGISTRO. Cierra un agujero que estuvo abierto hasta el 17-ago:
   * este botón se pinta ANTES del `<form>` y su `onClick` no leía la casilla de
   * términos, así que quien pulsaba "Registrarme con Google" creaba cuenta sin
   * haber aceptado nada — y era el camino que la propia pantalla ofrece
   * primero. Con esto el clic se bloquea igual que el submit del formulario.
   *
   * La versión viaja por la URL de vuelta y la graba AU04, porque el metadata
   * de un alta por Google lo trae Google: no pasa por `handle_new_user` con
   * nada nuestro dentro. Mismo camino que `intent` y `ref`.
   *
   * En el LOGIN no se pasa: quien ya tiene cuenta ya aceptó, y volver a pedirlo
   * para entrar sería pedir dos veces lo mismo.
   */
  terms?: { aceptado: boolean; version: string; locale: string };
  /**
   * RV-14 · Qué hacer cuando falta la casilla de términos. La pantalla de
   * registro lo usa para encender su error bajo la casilla —que es donde hay
   * que mirar—; sin él queda el aviso flotante de siempre.
   */
  onTermsMissing?: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    // Mismo mensaje y mismo momento que el submit por correo, para que los dos
    // caminos de alta se comporten igual.
    if (terms && !terms.aceptado) {
      if (onTermsMissing) onTermsMissing();
      else toast.error("Debes aceptar los términos para continuar.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const params = new URLSearchParams();
    if (next) params.set("next", next);
    if (intent) params.set("intent", intent);
    if (referralCode) params.set("ref", referralCode);
    if (terms?.aceptado) {
      params.set("terms", terms.version);
      params.set("terms_locale", terms.locale);
    }
    const query = params.toString();
    const redirectTo = `${window.location.origin}/auth/callback${
      query ? `?${query}` : ""
    }`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      toast.error("No se pudo continuar con Google.");
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={cn("w-full", className)}
      onClick={onClick}
      disabled={loading}
    >
      <GoogleIcon />
      {label}
    </Button>
  );
}
