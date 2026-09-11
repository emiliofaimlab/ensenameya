import type { HeaderUser } from "@/components/layout/site-header";
import { storageUrl } from "@/lib/catalog/format";
import { destinoDeAsistente, panelsFor, pickHome, type AppRole } from "./roles";
import type { SessionUser } from "./server";

/**
 * Reduce el `User` de Supabase a lo que el header necesita (nada sensible).
 * `homeHref` sale de `pickHome` (gana el rol más privilegiado) para que "Panel"
 * lleve a cada quien al suyo: admin → /admin, tutor → /tutor, alumno → /app.
 * Un enlace fijo a /app mandaría al tutor al panel del alumno.
 *
 * `panels` son TODOS los que puede ver, no solo el principal: con eso el menú
 * de cuenta pinta el switch de rol.
 *
 * El nombre y la foto llegan de `profiles` (los trae `getSessionContext`). El
 * metadata de Auth queda de reserva: viaja en el JWT y hay altas que no lo
 * escriben, que es lo que dejaba a algunas cuentas enseñando el correo.
 */
export function toHeaderUser(
  user: SessionUser | null,
  roles: AppRole[] = [],
  profile: {
    fullName?: string | null;
    avatarPath?: string | null;
    /** ⚠️ Sin esto el enlace «Panel» del header apunta a `/app` para quien tiene
     *  el onboarding a medias, y `/app` redirige desde el servidor: pantalla en
     *  blanco. Ver `destinoDeAsistente`. */
    onboardingComplete?: boolean;
  } = {},
): HeaderUser | null {
  if (!user) return null;
  const asistente = destinoDeAsistente(
    profile.onboardingComplete ?? true,
    user.user_metadata?.intended_role,
  );
  const metaName = user.user_metadata?.full_name as string | undefined;
  return {
    // La campana lo usa para acotar sus consultas a los avisos propios; ver la
    // nota del tipo `HeaderUser`.
    id: user.id,
    email: user.email ?? "",
    name: profile.fullName?.trim() || metaName?.trim() || null,
    avatarUrl: storageUrl("avatars", profile.avatarPath),
    homeHref: asistente ?? pickHome(roles),
    // Mientras quede asistente, «Mi cuenta» lleva ahí: `/account` vive bajo
    // `requireUser()` y rebotaría igual, pero por el camino que rompe.
    accountHref: asistente ?? "/account",
    // Y el switch Aprender/Enseñar se apaga solo: con menos de dos entradas el
    // componente no se pinta, y sus dos destinos (`/app` y `/tutor`) son
    // exactamente los que el guarda no deja ver todavía.
    panels: asistente ? [] : panelsFor(roles),
  };
}
