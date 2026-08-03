import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import {
  PanelShell,
  type PanelShellProps,
} from "@/components/layout/panel-shell";

/** Shell de las pantallas del tutor (TU02…TU09): `PanelShell` con su menú. */
export function TutorShell(props: Omit<PanelShellProps, "items">) {
  return <PanelShell items={TUTOR_ITEMS} {...props} />;
}
