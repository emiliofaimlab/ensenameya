import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { adminSidebarBadges } from "@/lib/admin/sidebar-badges";
import {
  toNotice,
  type AppNotice,
  type NotificationRow,
} from "@/lib/notifications";
import { TZ_COOKIE } from "@/lib/tz";
import { PANEL_COOKIE } from "@/lib/panel";
import { pickHome, panelValido, type AppRole } from "./roles";

/**
 * Guardas de ruta por rol (Doc 3), reutilizables en Server Components,
 * Route Handlers y Server Actions. Todo pasa por RLS (cliente ANON + sesión);
 * el `service_role` jamás se usa aquí.
 */

/**
 * Lo que de verdad se usa del usuario en toda la app (`id`, `email` y el
 * `user_metadata` del alta). Era el `User` entero de supabase-js, y traerlo
 * costaba un `auth.getUser()` — un viaje de red al servidor de Auth por cada
 * pantalla. Los tres campos viajan YA dentro del JWT, así que con la firma
 * verificada salen gratis. Ver la nota de `getSessionContext`.
 */
export type SessionUser = {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
};

type SessionContext = {
  user: SessionUser | null;
  roles: AppRole[];
  onboardingComplete: boolean;
  /**
   * Nombre y foto de `profiles`, para el menú de cuenta. Salen de la consulta
   * que ya se hacía. El metadata de Auth NO sirve: viaja dentro del JWT, así
   * que se queda con lo que hubiera al emitirlo (y hay altas que nunca lo
   * escriben) — por eso a algunas cuentas les salía el correo.
   */
  fullName: string | null;
  avatarPath: string | null;
  /** `profiles.timezone` crudo. Viaja aquí para que `zonaDelPerfil()` no repita
   *  el `auth.getUser()` + consulta que esta función ya hizo. */
  timezone: string | null;
  /** Los avisos de la campana. Vienen en el MISMO viaje que roles y perfil
   *  (`session_bootstrap`); el layout ya no los pide por separado. */
  notices: AppNotice[];
};

/**
 * Lee el usuario validado (auth server), sus roles y el flag de onboarding.
 *
 * ⚠️ `cache()` NO es un adorno: sin él esto se ejecutaba ENTERO una vez por
 * llamante y `auth.getUser()` es un viaje de red al servidor de Auth (medido:
 * 250–400 ms). En una navegación al panel había como mínimo tres —layout,
 * página y `zonaDelPerfil()`— más el del proxy: ~1 s de revalidar al mismo
 * usuario antes de mirar un solo dato de la pantalla. `cache()` es por request,
 * así que dos requests distintos siguen validando de verdad.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  // ⚠️ `getClaims()`, NO `getUser()`. Este proyecto firma con **ES256** y
  // publica su JWKS, así que la librería verifica la firma EN LOCAL (medido:
  // 17 ms contra los ~300 ms del viaje al servidor de Auth). Es la misma
  // garantía criptográfica, no un `getSession()` a ciegas: un token manipulado
  // no pasa la verificación. Si algún día el proyecto volviera a HS256, la
  // propia librería cae sola al viaje de red — más lento, nunca inseguro.
  const { data: verificado } = await supabase.auth.getClaims();
  const claims = verificado?.claims;
  const user: SessionUser | null = claims
    ? {
        id: claims.sub,
        email: claims.email ?? null,
        user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown>,
      }
    : null;

  const empty = {
    fullName: null,
    avatarPath: null,
    timezone: null,
    notices: [] as AppNotice[],
  };
  if (!user)
    return { user: null, roles: [], onboardingComplete: false, ...empty };

  // Roles + perfil + avisos EN UN VIAJE (`20260909120000`). Eran tres consultas
  // y dos peldaños de latencia —los avisos necesitan el id que devuelven las
  // otras dos—, y los pagaba entera cada pantalla con sesión. La RLS sigue
  // delante: la función es `security invoker`.
  const { data, error } = await supabase.rpc("session_bootstrap");
  // ⚠️ Regla de oro 10: `const { data } = …` convierte el fallo en una lista
  // vacía, que es una mentira creíble. Y aquí la mentira no es un contador a
  // cero: sin roles y con `onboardingComplete = false`, TODO usuario con sesión
  // rebota a `/onboarding` — un fallo del RPC es indistinguible de una cuenta
  // recién creada, y sin esta línea no deja rastro en ninguna parte.
  //
  // NO se lanza a propósito. `getSessionContext()` lo llaman también los
  // layouts públicos y varios route handlers SIN try/catch: un `throw` aquí
  // convertiría «el panel está roto» en «el sitio entero devuelve 500 a
  // cualquiera con cookie de sesión», legales incluidos. El flujo se queda
  // exactamente como estaba; lo único que cambia es que ahora se ve.
  // El `cache()` de arriba garantiza UNA línea por petición, no una por
  // llamante.
  if (error) console.error("[session_bootstrap]", error.code, error.message);
  const boot = (data ?? {}) as {
    roles?: AppRole[];
    profile?: {
      onboarding_complete: boolean;
      full_name: string | null;
      avatar_path: string | null;
      timezone: string | null;
    } | null;
    notices?: NotificationRow[];
  };
  const profile = boot.profile ?? null;

  return {
    user,
    roles: boot.roles ?? [],
    onboardingComplete: profile?.onboarding_complete ?? false,
    fullName: profile?.full_name ?? null,
    avatarPath: profile?.avatar_path ?? null,
    timezone: profile?.timezone ?? null,
    notices: (boot.notices ?? []).map(toNotice),
  };
});

/** Usuario actual o `null` (sin redirección). */
export async function getUser(): Promise<SessionUser | null> {
  return (await getSessionContext()).user;
}

