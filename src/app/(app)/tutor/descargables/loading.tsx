import { PanelShell } from "@/components/layout/panel-shell";
import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import { PageLoading } from "@/components/layout/page-loading";

/** EY-248 · Misma forma que `(app)/tutor/loading.tsx`: el menú no desaparece mientras carga. */
export default function TutorDescargablesLoading() {
  return (
    <PanelShell items={TUTOR_ITEMS}>
      <PageLoading />
    </PanelShell>
  );
}
