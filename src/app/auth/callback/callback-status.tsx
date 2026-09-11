"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import {
  panelDeCookie,
  pickHome,
  safeNext,
  type AppRole,
} from "@/lib/auth/roles";

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
  providerError,
  providerErrorDescription,
  next,
  intent,
  referralCode,
  termsVersion,
  termsLocale,
}: {
  code: string | null;
  /** `?error=` y `?error_description=` con los que vuelve Supabase cuando el
   *  usuario cancela en Google o el proveedor rechaza. Solo se registran: al
   *  usuario se le sigue enseñando un mensaje, no el texto del proveedor. */
  providerError: string | null;
  providerErrorDescription: string | null;
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
        // Antes esto era mudo y trataba igual tres cosas muy distintas: que el
        // usuario cancelara en Google, que el proveedor rechazara con un motivo
        // concreto, y que alguien abriera /auth/callback a pelo. El motivo lo
        // manda Supabase y no costaba nada mirarlo.
        if (providerError) {
          console.error(
            "[callback] el proveedor rechazó",
            providerError,
            providerErrorDescription ?? "(sin descripción)",
          );
        }
        router.replace("/login?error=oauth");
        return;
      }

      // Apaga el auto-canje de `?code=`: aquí lo canjea la línea de abajo,
      // que necesita el `code_verifier` intacto. El porqué largo, en
      // `lib/supabase/client.ts`.
      const supabase = createClient({ detectSessionInUrl: false });
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
        // ⚠️ Regla de oro 10. Esto era un `await` a pelo: si la RPC fallaba
        // —caduca la sesión, cambia un grant, se cae la red— el alta seguía
        // adelante sin constancia legal y sin rastro en ninguna parte. No se
        // aborta el flujo (dejar al usuario fuera es peor que entrar sin la
        // fila), pero deja de ser invisible.
        const { error: errTerms } = await supabase.rpc(
          "record_terms_acceptance",
          { p_version: termsVersion, p_locale: termsLocale ?? "en" },
        );
        if (errTerms) {
          console.error(
            "[callback] no se grabó la aceptación de términos",
            termsVersion,
            errTerms.code,
            errTerms.message,
          );
        }
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
        // Si esto falla, el asistente de alumno no sabrá que a esta persona le
        // queda además el de tutor, y no fallará nada a la vista: exactamente
        // el tipo de pérdida que hay que poder ver en la consola.
        const { error: errIntent } = await supabase.auth.updateUser({
          data: { intended_role: intent },
        });
        if (errIntent) {
          console.error(
            "[callback] no se guardó intended_role",
            intent,
            errIntent.message,
          );
        } else {
          /*
           * ⚠️ `updateUser` guarda el metadata pero NO reemite el JWT, y el
           * servidor lee los claims del token (`getClaims()`), no de la base.
           * O sea que `intended_role` no existía para nadie del lado servidor
           * hasta que el token caducara —hasta una hora—, y `requireUser()`,
           * que decide con él a qué asistente mandarte, veía el valor viejo.
           *
           * Eso es lo que hacía que quien elegía «Quiero enseñar» y pulsaba
           * «Ahora no» acabara rellenando el formulario de ALUMNO: el rebote
           * de `requireUser` no sabía todavía que era un aspirante a tutor.
           * Verificado en vivo el 11-sep-2026.
           *
           * Un refresco lo reemite con el metadata dentro. Solo corre aquí,
           * que es donde acabamos de escribirlo: un viaje más en el alta, cero
           * en los logins.
           */
          const { error: errRefresh } = await supabase.auth.refreshSession();
          if (errRefresh) {
            console.error(
              "[callback] el JWT se quedó sin intended_role",
              errRefresh.message,
            );
          }
        }
      }
      /*
       * US-1302: el metadata de Google no trae el código, así que el perfil lo
       * crea sin él y hay que estamparlo aquí.
       *
       * ⚠️ SOLO EN ALTAS NUEVAS, y esto no es una precaución teórica.
       * Verificado en vivo el 11-sep-2026: una cuenta VETERANA —mismo `id`,
       * `onboarding_complete` ya en `true`— que entrara por un enlace con
       * `?ref=` se quedaba con el código del referidor. El `.is(…, null)` de
       * abajo impide PISAR una atribución previa, pero no comprueba que la
       * cuenta acabe de nacer: bastaba un LOGIN, no hacía falta un alta. O
       * sea que cualquiera podía atribuirse usuarios que ya existían con solo
       * hacerles entrar por su enlace, y como el primero que pasa se lo queda
       * para siempre, tampoco había forma de corregirlo después.
       *
       * ponytail: la ventana de 5 min es el TECHO de este arreglo. Auth no
       * dice «este usuario es nuevo» por ninguna parte y `created_at` es lo
       * más cercano que hay; el margen cubre un onboarding lento de Google sin
       * llegar a abarcar una sesión posterior. Si algún día hiciera falta
       * exactitud, el sitio es `handle_new_user`, que sí sabe que está
       * insertando una fila nueva.
       */
      const reciénNacida =
        Date.now() - new Date(user.created_at).getTime() < 5 * 60 * 1000;
      if (referralCode && reciénNacida) {
        const { error: errRef } = await supabase
          .from("profiles")
          .update({ referral_code: referralCode })
          .eq("id", user.id)
          .is("referral_code", null);
        if (errRef) {
          console.error(
            "[callback] no se estampó el referido",
            referralCode,
            errRef.code,
            errRef.message,
          );
        }
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
      /*
       * ⚠️ Y la intención gana también al `next`, que es lo que faltaba.
       *
       * Con `if (!target && intent)` la intención solo decidía cuando `next`
       * venía vacío — o sea, casi nunca: el MODAL, que es la puerta principal
       * de alta, rellena `next` SIEMPRE con la ruta actual
       * (`signup-dialog.tsx`). Verificado en vivo el 11-sep-2026:
       * `/signup?next=/tutors` + «Quiero enseñar» + Google aterrizaba en
       * `/tutors`, una lista pública, sin que nada llevara al recién llegado
       * hacia ser tutor. El selector no decidía nada por este camino.
       *
       * Peor aún: `/tutors` es PÚBLICA, así que `requireUser()` —que sí sabe
       * rescatar a un aspirante a tutor— no llegaba a correr nunca.
       *
       * El `next` no se tira, se traslada: `/onboarding` sabe volver a él al
       * terminar (lee `?next=`), así que quien viene a aprender hace el
       * asistente y aterriza donde estaba.
       *
       * ponytail: para `intent=tutor` el `next` SÍ se pierde, y es el techo de
       * este arreglo. `/tutor/onboarding` no lee `?next=` (lo dice también
       * `requireUser`), y darle soporte es tocar el asistente entero. Quien
       * acaba de decir «quiero enseñar» entra al flujo de enseñar; volver a la
       * lista de tutores importa menos.
       */
      // La decisión vive entera en el bloque de abajo: necesita saber si el
      // onboarding está pendiente, y eso es una consulta.

      /*
       * ⚠️ ESTO SE CONSULTA SIEMPRE, Y EL `onboarding_complete` ES EL MOTIVO.
       *
       * El destino tiene que quedar RESUELTO aquí, porque navegar a una ruta
       * que luego redirige desde el servidor es exactamente la pantalla en
       * blanco que se reportó. Reproducida contra un build de producción el
       * 11-sep-2026: `router.replace("/app")` → `/app` responde con un
       * `redirect()` hacia `/onboarding` → el router de Next se queda con el
       * árbol VACÍO y se pone a pedir el RSC de esa URL ~20 veces por segundo,
       * para siempre. El servidor contesta 87 bytes con `"f":[]` («ya estás al
       * día»), el cliente sigue sin nada que pintar, y vuelve a pedir.
       *
       * La misma URL cargada DE CERO renderiza perfectamente: el fallo es solo
       * del camino de navegación de cliente. Y por eso solo lo veían algunas
       * personas — las que tenían el onboarding pendiente — y por eso
       * `next dev` no lo enseñaba.
       *
       * Regla que sale de aquí: **el callback no navega a ninguna ruta que
       * vaya a redirigir**. Lo que `requireUser()` decidiría al llegar se
       * decide antes, en esta pantalla.
       */
      {
        // Mismo cálculo que el login por correo, `esTutor` incluido: el rol
        // `tutor` solo se concede al APROBAR, así que sin esa pista quien está
        // en revisión entraba con Google al panel de alumno.
        //
        // ⚠️ El `.eq()` de `tutor_profiles` NO es redundante con la RLS: la
        // política `tutor_profiles_select_public` deja leer la fila de CUALQUIER
        // tutor aprobado, así que sin filtro esto trae muchas filas y
        // `maybeSingle()` devuelve error en vez de la propia.
        const [
          { data: roleRows, error: errRoles },
          { data: tutorProfile, error: errTutor },
          { data: perfil, error: errPerfil },
        ] = await Promise.all([
          // ⚠️ Este `.eq()` tampoco es decorativo: `has_role('admin')` deja a
          // un admin LEER la tabla entera, así que sin filtro esto traía los
          // roles de todo el mundo y `pickHome` decidía con los de otros.
          supabase.from("user_roles").select("role").eq("user_id", user.id),
          supabase
            .from("tutor_profiles")
            .select("profile_id")
            .eq("profile_id", user.id)
            .maybeSingle(),
          supabase
            .from("profiles")
            .select("onboarding_complete")
            .eq("id", user.id)
            .maybeSingle(),
        ]);
        // ⚠️ Regla de oro 10 otra vez, y aquí la mentira es cara: un fallo de
        // la consulta de roles es indistinguible de «esta persona solo es
        // alumno», así que un admin o un tutor acaba en /app y nada lo dice.
        if (errRoles) {
          console.error("[callback] roles", errRoles.code, errRoles.message);
        }
        if (errTutor) {
          console.error(
            "[callback] tutor_profiles",
            errTutor.code,
            errTutor.message,
          );
        }
        if (errPerfil) {
          console.error("[callback] perfil", errPerfil.code, errPerfil.message);
        }

        /*
         * EL DESTINO, EN UN SOLO SITIO Y EN ESTE ORDEN. Cada rama aterriza en
         * una ruta que RENDERIZA; ninguna en una que vaya a redirigir.
         *
         *  1. «Quiero enseñar» → su asistente, siempre. Sabe manejar los dos
         *     casos por sí mismo (bienvenida si empieza, «Ya eres tutor» si el
         *     perfil está aprobado), así que nunca redirige.
         *  2. Asistente de alumno PENDIENTE → se va a él directo, llevándose
         *     el `next` para volver al terminar. Ésta es la rama que antes iba
         *     a `/app` y dejaba que `requireUser()` redirigiera desde el
         *     servidor: la pantalla en blanco.
         *  3. Con el onboarding ya hecho, manda el `next`; y si no hay, el rol.
         *
         * ⚠️ Con el onboarding HECHO no se pasa por `/onboarding` ni aunque
         * venga `intent=alumno` —que es el valor por DEFECTO del selector de
         * `/signup`, o sea que llega sin que nadie lo elija—. Esa pantalla
         * redirige nada más entrar, y eso es justo lo que no puede ocurrir en
         * medio de una navegación de cliente.
         */
        const pendiente = perfil?.onboarding_complete === false;
        const aspiranteATutor =
          intent === "tutor" ||
          (!intent && user.user_metadata?.intended_role === "tutor");
        const conNext = (base: string) =>
          target ? `${base}?next=${encodeURIComponent(target)}` : base;

        if (aspiranteATutor) {
          // `?start=1` solo cuando la intención viene del metadata y no de esta
          // pantalla: quien acaba de pulsar «Quiero enseñar» merece ver primero
          // la bienvenida, igual que hace `requireUser()` al rebotar.
          target =
            intent === "tutor"
              ? "/tutor/onboarding"
              : "/tutor/onboarding?start=1";
        } else if (pendiente) {
          target = conNext("/onboarding");
        } else if (!target) {
          target = pickHome(
            (roleRows ?? []).map((r) => r.role as AppRole),
            {
              esTutor: Boolean(tutorProfile),
              // El último panel de este navegador (`ey-panel`), que ya no se
              // borra al cerrar sesión.
              panel: panelDeCookie(),
            },
          );
        }
      }
      setDest(target);
      /*
       * ⚠️ CARGA ENTERA, y no `router.replace()` + `router.refresh()`.
       *
       * Esto es la red que hace que la pantalla en blanco no pueda volver por
       * otra puerta. El bloque de arriba evita los redirects de servidor que
       * CONOCEMOS (el del onboarding), pero no puede conocerlos todos: un
       * `?next=` a cualquier ruta con guarda de rol acabaría igual, y la próxima
       * guarda que alguien añada también.
       *
       * Lo medido el 11-sep-2026 contra un build de producción: un `redirect()`
       * de servidor alcanzado a mitad de una navegación de CLIENTE deja al
       * router de Next con el árbol vacío, y desde ahí pide el RSC de esa URL
       * ~20 veces por segundo para siempre, pintando nada. La MISMA URL cargada
       * de cero renderiza perfecta. Así que se carga de cero.
       *
       * El coste es un viaje más, en una pantalla que ya es un spinner después
       * de ida y vuelta a Google: no se nota. Y de regalo se cae el
       * `router.refresh()`, que estaba ahí justo para que el servidor volviera
       * a leer las cookies de sesión recién escritas — cosa que una carga
       * entera hace por definición.
       */
      window.location.replace(target);
    }

    // ⚠️ `void run()` a secas dejaba el spinner girando PARA SIEMPRE si algo
    // lanzaba: la excepción ocurre dentro de un efecto ya montado, así que no
    // hay `error.tsx` que la recoja ni pantalla que cambie. El usuario se
    // quedaba mirando «Verificando tu cuenta…» sin nada más que hacer.
    void run().catch((e) => {
      console.error("[callback] el flujo se cayó entero", e);
      router.replace("/login?error=oauth");
    });
  }, [
    code,
    providerError,
    providerErrorDescription,
    next,
    intent,
    referralCode,
    termsVersion,
    termsLocale,
    router,
  ]);

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
