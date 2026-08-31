"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { panelDeCookie, pickHome, safeNext, type AppRole } from "@/lib/auth/roles";

/**
 * A dónde lleva la intención elegida en AU02. Mismo reparto que el alta por
 * correo (`signup-form`): quien se registra para enseñar va a su asistente y no
 * pasa antes por el de alumno, que le pediría los mismos básicos dos veces.
 */
function homeDeIntencion(intent: "alumno" | "tutor"): string {
  return intent === "tutor" ? "/tutor/onboarding" : "/onboarding";
}

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
  /**
   * Versión vigente de los términos cuando el usuario salió de `/signup` hacia
   * Google. Desde el 28-ago-2026 ese camino no pide casilla: el botón anuncia
   * "al continuar con Google aceptas…" y la constancia se graba aquí.
   */
  termsVersion: string | null;
  termsLocale: string | null;
}) {
  const router = useRouter();
  // Destino provisional por si el usuario pulsa el enlace antes de resolver: si
  // trae intención ya se sabe a dónde va; si no, al panel de alumno.
  const [dest, setDest] = useState(() =>
    safeNext(next, intent ? homeDeIntencion(intent) : "/app"),
  );
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
      // ⚠️ Sigue grabándose aunque el camino de Google ya no pida casilla
      // (28-ago-2026): lo que se acepta al pulsar el botón es esta versión, y
      // sin esta fila no quedaría rastro de cuál era.
      //
      // La RPC es idempotente por (usuario, versión): volver a entrar con
      // Google no crea filas nuevas ni pisa la fecha de la primera vez.
      if (termsVersion) {
        await supabase.rpc("record_terms_acceptance", {
          p_version: termsVersion,
          p_locale: termsLocale ?? "en",
        });
      }

      // El usuario, una sola vez: lo necesitan la intención, el referido y
      // —abajo— la consulta del perfil de tutor.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        // El intercambio fue bien pero la sesión no cuajó. Seguir decidiendo
        // destinos sin saber de quién es peor que rebotar al login.
        router.replace("/login?error=oauth");
        return;
      }

      // Alta por Google: la intención elegida en AU02 llega por query y solo se
      // graba si el usuario aún no tiene una (nunca pisa la del registro normal).
      //
      // Es el MISMO sitio donde la deja el alta por correo (`signup-form`,
      // `data.intended_role`) porque es de donde la lee el asistente de alumno
      // (`user.user_metadata?.intended_role`) para saber que al terminar le
      // queda todavía el de tutor. Un alta por Google que no lo escriba pierde
      // ese enganche sin que nada falle a la vista.
      if (intent && !user.user_metadata?.intended_role) {
        await supabase.auth.updateUser({ data: { intended_role: intent } });
      }
      // US-1302: el metadata de Google no trae el código, así que el perfil
      // lo crea sin él. `is("referral_code", null)` deja intacta cualquier
      // atribución previa: se referencia una vez, no en cada login.
      if (referralCode) {
        await supabase
          .from("profiles")
          .update({ referral_code: referralCode })
          .eq("id", user.id)
          .is("referral_code", null);
      }

      // Destino, por orden: `?next=` interno seguro → la intención de AU02 →
      // home por rol.
      let target = safeNext(next, "");

      /*
       * ⚠️ La INTENCIÓN manda sobre el rol, y ese era el fallo.
       *
       * Reportado en vivo: "cuando marco quiero enseñar y le doy a Google me
       * manda al onboarding de estudiante". El `intent` llegaba bien hasta
       * aquí, pero el destino se decidía abajo con `pickHome`, que mira los
       * ROLES — y un alta por Google recién creada solo tiene el `alumno` que
       * le pone `handle_new_user`. Resultado: `/app`, y desde ahí `requireUser`
       * rebotaba al asistente de alumno por `onboarding_complete = false`.
       *
       * `intent` solo viaja desde el REGISTRO (el botón de `/login` no lo
       * pasa), así que esto es exactamente el mismo reparto que hace el alta
       * por correo en `signup-form`: quien se registra para enseñar va directo
       * a su asistente y no pasa dos veces por los mismos campos. Y quien ya
       * tenía cuenta no se queda atrapado: los dos destinos saben salirse solos
       * —`/onboarding` redirige si `onboarding_complete`, y `/tutor/onboarding`
       * enseña "Ya eres tutor" si el perfil está aprobado.
       */
      if (!target && intent) {
        target = homeDeIntencion(intent);
      }

      if (!target) {
        // Mismo cálculo que el login por correo, `esTutor` incluido: el rol
        // `tutor` solo se concede al APROBAR, así que sin esa pista quien está
        // en revisión entraba con Google al panel de alumno.
        //
        // ⚠️ El `.eq()` de `tutor_profiles` NO es redundante con la RLS: la
        // política `tutor_profiles_select_public` deja leer la fila de CUALQUIER
        // tutor aprobado, así que sin filtro esto trae muchas filas y
        // `maybeSingle()` devuelve error en vez de la propia.
        const [{ data: roleRows }, { data: tutorProfile }] = await Promise.all([
          supabase.from("user_roles").select("role"),
          supabase
            .from("tutor_profiles")
            .select("profile_id")
            .eq("profile_id", user.id)
            .maybeSingle(),
        ]);
        target = pickHome((roleRows ?? []).map((r) => r.role as AppRole), {
          esTutor: Boolean(tutorProfile),
          // El último panel de este navegador (`ey-panel`), que ya no se borra
          // al cerrar sesión. Solo aplica a quien vuelve: un alta trae `intent`
          // y sale por arriba.
          panel: panelDeCookie(),
        });
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