/**
 * ⚠️ RV-03 · `'UTC'` en `profiles.timezone` significa «nadie la fijó», no «vive
 * en UTC».
 *
 * Es el **default de la columna**, y un navegador real nunca devuelve esa
 * cadena: `Intl` da nombres IANA (`America/Caracas`, `Europe/London`, incluso
 * `Atlantic/Reykjavik` para quien de verdad está en UTC+0). Comprobado en dev:
 * de 25 perfiles, 20 tienen zona IANA y **5 tienen el literal `'UTC'`**, que
 * salieron del default.
 *
 * Esos 5 veían las horas desplazadas —hasta +8 h— bajo un rótulo que decía
 * «tu hora local», porque las dos funciones de abajo devolvían ese `'UTC'` tal
 * cual y nunca llegaban a mirar la cookie del navegador.
 *
 * El desplazamiento que se reportó (+7 h, a veces +1 día) venía de aquí, NO de
 * que unas pantallas pasaran `timeZone` y otras no: todas la pasan. Lo que
 * fallaba era el valor que se les pasaba.
 *
 * Coste del arreglo: si alguien eligiera `UTC` a propósito en el selector y su
 * navegador dijera otra cosa, le mostraríamos la de su navegador. A cambio de
 * arreglar al 20 % de las cuentas, es un cambio que vale la pena. La solución
 * sin ese coste —columna anulable o marca de «configurada»— toca
 * `get_available_slots`, que interpreta la disponibilidad del tutor en esta
 * misma zona, y no es un cambio para hacer con prisa.
 */
function zonaConfigurada(valor: string | null | undefined): string | null {
  const tz = valor?.trim();
  return tz && tz !== "UTC" ? tz : null;
}

/** La que el navegador dejó en la cookie `ey-tz` (`TimezoneSync`), si la hay. */
async function zonaDelNavegador(): Promise<string | null> {
  const jar = await cookies();
  const cruda = jar.get(TZ_COOKIE)?.value;
  return zonaConfigurada(cruda ? decodeURIComponent(cruda) : null);
}

/** `profiles.timezone` del usuario en sesión, solo si está configurada. */
async function zonaDelPerfil(): Promise<string | null> {
  // Sale del contexto memoizado: pedirlo por separado eran otro viaje al
  // servidor de Auth y otra consulta a `profiles` para leer una columna que ya
  // venía en la misma fila.
  return zonaConfigurada((await getSessionContext()).timezone);
}

/**
 * Zona horaria IANA del usuario. Para formatear horas en componentes
 * **server**: sin ella el SSR usa la del servidor —UTC— y no la del usuario
 * (bug R24-12 / RN-01/02). `cache()` la memoiza por request.
 *
 * Orden: la del perfil si está configurada → la del navegador → "UTC".
 */
export const getUserTimezone = cache(async (): Promise<string> => {
  return (await zonaDelPerfil()) ?? (await zonaDelNavegador()) ?? "UTC";
});

/**
 * Zona horaria del **visitante**, tenga sesión o no (R24-22).
 *
 * Es la que deben usar las pantallas **públicas** con horarios: un visitante en
 * Venezuela tiene que ver la clase de un tutor de México en su propia hora.
 *
 * Hoy resuelve igual que `getUserTimezone` —las dos prefieren el perfil y caen
 * al navegador— y se conservan separadas porque expresan intenciones distintas:
 * una es «el usuario», la otra «quien esté mirando». Antes divergían de verdad,
 * y esa divergencia era la mitad de RV-03.
 */
export const getViewerTimezone = cache(async (): Promise<string> => {
  return (await zonaDelPerfil()) ?? (await zonaDelNavegador()) ?? "UTC";
});

/** Roles del usuario actual (vacío si anónimo). */
export async function getUserRoles(): Promise<AppRole[]> {
  return (await getSessionContext()).roles;
}

/**
 * Exige sesión. Si no hay, redirige a /login conservando el destino previo
 * (`?next=`, SCR-AU01). Devuelve el contexto con `user` no nulo.
 */
export async function requireUser(): Promise<
  { user: SessionUser } & Omit<SessionContext, "user">
