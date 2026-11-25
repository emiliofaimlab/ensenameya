"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * «Ya no lo necesito» y «Volver a publicar». Quien decide si se puede es el SQL
 * (`cerrar_clasificado` / `republicar_clasificado`); su error llega en español.
 */
export function AccionesClasificado({
  id,
  puedeCerrar,
  puedeRepublicar,
}: {
  id: string;
  puedeCerrar: boolean;
  puedeRepublicar: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function cerrar() {
    setBusy(true);
    const { error } = await createClient().rpc("cerrar_clasificado", { p_id: id });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo cerrar el clasificado.");
      return;
    }
    setOpen(false);
    toast.success("Listo: cerramos tu clasificado y avisamos a los tutores.");
    router.refresh();
  }

  async function republicar() {
    setBusy(true);
    const { error } = await createClient().rpc("republicar_clasificado", { p_id: id });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo volver a publicar.");
      return;
    }
    toast.success("Publicado otra vez: sigue abierto 14 días más.");
    router.refresh();
  }

  if (!puedeCerrar && !puedeRepublicar) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {puedeRepublicar ? (
        <Button type="button" disabled={busy} onClick={() => void republicar()} className="rounded-[8px]">
          Volver a publicar
        </Button>
      ) : null}
      {puedeCerrar ? (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            className="rounded-[8px]"
            onClick={() => setOpen(true)}
          >
            Ya no lo necesito
          </Button>
          <Dialog
            open={open}
            onOpenChange={(o) => {
              if (!busy) setOpen(o);
            }}
          >
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader>
                <DialogTitle>¿Cerrar este clasificado?</DialogTitle>
                <DialogDescription>
                  Deja de recibir postulaciones y las propuestas que no pagaste dejan de valer. No
                  se puede volver a abrir: si lo necesitas otra vez, publica uno nuevo.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                  Cancelar
                </Button>
                <Button type="button" disabled={busy} onClick={() => void cerrar()}>
                  Ya no lo necesito
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
