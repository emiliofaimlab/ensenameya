"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/form/field-error";
import {
  AUTH_FIELD,
  AUTH_LABEL,
  AUTH_SUBMIT,
} from "@/components/auth/field-classes";
import {
  PASSWORD_MIN,
  describedBy,
  emailError,
  passwordError,
  requiredError,
} from "@/components/form/validation";

/** Los legales, desde una pantalla de pago, siempre en otra pestaña. */
const LEGAL = { target: "_blank", rel: "noopener noreferrer" } as const;

/** Errores por campo (RV-14) + el del intento, que no cuelga de ningún campo. */
type Errores = Partial<Record<"email" | "password" | "terms" | "form", string>>;

/**
 * CHECKOUT DE INVITADO · «Tus datos» — el alta escondida dentro del pago.
 *
 * El comprador anónimo no ve `/signup` ni el onboarding: la cuenta se crea con
 * el mismo clic que paga. Aquí solo se piden las tres cosas sin las que no se
 * puede cobrar —correo, contraseña y la aceptación de los términos— más el
 * nombre, que es opcional porque no habrá onboarding donde pedirlo.
 *
 * ⚠️ NO ES `SignupForm` Y NO PUEDE SERLO. Aquel navega a `/onboarding` o a
 * `/tutor/onboarding` al terminar, trae el selector «Quiero aprender / Quiero
 * enseñar» y el botón de Google: es literalmente la pantalla que el comprador
 * no debe ver. Lo que sí se reutiliza es todo lo que vale la pena — las reglas
 * de validación, los mensajes, las medidas de los campos y el texto de la
 * casilla— para que la constancia de términos que se guarda desde aquí sea la
 * misma que la de `/signup`.
 *
 * ── DOS PASOS, EN ESTE ORDEN ────────────────────────────────────────────────
 *   1. `POST /api/checkout/invitado` crea la cuenta YA CONFIRMADA en servidor
 *      (`service_role`, ver ese fichero: en producción la confirmación por
 *      correo está encendida y un `signUp` normal no devuelve sesión).
 *   2. Este navegador hace `signInWithPassword` con la contraseña que su dueño
 *      acaba de teclear. La sesión queda en COOKIES —`createBrowserClient` de
 *      `@supabase/ssr`—, así que la ven el siguiente render de servidor y el
 *      siguiente `fetch` a nuestra propia API sin tocar ningún layout.
 *
 * ⚠️ CORREO QUE YA EXISTE → NUNCA SESIÓN AUTOMÁTICA, Y TAMPOCO SE DICE. Si el
 * correo tiene dueño, el endpoint no crea nada y responde igual que si lo
 * hubiera creado (200): contestar «ese correo ya tiene cuenta» a cualquiera que
 * pregunte es un comprobador de listas gratis. Quien decide es el paso 2 — sin
 * la contraseña de verdad no se entra a ninguna parte. Si ese intento falla, el
 * formulario pasa a MODO LOGIN para que la escriba, que es la única salida que
 * esta pantalla tiene: el layout de `(checkout)` no tiene ni una —el logo no es
 * enlace a propósito y no hay «Iniciar sesión» en ninguna parte—.
 *
 * Y en modo login no se encadena ningún intento solo: se entra al pulsar, una
 * vez por pulsación. Ahí el que protege es el límite de GoTrue, que es lo único
 * que hay del lado del login.
 */
