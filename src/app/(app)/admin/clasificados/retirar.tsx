"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Clasificados · «Retirar» del admin. Por RPC (`admin_retirar_clasificado`),
 * no por RLS: `class_requests` no tiene política de escritura y la función,
 * además de marcarlo `removed`, retira sus postulaciones avisando a los tutores.
 */
export function RetirarClasificado({ id, goal }: { id: string; goal: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);

  async function retirar() {
    setBusy(true);
    const { error } = await createClient().rpc("admin_retirar_clasificado", {
      p_id: id,
      p_motivo: motivo.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo retirar el clasificado.");
      return;
    }
    toast.success("Clasificado retirado.");
    setOpen(false);
    setMotivo("");
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        className="h-9 shrink-0 self-start rounded-[8px] px-3.5 text-[13px] text-[#a82929] sm:self-center"
        onClick={() => setOpen(true)}
      >
        Retirar
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retirar clasificado</DialogTitle>
            <DialogDescription>
              «{goal}» deja de verse y sus postulaciones se retiran avisando a los tutores. No se
              puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Motivo (obligatorio): datos de contacto, contenido fuera de lugar…"
            aria-label="Motivo"
          />
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={busy || motivo.trim().length < 3}
              onClick={retirar}
            >
              {busy ? "Retirando…" : "Retirar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
