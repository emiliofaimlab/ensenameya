import Link from "next/link";

import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar · Enséñame Ya" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

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
        <LoginForm next={next ?? null} oauthError={error === "oauth"} />
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        ¿No tienes cuenta?{" "}
        <Link
          href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-semibold text-brand hover:underline"
        >
          Crear cuenta
        </Link>
      </p>
    </div>
  );
}
