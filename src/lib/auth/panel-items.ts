import "server-only";

import { cookies } from "next/headers";

import {
  ADMIN_ITEMS,
  TUTOR_ITEMS,
  type SidebarItem,
} from "@/components/layout/app-sidebar";
import { PANEL_COOKIE, type Panel } from "@/lib/panel";
import { adminSidebarBadges } from "@/lib/admin/sidebar-badges";
import { tutorSidebarBadges } from "@/lib/tutor/sidebar-badges";
import { hasTutorProfile } from "./tutor";
import type { AppRole } from "./roles";

/**
 * Menú lateral de las pantallas compartidas (`/pagos`, `/account`): el del
 * panel del que vienes, que deja el proxy en la cookie `ey-panel`.
 *
 * `undefined` = menú de alumno (el que `PanelShell` pinta por defecto).
 *
 * El panel se comprueba contra lo que la persona puede ver de verdad: la cookie
 * se marca al *pedir* la ruta, antes de que la guarda decida, así que un alumno
 * que pulsa "Enseñar" y acaba en el asistente no puede quedarse con el menú de
 * tutor. Ser tutor aquí es tener perfil, no el rol: el rol `tutor` solo se
 * concede al aprobar (US-1101) y el panel se usa desde el primer día.
 */
// Interna a propósito: la puerta es `panelMenu`. Con las dos exportadas, la
// pantalla siguiente elige la que no trae contadores —que es justo el olvido
// que esto viene a cerrar— y el menú se queda mudo sin que nadie lo note.
async function panelItems(
  userId: string,
  roles: AppRole[],
): Promise<SidebarItem[] | undefined> {
  const panel = (await cookies()).get(PANEL_COOKIE)?.value as Panel | undefined;
  if (panel === "alumno") return undefined;

  const admin = roles.includes("admin");
  if (panel === "admin" && admin) return ADMIN_ITEMS;

  const tutor = roles.includes("tutor") || (await hasTutorProfile(userId));
  if (panel === "tutor" && tutor) return TUTOR_ITEMS;

  // Entrada directa (sin cookie): el panel de mayor rango que pueda abrir.
  return admin ? ADMIN_ITEMS : tutor ? TUTOR_ITEMS : undefined;
}

/**
 * G-02 · El menú y sus contadores, para las pantallas compartidas.
 *
 * ⚠️ POR QUÉ ESTO NO ES `panelItems` MÁS UNA LÍNEA EN CADA PANTALLA. Las diez
 * pantallas del tutor pintan los números porque `TutorShell` los resuelve por
 * ellas; `/account` y `/pagos` no usan ese shell —su menú depende de la cookie,
 * no de la ruta— y se quedaban con el MISMO menú y sin un solo número. Se nota
 * justo donde más duele: «Mi cuenta → Verificación» lleva su propio contador
 * (un documento rechazado), y esa entrada es la de la pantalla en la que estás.
 *
 * La regla «menú de tutor ⇒ contadores de tutor» vive aquí y en ningún otro
 * sitio, que es lo que evita que la tercera pantalla compartida se vuelva a
 * olvidar. `tutorSidebarBadges` está memoizada por petición, así que no la
 * paga dos veces quien ya la haya pedido. Lo mismo para el menú del admin,
 * que tenía exactamente el mismo hueco.
 */
export async function panelMenu(userId: string, roles: AppRole[]) {
  const items = await panelItems(userId, roles);
  return {
    items,
    badges:
      items === TUTOR_ITEMS
        ? await tutorSidebarBadges(userId)
        : items === ADMIN_ITEMS
          ? await adminSidebarBadges()
          : undefined,
  };
}
