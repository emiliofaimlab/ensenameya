"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreditCardIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export type Card = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

/**
 * PAC-02 · las tarjetas guardadas, tal como las tiene el proveedor.
 *
 * NO HAY FORMULARIO PARA AÑADIR, y es deliberado. Una tarjeta se guarda en el
 * único sitio donde se escribe: el checkout alojado, marcando la casilla. Un
 * formulario aquí solo podría hacer una de dos cosas —pedir el PAN, que nos
 * metería en PCI-DSS SAQ D, o fabricar una fila falsa, que es lo que hacía la
 * versión simulada— y ninguna de las dos vale.
 */
export function PaymentMethods({ cards }: { cards: Card[] }) {
  const router = useRouter();
  const [borrando, setBorrando] = useState<string | null>(null);

  async function quitar(id: string) {
    setBorrando(id);
    const res = await fetch("/api/pagos/metodos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethodId: id }),
    });
    setBorrando(null);
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      return toast.error(error ?? "No se pudo quitar la tarjeta.");
    }
    toast.success("Tarjeta eliminada.");
    router.refresh();
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d8d8d8] px-5 py-8 text-center">
        <CreditCardIcon className="mx-auto size-6 text-[#9a9a9a]" />
        <p className="mt-3 text-sm font-medium text-[#19191f]">
          No tienes tarjetas guardadas
        </p>
        <p className="mx-auto mt-1 max-w-[380px] text-[13px] text-[#6b6b6b]">
          Al pagar una reserva puedes marcar «Guardar esta tarjeta» y aparecerá
          aquí para las siguientes. Nunca escribes los datos de tu tarjeta en
          Enséñame Ya.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {cards.map((c) => (
        <li
          key={c.id}
          className="flex items-center justify-between gap-4 rounded-xl border border-[#e0e0e0] px-4 py-3"
        >
          <span className="flex items-center gap-3">
            <CreditCardIcon className="size-4 shrink-0 text-[#6b6b6b]" />
            <span>
              <span className="block text-sm font-medium text-[#19191f] capitalize">
                {c.brand} •••• {c.last4}
              </span>
              <span className="block text-xs text-[#6b6b6b]">
                Vence {String(c.expMonth).padStart(2, "0")}/{String(c.expYear).slice(-2)}
              </span>
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={borrando === c.id}
            onClick={() => quitar(c.id)}
          >
            {borrando === c.id ? "Quitando…" : "Quitar"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
