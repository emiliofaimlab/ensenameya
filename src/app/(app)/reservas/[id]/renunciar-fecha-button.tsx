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
import { PrecioEnLinea } from "@/components/precio/precio";

/**
 * Lote 11 (M14) · «Renunciar a esta fecha», junto a una fecha grupal que el
 * tutor reagendó cuando el ciclo YA había empezado.
 *
 * Con el ciclo empezado el alumno no puede darse de baja de la clase (RG-16),
 * así que la salida es soltar solo esa fecha y recuperar su parte,
 * round(gross/N). Quien decide si se puede —y cuánto se devuelve, en efectivo o
 * en crédito— es `renunciar_fecha_grupal` en servidor; `parte` es solo la
 * estimación que se enseña en el diálogo.
 */
export function RenunciarFechaButton({
  sessionId,
  parte,
  currency,
}: {
  sessionId: string;
  parte: number;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function renunciar() {
    setBusy(true);
    const { data, error } = await createClient().rpc("renunciar_fecha_grupal", {
      p_session: sessionId,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo renunciar a esta fecha.");
      return;
    }
    setOpen(false);
    // Lo devuelto se reparte entre medio de pago y saldo (`reembolsar_con_credito`),
    // y lo pagado con un regalo de mentoría no vuelve por fechas sueltas.
    const r = (data ?? {}) as { refund_credit_perdido?: number };
    toast.success(
      (r.refund_credit_perdido ?? 0) > 0
        ? "Renunciaste a esta fecha. La parte pagada con un regalo de mentoría no se devuelve por fechas sueltas."
        : "Listo: renunciaste a esta fecha. Lo devuelto está en «Pago».",
    );
    router.refresh();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 rounded-[8px] px-3.5 text-[13px]"
        onClick={() => setOpen(true)}
      >
        Renunciar a esta fecha
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!busy) setOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>¿Renunciar a esta fecha?</DialogTitle>
            <DialogDescription>
              Te devolvemos la parte de esta fecha (
              <PrecioEnLinea amountMinor={parte} currency={currency} />): a tu
              medio de pago o a tu saldo, según cómo pagaste. Lo pagado con un
              regalo de mentoría no se devuelve por fechas sueltas. Las demás
              fechas del ciclo siguen igual.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={busy} onClick={() => void renunciar()}>
              Renunciar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
