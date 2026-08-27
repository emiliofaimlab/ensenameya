import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import {
  PanelShell,
  type PanelShellProps,
} from "@/components/layout/panel-shell";

/** Shell de las pantallas de admin (AD02…AD15): `PanelShell` con su menú.
 *  El prop `breadcrumb` se cayó: ninguna pantalla lo pasaba.
 *
 *  US-1601 · La columna de 196 px a tablet (AD02) no se pide desde aquí:
 *  `PanelShell` la deduce del propio menú, porque `/pagos` y `/account` también
 *  pintan `ADMIN_ITEMS` sin pasar por este shell. */
export function AdminShell(props: Omit<PanelShellProps, "items">) {
  return <PanelShell items={ADMIN_ITEMS} {...props} />;
}
