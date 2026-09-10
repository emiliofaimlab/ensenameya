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
async function panelResuelto(
  userId: string,
  roles: AppRole[],
): Promise<Panel> {
  const panel = (await cookies()).get(PANEL_COOKIE)?.value as Panel | undefined;
  if (panel === "alumno") return "alumno";

  const admin = roles.includes("admin");
  if (panel === "admin" && admin) return "admin";

  const tutor = roles.includes("tutor") || (await hasTutorProfile(userId));
  if (panel === "tutor" && tutor) return "tutor";

  // Entrada directa (sin cookie): el panel de mayor rango que pueda abrir.
  return admin ? "admin" : tutor ? "tutor" : "alumno";
}

/**
 * ⚠️ POR QUÉ ESTA FUNCIÓN DEVUELVE EL PANEL Y NO SOLO EL MENÚ, Y POR QUÉ NO SE
 * PUEDE VOLVER A DEDUCIR DEL MENÚ. `TUTOR_ITEMS` y `ADMIN_ITEMS` viven en
 * `components/layout/app-sidebar.tsx`, que es `"use client"`. Importarlos desde
 * código de SERVIDOR no trae el array: trae una **referencia de cliente**, que
 * es una función. Medido el 10-sep en `/referidos`:
 *
 *     typeof TUTOR_ITEMS → "function" · Array.isArray → false · .length → 0
 *
 * Así que `items?.[0]?.href === "/tutor"` —el idiom con el que tres pantallas
 * decidían de qué panel venías— es `undefined` SIEMPRE, y la comparación sale
 * `false` siempre. Falla mudo: el menú se pinta perfecto, porque la referencia
 * se resuelve ya en el cliente, y solo se nota en la decisión que cuelga de él.
 * Costó que ningún tutor pudiera ver su campaña de referidos (B1.11): se le
 * servía la del alumno, que es exactamente lo prohibido.
 *
 * `panel` sale de la cookie, que es un `string` y cruza el borde intacta.
 */
async function panelItems(panel: Panel): Promise<SidebarItem[] | undefined> {
  return panel === "admin"
    ? ADMIN_ITEMS
    : panel === "tutor"
      ? TUTOR_ITEMS
      : undefined;
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
  const panel = await panelResuelto(userId, roles);
  return {
    /** El panel del que vienes. Quien decida algo por rol de panel usa ESTO,
     *  nunca `items[0].href` — ver la cabecera de `panelItems`. */
    panel,
    items: await panelItems(panel),
    // Por `panel` y no por identidad de referencia (`items === TUTOR_ITEMS`):
    // esa comparación seguía funcionando de casualidad —es el mismo objeto a
    // los dos lados— pero atarla a lo que sí cruza el borde cuesta lo mismo.
    badges:
      panel === "tutor"
        ? await tutorSidebarBadges(userId)
        : panel === "admin"
          ? await adminSidebarBadges()
          : undefined,
  };
}
