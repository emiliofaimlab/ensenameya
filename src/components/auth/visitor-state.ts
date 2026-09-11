import "server-only";

import { getSessionContext } from "@/lib/auth/server";
import { hasTutorProfile } from "@/lib/auth/tutor";
import { destinoDeAsistente, pickHome, ROLE_HOME } from "@/lib/auth/roles";

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
 * Sin `cache()` propia: no queda nada que memoizar. Las DOS lecturas que hace
 * —`getSessionContext()` y `leerPerfilDeTutor()` por debajo de
 * `hasTutorProfile()`— ya lo están cada una por su cuenta, así que la portada y
 * el banner del pie pidiéndolo en el mismo render no cuestan ni un viaje extra.
 * El resto del cuerpo es decidir un `href`. La `cache()` que había aquí se
 * justificaba diciendo que `getSessionContext()` no estaba memoizada; lo está.
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

export async function getVisitorState(): Promise<VisitorState> {
  const { user, roles, onboardingComplete } = await getSessionContext();
  if (!user) return { anonimo: true, homeHref: null, teachHref: null };

  // ⚠️ El asistente pendiente manda sobre el panel, y los DOS destinos apuntan
  // ahí: mandar a alguien a `/app` o a `/tutor` con el onboarding a medias es
  // mandarlo a un `redirect()` de servidor, que desde una ruta pública deja la
  // pantalla en blanco (medido el 11-sep-2026).
  const pendiente = destinoDeAsistente(
    onboardingComplete,
    user.user_metadata?.intended_role,
  );
  if (pendiente) {
    return { anonimo: false, homeHref: pendiente, teachHref: pendiente };
  }

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
}
