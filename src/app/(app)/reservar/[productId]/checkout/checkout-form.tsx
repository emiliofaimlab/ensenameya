"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LockIcon, ShieldCheckIcon } from "lucide-react";
import { StripeEmbed, type Embed } from "@/components/checkout/stripe-embed";

import { createClient } from "@/lib/supabase/client";
import type { SavedCard } from "@/lib/stripe";
import { formatMoney } from "@/lib/catalog/format";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";

const slotLabel = (iso: string) =>
  new Date(iso).toLocaleString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

type State = "idle" | "processing";

/**
 * US-602 (SCR-AL05) — checkout con PSP **simulado** (C-01). "Confirmar pago"
 * crea la reserva (create_booking) y dispara el pago simulado
 * (confirm_simulated_payment) → `pending_acceptance`, y redirige a la
 * confirmación (AL06). Todo el dinero lo mueven las RPC server-side.
 *
 * El nombre de la RPC no es cosmético: `confirm_payment` está revocada para el
 * cliente y solo la alcanza el webhook (`20260806120000`). Esta variante exige
 * que el cobro esté ruteado al proveedor simulado, así que el día que entre un
 * PSP real este botón deja de funcionar solo — que es lo que debe pasar.
 *
 * ⚠️ SIN campos de tarjeta NUESTROS, a propósito. El Figma dibuja aquí número
 * de tarjeta, titular, vencimiento y CVC en campos propios; capturar el PAN en
 * nuestro formulario metería el proyecto en PCI-DSS SAQ D (alcance completo).
 * Lo que hay en su lugar es el **Embedded Checkout** de Stripe (reunión 7-ago):
 * el formulario se ve dentro de esta pantalla, pero vive en un iframe del
 * proveedor, así que los datos de la tarjeta no tocan nuestro DOM y seguimos en
 * SAQ A igual que con el checkout alojado. La tarjeta ilustrada de la izquierda
 * es decorativa (no captura nada).
 */
