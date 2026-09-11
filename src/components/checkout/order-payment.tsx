"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { StripeEmbed, type Embed } from "@/components/checkout/stripe-embed";
import { DlocalEmbed } from "@/components/checkout/dlocal-embed";
import { HoldCountdown } from "@/components/checkout/hold-countdown";
import { ConfirmarConCredito } from "@/components/checkout/confirmar-con-credito";
import {
  interpretar,
  irAPagar,
  type DlocalTransparente,
  type RespuestaDeCobro,
} from "@/components/checkout/respuesta-de-cobro";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { PrecioEnLinea, usePrecio } from "@/components/precio/precio";

/** Igual que en el checkout de una reserva: primero se abre el cobro, luego se pinta. */
type Apertura =
  | { fase: "abriendo" }
  | { fase: "error"; mensaje: string }
  | { fase: "simulado"; retencionHasta: string | null }
  | { fase: "lista"; retencionHasta: string | null; embed: Embed }
  /** dLocal transparente: sus campos de tarjeta, dentro de esta pantalla. */
  | {
      fase: "transparente";
      retencionHasta: string | null;
      transparente: DlocalTransparente;
    }
  /** El crédito cubre las N líneas: no hay pasarela, hay un botón de confirmar. */
  | { fase: "credito"; retencionHasta: string | null; creditoTotal: number };

/**
 * Lo que ponen los créditos en ESTE pedido, sumando línea a línea.
 *
 * ⚠️ SON DOS CONSULTAS Y NO UNA porque el crédito se aplica POR RESERVA
 * (`aplicar_credito(p_booking_id, …)`) y `payments` no tiene `order_id`: se
 * resuelven las líneas del pedido y se leen sus pagos. Es exactamente lo que
 * hace `/api/pagos/checkout` con `service_role`, solo que aquí con la sesión del
 * alumno y su RLS (`bookings_select_own` + `payments_select_student`).
 *
 * ⚠️ Y NO DECIDE NINGÚN COBRO. Lo que se cobra lo compone el Route Handler
 * leyendo esos mismos snapshots (regla de oro 2); esto solo existe para que la
 * pantalla no siga anunciando el bruto cuando ya no es lo que se va a cobrar.
 * Hoy casi siempre da 0 —al pedido no se le puede aplicar un crédito desde
 * ninguna pantalla, porque el selector es por reserva—, y da igual: el día que
 * una línea llegue con un regalo dentro, el botón de abajo tiene que decir la
 * verdad sin que nadie se acuerde de tocarlo.
 *
 * Se mira el `error` de las dos (regla de oro 10): un `const { data } = …`
 * convertiría un fallo de consulta en «no hay crédito», que es una mentira
 * creíble sobre el importe que alguien está a punto de pagar. Ante la duda se
 * devuelve `null` y la pantalla no promete nada.
 */
async function creditoDelPedido(orderId: string): Promise<number | null> {
  const supabase = createClient();

  const { data: lineas, error: eLineas } = await supabase
    .from("bookings")
    .select("id")
    .eq("order_id", orderId);

  if (eLineas) {
    console.error("[order-payment] no se pudieron leer las líneas:", eLineas.message);
    return null;
  }
  const ids = (lineas ?? []).map((b) => b.id);
  if (ids.length === 0) return null;

  const { data: pagos, error: ePagos } = await supabase
    .from("payments")
    .select("credit_amount")
    .in("booking_id", ids);

  if (ePagos) {
    console.error("[order-payment] no se pudieron leer los pagos:", ePagos.message);
    return null;
  }
  return (pagos ?? []).reduce((suma, p) => suma + (p.credit_amount ?? 0), 0);
}

/**
 * EY-176 · EL PAGO DE UN PEDIDO — un cobro, N mentorías (P-3).
 *
 * ⚠️ NO CREA NADA. Las N reservas y la cabecera del pedido ya existen: las creó
 * `create_order` desde `/api/pedidos` cuando la persona pulsó «Ir al pago» en
 * el carrito, todas en una transacción (P-1). Esta pantalla solo abre el cobro,
 * igual que `resume-payment.tsx` con una reserva a medias. Llamar aquí a
 * `create_order` sería el duplicado que `find_open_order` existe para evitar.
 *
 * ⚠️ EL RELOJ ES UNO PARA TODO EL PEDIDO, y eso es P-2. Las N reservas nacieron
 * en la misma transacción, así que comparten `created_at` y
 * `expire_stale_bookings` las vence juntas en una sola pasada: un contador, no
 * N. Es exactamente por eso que se descartó que el carrito retuviera el horario
 * al añadir — con 7 minutos por línea, la primera mentoría caducaría mientras
 * se elige la segunda.
 *
 * ⚠️ Y EL IMPORTE NO SALE DE AQUÍ. `total` es solo lo que se pinta, y viene del
 * servidor sumando `payments.gross_amount` de cada línea; lo que se cobra lo
 * compone `/api/pagos/checkout` leyendo esos mismos snapshots (regla de oro 2).
 * Este componente no suma nada.
 *
 * ⚠️ 💳 AQUÍ NO HAY SELECTOR DE CRÉDITO, y no es un olvido: el crédito se aplica
 * POR RESERVA y esta pantalla solo conoce el pedido. Ofrecer uno exigiría
 * decidir a qué línea va —una decisión de producto que nadie ha tomado— y
 * pasarle las N reservas desde el servidor. Lo que sí hay es el camino de
 * llegada: un pedido cuyas líneas YA vengan cubiertas (un regalo) se confirma
 * abajo sin pasar por ninguna pasarela, y lo que ponga un crédito parcial se
 * descuenta de lo que anuncia el botón.
 */
