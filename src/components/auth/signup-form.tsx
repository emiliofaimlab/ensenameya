"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { REFERRAL_COOKIE } from "@/lib/referral";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/auth/google-button";
import type { SignupIntent } from "@/components/auth/auth-links";
import {
  TERMS_GOVERNING_LOCALE,
  TERMS_VERSION,
} from "@/components/legal/terms-content";
import { AuthDivider } from "@/components/auth/auth-divider";
import {
  AUTH_FIELD,
  AUTH_LABEL,
  AUTH_SUBMIT,
} from "@/components/auth/field-classes";
import { FieldError } from "@/components/form/field-error";
import {
  PASSWORD_MIN,
  describedBy,
  emailError,
  passwordError,
} from "@/components/form/validation";

/**
 * Errores por campo (RV-14). La clave es el `name` del input.
 *
 * ⚠️ Ya no hay `full_name`: M-05 dejó el alta en DOS campos (correo y
 * contraseña). El nombre se pide en el onboarding, que es donde el usuario ya
 * está dentro y donde de todas formas hacía falta pedirle zona horaria y foto.
 */
type Errores = Partial<Record<"email" | "password" | "terms", string>>;

const intentOptions: { value: SignupIntent; label: string }[] = [
  { value: "alumno", label: "Quiero aprender" },
  { value: "tutor", label: "Quiero enseñar" },
];

/**
 * El `ey-ref` que dejó el proxy, leído del navegador.
 *
 * Solo se usa cuando el formulario se monta en un MODAL: ahí no hay página de
 * servidor que lo haya leído de las cookies y lo pase como prop (`/signup` sí
 * lo hace, y encima honra el `?ref=` de la URL, que manda). La cookie no es
 * `httpOnly` a propósito —la escribe el middleware sin esa opción— justamente
 * porque es atribución, no un secreto (US-1302 / RN-21).
 *
 * Se lee al ENVIAR, no al montar: así no hay nada que hidratar y no puede
 * desincronizarse con el HTML que vino del servidor.
 */