export function DatosInvitado({
  onCuentaLista,
  etiqueta = "Crear cuenta y pagar",
  className,
}: {
  /** El id del alumno recién autenticado. El padre sigue desde aquí. */
  onCuentaLista: (userId: string) => void;
  /** El CTA. Cambia entre el checkout («…y pagar») y el carrito. */
  etiqueta?: string;
  className?: string;
}) {
  // Sufijo propio en los `id`: esto se monta en pantallas que ya pueden tener
  // otro formulario de alta (el carrito vive en `(public)`, con su cabecera y
  // su diálogo de registro), y dos `id="email"` en el documento hacen que
  // `htmlFor` enfoque el campo equivocado.
  const uid = useId();
  const idCampo = (base: string) => `${base}-${uid}`;

  const [modo, setModo] = useState<"alta" | "login">("alta");
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errores, setErrores] = useState<Errores>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const fullName = String(form.get("fullName") ?? "").trim();

    // RV-12 / RV-14 · validación propia y en español, la misma que `/signup`.
    // Y el servidor la repite: esto solo evita un viaje.
    const fallos: Errores = {
      email: emailError(email) ?? undefined,
      // En modo login NO se exige el mínimo de 8: las cuentas anteriores a
      // RV-12 tienen 6 caracteres y rechazarlas aquí las dejaría fuera de su
      // propia cuenta (mismo criterio que `(auth)/login/login-form.tsx`).
      password:
        (modo === "login"
          ? requiredError(password, "Escribe tu contraseña.")
          : passwordError(password)) ?? undefined,
      // La casilla solo manda en el alta: quien ya tiene cuenta ya la aceptó, y
      // su constancia está guardada desde entonces.
      terms:
        modo === "login" || accepted
          ? undefined
          : "Debes aceptar los términos para continuar.",
    };
    setErrores(fallos);
    if (Object.values(fallos).some(Boolean)) {
      const primero = (["email", "password"] as const).find((k) => fallos[k]);
      if (primero) document.getElementById(idCampo(primero))?.focus();
      return;
    }

    setLoading(true);

    if (modo === "alta") {
      // ⚠️ `fetch` RECHAZA —no devuelve `!res.ok`— ante un corte de red, un DNS
      // caído, el salto de datos a wifi o el ahorro de batería del teléfono: o
      // sea, el caso normal de pagar desde el móvil. Sin este `try`, la promesa
      // del `onSubmit` quedaba sin capturar, `setLoading(false)` no se
      // ejecutaba nunca y el botón se quedaba en «Creando tu cuenta…»
      // deshabilitado para siempre, en una pantalla que no tiene ni una salida.
      let res: Response;
      try {
        res = await fetch("/api/checkout/invitado", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            fullName: fullName || null,
            acceptedTerms: true,
          }),
        });
      } catch {
        const msg = "No pudimos conectar. Revisa tu conexión e inténtalo otra vez.";
        setErrores({ form: msg });
        toast.error(msg);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const salida = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = salida.error ?? "No se pudo crear la cuenta. Intenta de nuevo.";
        setErrores({ form: msg });
        toast.error(msg);
        setLoading(false);
        return;
      }
    }

    // La sesión SIEMPRE la abre el navegador, nunca el endpoint: así la
    // contraseña que abre la sesión es la que tecleó su dueño, y no un token
    // que hubiéramos fabricado con `service_role`.
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      // Cuenta que YA existía y está sin confirmar (alguien se registró por
      // `/signup` y no pulsó el enlace del correo). GoTrue comprueba la
      // contraseña ANTES que la confirmación, así que este código solo llega a
      // quien acertó la suya: decírselo no delata ninguna cuenta y le ahorra
      // quedarse encerrado repitiendo una contraseña que es la buena.
      const sinConfirmar =
        error?.code === "email_not_confirmed" ||
        /not confirmed/i.test(error?.message ?? "");

      const msg = sinConfirmar
        ? "Esa cuenta está sin confirmar. Busca en tu correo el mensaje de confirmación y vuelve a intentarlo."
        : modo === "login"
          ? // Genérico y no colgado de ningún campo (S-40), igual que `/login`.
            "Correo o contraseña incorrectos."
          : // ⚠️ NI UNA PALABRA SOBRE SI ESE CORREO TIENE CUENTA. El endpoint ya
            // no lo dice —contesta 200 tanto si creó la cuenta como si el correo
            // ya tenía dueño—, y quien decide es este `signInWithPassword`: sin
            // la contraseña de verdad no se entra a ninguna parte. Si falla,
            // pasamos a modo login y que lo intente con ella; el siguiente envío
            // ya no llama al endpoint, así que tampoco gasta su cupo por IP.
            "No pudimos continuar con esos datos. Si ya tienes cuenta con ese correo, escribe tu contraseña; si no, revísalos.";

      // Pase lo que pase, el siguiente intento es un LOGIN a secas: no vuelve a
      // llamar al endpoint —ni gasta su cupo por IP— y, si la cuenta estaba sin
      // confirmar, basta con confirmarla en otra pestaña y volver a pulsar.
      if (modo === "alta") {
        setModo("login");
        document.getElementById(idCampo("password"))?.focus();
      }
      setErrores({ form: msg });
      toast.error(msg);
      setLoading(false);
      return;
    }

    // Sin `setLoading(false)`: a partir de aquí manda el padre (abre la reserva
    // y el cobro) y el botón tiene que quedarse quieto hasta que desmonte.
    onCuentaLista(data.user.id);
  }

  return (
    <div className={className}>
      <p className="text-[13px] leading-relaxed text-[#6b6b6b]">
        {modo === "login"
          ? "Si ya tienes cuenta con ese correo, escribe tu contraseña para continuar con la compra."
          : "Creamos tu cuenta con estos datos para poder reservar tu horario y enviarte la confirmación."}
      </p>

      {/* `noValidate` por lo mismo que en `/signup`: el globo del navegador sale
          en el idioma del sistema y los lectores de pantalla no lo anuncian de
          forma fiable. Los `required` / `minLength` se quedan como semántica. */}
      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor={idCampo("email")} className={AUTH_LABEL}>
            Correo
          </Label>
          <Input
            id={idCampo("email")}
            name="email"
            type="email"
            autoComplete="email"
            required
            // Cambiar el correo deshace el modo login: la contraseña que se
            // pida a partir de ahora ya no es la de esa otra cuenta.
            onChange={() => {
              if (modo === "login") setModo("alta");
              if (errores.email) setErrores((p) => ({ ...p, email: undefined }));
            }}
            aria-invalid={Boolean(errores.email)}
            aria-describedby={describedBy(errores.email && idCampo("email-error"))}
            placeholder="tucorreo@ejemplo.com"
            className={AUTH_FIELD}
          />
          <FieldError id={idCampo("email-error")} message={errores.email} />
        </div>

        {/* El nombre solo en el alta, y opcional: es el único dato del
            onboarding que se pide aquí, porque el comprador de invitado no va a
            pasar por él. Sin nombre, el perfil nace con `full_name` a null —
            exactamente igual que un alta por `/signup`. */}
        {modo === "alta" ? (
          <div className="grid gap-2">
            <Label htmlFor={idCampo("fullName")} className={AUTH_LABEL}>
              Nombre <span className="text-[#9a9a9a]">(opcional)</span>
            </Label>
            <Input
              id={idCampo("fullName")}
              name="fullName"
              type="text"
              autoComplete="name"
              maxLength={120}
              placeholder="Cómo quieres que te llamemos"
              className={AUTH_FIELD}
            />
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor={idCampo("password")} className={AUTH_LABEL}>
            Contraseña
          </Label>
          <div className="relative">
            <Input
              id={idCampo("password")}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={modo === "login" ? "current-password" : "new-password"}
              required
              minLength={modo === "login" ? undefined : PASSWORD_MIN}
              aria-invalid={Boolean(errores.password)}
              aria-describedby={describedBy(
                modo === "alta" && idCampo("password-hint"),
                errores.password && idCampo("password-error"),
              )}
              placeholder={
                modo === "login" ? "Tu contraseña" : "Crea una contraseña"
              }
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
          {/* La regla se dice ANTES de fallar, como en `/signup`. */}
          {modo === "alta" ? (
            <p
              id={idCampo("password-hint")}
              className="text-[13px] text-muted-foreground"
            >
              Mínimo {PASSWORD_MIN} caracteres.
            </p>
          ) : null}
          <FieldError id={idCampo("password-error")} message={errores.password} />
        </div>

        {/* Mismos enlaces, mismo texto y misma versión que la casilla de
            `/signup`: la constancia que escribe el trigger tiene que referirse
            al mismo documento que se le puso delante. Los legales abren en
            pestaña nueva SIEMPRE — navegar desde una pantalla de pago tira el
            formulario y, con él, el horario retenido. */}
        {modo === "alta" ? (
          <>
            <label className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => {
                  setAccepted(e.target.checked);
                  if (e.target.checked)
                    setErrores((prev) => ({ ...prev, terms: undefined }));
                }}
                aria-invalid={Boolean(errores.terms)}
                aria-describedby={describedBy(
                  errores.terms && idCampo("terms-error"),
                )}
                className="mt-0.5 size-[18px] rounded-[5px] border-input accent-primary"
              />
              <span>
                Acepto los{" "}
                <Link href="/terms" className="text-brand hover:underline" {...LEGAL}>
                  Términos y Condiciones
                </Link>{" "}
                <span className="text-muted-foreground">
                  (
                  <Link href="/terms/es" className="hover:underline" {...LEGAL}>
                    versión en español
                  </Link>
                  )
                </span>{" "}
                y la{" "}
                <Link href="/privacy" className="text-brand hover:underline" {...LEGAL}>
                  Política de privacidad
                </Link>
                .
              </span>
            </label>
            <FieldError id={idCampo("terms-error")} message={errores.terms} />
          </>
        ) : null}

        {/* El fallo que no es de ningún campo (la red, el límite por IP, unas
            credenciales que no entran). */}
        <FieldError id={idCampo("form-error")} message={errores.form} />

        <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
          {loading
            ? modo === "login"
              ? "Entrando…"
              : "Creando tu cuenta…"
            : modo === "login"
              ? "Iniciar sesión y continuar"
              : etiqueta}
        </Button>
      </form>
    </div>
  );
}
