import Link from "next/link";
import { redirect } from "next/navigation";

import { safeNext } from "@/lib/auth/roles";
import { hrefSignup, PARAM_YA_TENGO_CUENTA } from "@/components/auth/auth-links";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar · Enséñame Ya" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; entrar?: string }>;
}) {
  const params = await searchParams;
  const { next, error } = params;
  // Se indexa con la constante en vez de desestructurar `entrar`: así, si
  // alguien renombra el parámetro en `auth-links.ts`, esta línea deja de
  // compilar en vez de apagar el rebote en silencio.
  const entrar = params[PARAM_YA_TENGO_CUENTA];

  // Se sanea aquí y no solo al usarlo: abajo se reinyecta en un `redirect`, y
  // un `next` con `//host` convertiría el rebote en un open-redirect.
  const destinoPrevio = safeNext(next, "");

  /*
   * M-05 (3) · Quien llega con `?next=` no vino a esta pantalla: le empujó una
   * guarda. Hoy el único que arma ese enlace es `requireUser()`, o sea, el
   * anónimo que acaba de pulsar "Reservar". Recibirle con "Inicia sesión ·
   * Bienvenido de nuevo" es el saludo equivocado para quien nunca ha entrado,
   * así que el destino por defecto de ese rebote pasa a ser CREAR CUENTA, con
   * iniciar sesión como opción secundaria (el enlace del pie de `/signup`).
   *
   * `?entrar=1` es la salida para quien sí tiene cuenta y lo pone ese mismo
   * enlace (`hrefLogin`). Sin el marcador las dos pantallas se rebotarían la
   * una a la otra en bucle.
   *
   * Los enlaces sin `next` —header, `/reset`— no se tocan: ahí el usuario
   * eligió entrar, nadie le mandó.
   */
  if (destinoPrevio && !entrar) redirect(hrefSignup(destinoPrevio));

  // AU01 usa card suelta en vez de <Card>: el diseño no lleva el separador del
  // footer y pide radio 20 / padding 40, fuera de la escala del componente.
  return (
    <div className="rounded-[20px] border bg-card p-10 shadow-sm">
      <h1 className="text-center text-[26px] font-bold tracking-tight">
        Inicia sesión
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Bienvenido de nuevo a Enséñame Ya
      </p>

      <div className="mt-6">
        <LoginForm next={destinoPrevio || null} oauthError={error === "oauth"} />
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        ¿No tienes cuenta?{" "}
        <Link
          href={hrefSignup(destinoPrevio)}
          className="font-semibold text-brand hover:underline"
        >
          Crear cuenta
        </Link>
      </p>
    </div>
  );
}