export function OrderPayment({
  orderId,
  total,
  currency,
}: {
  orderId: string;
  /** Solo para el botón del camino simulado. El cobro real no lo mira. */
  total: number;
  currency: string;
}) {
  const router = useRouter();
  const [apertura, setApertura] = useState<Apertura>({ fase: "abriendo" });
  /** Lo que ponen los créditos de las líneas. `null` = no se pudo saber. */
  const [credito, setCredito] = useState<number | null>(null);
  const creditoAplicado = credito ?? 0;
  const aPagar = Math.max(0, total - creditoAplicado);
  // El botón repite la cifra GRANDE del total que tiene encima —la local si la
  // hay—, no el dólar: si dijeran números distintos, el que se lee al pulsar es
  // el del botón. El USD sigue visible en la línea pequeña de ese total.
  const { local: totalLocal, usd: totalUsd } = usePrecio(aPagar, currency);
  const [pagando, setPagando] = useState(false);
  // Qué pedido se abrió ya. Con la clave dentro y no un booleano, StrictMode no
  // abre dos veces y una navegación a OTRO pedido sí vuelve a abrir.
  const abiertoPara = useRef<string | null>(null);

  useEffect(() => {
    if (abiertoPara.current === orderId) return;
    abiertoPara.current = orderId;

    async function abrir() {
      setApertura({ fase: "abriendo" });
      // En paralelo con la apertura a propósito: lo que ponen los créditos solo
      // cambia lo que se PINTA, así que no tiene por qué añadir un viaje a la
      // profundidad de la cascada que hay antes del formulario de pago.
      const [res, sumaDeCreditos] = await Promise.all([
        fetch("/api/pagos/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // ⚠️ `orderId`, no `bookingId`: el Route Handler los trata como
          // excluyentes y de esa distinción depende que el webhook acredite las N
          // líneas y no una.
          body: JSON.stringify({ orderId }),
        }),
        creditoDelPedido(orderId),
      ]);
      const salida = (await res.json().catch(() => ({}))) as RespuestaDeCobro;
      setCredito(sumaDeCreditos);

      if (!res.ok) {
        setApertura({
          fase: "error",
          mensaje: salida.error ?? "No se pudo abrir el pago del pedido.",
        });
        return;
      }

      // A2 · ver `respuesta-de-cobro.ts`. Con un pedido esto importa igual o
      // más: caer al camino simulado aquí pintaría el botón de «simular pago»
      // sobre un cargo de N mentorías.
      const accion = interpretar(salida);
      const retencionHasta = salida.retencionHasta ?? null;

      if (accion.tipo === "redireccion") {
        irAPagar(accion.url);
        return;
      }
      if (accion.tipo === "embebido") {
        setApertura({ fase: "lista", retencionHasta, embed: accion.embed });
        return;
      }
      // dLocal, dentro de la pantalla. Con un pedido esto importa igual que con
      // una reserva suelta: el cargo es UNO para las N mentorías (P-3), así que
      // el formulario es uno y la confirmación es la del pedido.
      if (accion.tipo === "transparente") {
        setApertura({ fase: "transparente", retencionHasta, transparente: accion.transparente });
        return;
      }
      // 💳 Las N líneas están cubiertas al 100 %: no hay a quién cobrar. Sin
      // esta rama la respuesta caía al `default` de `interpretar` y el pedido
      // salía con un error en vez de con su botón de confirmar.
      if (accion.tipo === "credito") {
        setApertura({ fase: "credito", retencionHasta, creditoTotal: accion.creditoTotal });
        return;
      }
      if (accion.tipo === "simulado") {
        setApertura({ fase: "simulado", retencionHasta });
        return;
      }
      setApertura({ fase: "error", mensaje: accion.mensaje });
    }

    void abrir();
  }, [orderId]);

  /**
   * Camino simulado (`payment_routing_rules` todavía en 'simulated', que es el
   * estado de HOY). No hay Session que abrir y lo cierra el propio navegador.
   *
   * ⚠️ `confirm_simulated_order_payment` Y NO N LLAMADAS A
   * `confirm_simulated_payment`. Confirmar línea a línea desde aquí produce
   * exactamente el estado medio pagado que toda esta ficha existe para impedir,
   * solo que sin Stripe delante: si la pestaña se cierra a mitad, quedan dos
   * mentorías compradas y una muriendo. La RPC del pedido las hace todas en una
   * transacción, y exige ser dueño **y** que el pedido esté ruteado al
   * proveedor simulado — el día que se encienda Stripe este botón deja de
   * funcionar solo, que es lo que debe pasar.
   */
  async function confirmarSimulado(exito: boolean) {
    setPagando(true);
    const { error } = await createClient().rpc(
      "confirm_simulated_order_payment",
      { p_order_id: orderId, p_success: exito },
    );
    if (error) {
      toast.error(error.message ?? "No se pudo procesar el pago.");
      setPagando(false);
      return;
    }
    if (!exito) {
      toast.error("El pago no se completó. Se liberaron los horarios.");
      setPagando(false);
      return;
    }
    router.push(`/pedidos/${orderId}/confirmacion`);
  }

  return (
    <>
      {apertura.fase !== "abriendo" && apertura.fase !== "error" ? (
        <HoldCountdown hasta={apertura.retencionHasta} className="mt-3.5" />
      ) : null}

      {apertura.fase === "abriendo" ? (
        <p className="mt-3.5 text-[13px] text-[#6b6b6b]" aria-live="polite">
          Preparando tu pago seguro…
        </p>
      ) : null}

      {apertura.fase === "error" ? (
        <p role="alert" className="mt-3.5 text-[13px] text-destructive">
          {apertura.mensaje}
        </p>
      ) : null}

      {/* 💳 Lo que ponen los créditos de las líneas, cuando queda algo por
          cobrar. En la fase "credito" no se pinta: allí lo dice el propio bloque
          de confirmar, y decirlo dos veces con dos cifras que tienen que coincidir
          es la forma habitual de que un día no coincidan.

          Un crédito NO es un descuento: la mentoría vale lo mismo y el tutor
          cobra lo mismo, solo cambia quién la financia. De ahí «Tu crédito». */}
      {apertura.fase !== "abriendo" &&
      apertura.fase !== "error" &&
      apertura.fase !== "credito" &&
      creditoAplicado > 0 ? (
        <p className="mt-3.5 text-[13px] text-[#4b4b4b]">
          Tu crédito cubre{" "}
          <PrecioEnLinea
            amountMinor={creditoAplicado}
            currency={currency}
            className="font-semibold text-[#19191f]"
          />{" "}
          de este pedido: abajo solo se cobra la diferencia.
        </p>
      ) : null}

      {apertura.fase === "lista" ? (
        <div className="mt-3.5">
          {/* La casilla de «guardar esta tarjeta» la pinta Stripe dentro de
              este formulario (D-3), igual que en el checkout de una reserva. */}
          <StripeEmbed {...apertura.embed} />
        </div>
      ) : null}

      {/* ⚠️ Y AQUÍ NO HAY CASILLA DE GUARDADO DE NINGUNA CLASE: el formulario
          embebido de dLocal NO TIENE BÓVEDA (dictado §5). Quien pague por dLocal
          no puede guardar su tarjeta — es la decisión abierta D-6, y lo honesto
          es no ofrecer una casilla que no guardaría nada. */}
      {apertura.fase === "transparente" ? (
        <div className="mt-3.5">
          <DlocalEmbed
            sujeto={{ tipo: "order", id: orderId }}
            {...apertura.transparente}
            returnUrl={`/pedidos/${orderId}/confirmacion`}
          />
        </div>
      ) : null}

      {/* 💳 El pedido entero lo pagan los créditos: ni Session ni redirección,
          un botón contra `POST /api/pagos/credito`. Es él quien llama a
          `confirm_credit_order`, que exige que las N líneas estén cubiertas al
          100 % y aborta entera si una sola no lo está — el todo o nada de P-1,
          igual que en el camino simulado de aquí al lado. */}
      {apertura.fase === "credito" ? (
        <ConfirmarConCredito
          sujeto={{ tipo: "order", id: orderId }}
          destino={`/pedidos/${orderId}/confirmacion`}
          etiqueta="Confirmar pedido"
          importe={{ minor: apertura.creditoTotal, currency }}
          className="mt-3.5"
        />
      ) : null}

      {apertura.fase === "simulado" ? (
        <>
          <p className="mt-4 rounded-lg bg-warning-muted px-4 py-3 text-[13px] text-warning">
            Entorno de pruebas: el cobro está simulado, no se mueve dinero real.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              className="h-[49px] rounded-[10px] px-6 font-semibold"
              disabled={pagando}
              onClick={() => confirmarSimulado(true)}
            >
              {pagando
                ? "Procesando…"
                : `Confirmar pago · ${totalLocal ?? totalUsd}`}
            </Button>
            <Button
              variant="outline"
              className="h-[49px] rounded-[10px] px-6"
              disabled={pagando}
              onClick={() => confirmarSimulado(false)}
            >
              Simular fallo
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}
