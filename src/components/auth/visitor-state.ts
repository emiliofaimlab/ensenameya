import "server-only";

import { cache } from "react";

import { getSessionContext } from "@/lib/auth/server";
import { hasTutorProfile } from "@/lib/auth/tutor";
import { pickHome, ROLE_HOME } from "@/lib/auth/roles";

/**
 * N-01 · Qué debe ofrecer un CTA público según quién lo esté mirando.
 *
 * El síntoma comprobado (no el del enunciado): los botones "Quiero enseñar YA"
 * de la portada y del banner apuntaban fijos a `/signup`, y `/signup` está bajo
 * el layout `(auth)`, que llama a `requireGuest()`. Con sesión, ese guarda
 * redirige a `pickHome(roles)` **sin** el flag `esTutor`, así que:
 *
 * · tutor APROBADO (rol `tutor`) → acababa en `/tutor`, pero tras un rebote;
 * · tutor PENDIENTE de aprobación → sus roles siguen siendo `[alumno]` (el rol
 *   se concede al aprobar, `20260714120000`), así que aterrizaba en **`/app`**,
 *   el panel de ALUMNO — justo el contrario de lo que acababa de pulsar;
 * · alumno sin perfil de tutor → lo mismo, `/app`, y nunca veía el asistente.
 *
 * Aquí se resuelve el destino ANTES de pintar el enlace, para que nadie llegue
 * por rebote y nadie termine en el panel equivocado.
 *
 * `cache()` porque la portada y el banner del pie lo piden en el mismo render y
 * `getSessionContext()` no está memoizada: sin esto serían dos `auth.getUser()`.
 */
export type VisitorState = {
  /** Sin sesión: los CTA de alta abren el modal en vez de navegar. */
  anonimo: boolean;
  /** Panel propio (home por rol). `null` si es anónimo. */
  homeHref: string | null;
  /**
   * Destino de "Quiero enseñar". `null` cuando es anónimo, que en ese caso el
   * destino no es una ruta sino el alta —modal o `/signup?intent=tutor`—, y
   * eso lo decide quien pinta el botón.
   */
  teachHref: string | null;
};

export const getVisitorState = cache(async (): Promise<VisitorState> => {
  const { user, roles } = await getSessionContext();
  if (!user) return { anonimo: true, homeHref: null, teachHref: null };

  const homeHref = pickHome(roles);

  // Con el rol ya concedido no hace falta preguntar por el perfil: tenerlo es
  // condición previa a que el admin lo apruebe.
  if (roles.includes("tutor")) {
    return { anonimo: false, homeHref, teachHref: ROLE_HOME.tutor };
  }

  // Sin el rol, la pregunta es si YA empezó. Con perfil (aunque esté pendiente
  // o rechazado) manda `/tutor`: esa pantalla resuelve sola la cascada y es la
  // que enseña el estado de la solicitud. Sin perfil, al asistente directo.
  const empezado = await hasTutorProfile(user.id);
  return {
    anonimo: false,
    homeHref,
    teachHref: empezado ? ROLE_HOME.tutor : "/tutor/onboarding",
  };
});
