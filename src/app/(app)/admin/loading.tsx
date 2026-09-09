import { PanelShell } from "@/components/layout/panel-shell";
import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import { PageLoading } from "@/components/layout/page-loading";

/** Mismo motivo y misma forma que `(app)/tutor/loading.tsx`: el menú del panel
 *  no tiene por qué desaparecer mientras se carga la pantalla siguiente. */
export default function AdminLoading() {
  return (
    <PanelShell items={ADMIN_ITEMS}>
      <PageLoading />
    </PanelShell>
  );
}
