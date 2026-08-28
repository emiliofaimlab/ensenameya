import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import { adminSidebarBadges } from "@/lib/admin/sidebar-badges";
import {
  PanelShell,
  type PanelShellProps,
} from "@/components/layout/panel-shell";

/** Shell de las pantallas de admin (AD02…AD15): `PanelShell` con su menú.
 *  El prop `breadcrumb` se cayó: ninguna pantalla lo pasaba.
 *
 *  US-1601 · La columna de 196 px a tablet (AD02) no se pide desde aquí:
 *  `PanelShell` la deduce del propio menú, porque `/pagos` y `/account` también
 *  pintan `ADMIN_ITEMS` sin pasar por este shell.
 *
 *  ⚠️ Los contadores del menú se resuelven AQUÍ y no en un layout, porque no
 *  hay `admin/layout.tsx`: este componente es el único punto por el que pasan
 *  las quince pantallas del panel. Un layout tampoco serviría tal cual —el menú
 *  lo monta `PanelShell` dentro de cada PÁGINA, y un layout no le puede pasar
 *  props a eso sin un contexto, y en `src/` no hay ni uno a propósito
 *  (`lib/cart/cookie.ts` explica por qué).
 *
 *  El coste es real y conviene tenerlo escrito: son tres consultas agregadas
 *  (`head: true`, sin filas) por cada carga de pantalla del panel. Van en
 *  paralelo entre ellas, pero **en serie con el `children`**, porque son un
 *  `await` antes del return. Si algún día se nota, la salida es envolver el
 *  menú en un `<Suspense>` y dejar que los badges lleguen después: el menú no
 *  depende de ellos para pintarse.
 *
 *  ⚠️ `/pagos` y `/account` pintan `ADMIN_ITEMS` sin pasar por aquí, así que
 *  ahí el menú sale SIN badges. Es aceptable —son pantallas compartidas donde
 *  el admin no está trabajando la cola— y preferible a colar tres consultas de
 *  admin en dos pantallas que también ven alumnos y tutores. */
export async function AdminShell(
  props: Omit<PanelShellProps, "items" | "badges">,
) {
  const badges = await adminSidebarBadges();
  return <PanelShell items={ADMIN_ITEMS} badges={badges} {...props} />;
}
