"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2Icon, LockIcon, ShieldCheckIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/catalog/format";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { Button } from "@/components/ui/button";

const slotLabel = (iso: string) =>
  new Date(iso).toLocaleString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

type State = "idle" | "processing" | "paid" | "failed";

/**
 * US-602 (SCR-AL05) — checkout con PSP **simulado** (C-01). "Confirmar pago"
 * crea la reserva (create_booking) y dispara el pago simulado (confirm_payment)
 * → `pending_acceptance`. Todo el dinero lo mueven las RPC server-side.
 *
 * ⚠️ SIN campos de tarjeta, a propósito. El Figma dibuja aquí número de
 * tarjeta, titular, vencimiento y CVC en campos propios; capturar el PAN en
 * nuestro formulario metería el proyecto en PCI-DSS SAQ D (alcance completo)
 * en vez del SAQ A que da un checkout alojado. Además contradice el plan ya
 * aprobado: PAC-01 (EY-93) es "checkout ALOJADO real" y PAC-02 (EY-94)
 * tokenización en el PSP. Cuando EP-20 se desbloquee, en el hueco de abajo va
 * el redirect al checkout del proveedor o su iframe/Elements — nunca inputs
 * nuestros.
 */
export function CheckoutForm({
  productId,
  slots,
  total,
  currency,
  productTitle,
  tutorName,
}: {
  productId: string;
  slots: string[];
  total: number;
  currency: string;
  productTitle: string;
  tutorName: string;
}) {
  const [state, setState] = useState<State>("idle");

  async function pay(success: boolean) {
    setState("processing");
    const supabase = createClient();

    const { data: bookingId, error } = await supabase.rpc("create_booking", {
      p_product_id: productId,
      p_slots: slots,
    });
    if (error || !bookingId) {
      toast.error(error?.message ?? "No se pudo crear la reserva.");
      setState("idle");
      return;
    }

    const { error: payErr } = await supabase.rpc("confirm_payment", {
      p_booking_id: bookingId,
      p_success: success,
    });
    if (payErr) {
      toast.error(payErr.message ?? "No se pudo procesar el pago.");
      setState("idle");
      return;
    }
    setState(success ? "paid" : "failed");
  }

  if (state === "paid") {
    return (
      <div className="rounded-2xl bg-card p-8">
        <span className="grid size-12 place-items-center rounded-full bg-success-muted text-success">
          <CheckCircle2Icon className="size-6" />
        </span>
        <h2 className="mt-4 text-xl font-bold">¡Pago recibido!</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tu reserva quedó pendiente de que el tutor la acepte (hasta 24 h). Te
          avisaremos; si no responde, se reembolsa el 100 %.
        </p>
        <Button asChild className="mt-5">
          <Link href="/reservas">Ver mis reservas</Link>
        </Button>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div className="rounded-2xl bg-card p-8">
        <h2 className="text-xl font-bold text-destructive">
          El pago no se completó
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Se liberó el horario. Puedes intentarlo de nuevo.
        </p>
        <Button
          variant="outline"
          className="mt-5"
          onClick={() => setState("idle")}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      <section className="rounded-2xl bg-card p-6">
        <h2 className="text-lg font-bold">Método de pago</h2>

        <div className="mt-4 flex gap-3 rounded-xl border border-dashed p-5">
          <LockIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">
              El pago se completa en la pasarela del proveedor
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Nunca escribes los datos de tu tarjeta en Enséñame Ya: al
              confirmar te llevamos al checkout seguro del proveedor de pagos.
            </p>
          </div>
        </div>

        {/* Motor simulado: EP-20 (PAC-01…04) sigue bloqueada esperando cuenta y
            credenciales de DLocal/Stripe. Se avisa en pantalla para que nadie
            confunda esto con un cobro real. */}
        <p className="mt-4 rounded-lg bg-warning-muted px-4 py-3 text-[13px] text-warning">
          Entorno de pruebas: el cobro está simulado, no se mueve dinero real.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            size="lg"
            disabled={state === "processing"}
            onClick={() => pay(true)}
          >
            {state === "processing"
              ? "Procesando…"
              : `Confirmar pago · ${formatMoney(total, currency)}`}
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={state === "processing"}
            onClick={() => pay(false)}
          >
            Simular fallo
          </Button>
        </div>
      </section>

      <aside className="rounded-2xl bg-card p-6 lg:sticky lg:top-24">
        <h2 className="text-lg font-bold">Resumen del pedido</h2>

        <div className="mt-4">
          <p className="font-semibold">{productTitle}</p>
          <p className="text-[13px] text-muted-foreground">
            con {tutorName} ·{" "}
            {slots.length > 1
              ? `Paquete ${slots.length} sesiones`
              : "Sesión suelta"}
          </p>
        </div>

        <ul className="mt-4 flex flex-col gap-1.5 border-t pt-4 text-[13px] text-muted-foreground">
          {slots.map((iso) => (
            <li key={iso} className="first-letter:uppercase">
              {slotLabel(iso)}
            </li>
          ))}
        </ul>

        <dl className="mt-4 border-t pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{formatMoney(total, currency)}</dd>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <dt className="font-semibold">Total</dt>
            <dd className="text-lg font-bold">{formatMoney(total, currency)}</dd>
          </div>
        </dl>

        <p className="mt-5 flex gap-2 border-t pt-4 text-xs text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            Reembolso del 100 % si el tutor no acepta en {P.cutoffHours} h.
            Cancelas con ≥{P.cutoffHours} h: {P.refundPct.studentEarly} %; con
            menos: {P.refundPct.studentLate} %.
          </span>
        </p>
      </aside>
    </div>
  );
}
