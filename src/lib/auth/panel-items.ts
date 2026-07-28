import "server-only";

import { cookies } from "next/headers";

import {
  ADMIN_ITEMS,
  TUTOR_ITEMS,
  type SidebarItem,
} from "@/components/layout/app-sidebar";
import { PANEL_COOKIE, type Panel } from "@/lib/panel";
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
export async function panelItems(
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