function refDeCookie(): string | null {
  if (typeof document === "undefined") return null;
  const bruto = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${REFERRAL_COOKIE}=`))
    ?.slice(REFERRAL_COOKIE.length + 1);
  if (!bruto) return null;
  try {
    return decodeURIComponent(bruto) || null;
  } catch {
    // Cookie manipulada a mano: mejor sin atribución que reventando el alta.
    return null;
  }
}

/**
 * Alta de cuenta (AU02). Vive en `components/` y no junto a la página porque
 * desde M-05 tiene DOS carcasas: la ruta `/signup` de siempre y el modal que
 * se abre sobre la página en la que estabas (`SignupDialog`).
 */
export function SignupForm({
  next,
  referralCode,
  intentInicial = "alumno",
  enModal = false,
  onDone,
}: {
  next: string | null;
  /** `null` en el modal: se resuelve de la cookie al enviar (ver `refDeCookie`). */
  referralCode: string | null;
  intentInicial?: SignupIntent;
  /**
   * Cambia lo que depende de estar dentro de un diálogo:
   * · los legales abren en pestaña nueva (si navegas, pierdes el formulario);
   * · el alta que espera confirmación por correo NO te manda a `/login` —
   *   sacarte de la página es justo lo que el modal viene a evitar.
   */
  enModal?: boolean;
  /** Cerrar el diálogo cuando el alta termina sin navegar a ningún sitio. */
  onDone?: () => void;
}) {
  const router = useRouter();
  /*
   * ⚠️ Dentro del modal los `id` llevan sufijo propio.
   *
   * El diálogo se monta en la MISMA página que puede tener otro disparador de
   * alta (el pie de la portada tiene dos), y dos `id="email"` en el documento
   * rompen justo lo que M-05 no puede permitirse: `htmlFor` enfoca el primero
   * que encuentre y `aria-describedby` describe el campo equivocado. Fuera del
   * modal se dejan los de siempre — `/signup` es una pantalla entera y no hay
   * con quién chocar.
   */
  const uid = useId();
  const idCampo = (base: string) => (enModal ? `${base}-${uid}` : base);
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState<SignupIntent>(intentInicial);
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errores, setErrores] = useState<Errores>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    // RV-12 / RV-14 · Validación propia, no la del navegador. El `minLength`
    // del HTML no protege de un submit programático y su globo de error se
    // escribe en el idioma del sistema; esto se pinta bajo cada campo.
    const fallos: Errores = {
      email: emailError(email) ?? undefined,
      password: passwordError(password) ?? undefined,
      terms: accepted
        ? undefined
        : "Debes aceptar los términos para continuar.",
    };
    setErrores(fallos);
    if (Object.values(fallos).some(Boolean)) {
      // El foco al primer campo con fallo: en móvil el error puede quedar
      // fuera de pantalla y parecería que el botón no hace nada.
      const primero = (["email", "password"] as const).find((k) => fallos[k]);
      if (primero) document.getElementById(idCampo(primero))?.focus();
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          // ⚠️ Sin `full_name` (M-05): el trigger `handle_new_user` lo copia a
          // `profiles.full_name`, así que el perfil nace con el nombre a null
          // hasta que el onboarding lo rellene. Es lo esperado, no un olvido.
          //
          // El rol real lo asigna el trigger (=alumno); la intención (S-37)
          // se guarda para el onboarding por rol (AL01 / TU01).
          intended_role: intent,
          // S-18: lo persiste `handle_new_user` al crear el perfil — también
          // cuando el alta espera confirmación por correo y aquí no hay sesión.
          referral_code: referralCode ?? refDeCookie(),
          // Constancia de la aceptación. Va por el metadata y lo escribe el
          // mismo trigger, por el mismo motivo que el código de referido: con
          // la confirmación por correo activa aquí NO hay sesión todavía, así
          // que un insert desde el cliente fallaría en silencio.
          terms_version: TERMS_VERSION,
          // Qué versión enlazaba la casilla. La que obliga es la inglesa (§38);
          // esto solo deja constancia de cuál se le puso delante.
          terms_locale: TERMS_GOVERNING_LOCALE,
        },
      },
    });

    if (error) {
      const yaExiste = /registered|already/i.test(error.message);
      const msg = yaExiste
        ? "Ese correo ya tiene una cuenta. Inicia sesión."
        : "No se pudo crear la cuenta. Revisa los datos e intenta de nuevo.";
      // Si el problema es el correo, el error vive BAJO el correo; si es
      // genérico no hay campo al que colgarlo y se queda en el aviso flotante.
      // ⚠️ El servidor de Auth puede rechazar la contraseña por su propia
      // política (longitud mínima del panel de Supabase) aunque aquí pase.
      if (yaExiste) setErrores({ email: msg });
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
      // Cerrar ANTES de navegar. El diálogo bloquea el scroll del `body` y le
      // pone `pointer-events:none`; desmontarlo de golpe con la navegación deja
      // esa limpieza a merced del orden de efectos, y una página que no acepta
      // clics es un fallo que no se atribuye a esto ni de lejos.
      onDone?.();
      router.push(`${destino}${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      router.refresh();
      return;
    }

    // Cloud con confirmación de correo activa: no hay sesión todavía.
    toast.success("Te enviamos un correo para confirmar tu cuenta.");
    if (enModal) {
      // "Regístrate y seguimos": el correo se confirma desde la bandeja, no
      // desde aquí, así que mandarle a `/login` solo le quitaría la página.
      setLoading(false);
      onDone?.();
      return;
    }
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
        referralCode={referralCode ?? refDeCookie()}
        // La casilla de términos se pinta más abajo, dentro del formulario,
        // pero aplica a los DOS caminos de alta. Sin esto, este botón la
        // esquivaba por completo.
        terms={{
          aceptado: accepted,
          version: TERMS_VERSION,
          locale: TERMS_GOVERNING_LOCALE,
        }}
        onTermsMissing={() =>
          setErrores((prev) => ({
            ...prev,
            terms: "Debes aceptar los términos para continuar.",
          }))
        }
        label="Registrarme con Google"
        className={`${AUTH_FIELD} font-medium`}
      />
      <AuthDivider />

      {/*
        `noValidate`: la validación la hace `onSubmit` y se pinta bajo cada
        campo (RV-14). Los atributos `required` / `minLength` se quedan porque
        son semántica que el lector de pantalla anuncia, pero sin ellos
        mandando el navegador dispararía además su propio globo, en el idioma
        del sistema y por encima del nuestro.
      */}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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
            aria-invalid={Boolean(errores.email)}
            aria-describedby={describedBy(
              errores.email && idCampo("email-error"),
            )}
            placeholder="tucorreo@ejemplo.com"
            className={AUTH_FIELD}
          />
          <FieldError
            id={idCampo("email-error")}
            message={errores.email}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={idCampo("password")} className={AUTH_LABEL}>
            Contraseña
          </Label>
          <div className="relative">
            <Input
              id={idCampo("password")}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN}
              aria-invalid={Boolean(errores.password)}
              aria-describedby={describedBy(
                idCampo("password-hint"),
                errores.password && idCampo("password-error"),
              )}
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
          {/* La regla se dice ANTES de fallar: enterarse del mínimo al pulsar
              "Crear cuenta" es la forma cara de enterarse. */}
          <p
            id={idCampo("password-hint")}
            className="text-[13px] text-muted-foreground"
          >
            Mínimo {PASSWORD_MIN} caracteres.
          </p>
          <FieldError
            id={idCampo("password-error")}
            message={errores.password}
          />
        </div>

        {/*
          La casilla enlaza a `/terms`, que sirve la versión INGLESA — la que
          gobierna según el §38 del propio contrato y la que el cliente pidió
          que se acepte. La traducción al español está a un clic desde ahí y se
          enlaza también aquí, para que nadie tenga que aceptar un texto que no
          puede leer sin buscarlo.
        */}
        <label className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => {
              setAccepted(e.target.checked);
              // El error se apaga al marcarla: dejarlo ahí después de
              // corregirlo hace dudar de si se corrigió.
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
            <Link href="/terms" className="text-brand hover:underline" {...legal(enModal)}>
              Términos y Condiciones
            </Link>{" "}
            <span className="text-muted-foreground">
              (
              <Link href="/terms/es" className="hover:underline" {...legal(enModal)}>
                versión en español
              </Link>
              )
            </span>{" "}
            y la{" "}
            <Link href="/privacy" className="text-brand hover:underline" {...legal(enModal)}>
              Política de privacidad
            </Link>
            .
          </span>
        </label>
        <FieldError id={idCampo("terms-error")} message={errores.terms} />

        <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
          {loading ? "Creando cuenta…" : "Crear cuenta"}
        </Button>
      </form>
    </div>
  );
}

/**
 * Los legales, dentro del modal, se abren aparte: seguir el enlace en la misma
 * pestaña cierra el diálogo y tira lo que llevabas escrito. Fuera del modal
 * navegan como siempre — es una pantalla entera, no hay nada que perder.
 */
function legal(enModal: boolean) {
  return enModal
    ? ({ target: "_blank", rel: "noopener noreferrer" } as const)
    : {};
}