export function CheckoutForm({
  productId,
  slots,
  total,
  currency,
  productTitle,
  tutorName,
  packageLabel,
  simulado,
  tarjetas,
  hayUltimaUsada,
}: {
  productId: string;
  slots: string[];
  total: number;
  currency: string;
  productTitle: string;
  tutorName: string;
  packageLabel: string;
  /** Lo decide `payment_routing_rules`, no el código: con un proveedor real no
   *  hay aviso de pruebas ni botón de simular fallo. */
  simulado: boolean;
  /** Las tarjetas guardadas de verdad. La ilustración refleja la primera y el
   *  texto dice cuántas hay: enseñar una sola cuando hay varias es la misma
   *  mentira que el `4821` inventado, solo que más difícil de ver. */
  tarjetas: SavedCard[];
  /** true si la primera de la lista es de verdad la última usada, no solo la
   *  más reciente. Cambia la etiqueta: sin cobros previos no se puede afirmar. */
  hayUltimaUsada: boolean;
}) {
  const tarjeta = tarjetas[0] ?? null;
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  // DESMARCADA a propósito: guardar un medio de pago se pide, no se presupone.
  const [guardarTarjeta, setGuardarTarjeta] = useState(false);
  // Con el `client_secret` en mano, el formulario de Stripe sustituye al aviso
  // de "te llevamos a la pasarela". `loadStripe` devuelve una promesa que hay
  // que crear UNA vez: guardarla en el mismo estado la ata al secreto que le
  // corresponde y evita recrearla en cada render (remontaría el iframe).
  const [embed, setEmbed] = useState<Embed | null>(null);

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

    // Quién cobra lo decide el servidor leyendo `payments.provider`, que es el
    // snapshot que `create_booking` acaba de congelar desde
    // `payment_routing_rules`. El navegador no elige proveedor: pregunta.
    const res = await fetch("/api/pagos/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, guardarTarjeta }),
    });
    const salida = (await res.json().catch(() => ({}))) as Partial<Embed> & {
      simulated?: boolean;
      error?: string;
    };

    if (!res.ok) {
      toast.error(salida.error ?? "No se pudo abrir el pago.");
      setState("idle");
      return;
    }

    if (salida.clientSecret && salida.publishableKey) {
      // El pago ya no sale del sitio: se monta el iframe de Stripe aquí mismo.
      // A partir de este punto manda el embed —él redirige al `return_url` al
      // terminar— y el cobro lo confirma el webhook, no esta pantalla. El botón
      // no vuelve a "idle" a propósito: reservar otra vez abriría un cobro
      // duplicado sobre la misma reserva.
      setEmbed({
        clientSecret: salida.clientSecret,
        publishableKey: salida.publishableKey,
      });
      return;
    }

    // Camino simulado (`payment_routing_rules` aún en 'simulated'): sigue
    // funcionando igual que siempre, incluido el botón de simular fallo.
    const { error: payErr } = await supabase.rpc("confirm_simulated_payment", {
      p_booking_id: bookingId,
      p_success: success,
    });
    if (payErr) {
      toast.error(payErr.message ?? "No se pudo procesar el pago.");
      setState("idle");
      return;
    }

    if (!success) {
      toast.error("El pago no se completó. Se liberó el horario.");
      setState("idle");
      return;
    }
    // AL06 — confirmación como página propia.
    router.push(`/reservas/${bookingId}/confirmacion`);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* Columna izquierda del Figma: tarjeta ilustrada + resumen. */}
      <div className="flex flex-col gap-5">
        {/* Wallet: la de delante es la última usada; las demás asoman detrás y
            se abren en abanico al pasar el ratón. Es INFORMATIVO, no un
            selector — elegir se elige en la pasarela, y un selector aquí sería
            prometer un control que el checkout alojado no nos da. */}
        <div
          className="group relative"
          style={{ height: tarjetas.length > 2 ? 286 : tarjetas.length > 1 ? 232 : 178 }}
        >
          {/* Las de detrás, de la más lejana a la más cercana. */}
          {tarjetas.slice(1, 3).map((t, i) => (
            <div
              key={t.id}
              aria-hidden
              // Transformaciones explícitas y no calculadas: Tailwind necesita la
              // clase entera en el fuente para generarla, y como mucho hay dos.
              className={[
                "absolute inset-x-0 top-0 flex h-[178px] items-end rounded-[20px]",
                "bg-linear-to-br from-[#243043] to-[#0b3a6d] px-6 pb-1.5",
                "text-[11px] text-white/70 shadow-lg",
                "transition-transform duration-500 ease-out",
                // Sin animación para quien la haya desactivado en su sistema.
                "motion-reduce:transition-none motion-reduce:group-hover:transform-none",
                i === 0
                  ? "z-10 translate-y-[26px] scale-[0.955] group-hover:translate-y-[46px] group-hover:-rotate-2"
                  : "z-0 translate-y-[52px] scale-[0.91] group-hover:translate-y-[92px] group-hover:-rotate-4",
              ].join(" ")}
            >
              <span className="capitalize">
                {t.brand} •••• {t.last4}
              </span>
            </div>
          ))}

          {/* La de delante. */}
          <div
            className="absolute inset-x-0 top-0 z-20 h-[178px] rounded-[20px] bg-linear-to-br from-[#191925] to-[#054a94] p-6 text-white shadow-xl transition-transform duration-500 ease-out group-hover:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
          >
            <div className="flex items-center justify-between">
              <span className="h-7 w-9 rounded-[6px] bg-[#facc66]" />
              <span className="text-xs font-semibold tracking-wide">
                ENSÉÑAME YA
              </span>
            </div>
            <p className="mt-9 text-xl font-medium tracking-[0.15em]">
              •••• •••• •••• {tarjeta ? tarjeta.last4 : "••••"}
            </p>
            <div className="mt-5 flex justify-between text-[13px]">
              <span>
                <span className="block text-[9px] tracking-wide opacity-70">
                  {!tarjeta
                    ? "SIN TARJETA GUARDADA"
                    : tarjetas.length > 1
                      ? hayUltimaUsada
                        ? "ÚLTIMA USADA · ELIGES AL PAGAR"
                        : `1 DE ${tarjetas.length} · ELIGES AL PAGAR`
                      : "TITULAR"}
                </span>
                <span className="font-semibold capitalize">
                  {tarjeta ? (tarjeta.nombre ?? tarjeta.brand) : "—"}
                </span>
              </span>
              <span>
                <span className="block text-[9px] tracking-wide opacity-70">
                  VENCE
                </span>
                <span className="font-semibold">
                  {tarjeta
                    ? `${String(tarjeta.expMonth).padStart(2, "0")}/${String(tarjeta.expYear).slice(-2)}`
                    : "\u2013\u2013/\u2013\u2013"}
                </span>
              </span>
            </div>
          </div>

          {tarjetas.length > 3 ? (
            <span className="absolute inset-x-0 bottom-0 z-30 text-center text-[11px] text-[#6b6b6b]">
              y {tarjetas.length - 3} más
            </span>
          ) : null}
        </div>

        <PanelCard>
          <PanelCardTitle className="text-[15px]">
            Resumen del pedido
          </PanelCardTitle>
          <div className="mt-3.5">
            <p className="text-sm font-medium text-[#19191f]">{productTitle}</p>
            <p className="text-xs text-[#6b6b6b]">
              con {tutorName} · {packageLabel}
            </p>
          </div>
          <ul className="mt-3.5 flex flex-col gap-1 border-t border-[#e0e0e0] pt-3.5 text-xs text-[#6b6b6b]">
            {slots.map((iso) => (
              <li key={iso} className="first-letter:uppercase">
                {slotLabel(iso)}
              </li>
            ))}
          </ul>
          <div className="mt-3.5 flex items-center justify-between border-t border-[#e0e0e0] pt-3.5 text-[13px]">
            <span className="text-[#6b6b6b]">Subtotal</span>
            <span className="text-[#333333]">{formatMoney(total, currency)}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-semibold text-[#19191f]">Total</span>
            <span className="text-lg font-bold text-brand">
              {formatMoney(total, currency)}
            </span>
          </div>
          <p className="mt-3.5 flex gap-2 text-[11px] text-[#6b6b6b]">
            <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-success" />
            <span>
              Reembolso del {P.refundPct.studentEarly} % si el tutor no acepta en{" "}
              {P.cutoffHours} h (RN-27/37).
            </span>
          </p>
        </PanelCard>
      </div>

      {/* Columna derecha: el formulario de Stripe, embebido (sin PAN nuestro). */}
      <PanelCard>
        <PanelCardTitle className="text-[15px]">Método de pago</PanelCardTitle>

        {embed ? (
          <div className="mt-3.5">
            <StripeEmbed {...embed} />
          </div>
        ) : (
          <div className="mt-3.5 flex gap-3 rounded-xl border border-dashed border-[#e0e0e0] p-5">
            <LockIcon className="mt-0.5 size-5 shrink-0 text-[#6b6b6b]" />
            <div>
              <p className="text-sm font-semibold text-[#19191f]">
                Pagas aquí mismo, sin salir de Enséñame Ya
              </p>
              <p className="mt-1 text-[13px] text-[#6b6b6b]">
                {tarjetas.length === 0
                  ? "Al continuar aparece aquí el formulario seguro de nuestro proveedor de pagos. Los datos de tu tarjeta viajan a él directamente: nunca pasan por Enséñame Ya."
                  : tarjetas.length === 1
                    ? `Al continuar podrás pagar con tu ${tarjeta!.brand} ••••${tarjeta!.last4} o con otra tarjeta, aquí mismo. Esos datos nunca pasan por Enséñame Ya.`
                    : `Al continuar podrás elegir entre tus ${tarjetas.length} tarjetas guardadas o usar otra, aquí mismo. Esos datos nunca pasan por Enséñame Ya.`}
              </p>
            </div>
          </div>
        )}

        {/* El aviso solo cuando el cobro ES simulado. Dejarlo fijo fue un bug
            real: al encender Stripe, la pantalla seguía diciendo que no se movía
            dinero mientras el botón llevaba a una pasarela de verdad. */}
        {simulado ? (
          <p className="mt-4 rounded-lg bg-warning-muted px-4 py-3 text-[13px] text-warning">
            Entorno de pruebas: el cobro está simulado, no se mueve dinero real.
          </p>
        ) : null}

        {/* Consentimiento explícito para el card-on-file (PAC-02). Va aquí y no
            en la pasarela para que se lea en nuestro idioma y ANTES de salir del
            sitio. Se traduce en `setup_future_usage` solo si está marcada. */}
        {simulado || embed ? null : (
          <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px] text-[#4b4b4b]">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[color:var(--brand)]"
              checked={guardarTarjeta}
              onChange={(e) => setGuardarTarjeta(e.target.checked)}
            />
            <span>
              {tarjeta
                ? "Guardar también la tarjeta que use ahora, si es distinta."
                : "Guardar esta tarjeta para mis próximas reservas."}{" "}
              Puedes quitarlas cuando quieras desde{" "}
              <strong>Métodos de pago</strong>.
            </span>
          </label>
        )}

        {/* Montado el embed, el pago lo cierra Stripe: dejar aquí un botón que
            vuelve a crear reserva y Session abriría un cobro duplicado. */}
        <div className={embed ? "hidden" : "mt-6 flex flex-wrap gap-3"}>
          <Button
            className="h-[49px] rounded-[10px] px-6 font-semibold"
            disabled={state === "processing"}
            onClick={() => pay(true)}
          >
            {state === "processing"
              ? "Procesando…"
              : simulado
                ? `Confirmar pago · ${formatMoney(total, currency)}`
                : `Continuar al pago · ${formatMoney(total, currency)}`}
          </Button>
          {/* Simular fallo solo tiene sentido con el proveedor simulado: con
              Stripe el rechazo lo decide la pasarela, y este botón acabaría
              llevando al mismo checkout real. */}
          {simulado ? (
            <Button
              variant="outline"
              className="h-[49px] rounded-[10px] px-6"
              disabled={state === "processing"}
              onClick={() => pay(false)}
            >
              Simular fallo
            </Button>
          ) : null}
        </div>
      </PanelCard>
    </div>
  );
}
