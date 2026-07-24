"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";

type Status = Database["public"]["Enums"]["product_status"];

type Action = { label: string; to: Status; needsApproval?: boolean; confirm?: string };

// M3 (Doc 2 §2.6) — transiciones válidas por estado. `archived` es terminal
// (no se reactiva; se clona para reusar). Publicar/Reanudar exigen tutor
// `approved` (RN-23), lo respalda el trigger `products_publish_guard` en BD.
// ponytail: la matriz vive en la UI; el único guard con dientes (RN-23) está en
// BD. Un guard de matriz completo en BD se añade si aparece escritura no-UI.
const ACTIONS: Record<Status, Action[]> = {
  draft: [
    { label: "Publicar", to: "active", needsApproval: true },
    { label: "Descartar", to: "archived", confirm: "¿Descartar este borrador? Es definitivo." },
  ],
  active: [
    { label: "Pausar", to: "paused" },
    { label: "Archivar", to: "archived", confirm: "¿Archivar? Es definitivo, no se reactiva." },
  ],
  paused: [
    { label: "Reanudar", to: "active", needsApproval: true },
    { label: "Archivar", to: "archived", confirm: "¿Archivar? Es definitivo, no se reactiva." },
  ],
  archived: [],
};

export function ProductStatusActions({
  productId,
  status,
  isApproved,
}: {
  productId: string;
  status: Status;
  isApproved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const actions = ACTIONS[status];
  if (!actions.length) return null;

  async function run(a: Action) {
    if (a.needsApproval && !isApproved) {
      toast.error("Tu perfil de tutor debe estar aprobado para publicar.");
      return;
    }
    if (a.confirm && !window.confirm(a.confirm)) return;

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("products")
      .update({ status: a.to })
      .eq("id", productId);
    setBusy(false);

    if (error) {
      // El guard RN-23 (BD) rechaza publicar sin aprobación aunque se fuerce.
      toast.error(error.message || "No se pudo actualizar el producto.");
      return;
    }
    toast.success("Producto actualizado.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2.5">
      {actions.map((a) => {
        const blocked = a.needsApproval && !isApproved;
        // Publicar/Reanudar van en azul sólido (191:84); el resto, outline.
        const solid = a.to === "active";
        return (
          <Button
            key={a.label}
            type="button"
            variant={solid ? "default" : "outline"}
            disabled={busy || blocked}
            title={blocked ? "Requiere que tu perfil de tutor esté aprobado" : undefined}
            onClick={() => run(a)}
            className={
              solid
                ? "h-9 rounded-[8px] bg-brand px-3.5 text-[13px] font-semibold hover:bg-brand/90"
                : "h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
            }
          >
            {a.label}
          </Button>
        );
      })}
    </div>
  );
}