> {
  const ctx = await getSessionContext();
  if (!ctx.user) {
    const next = await currentPath();
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  // US-201 / RN-44: onboarding obligatorio antes de usar el área autenticada.
  // `/tutor/onboarding` también vale: recoge los mismos básicos (nombre, zona
  // horaria, teléfono) y marca `onboarding_complete` al guardarlos, así que
  // obligar a pasar antes por el de alumno sería pedir dos veces lo mismo.
  const path = await currentPath();
  const enAlgunOnboarding =
    path === "/onboarding" || path === "/tutor/onboarding";
  if (!ctx.onboardingComplete && !enAlgunOnboarding) {
    // Quien se registró para ENSEÑAR va a su propio asistente. `intended_role`
    // en el metadata de Auth es el único rastro de esa elección: el rol `tutor`
    // solo se concede al aprobar (US-1101), así que mirar los roles aquí manda
    // a todo el mundo al asistente de alumno. Este es el embudo de `(app)`, así
    // que arreglarlo aquí cierra los tres caminos (alta, login y callback).
    // `?start=1` entra directo al formulario: sin él, la pantalla de bienvenida
    // ofrece un "Ahora no" → `/app` que volvería a rebotar aquí (bucle). No se
    // pasa `?next=`: esa página no lo lee.
    redirect(
      ctx.user.user_metadata?.intended_role === "tutor"
        ? "/tutor/onboarding?start=1"
        : `/onboarding?next=${encodeURIComponent(path)}`,
    );
  }
  return { ...ctx, user: ctx.user };
}

/**
 * Exige NO tener sesión (login/registro). Si ya hay sesión, manda a su home.
 */
/**
 * A dónde pertenece este usuario.
 *
 * ⚠️ Existe porque TRES puertas necesitaban esta respuesta y cada una la
 * calculaba a su manera, con resultados distintos para la MISMA cuenta
 * (verificado en vivo el 11-sep-2026 con un tutor aprobado):
 *   · el callback de OAuth  → `/tutor`   ✓
 *   · `requireGuest()`      → `/admin`, ignorando la cookie del panel
 *   · la salida de `/onboarding` → `/app`, con la ruta escrita a pelo
 *
 * Las dos pistas que se perdían por el camino son siempre las mismas: que el
 * rol `tutor` solo se concede al APROBAR —así que quien está en revisión no lo
 * tiene y hay que mirar `tutor_profiles`— y de qué panel venías.
 *
 * La consulta de más solo corre en puertas de paso, nunca en una pantalla.
 */
export async function destinoDeUsuario(
  userId: string,
  roles: AppRole[],
): Promise<string> {
  const supabase = await createClient();
  // El `.eq()` no es redundante con la RLS: `tutor_profiles_select_public` deja
  // leer la fila de CUALQUIER tutor aprobado, así que sin filtro esto trae
  // muchas filas y `maybeSingle()` devuelve error en vez de la propia.
  const { data: tutorProfile, error } = await supabase
    .from("tutor_profiles")
    .select("profile_id")
    .eq("profile_id", userId)
    .maybeSingle();
  // Regla de oro 10: si falla, el destino cae al panel de alumno sin que nada
  // lo diga.
  if (error) {
    console.error("[destinoDeUsuario] tutor_profiles", error.code, error.message);
  }
  return pickHome(roles, {
    esTutor: Boolean(tutorProfile),
    panel: panelValido((await cookies()).get(PANEL_COOKIE)?.value),
  });
}

export async function requireGuest(): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx.user) return;

  redirect(await destinoDeUsuario(ctx.user.id, ctx.roles));
}

/**
 * Exige un rol concreto. Sin sesión → /login; con sesión pero sin el rol →
 * su propio home (no se filtra que la ruta existía).
 */
export async function requireRole(
  role: AppRole,
): Promise<{ user: SessionUser; roles: AppRole[] }> {
  const ctx = await requireUser();
  // ⚠️ Sí, esto es UI dentro del fichero de guardas, y se hace a sabiendas:
  // `await requireRole("admin")` es la PRIMERA línea de las quince pantallas
  // del panel y el único punto por el que pasan todas. `AdminShell` pide los
  // contadores desde dentro del árbol que devuelve la pantalla, o sea al final
  // de todos sus `await`; lanzarlos aquí sin esperarlos los solapa con las
  // consultas propias de la pantalla. Un `admin/layout.tsx` no sirve para esto:
  // en una navegación de cliente dentro de /admin/* los layouts por encima del
  // punto de divergencia no se re-ejecutan. `adminSidebarBadges` está memoizada
  // con `cache()`, así que el shell encuentra la promesa en vuelo, no otra.
  // El `.catch` evita que un fallo de red en una promesa sin dueño tumbe el
  // proceso; el error real lo sigue viendo quien haga `await`. Va DESPUÉS de la
  // comprobación del rol: quien no es admin se va por el `redirect` sin pagar
  // tres consultas que además la RLS le contestaría a cero.
  if (!ctx.roles.includes(role)) redirect(pickHome(ctx.roles));
  if (role === "admin") void adminSidebarBadges().catch(() => {});
  return ctx;
}

/** Ruta actual, leída del header `x-pathname` que inyecta el proxy. */
async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get("x-pathname") ?? "/app";
}
