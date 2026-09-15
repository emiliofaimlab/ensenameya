import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { tutorSidebarBadges } from "@/lib/tutor/sidebar-badges";
import { requireUser } from "./server";

type Approval = Database["public"]["Enums"]["tutor_approval_status"];

/**
 * La fila de `tutor_profiles` del usuario, o `null`. Sin guardas ni redirección.
 *
 * ⚠️ Es la puerta ÚNICA a esa lectura, y por eso está memoizada y exportada.
 * Antes cada llamante hacía la suya: `requireTutorProfile` una y
 * `hasTutorProfile` otra, a la misma tabla y por la misma clave. Y sobre todo,
 * `requireTutorProfile` la resolvía DESPUÉS de la sesión y ANTES de que la
 * pantalla lanzara sus propias consultas — medido en `/tutor/products`: un
 * peldaño de ~300 ms que pagaban las diez pantallas del tutor sin que ninguna
 * necesitara su resultado para pedir lo suyo.
 *
 * Se exporta para `hasTutorProfile()` y para `visitor-state.ts`, que la piden
 * sin pasar por la guarda. **No se adelanta desde ningún layout**: `(app)/tutor/
 * layout.tsx` lo intentaba y no servía ni en carga dura, porque layout y
 * pantalla se renderizan CONCURRENTEMENTE y el primer `await` de la pantalla
 * es esta misma llamada — no había nada con lo que solaparla.
 *
 * ⚠️ `payout_country` viaja aquí y no lo pide nadie más: es UNA COLUMNA de esta
 * misma fila, y `/tutor/payouts` la releía por su cuenta DESPUÉS de esta
 * lectura — un viaje entero para un dato que ya venía de camino. Peor: de ella
 * cuelgan otros dos peldaños (`rielesDelPais()` y el catálogo de bancos), así
 * que traerla aquí es lo que permite lanzarlos con el resto en paralelo. El
 * `select` de tabla lo tiene `authenticated` desde `20260706120000:171`; lo que
 * `20260908130000` revocó de esta columna fue el UPDATE/INSERT, no la lectura.
 * Los demás llamantes no se enteran: la columna se suma, no sustituye a nada.
 */
export const leerPerfilDeTutor = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("approval_status, payout_country")
    .eq("profile_id", userId)
    .maybeSingle();
  return data;
});

/**
 * Exige haber iniciado el onboarding de tutor (fila en `tutor_profiles`). Un
 * tutor puede preparar productos en borrador antes de la aprobación; PUBLICAR
 * exige `approved` (RN-23), lo fuerza el trigger `products_publish_guard` en BD.
 * Sin fila → a onboarding (no es tutor todavía).
 */
export async function requireTutorProfile(): Promise<{
  userId: string;
  approvalStatus: Approval;
  /** El país que rutea SUS payouts. Sale de la zona horaria (`20260908130000`);
   *  `null` = todavía sin determinar. Va aquí para que `/tutor/payouts` no
   *  vuelva a pedir la misma fila — ver la cabecera de `leerPerfilDeTutor`. */
  payoutCountry: string | null;
}> {
  const { user } = await requireUser();
  // ⚠️ Aquí, y no en `(app)/tutor/layout.tsx`, es donde se ADELANTAN los siete
  // contadores del menú. `TutorShell` los pide desde dentro del árbol que
  // devuelve la PANTALLA, así que sin este empujón son el último peldaño del
  // render: no arrancan hasta que la pantalla ha terminado todos sus `await`.
  // El layout no valía porque en una navegación de cliente dentro de /tutor/*
  // los layouts por encima del punto de divergencia NO se re-ejecutan — la
  // precarga solo corría en carga dura. Esta función sí abre las nueve
  // pantallas del panel (la décima, `verification`, lleva su propia línea).
  // Va ANTES del `await` de abajo a propósito: es el solape que se persigue.
  // El `.catch` es obligatorio en una promesa sin dueño —sin él un fallo de red
  // tumbaría el proceso con un rechazo no capturado—; el error real lo sigue
  // viendo quien haga `await` de la promesa memoizada, que es `TutorShell`.
  void tutorSidebarBadges(user.id).catch(() => {});
  const data = await leerPerfilDeTutor(user.id);

  if (!data) redirect("/tutor/onboarding");
  return {
    userId: user.id,
    approvalStatus: data.approval_status,
    payoutCountry: data.payout_country,
  };
}

/**
 * ¿Tiene perfil de tutor? Sin redirigir, para decidir cosas de UI (qué menú
 * pintar). Sale de la misma lectura memoizada, así que no cuesta un viaje
 * propio a quien ya la haya pedido.
 */
export const hasTutorProfile = async (userId: string) =>
  Boolean(await leerPerfilDeTutor(userId));
