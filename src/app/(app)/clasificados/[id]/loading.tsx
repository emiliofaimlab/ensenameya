import { PanelShell } from "@/components/layout/panel-shell";
import { PageLoading } from "@/components/layout/page-loading";

/** Sin menú ni título adelantado: ver `src/app/(app)/regalar/loading.tsx`. */
export default function Loading() {
  return (
    <PanelShell sidebar={false}>
      <PageLoading />
    </PanelShell>
  );
}
