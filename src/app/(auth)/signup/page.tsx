import Link from "next/link";
import { cookies } from "next/headers";

import { REFERRAL_COOKIE } from "@/lib/referral";
import { SignupForm } from "@/components/auth/signup-form";
import { hrefLogin } from "@/components/auth/auth-links";

export const metadata = { title: "Crear cuenta · Enséñame Ya" };

/**
 * AU02 — Alta de cuenta como PANTALLA.
 *
 * ⚠️ Desde M-05 el camino principal es el modal (`SignupDialog`), pero esta
 * ruta no se va a ninguna parte: la usan los enlaces externos, el correo de
 * confirmación, `/login` cuando rebota a crear cuenta y cualquier `?next=` que
 * venga de fuera. Las dos carcasas comparten el MISMO `SignupForm`, así que la
 * casilla de términos, el bloqueo de Google y los errores por campo se
 * arreglan (o se rompen) en un solo sitio.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; ref?: string; intent?: string }>;
}) {
  const { next, ref, intent } = await searchParams;

  // El `?ref=` de la URL manda; si no viene, el que dejó el proxy al entrar por
  // el enlace del referidor (que rara vez apunta directo a /signup).
  const referralCode =
    ref?.trim() || (await cookies()).get(REFERRAL_COOKIE)?.value || null;

  // AU02: misma card suelta que AU01 (radio 20, padding 40, sin separador).
  return (
    <div className="rounded-[20px] border bg-card p-10 shadow-sm">
      <h1 className="text-center text-[26px] font-bold tracking-tight">
        Crea tu cuenta
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Aprende en vivo 1 a 1 con tutores verificados
      </p>

      <div className="mt-6">
        <SignupForm
          next={next ?? null}
          referralCode={referralCode}
          // N-01: quien llega desde "Quiero enseñar YA" ya dijo a qué venía.
          intentInicial={intent === "tutor" ? "tutor" : "alumno"}
        />
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        ¿Ya tienes cuenta?{" "}
        <Link
          href={hrefLogin(next)}
          className="font-semibold text-brand hover:underline"
        >
          Inicia sesión
        </Link>
      </p>
    </div>
  );
}
