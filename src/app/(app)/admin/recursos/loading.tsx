import { PanelShell } from "@/components/layout/panel-shell";
import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import { PageLoading } from "@/components/layout/page-loading";

/** EY-222 · Misma forma que `(app)/admin/loading.tsx`: el menú del panel se queda mientras carga. */
export default function AdminRecursosLoading() {
  return (
    <PanelShell items={ADMIN_ITEMS}>
      <PageLoading />
    </PanelShell>
  );
}
