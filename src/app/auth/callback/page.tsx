import { AuthShell } from "@/components/layout/auth-shell";
import { CallbackStatus } from "./callback-status";

export const metadata = { title: "Verificando… · Enséñame Ya" };

/**
 * AU04 — Callback de OAuth / confirmación de correo.
 *
 * Antes era un route handler que intercambiaba el `code` en servidor y hacía
 * 302 sin renderizar nada. El diseño pide pantalla de espera, así que el
 * intercambio pasa al navegador: mismo mecanismo que ya usa el login por
 * correo (`createBrowserClient` escribe la cookie de sesión).
 */
export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string; intent?: string }>;
}) {
  const { code, next, intent } = await searchParams;

  return (
    <AuthShell className="max-w-[420px]">
      <CallbackStatus
        code={code ?? null}
        next={next ?? null}
        intent={intent === "alumno" || intent === "tutor" ? intent : null}
      />
    </AuthShell>
  );
}
