"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreditCardIcon, LockIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StripeEmbed, type Embed } from "@/components/checkout/stripe-embed";

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
 * N-31 · desde el 17-ago SÍ se pueden añadir desde aquí. Antes esta pantalla
 * solo sabía borrar y la única forma de guardar una tarjeta era empezar una
 * compra y marcar la casilla del checkout — quien quería dejar el medio de pago
 * listo antes de reservar no tenía manera.
 *
 * ⚠️ SIN CAMPOS DE TARJETA NUESTROS, que es lo que bloqueaba esto. El formulario
 * que se monta al pulsar "Añadir tarjeta" es el MISMO embed de Stripe que el
 * checkout (`StripeEmbed`), abierto en `mode: 'setup'`: el PAN vive en un iframe
 * del proveedor y no toca nuestro DOM, así que el proyecto sigue en PCI-DSS
 * SAQ A. Pintar aquí número/CVC propios nos llevaría a SAQ D, y por eso la
 * versión anterior de este comentario decía que no había formulario.
 */
export function PaymentMethods({
  cards,
  puedeAnadir,
  sesionVuelta,
}: {
  cards: Card[];
  /** Stripe configurado (secreta + publicable). Sin las dos no hay formulario
   *  que abrir, así que no se ofrece un botón que solo puede fallar. */
  puedeAnadir: boolean;
  /** `?tarjeta=cs_…` con el que Stripe nos devuelve tras guardar. */
  sesionVuelta: string | null;
}) {
  const router = useRouter();
  const [borrando, setBorrando] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [embed, setEmbed] = useState<Embed | null>(null);

  // Al volver del formulario: confirmar contra Stripe (ver el PATCH del Route
  // Handler), limpiar la query y repintar la lista con la tarjeta nueva.
  //
  // El `ref` es por el doble montaje de React en desarrollo: la llamada es
  // idempotente, pero dos toasts seguidos parecen dos tarjetas guardadas.
  const yaConfirmada = useRef(false);
  useEffect(() => {
    if (!sesionVuelta || yaConfirmada.current) return;
    yaConfirmada.current = true;

    (async () => {
      const res = await fetch("/api/pagos/metodos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sesionVuelta }),
      });
      const salida = (await res.json().catch(() => ({}))) as {
        guardada?: boolean;
      };
      if (res.ok && salida.guardada) {
        toast.success("Tarjeta guardada. Ya puedes usarla al pagar.");
      }
      // La query se quita siempre: dejarla haría que recargar la pantalla
      // repitiese la confirmación de una Session que ya no significa nada.
      router.replace("/pagos");
      router.refresh();
    })();
  }, [sesionVuelta, router]);

  async function anadir() {
    setAbriendo(true);
    const res = await fetch("/api/pagos/metodos", { method: "POST" });
    const salida = (await res.json().catch(() => ({}))) as Partial<Embed> & {
      error?: string;
    };
    setAbriendo(false);

    if (!res.ok || !salida.clientSecret || !salida.publishableKey) {
      return toast.error(salida.error ?? "No se pudo abrir el formulario.");
    }
    setEmbed({
      clientSecret: salida.clientSecret,
      publishableKey: salida.publishableKey,
    });
  }

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

  // Con el formulario montado manda Stripe: él redirige al `return_url` al
  // terminar. Se oculta la lista para no dejar un "Quitar" al lado de un
  // formulario abierto.
  if (embed) {
    return (
      <div>
        {/* PAC-02 · el consentimiento de card-on-file se pide en cada cobro con
            una casilla que nace DESMARCADA. Aquí no hay casilla porque el acto
            en sí ES la petición de guardar — pero se dice, no se da por hecho en
            silencio: quien llega aquí tiene que leer qué está autorizando y qué
            NO está autorizando (que le cobren ahora). */}
        <div className="flex gap-3 rounded-xl border border-dashed border-[#e0e0e0] p-5">
          <LockIcon className="mt-0.5 size-5 shrink-0 text-[#6b6b6b]" />
          <div>
            <p className="text-sm font-semibold text-[#19191f]">
              Estás autorizando a guardar esta tarjeta
            </p>
            <p className="mt-1 text-[13px] text-[#6b6b6b]">
              <strong>No se te cobra nada ahora.</strong> La tarjeta queda
              guardada en nuestro proveedor de pagos para que puedas elegirla al
              reservar; solo se cobra cuando tú confirmas una reserva. Los datos
              de la tarjeta viajan directamente a él: nunca pasan por Enséñame
              Ya. Puedes quitarla desde esta misma pantalla cuando quieras.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <StripeEmbed {...embed} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#d8d8d8] px-5 py-8 text-center">
          <CreditCardIcon className="mx-auto size-6 text-[#9a9a9a]" />
          <p className="mt-3 text-sm font-medium text-[#19191f]">
            No tienes tarjetas guardadas
          </p>
          <p className="mx-auto mt-1 max-w-[380px] text-[13px] text-[#6b6b6b]">
            {puedeAnadir
              ? "Añade una aquí y aparecerá al pagar tus reservas. También puedes guardarla en el momento del pago, marcando «Guardar esta tarjeta». Nunca escribes los datos de tu tarjeta en Enséñame Ya."
              : "Al pagar una reserva puedes marcar «Guardar esta tarjeta» y aparecerá aquí para las siguientes. Nunca escribes los datos de tu tarjeta en Enséñame Ya."}
          </p>
        </div>
      ) : (
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
                    Vence {String(c.expMonth).padStart(2, "0")}/
                    {String(c.expYear).slice(-2)}
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
      )}

      {/* Sin las claves de Stripe no se ofrece: el botón daría un 503 y la
          pantalla ya se enseña vacía en ese caso, que es la verdad. */}
      {puedeAnadir ? (
        <div className="mt-4">
          <Button
            variant="outline"
            disabled={abriendo}
            onClick={anadir}
            className="h-10 rounded-[8px] px-4 text-[13.5px] font-semibold"
          >
            <PlusIcon className="size-4" />
            {abriendo ? "Abriendo…" : "Añadir tarjeta"}
          </Button>
          <p className="mt-2 text-[13px] text-[#6b6b6b]">
            No se te cobra nada al añadirla: queda guardada para que puedas
            elegirla al pagar tus próximas reservas.
          </p>
        </div>
      ) : null}
    </div>
  );
}
