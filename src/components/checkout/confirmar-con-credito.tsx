"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PrecioEnLinea } from "@/components/precio/precio";
import type { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { cn } from "@/lib/utils";

/**
 * 💳 EL CAMINO SIN PASARELA, Y LA PREGUNTA QUE VA ANTES DE ABRIR UN COBRO.
 *
 * Este fichero tiene dos mitades y las dos son del mismo camino:
 *
 *   · `hayQueElegirCredito` — si esta pantalla tiene que PREGUNTAR antes de
 *     abrir el cobro, o puede abrirlo de una como siempre.
 *   · `ConfirmarConCredito` — el bloque que sustituye al formulario de pago
 *     cuando el crédito cubre el total.
 *
 * ⚠️ VIVE APARTE DE LAS TRES PANTALLAS A PROPÓSITO. `checkout-form`,
 * `resume-payment` y `order-payment` necesitan EXACTAMENTE lo mismo, y esto no
 * es un adorno: es un botón que consume un crédito y confirma una compra.
 * Escrito tres veces, la tercera copia es la que se queda sin el candado del
 * doble clic o sin la rama del 409 — que es literalmente la historia de
 * `interpretar()` en `respuesta-de-cobro.ts`, tres pantallas leyendo la misma
 * respuesta cada una a su manera hasta que una se equivocó.
 */

type Cliente = ReturnType<typeof createClient>;
type BookingStatus = Database["public"]["Enums"]["booking_status"];
type OrderStatus = Database["public"]["Enums"]["order_status"];

/** Qué se está confirmando. Misma forma que el `sujeto` de `DlocalEmbed`. */
export type SujetoDelCredito =
  | { tipo: "booking"; id: string }
  | { tipo: "order"; id: string };

/**
 * ¿Hay algo que preguntarle al alumno antes de abrir el cobro de esta reserva?
 *
 * 🔴 POR QUÉ HACE FALTA PREGUNTAR, Y POR QUÉ ANTES — el orden no es preferencia.
 *
 * `aplicar_credito` (§8.2 de `20260912110000`) lleva el cerrojo 2: si el pago ya
 * tiene un cobro abierto y `payments.checkout_amount` no coincide con
 * `gross_amount − lo que cubriría el crédito`, levanta excepción («ya hay un
 * cobro abierto para esta reserva por otro importe»). Y abrir el cobro sin
 * crédito sella `checkout_amount = gross_amount`, así que desde ese instante
 * CUALQUIER crédito usable —que por definición cubre más de cero— da un importe
 * distinto y la RPC dice que no. `quitar_credito` lleva el simétrico, y por eso
 * la pregunta también hay que hacerla cuando el crédito YA está aplicado: con el
 * cobro abierto por `gross − credito`, quitarlo tampoco se puede.
 *
 * O sea que cambiar el crédito después de abrir no es «feo»: **es imposible**, y
 * el navegador no tiene forma de cerrar un cobro abierto (el marcador solo lo
 * limpia `liberar_credito_de_pago` cuando el pago ya está muerto). Ese cerrojo
 * existe para que nadie pueda abrir una Session por `gross − credito`, quitar el
 * crédito y pagar la Session vieja: una imprenta de dinero. No se rodea, se
 * respeta — y respetarlo significa preguntar primero.
 *
 * ⚠️ POR QUÉ ESTO NO ES EL `onCambio` DEL SELECTOR, que sería lo natural.
 * `CambioDeCredito` distingue «hay uno aplicado» de «no hay ninguno aplicado»,
 * que no es la pregunta de aquí: `{ tipo: 'sin-credito' }` sale IGUAL cuando el
 * alumno no tiene un solo crédito —casi todos— y cuando tiene uno sin aplicar.
 * El padre necesita separarlas para decidir si abre el cobro de una o espera, y
 * de la segunda depende que a alguien no se le abra el cobro debajo del botón
 * de canjear. Esta función responde EXACTAMENTE a la condición con la que
 * `SelectorDeCredito` decide pintarse (`leerTodo` → `tipo: 'vacio'` → devuelve
 * `null`): pago vivo y, o bien un crédito puesto, o bien alguna fila que
 * enseñar. Si un día divergen, lo que se ve es un «Continuar al pago» solo
 * encima de un selector invisible — molesto, no roto.
 *
 * ⚠️ EL COSTE, QUE SE PAGA ENTERO: un viaje más antes del formulario de pago,
 * para todo el mundo. Va en paralelo con la carga del propio selector, así que
 * es una ida y no dos, pero no se puede solapar con la apertura del cobro:
 * solaparlas es exactamente abrirlo antes de saber. Quien venga a quitar
 * profundidad a esta cascada, el sitio bueno es el render de servidor de cada
 * pantalla, no aquí.
 *
 * ⚠️ Y SI LA LECTURA FALLA, NO SE BLOQUEA EL PAGO. Se mira el `error` —regla de
 * oro 10— y queda en consola, pero la respuesta es «no hay nada que preguntar»:
 * un fallo de esta consulta no puede dejar a nadie encerrado sin poder pagar. La
 * contrapartida es que quien tuviera un crédito pagaría sin usarlo, y de eso
 * avisa el propio selector, que también mira su `error` y lo dice en pantalla.
 */
export async function hayQueElegirCredito(
  supabase: Cliente,
  bookingId: string,
): Promise<boolean> {
  const [pago, creditos] = await Promise.all([
    // `payments_select_student` deja al alumno leer el pago de su reserva: la
    // autorización es la RLS, no una comprobación nuestra.
    supabase
      .from("payments")
      .select("credit_id, status")
      .eq("booking_id", bookingId)
      .maybeSingle(),
    supabase.rpc("creditos_disponibles", { p_booking_id: bookingId }),
  ]);

  if (pago.error || creditos.error) {
    console.error("[checkout] no se pudo mirar el crédito de la reserva:", {
      reserva: bookingId,
      pago: pago.error?.message,
      creditos: creditos.error?.message,
    });
    return false;
  }

  // Sin fila de cobro, o con el pago fuera de `pending`, las dos RPC se niegan
  // por diseño (cerrojo 1): no hay nada que elegir porque no hay nada que hacer.
  if (!pago.data || pago.data.status !== "pending") return false;

  // Ya hay uno puesto → se pregunta igual: es la única ventana en la que se
  // puede quitar. Y las filas NO usables cuentan a propósito, porque el selector
  // las pinta con su motivo: enseñar «tu regalo caducó» al lado del precio es
  // justo lo que evita la pregunta a soporte de dos días después.
  return pago.data.credit_id !== null || (creditos.data ?? []).length > 0;
}

/**
 * Estados en los que la compra YA ESTÁ HECHA. Se usan para una cosa muy
 * concreta: el 409 de `/api/pagos/credito` cuando el sujeto no está en
 * `pending_payment`.
 *
 * ⚠️ Ese 409 tiene DOS significados opuestos y hay que separarlos. Si la reserva
 * pasó a `confirmed`/`pending_acceptance`, la confirmación FUNCIONÓ —otra
 * pestaña, o esta misma petición cuya respuesta se perdió por el camino— y lo
 * correcto es llevar a la persona a su confirmación, no acusarla de un error.
 * Si pasó a `cancelled` (el hold venció mientras dudaba) eso sí es un final
 * malo y hay que decirlo. `refunded` queda fuera de la lista a propósito: es una
 * compra deshecha, y mandar ahí a alguien que acaba de pulsar «confirmar» sería
 * enseñarle una confirmación de algo que ya no existe.
 */
const RESERVA_YA_COMPRADA: BookingStatus[] = [
  "pending_acceptance",
  "confirmed",
  "in_progress",
  "completed",
];
const PEDIDO_YA_COMPRADO: OrderStatus[] = ["paid"];

function yaComprado(tipo: SujetoDelCredito["tipo"], estado: unknown): boolean {
  if (typeof estado !== "string") return false;
  const validos: string[] =
    tipo === "booking" ? RESERVA_YA_COMPRADA : PEDIDO_YA_COMPRADO;
  return validos.includes(estado);
}

type Envio =
  | { fase: "listo" }
  | { fase: "enviando" }
  /** `reintentable` = la petición no llegó a salir; repetirla es seguro. */
  | { fase: "error"; mensaje: string; reintentable: boolean };

const MENSAJE_RED =
  "No pudimos completar la confirmación. Comprueba tu conexión y vuelve a intentarlo.";

/**
 * 💳 «Tu crédito cubre el total» — el bloque que sustituye al formulario de pago.
 *
 * Aparece cuando `/api/pagos/checkout` responde `modo: 'credito'`, o sea cuando
 * `gross_amount - credit_amount = 0` en todas las líneas. No hay pasarela a la
 * que ir —un cargo de 0 en Stripe es un 400— y la reserva hay que confirmarla
 * igual: el tutor cobra su `tutor_net_amount` íntegro, solo que lo financia el
 * crédito. Eso lo hace `POST /api/pagos/credito`.
 *
 * ⚠️ UN SOLO PULSO, Y SE NOTA QUE ESTÁ EN MARCHA. Si esto se envía dos veces, la
 * segunda encuentra el crédito ya consumido y la reserva ya movida: la persona
 * lee un error después de haber comprado bien. El candado es un `ref` y no el
 * `disabled` del botón a propósito — `disabled` depende de que React haya
 * repintado, y un doble clic rápido cabe antes de ese repintado.
 *
 * ⚠️ Y NO SE MANDA NI UN IMPORTE. El cuerpo lleva `bookingId` u `orderId` y nada
 * más: cuánto cubre el crédito lo escribió `aplicar_credito` en la base y lo
 * revalida la RPC (regla de oro 2). `creditoTotal` de aquí es para PINTARLO, no
 * para decidir nada.
 */
export function ConfirmarConCredito({
  sujeto,
  destino,
  etiqueta,
  importe,
  className,
}: {
  sujeto: SujetoDelCredito;
  /**
   * A dónde ir cuando sale bien. Lo pone cada pantalla con SU camino de éxito
   * de siempre —el mismo al que llegan el cobro simulado y el `returnUrl` de
   * dLocal—, para que pagar con crédito no aterrice en otro sitio que pagar con
   * tarjeta.
   */
  destino: string;
  /** «Confirmar reserva» / «Confirmar pedido»: el verbo de esa pantalla. */
  etiqueta: string;
  /** Lo que cubre el crédito. Opcional: `/reservas/[id]/pagar` no maneja
   *  importes y ahí es mejor no pintar una cifra que decir una de más. */
  importe?: { minor: number; currency: string };
  className?: string;
}) {
  const router = useRouter();
  const [envio, setEnvio] = useState<Envio>({ fase: "listo" });
  const enviado = useRef(false);

  async function confirmar() {
    if (enviado.current) return;
    enviado.current = true;
    setEnvio({ fase: "enviando" });

    let res: Response;
    try {
      res = await fetch("/api/pagos/credito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          sujeto.tipo === "booking" ? { bookingId: sujeto.id } : { orderId: sujeto.id },
        ),
      });
    } catch {
      // La petición no salió (o se perdió por el camino). Reintentar es seguro:
      // si por dentro sí había llegado y funcionado, el segundo intento se
      // encuentra el 409 con `estado` de abajo y termina en la confirmación.
      enviado.current = false;
      setEnvio({ fase: "error", mensaje: MENSAJE_RED, reintentable: true });
      return;
    }

    const salida = (await res.json().catch(() => ({}))) as {
      error?: string;
      estado?: unknown;
    };

    // Sin `setEnvio`: se queda en "enviando" mientras el router navega, que es
    // lo honesto. Volver a "listo" aquí dejaría un «Confirmar» pulsable durante
    // la navegación, encima de una compra que ya está hecha.
    if (res.ok) {
      router.push(destino);
      return;
    }

    // El 409 que en realidad es un sí. Ver `RESERVA_YA_COMPRADA`.
    if (res.status === 409 && yaComprado(sujeto.tipo, salida.estado)) {
      router.push(destino);
      return;
    }

    setEnvio({
      fase: "error",
      mensaje:
        salida.error ??
        "No pudimos confirmar con tu crédito. Recarga la página para ver su estado.",
      reintentable: false,
    });
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-[#bfe3c9] bg-success-muted p-5",
        className,
      )}
    >
      <p className="flex items-center gap-2 text-[15px] font-semibold text-success">
        <SparklesIcon className="size-4 shrink-0" aria-hidden />
        Tu crédito cubre el total
      </p>

      {/* El crédito NO es un descuento: cambia quién paga, no cuánto vale la
          mentoría. Por eso se dice «lo pone tu crédito» y no «te descontamos»:
          el tutor cobra lo mismo, y quien lo financia es la plataforma. */}
      <p className="mt-2 text-[13px] text-[#4b4b4b]">
        No queda nada que pagar
        {importe ? (
          <>
            {": los "}
            <PrecioEnLinea
              amountMinor={importe.minor}
              currency={importe.currency}
              className="font-semibold text-[#19191f]"
            />
            {" los pone tu crédito"}
          </>
        ) : (
          ": lo pone tu crédito"
        )}
        . Confirma y tu horario queda reservado.
      </p>

      <Button
        type="button"
        // 49 px de alto, como el resto de botones de estas pantallas: por encima
        // de los 44 del objetivo táctil. `w-full` en móvil para que no quede un
        // botón estrecho al borde de la tarjeta.
        className="mt-4 h-[49px] w-full rounded-[10px] px-6 font-semibold sm:w-auto"
        disabled={envio.fase === "enviando"}
        onClick={confirmar}
      >
        {envio.fase === "enviando" ? "Confirmando…" : etiqueta}
      </Button>

      {envio.fase === "error" ? (
        <div className="mt-3">
          <p role="alert" className="text-[13px] text-destructive">
            {envio.mensaje}
          </p>
          {/* Cuando el fallo NO es de red, el estado de la reserva cambió por
              debajo y reintentar no arregla nada: lo único útil es volver a
              mirar. Recarga entera y no `router.refresh()`, porque lo que hay
              que rehacer es la apertura del cobro, que es estado de cliente. */}
          {!envio.reintentable ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 text-[13px] font-semibold text-brand hover:underline"
            >
              Recargar y ver el estado
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
