"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { pickHome, safeNext, type AppRole } from "@/lib/auth/roles";

export function CallbackStatus({
  code,
  next,
  intent,
  referralCode,
  termsVersion,
  termsLocale,
}: {
  code: string | null;
  next: string | null;
  intent: "alumno" | "tutor" | null;
  referralCode: string | null;
  /** Versión de los términos aceptada en `/signup` antes de salir hacia Google. */
  termsVersion: string | null;
  termsLocale: string | null;
}) {
  const router = useRouter();
  // Destino provisional por si el usuario pulsa el enlace antes de resolver.
  const [dest, setDest] = useState(() => safeNext(next, "/app"));
  const started = useRef(false);

  useEffect(() => {
    // StrictMode monta dos veces en dev y el `code` es de un solo uso.
    if (started.current) return;
    started.current = true;

    async function run() {
      if (!code) {
        router.replace("/login?error=oauth");
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        router.replace("/login?error=oauth");
        return;
      }

      // Constancia de la aceptación de términos. El metadata de un alta por
      // Google lo trae Google, así que `handle_new_user` no ve nada nuestro:
      // este es el único punto donde se puede dejar rastro. Va ANTES del resto
      // porque es lo que no se puede perder — si el usuario cierra la pestaña
      // mientras se resuelve el destino, la constancia ya está escrita.
      //
      // La RPC es idempotente por (usuario, versión): volver a entrar con
      // Google no crea filas nuevas ni pisa la fecha de la primera vez.
      if (termsVersion) {
        await supabase.rpc("record_terms_acceptance", {
          p_version: termsVersion,
          p_locale: termsLocale ?? "en",
        });
      }

      // Alta por Google: la intención elegida en AU02 llega por query y solo se
      // graba si el usuario aún no tiene una (nunca pisa la del registro normal).
      if (intent || referralCode) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (intent && user && !user.user_metadata?.intended_role) {
          await supabase.auth.updateUser({ data: { intended_role: intent } });
        }
        // US-1302: el metadata de Google no trae el código, así que el perfil
        // lo crea sin él. `is("referral_code", null)` deja intacta cualquier
        // atribución previa: se referencia una vez, no en cada login.
        if (referralCode && user) {
          await supabase
            .from("profiles")
            .update({ referral_code: referralCode })
            .eq("id", user.id)
            .is("referral_code", null);
        }
      }

      // Si viene un destino interno seguro, gana; si no, home por rol.
      let target = safeNext(next, "");
      if (!target) {
        const { data } = await supabase.from("user_roles").select("role");
        target = pickHome((data ?? []).map((r) => r.role as AppRole));
      }
      setDest(target);
      router.replace(target);
      router.refresh();
    }

    void run();
  }, [code, next, intent, referralCode, termsVersion, termsLocale, router]);

  return (
    <div className="rounded-[20px] border bg-card p-9 text-center shadow-sm">
      <div
        className="mx-auto size-13 animate-spin rounded-full border-4 border-border border-t-brand"
        role="status"
        aria-label="Verificando tu cuenta"
      />
      <h1 className="mt-6 text-[22px] font-bold tracking-tight">
        Verificando tu cuenta…
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Esto tomará solo un momento.
        <br />
        No cierres esta ventana.
      </p>
      <p className="mt-6 text-[13px] text-muted-foreground">
        ¿No se redirige?{" "}
        <Link href={dest} className="font-semibold text-brand hover:underline">
          Haz clic aquí
        </Link>
      </p>
    </div>
  );
}
