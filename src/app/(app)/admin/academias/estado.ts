import type { PillTone } from "@/components/layout/panel-shell";

export const ESTADO_ACADEMIA: Record<string, { label: string; tone: PillTone }> = {
  draft: { label: "Borrador", tone: "neutral" },
  active: { label: "Activa", tone: "green" },
  suspended: { label: "Suspendida", tone: "amber" },
};
