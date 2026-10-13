import { PanelShell } from "@/components/layout/panel-shell";
import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import { PageLoading } from "@/components/layout/page-loading";

/** EY-222 · Misma forma que `(app)/tutor/loading.tsx`: el menú no desaparece mientras se firman los enlaces. */
export default function TutorRecursosLoading() {
  return (
    <PanelShell items={TUTOR_ITEMS}>
      <PageLoading />
    </PanelShell>
  );
}
