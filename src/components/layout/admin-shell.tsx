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
 *  ⚠️ Los contadores del menú se PIDEN aquí, pero no se empiezan aquí. No hay
 *  `admin/layout.tsx` y es a propósito: un layout solo corre en la carga dura
 *  —en una navegación de cliente dentro de /admin/* los layouts por encima del
 *  punto de divergencia no se re-ejecutan— y además no le podría pasar props al
 *  menú, que lo monta `PanelShell` dentro de cada PÁGINA (y en `src/` no hay
 *  contextos a propósito, `lib/cart/cookie.ts` explica por qué). Quien las
 *  ADELANTA es `requireRole("admin")`, la primera línea de las quince
 *  pantallas: lanza `adminSidebarBadges()` sin `await`, y como está memoizada
 *  con `cache()`, este `await` encuentra la misma promesa ya en vuelo.
 *
 *  El coste conviene tenerlo escrito igual: son tres consultas agregadas
 *  (`head: true`, sin filas) por cada carga de pantalla del panel. Van en
 *  paralelo entre ellas y, desde el adelanto, también en paralelo con las
 *  consultas propias de la pantalla — pero este `await` sigue estando antes del
 *  `return`, así que si alguna tardara más que la pantalla, retrasaría el HTML.
 *  Si algún día se nota, la salida es envolver el menú en un `<Suspense>`: no
 *  depende de los números para pintarse.
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
