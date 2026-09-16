"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { destinoDeAsistente, safeNext } from "@/lib/auth/roles";
import { FieldError } from "@/components/form/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_FIELD, AUTH_LABEL, AUTH_SUBMIT } from "@/components/auth/field-classes";
import {
  leerSignupPendiente,
  limpiarSignupPendiente,
} from "@/components/auth/signup-pendiente";

/**
 * ── CONFIRMAR LA CUENTA CON EL CÓDIGO DEL CORREO ────────────────────────────
 *
 * 🔴 POR QUÉ EXISTE ESTA PANTALLA, que es toda la historia.
 *
 * El correo de alta lleva DOS formas de confirmar: un enlace y un código de 8
 * dígitos. El enlace canjea por PKCE en `/auth/callback`, y el `code_verifier`
 * de PKCE vive en el navegador que se registró: abrir ese enlace en el MÓVIL
 * falla siempre. Y registrarse en el portátil y confirmar en el móvil es el
 * camino más normal del mundo. En prod la confirmación está encendida, así que
 * hasta hoy ese usuario NO PODÍA activar su cuenta.
 *
 * El código no tiene ese problema: se lee en el móvil y se teclea AQUÍ, en la
 * pantalla que quedó abierta en el portátil. `verifyOtp({email, token,
 * type:'signup'})` canjea sin `code_verifier` —medido contra dev el
 * 16-sep-2026: da sesión desde un cliente nuevo, y funciona aunque el correo se
 * pidiera en modo PKCE— y al hacerlo marca `email_confirmed_at`. El enlace
 * sigue estando y sigue valiendo en el mismo dispositivo; esto es la salida
 * cross-device, no su sustituto.
 *
 * ⚠️ El código es de 8 dígitos, no 6 (medido: `{{ .Token }}` de GoTrue).
 *
 * ⚠️ El correo se prellena desde `sessionStorage` (misma pestaña que el alta),
 * pero el campo es editable y funciona vacío: si alguien abre esta URL de cero
 * —otra pestaña, la pestaña cerrada— teclea su correo y su código y confirma
 * igual. `verifyOtp` necesita el correo de todos modos.
 */
export function ConfirmarForm() {
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [loading, setLoading] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El correo del alta que dejó `signup-form`, si esta es su misma pestaña.
  // Va en un effect y NO en el initializer de `useState` a propósito:
  // `sessionStorage` no existe en el render del servidor, así que inicializarlo
  // ahí daría "" en SSR y el correo en cliente — un hydration mismatch en un
  // input controlado. Leerlo tras montar es el patrón correcto; el lint de
  // React 19 lo marca de más para este caso (storage de solo-cliente).
  useEffect(() => {
    const p = leerSignupPendiente();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura de sessionStorage tras montar, sin cascada real
    if (p?.email) setEmail(p.email);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const correo = email.trim().toLowerCase();
    // El código son 8 dígitos; se limpian espacios y separadores que la gente
    // copia del correo sin querer. No se valida la longitud aquí: que lo diga
    // GoTrue, que es quien sabe la verdad.
    const token = codigo.replace(/\D/g, "");
    if (!correo || !token) {
      setError("Escribe tu correo y el código que te enviamos.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: eV } = await supabase.auth.verifyOtp({
      email: correo,
      token,
      type: "signup",
    });

    if (eV) {
      // `otp_expired` (403) es el caso común: código mal tecleado o caducado.
      // No se distingue «caducado» de «incorrecto» a propósito — decir cuál es
      // da información a quien no debería tener el código.
      setError(
        "Ese código no es válido o ya caducó. Revísalo en el correo, o pide uno nuevo abajo.",
      );
      setLoading(false);
      return;
    }

    // Confirmada y CON SESIÓN: `verifyOtp` deja al usuario dentro.
    //
    // ⚠️ EL `next` SE LEE ANTES DE LIMPIAR. `limpiarSignupPendiente()` borra la
    // entrada de `sessionStorage`, así que preguntar por el `next` después daría
    // siempre null y el destino elegido se perdería en silencio.
    const next = leerSignupPendiente()?.next ?? null;
    limpiarSignupPendiente();
    toast.success("¡Cuenta confirmada!");

    // El destino, como en el alta con sesión inmediata: el asistente que toque
    // según lo que eligió al registrarse (S-37 · `intended_role` del metadata).
    // Un alta recién confirmada tiene el onboarding a medias por definición, así
    // que `destinoDeAsistente` nunca devuelve null aquí.
    const intended = data.user?.user_metadata?.intended_role;
    const asistente = destinoDeAsistente(false, intended) ?? "/onboarding";
    // El de alumno lee `?next=`; el de tutor no (ya lleva su `?start=1`).
    const destino =
      asistente === "/onboarding" && next
        ? `/onboarding?next=${encodeURIComponent(safeNext(next, "/app"))}`
        : asistente;

    // 🔴 CARGA ENTERA, NO `router.push` — REGLA DE ORO 13. Se cruza de `(auth)`
    // a `(app)`, cuyo layout hace `requireUser()` → `redirect()`, y un redirect
    // de servidor alcanzado por una navegación de cliente deja la pantalla en
    // blanco. Es la misma salida que toma `auth/callback` y `reset/update`.
    window.location.assign(destino);
  }

  async function reenviar() {
    const correo = email.trim().toLowerCase();
    if (!correo) {
      setError("Escribe tu correo para reenviarte el código.");
      return;
    }
    setReenviando(true);
    setError(null);
    const supabase = createClient();
    // El resultado se IGNORA a propósito: el mensaje es el mismo salga como
    // salga —cuenta ya confirmada, correo inexistente, rate limit— porque
    // decir cuál fue delata si esa dirección tiene cuenta sin confirmar. Mismo
    // criterio que la pantalla de recuperación.
    await supabase.auth.resend({
      type: "signup",
      email: correo,
      // El correo reenviado trae otra vez enlace + código. El enlace apunta al
      // mismo sitio que el del alta; el código es lo que se usa aquí.
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setReenviando(false);
    toast.success("Si esa cuenta está sin confirmar, te enviamos otro código.");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="confirm-email" className={AUTH_LABEL}>
          Correo
        </Label>
        <Input
          id="confirm-email"
          type="email"
          autoComplete="email"
          className={AUTH_FIELD}
          placeholder="tucorreo@ejemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="confirm-code" className={AUTH_LABEL}>
          Código de confirmación
        </Label>
        <Input
          id="confirm-code"
          // Numérico en móvil sin forzar `type=number` (que trae flechas y
          // validación del navegador que estorban a un OTP).
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          className={`${AUTH_FIELD} tracking-[0.3em] text-center font-semibold`}
          placeholder="········"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          aria-describedby="confirm-error"
        />
        <p className="text-[13px] text-muted-foreground">
          Te enviamos un código de 8 dígitos. Revisa tu correo (y el spam).
        </p>
      </div>

      <FieldError id="confirm-error" message={error} className="text-sm" />

      <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
        {loading ? "Confirmando…" : "Confirmar mi cuenta"}
      </Button>

      <button
        type="button"
        onClick={reenviar}
        disabled={reenviando}
        className="text-[13px] font-medium text-brand hover:underline disabled:opacity-60"
      >
        {reenviando ? "Reenviando…" : "¿No te llegó? Reenviar el código"}
      </button>

      <p className="text-center">
        <Link
          href="/login"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Volver a iniciar sesión
        </Link>
      </p>
    </form>
  );
}
