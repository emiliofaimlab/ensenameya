import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import {
  PanelShell,
  type PanelShellProps,
} from "@/components/layout/panel-shell";

/** Shell de las pantallas de admin (AD02…AD15): `PanelShell` con su menú.
 *  El prop `breadcrumb` se cayó: ninguna pantalla lo pasaba. */
export function AdminShell(props: Omit<PanelShellProps, "items">) {
  return <PanelShell items={ADMIN_ITEMS} {...props} />;
}
