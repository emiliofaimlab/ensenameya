"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import {
  panelDeCookie,
  pickHome,
  safeNext,
  type AppRole,
} from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/auth/google-button";
import { GoogleTermsNote } from "@/components/auth/google-terms-note";
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
  describedBy,
  emailError,
  requiredError,
} from "@/components/form/validation";

/** Errores por campo (RV-14) + el del intento fallido, que no es de un campo. */
type Errores = Partial<Record<"email" | "password" | "form", string>>;

export function LoginForm({
  next,
  oauthError,
}: {
  next: string | null;
  oauthError: boolean;
}) {
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
    const [
      { data: rolesData, error: errRoles },
      { data: tutorProfile, error: errTutor },
      { data: perfil, error: errPerfil },
    ] = await Promise.all([
      // ⚠️ Este `.eq()` tampoco sobra: `has_role('admin')` deja a un admin LEER
      // `user_roles` entera, así que sin filtro esto traía los roles de todo el
      // mundo y `pickHome` decidía con los de otros. Mismo fallo que tenía el
      // callback de OAuth.
      supabase.from("user_roles").select("role").eq("user_id", data.user.id),
      supabase
        .from("tutor_profiles")
        .select("profile_id")
        .eq("profile_id", data.user.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("onboarding_complete")
        .eq("id", data.user.id)
        .maybeSingle(),
    ]);
    // Regla de oro 10: sin esto, un fallo de la consulta de roles es
    // indistinguible de «solo es alumno» y nadie se entera.
    if (errRoles)
      console.error("[login] roles", errRoles.code, errRoles.message);
    if (errTutor)
      console.error("[login] tutor_profiles", errTutor.code, errTutor.message);
    if (errPerfil)
      console.error("[login] perfil", errPerfil.code, errPerfil.message);

    const roles = (rolesData ?? []).map((r) => r.role as AppRole);

    /*
     * ⚠️ EL MISMO TRATAMIENTO QUE EL CALLBACK DE OAUTH, y por la misma razón.
     *
     * Esto era `router.push(pickHome(...))` + `router.refresh()` sin mirar
     * `onboarding_complete`, que es exactamente la forma del fallo que dejaba
     * la pantalla en blanco al entrar con Google: se navegaba a `/app`, allí
     * `requireUser()` respondía con un `redirect()` de SERVIDOR hacia
     * `/onboarding`, y ese redirect alcanzado a mitad de una navegación de
     * cliente dejaba al router de Next con el árbol vacío.
     *
     * Dos capas, iguales a las de allí:
     *  1. El destino se resuelve AQUÍ, onboarding incluido, así que no se
     *     navega a una ruta que vaya a redirigir. El reparto copia el de
     *     `requireUser()` para que las dos puertas contesten igual.
     *  2. Se navega con una carga entera, que cierra la clase completa —
     *     incluido cualquier `?next=` a una ruta con guarda de rol. De paso se
     *     cae el `router.refresh()`, que estaba para que el servidor releyera
     *     las cookies recién escritas.
     *
     * ⚠️ No pude dispararlo en vivo: reproducirlo exige teclear una contraseña
     * y eso no lo hago. Lo que hay es que la forma del código era idéntica a la
     * del callback, y allí sí está medido (0 caracteres y ~20 peticiones por
     * segundo antes; página entera y 0 después).
     */
    const pendiente = perfil?.onboarding_complete === false;
    let destino = safeNext(next, "");
    if (pendiente) {
      destino =
        data.user.user_metadata?.intended_role === "tutor"
          ? "/tutor/onboarding?start=1"
          : destino
            ? `/onboarding?next=${encodeURIComponent(destino)}`
            : "/onboarding";
    } else if (!destino) {
      // `panel`: el último panel en el que estuvo este navegador (`ey-panel`).
      // Manda sobre la prioridad de rol, así que quien administra pero estaba
      // enseñando vuelve a `/tutor` y no a `/admin`.
      destino = pickHome(roles, {
        esTutor: Boolean(tutorProfile),
        panel: panelDeCookie(),
      });
    }
    window.location.replace(destino);
  }

  return (
    <div className="flex flex-col gap-5">
      {/*
        ⚠️ `terms` también aquí desde el 11-sep-2026, y no es simetría por
        gusto: este botón NO solo inicia sesión, también DA DE ALTA. Verificado
        en vivo con una cuenta de Google que no existía: se creaba igual, pero
        sin `intent`, sin referido y con CERO filas en `terms_acceptances`,
        para siempre. Con `?terms=` en la URL de vuelta, AU04 deja la misma
        constancia que por `/signup`, y la RPC es idempotente por (usuario,
        versión), así que a quien ya tiene cuenta no le crea filas nuevas ni le
        pisa la fecha de la primera vez.

        Lo que NO se pasa aquí es `intent` ni `ref`: quien entra por esta
        pantalla no ha elegido a qué viene ni trae campaña.
      */}
      <GoogleButton
        next={next}
        terms={{ version: TERMS_VERSION, locale: TERMS_GOVERNING_LOCALE }}
        label="Continuar con Google"
        className={`${AUTH_FIELD} font-medium`}
      />
      {/* Si por aquí puede nacer una cuenta, por aquí hay que decir qué se
          acepta al pulsar. Mismo texto que `/signup`, del mismo componente. */}
      <GoogleTermsNote />
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
          <Label htmlFor="password" className={AUTH_LABEL}>
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
              aria-describedby={describedBy(
                errores.password && "password-error",
              )}
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
        <FieldError
          id="login-error"
          message={errores.form}
          className="text-sm"
        />
        {/*
          ⚠️ Este mensaje ya no nombra a Google, y es un arreglo, no una
          rebaja. Por `/auth/callback` pasan TRES flujos —entrar con Google,
          recuperar la contraseña y confirmar el correo— y los tres salen por
          `/login?error=oauth`. O sea que confirmar el correo desde el móvil
          decía «no se pudo completar el inicio con Google», que es mentira y
          además no ayuda.

          Y la causa más común no era ninguna de las tres: el `code_verifier`
          es una cookie del NAVEGADOR, así que abrir el enlace en otro
          dispositivo falla siempre. Eso es lo que conviene decir.
        */}
        {oauthError ? (
          <p role="alert" className="text-sm text-destructive">
            No se pudo completar el acceso. El enlace pudo caducar, usarse dos
            veces, o abrirse en un navegador distinto del que lo pidió. Vuelve a
            intentarlo desde aquí.
          </p>
        ) : null}
        <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
          {loading ? "Entrando…" : "Iniciar sesión"}
        </Button>
      </form>
    </div>
  );
}
