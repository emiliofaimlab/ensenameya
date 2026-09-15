import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { capturarOrden, paypalProvider } from "@/lib/payments/paypal-provider";
import type { OrderStatus } from "@/lib/orders/tipos";
import type { Database } from "@/lib/database.types";

type EstadoReserva = Database["public"]["Enums"]["booking_status"];

/**
 * WEBHOOK DE PAYPAL. El tercer hermano de `/api/webhooks/stripe` y
 * `/api/webhooks/dlocalgo`, y **el único sitio donde un cobro de PayPal pasa a
 * `paid`**. El navegador no confirma pagos (regla de oro 2).
 *
 * ── 🔴 ESTE FICHERO ES LA TERCERA COPIA, Y HAY QUE DECIRLO ─────────────────
 *
 * El de dLocal ya avisa: «la LÓGICA (X-02, idempotencia, sellado) sí es la
 * misma, y por eso se lee igual: si tocas una, mira la otra». Con tres, eso deja
 * de ser un consejo y pasa a ser una trampa: un arreglo aplicado a dos de tres
 * es indistinguible de uno aplicado a las tres hasta que alguien pierde dinero
 * por la que se quedó atrás.
 *
 * ponytail: esto se escribe así a sabiendas y con el techo puesto. Lo que hay
 * que extraer es el motor de después de la firma —`llamar`, `sellarReferencia`,
 * `cobroEntrante`, `reembolsarCobroHuerfano`— a un módulo común del que cuelguen
 * los tres. No se hizo aquí porque significa reescribir dos rutas de dinero que
 * hoy funcionan, y eso es un cambio propio, con su revisión, no el peaje de
 * añadir una pasarela. **Está pendiente y es lo siguiente que toca.**
 *
 * Lo que sí se ha hecho es que la copia sea la MÁS PEQUEÑA posible: aquí no
 * está el camino del 🎁 REGALO, que son ~150 líneas de las otras dos. No por
 * recorte: es que PayPal no puede cobrar un regalo, y no puede porque
 * `api/pagos/checkout` lo excluye de esa cadena a propósito (ver allí). Si
 * llegara uno igualmente, este archivo grita y devuelve 500 en vez de adivinar.
 *
 * ── LAS DOS DIFERENCIAS CON SUS HERMANOS ───────────────────────────────────
 *
 * 1. 🔑 **HAY UN PASO DE CAPTURA.** Aprobar no es pagar: con `intent: CAPTURE`
 *    PayPal autoriza y el dinero sigue siendo del alumno hasta que el comercio
 *    captura. Así que este webhook recibe DOS eventos por cobro —
 *    `CHECKOUT.ORDER.APPROVED`, que dispara la captura, y
 *    `PAYMENT.CAPTURE.COMPLETED`, que acredita— y solo el segundo toca la
 *    reserva. El fallo seguro es bueno: si la captura no ocurre, no se cobró
 *    nada y el hold caduca solo.
 *
 * 2. **La firma se verifica CONTRA LA API DE PAYPAL**, no con un HMAC local
 *    (ver `paypalProvider.verifyWebhook`). Consecuencia práctica: verificar
 *    cuesta un viaje de red y puede fallar por causas nuestras, y por eso un
 *    fallo de verificación que no sea «la firma no cuadra» sale por 503 para
 *    que PayPal reintente, nunca por 400.
 *
 * ⚠️ Y COMO EN LOS OTROS DOS, EL IMPORTE NO LO ELIGE QUIEN MANDA EL POST: lo
 * dice el cuerpo que PayPal acaba de firmar, y `confirm_payment` lo concilia
 * contra lo debido y aborta si no cuadra.
 */

/** Node, no edge: el adaptador usa `Buffer` para la credencial básica. */
export const runtime = "nodejs";

/** Estados de `payments` en los que el cobro ya está contabilizado. */
const YA_CONTABILIZADO = ["paid", "refunded", "partially_refunded"];

/** `check_violation`: las dos comprobaciones de importe de `confirm_payment`. */
const DESCUADRE = "23514";

export async function POST(req: Request) {
  // ⚠️ EL CUERPO CRUDO. Aquí PayPal reserializa por su cuenta para verificar,
  // así que el crudo no es tan crítico como en un HMAC — pero `WebhookInput` lo
  // exige para los tres y parsear es reversible; recomponer el crudo, no.
  const crudo = await req.text();

  // Las CINCO cabeceras de la firma van enteras: la verificación de PayPal las
  // quiere todas y `signature` solo cabe una. Ver `WebhookInput.headers`.
  const cabeceras: Record<string, string> = {};
  req.headers.forEach((v, k) => (cabeceras[k.toLowerCase()] = v));

  const verificacion = await paypalProvider.verifyWebhook({
    rawBody: crudo,
    signature: req.headers.get("paypal-transmission-sig"),
    headers: cabeceras,
  });

  if (!verificacion.ok) {
    // Mismo corte que en los otros dos webhooks, y el eje es de quién es el
    // problema: `sin-secreto` es NUESTRO —falta la variable, o la API de
    // verificación de PayPal no contesta— y se recupera solo, así que 503 y que
    // reintente. Una firma que falta o que no cuadra es definitiva: reintentar
    // el mismo payload no lo va a validar nunca, así que 400 y PayPal deja de
    // insistir.
    return NextResponse.json(
      { error: verificacion.error },
      { status: verificacion.motivo === "sin-secreto" ? 503 : 400 },
    );
  }

  const evento = verificacion.evento;
  const admin = createAdminClient();

  // ── 1 · APROBADA: capturar, que es lo que mueve el dinero ────────────────
  if (evento.kind === "cobro-en-curso") {
    if (!evento.objectRef) {
      // Un APPROVED sin id de orden es su API cambiando de forma. 200 para que
      // no reintente 100 veces, y a gritos en el log.
      console.error("[paypal] APPROVED sin id de orden: no se puede capturar", { evento: evento.id });
      return NextResponse.json({ status: "ignorado", tipo: evento.rawType });
    }

    const captura = await capturarOrden(evento.objectRef);
    if (captura.estado === "fallo") {
      // 🔴 Dinero autorizado que no llegamos a cobrar. 500 para que PayPal
      // reintente: la autorización vive unas horas y en ese rato puede cuajar.
      console.error("[paypal] 🔴 no se pudo capturar una orden aprobada", {
        orden: evento.objectRef,
        evento: evento.id,
        error: captura.error,
      });
      return NextResponse.json({ status: "captura-fallida", error: captura.error }, { status: 500 });
    }
    // La reserva NO se toca aquí: la acredita `PAYMENT.CAPTURE.COMPLETED`, que
    // PayPal manda a continuación. Si se acreditara ya, una captura que se
    // quedara a medias dejaría una clase pagada sin dinero detrás.
    return NextResponse.json({ status: captura.estado, orden: evento.objectRef });
  }

  if (evento.kind === "otro") {
    return NextResponse.json({ status: "ignorado", tipo: evento.rawType });
  }

  const ref = evento.ref;
  if (!ref) {
    // Firmado y real, pero sin sujeto en su `custom_id`: un cobro creado desde
    // el panel de PayPal, o de otro sistema que comparta la cuenta de sandbox.
    console.error("[paypal] cobro sin sujeto reconocible", {
      captura: evento.chargeRef,
      tipo: evento.rawType,
    });
    return NextResponse.json({ status: "ignorado", captura: evento.chargeRef });
  }

  const etiqueta = ref.tipo === "order" ? `pedido ${ref.id}` : `booking ${ref.id}`;
  // 🔑 La CAPTURA, no la orden: es lo que se sella y lo que sabe reembolsar
  // `/v2/payments/captures/{id}/refund`. Ver `eventoDeWebhook`.
  const capturaId = evento.chargeRef;

  /**
   * La confirmación, idéntica a la de sus dos hermanos y a propósito:
   * `confirm_payment` es idempotente por `event_id` para esa reserva, y un
   * pedido va por `confirm_order_payment`, que recorre las N líneas EN UNA
   * TRANSACCIÓN (EY-176). Nunca se acredita una línea suelta.
   */
  const llamar = async (
    exito: boolean,
    importeCobrado: number | null,
  ): Promise<NextResponse | null> => {
    // ⚠️ `undefined` y no la clave ausente: supabase-js no serializa `undefined`
    // (regla de oro 12), así que el argumento no viaja y PostgREST usa su
    // `default null`. La clave se escribe para que la vea el COMPILADOR.
    const salida =
      ref.tipo === "order"
        ? await admin.rpc("confirm_order_payment", {
            p_order_id: ref.id,
            p_success: exito,
            p_event_id: evento.id,
            p_amount_charged: importeCobrado ?? undefined,
          })
        : await admin.rpc("confirm_payment", {
            p_booking_id: ref.id,
            p_success: exito,
            p_event_id: evento.id,
            p_amount_charged: importeCobrado ?? undefined,
          });

    const error = salida.error;
    if (!error) return null;

    if (error.code === DESCUADRE) {
      // 🔴 Lo cobrado no es lo debido: la RPC abortó y con ella el registro del
      // evento, así que PayPal lo va a reintentar con el dinero ya cobrado. Es
      // lo correcto —a gritos antes que en silencio— y la salida es MANUAL.
      console.error("[conciliación] 🔴 lo cobrado no es lo debido: NO se acredita", {
        sujeto: etiqueta,
        pasarela: paypalProvider.key,
        captura: capturaId,
        evento: evento.id,
        tipo: evento.rawType,
        cobradoPorLaPasarela: importeCobrado,
        // Lo debido lo dice la propia función, que lo leyó de `payments`.
        // Repetir aquí la resta sería una segunda fuente de verdad (regla 2).
        segunLaBase: error.message,
        pista: error.hint,
      });
      return NextResponse.json(
        { status: "descuadre", sujeto: etiqueta, error: error.message },
        { status: 500 },
      );
    }

    throw new Error(error.message);
  };

  /** El sello, en TODAS las líneas: `enqueue_refund` copia esta columna a la cola. */
  const sellarReferencia = async (captura: string) => {
    if (ref.tipo === "order") {
      const { data: lineas, error: eLineas } = await admin
        .from("bookings")
        .select("id")
        .eq("order_id", ref.id);
      if (eLineas) throw new Error(eLineas.message);

      const { error } = await admin
        .from("payments")
        .update({ provider_payment_id: captura })
        .in("booking_id", (lineas ?? []).map((b) => b.id));
      if (error) throw new Error(error.message);

      const { error: eOrden } = await admin
        .from("orders")
        .update({ provider_payment_id: captura })
        .eq("id", ref.id);
      if (eOrden) throw new Error(eOrden.message);
      return;
    }
    const { error } = await admin
      .from("payments")
      .update({ provider_payment_id: captura })
      .eq("booking_id", ref.id);
    if (error) throw new Error(error.message);
  };

  /**
   * X-02 · DEVOLVER UN COBRO QUE NO DEBIÓ OCURRIR. Misma política y misma tabla
   * que en los otros dos.
   *
   * 🔑 AQUÍ SE ANOTA ANTES DE LLAMAR, como en dLocal y NO como en Stripe, pero
   * por el motivo contrario: en dLocal es un apaño porque no hay idempotencia de
   * reembolsos; aquí sí la hay (`PayPal-Request-Id`), y el orden se conserva
   * porque el `unique` de `provider_payment_id` es además el candado que impide
   * que dos entregas simultáneas lleguen las dos a la API. Con los dos tirantes
   * puestos, el peor caso es una fila anotada sin reembolso hecho —detectable,
   * porque `provider_refund_id` se queda null y el log lo grita— en vez de un
   * reembolso doble.
   */
  const reembolsarCobroHuerfano = async (
    estado: { reserva: EstadoReserva; pedido: null } | { reserva: null; pedido: OrderStatus },
  ): Promise<NextResponse> => {
    const descripcion = estado.reserva ?? estado.pedido;

    const { data: previo } = await admin
      .from("late_payment_refunds")
      .select("provider_refund_id")
      .eq("provider_payment_id", capturaId!)
      .maybeSingle();
    if (previo) {
      return NextResponse.json({
        status: "ya-reembolsado",
        sujeto: etiqueta,
        reembolso: previo.provider_refund_id,
      });
    }

    const { error: eReserva } = await admin.from("late_payment_refunds").insert({
      booking_id: estado.reserva ? ref.id : null,
      order_id: estado.pedido ? ref.id : null,
      provider: paypalProvider.key,
      provider_payment_id: capturaId!,
      provider_refund_id: null,
      event_id: evento.id,
      amount: evento.amountMinor ?? 0,
      currency: (evento.currency ?? "USD").toUpperCase(),
      booking_status: estado.reserva,
      order_status: estado.pedido,
      reason:
        estado.pedido !== null
          ? `cobro de un pedido recibido con el pedido en '${estado.pedido}'`
          : `cobro recibido con la reserva en '${estado.reserva}'`,
    });
    if (eReserva) {
      // Choque con la entrega gemela: ella se está encargando. 200.
      return NextResponse.json({ status: "ya-en-curso", sujeto: etiqueta });
    }

    // Sin `amountMinor`: el cargo entero. Un cobro por una reserva que ya no
    // existe no se retiene ni en parte, y con un pedido «entero» son las N
    // líneas (decisión P-1).
    const salida = await paypalProvider.refund({
      chargeRef: capturaId!,
      currency: evento.currency ?? "USD",
      metadata: {
        ...(ref.tipo === "order" ? { order_id: ref.id } : { booking_id: ref.id }),
        motivo: "x02_cobro_tardio",
      },
      idempotencyKey: `x02-reembolso-${capturaId}`,
    });

    if (salida.estado === "transitorio" || salida.estado === "rechazado") {
      // La fila queda con `provider_refund_id` null y el log lo grita: es dinero
      // pendiente de devolver que necesita una persona.
      console.error("[X-02] ⚠️ PayPal NO aceptó el reembolso del cobro tardío", {
        sujeto: etiqueta,
        captura: capturaId,
        error: salida.estado,
        mensaje: salida.mensaje,
      });
      throw salida.causa;
    }

    const refundId =
      salida.estado === "ya-reembolsado" ? null : salida.refundId;

    // ⚠️ `late_payment_refunds` es APPEND-ONLY a propósito (`20260817160000`):
    // `service_role` tiene `select, insert` y nada más. El id del reembolso
    // queda en el log del incidente de abajo —X-02 es un incidente, no un
    // trámite— y en el panel de PayPal. Un `update` aquí fallaría con 42501 en
    // silencio, que es como ya mordió en dLocal.
    if (refundId) {
      console.warn("[X-02] reembolso de PayPal sin anotar en la fila (tabla append-only)", {
        captura: capturaId,
        reembolso: refundId,
      });
    }

    console.error("[X-02] cobro tardío reembolsado (paypal)", {
      sujeto: etiqueta,
      estado: descripcion,
      captura: capturaId,
      reembolso: refundId ?? "(ya estaba)",
    });

    return NextResponse.json({ status: "reembolsado", sujeto: etiqueta, reembolso: refundId });
  };

  /** X-02 · antes de acreditar, comprobar que el sujeto sigue esperando el cobro. */
  const cobroEntrante = async (): Promise<NextResponse> => {
    // ⚠️ LOS ERRORES DE LECTURA SE RELANZAN, NO SE TRATAN COMO «NO EXISTE»
    // (regla de oro 9). Darlo por ajeno devolvería 200, PayPal dejaría de
    // reintentar y el cobro se quedaría cobrado y sin acreditar PARA SIEMPRE.
    let pedido: { id: string; status: OrderStatus } | null = null;
    if (ref.tipo === "order") {
      const { data, error } = await admin
        .from("orders")
        .select("id, status")
        .eq("id", ref.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      pedido = data;
    }

    const { data: reservas, error: eReservas } =
      ref.tipo === "order"
        ? await admin.from("bookings").select("id, status").eq("order_id", ref.id)
        : await admin.from("bookings").select("id, status").eq("id", ref.id);
    if (eReservas) throw new Error(eReservas.message);

    const lineas = reservas ?? [];
    if (lineas.length === 0 || (ref.tipo === "order" && !pedido)) {
      // 🎁 Aquí caería también un cobro de REGALO, que este archivo no atiende
      // (ver la cabecera): su `custom_id` no es de `bookings` ni de `orders`, así
      // que no habría filas. Se distingue por el 500 de abajo, no por el silencio.
      console.error("[paypal] 🔴 cobro con sujeto que no existe en bookings/orders", {
        sujeto: etiqueta,
        captura: capturaId,
        evento: evento.id,
        pista: "si es un regalo, PayPal no debería haber cobrado: mira la cadena en api/pagos/checkout",
      });
      return NextResponse.json({ status: "ajeno", sujeto: etiqueta }, { status: 500 });
    }

    const { data: pagos, error: ePagos } = await admin
      .from("payments")
      .select("booking_id, status, provider_payment_id, currency")
      .in("booking_id", lineas.map((b) => b.id));
    if (ePagos) throw new Error(ePagos.message);

    const cobros = pagos ?? [];
    // Reentrega del cobro que YA acreditamos. `every` y no `some`: con un pedido
    // hacen falta TODAS las líneas selladas y contabilizadas.
    const yaAcreditado =
      cobros.length === lineas.length &&
      cobros.every(
        (p) => p.provider_payment_id === capturaId && YA_CONTABILIZADO.includes(p.status),
      );

    // ⚠️ P-1 · TODO O NADA. Si el cron venció una línea, el pedido ya no se
    // puede entregar completo: no se acredita ninguna y el cargo vuelve entero.
    const esperaCobro = lineas.every((b) => b.status === "pending_payment");

    if (!esperaCobro && !yaAcreditado) {
      return await reembolsarCobroHuerfano(
        pedido
          ? { reserva: null, pedido: pedido.status }
          : { reserva: lineas[0]!.status, pedido: null },
      );
    }

    /**
     * 🔴 LO QUE PAYPAL COBRÓ DE VERDAD. Sale del cuerpo que PayPal acaba de
     * FIRMAR —`resource.amount` de la captura—, no de nuestra base (comparar
     * `gross_amount` consigo mismo no concilia nada). Es el mismo trato que
     * Stripe; dLocal es el raro, que tiene que releer porque su cuerpo no trae
     * importe.
     *
     * ⚠️ Con un pedido es el TOTAL del cargo, no el de una línea: N mentorías
     * son UNA captura (P-3). Repartirlo es cosa de `confirm_order_payment`.
     */
    const importeCobrado = evento.amountMinor;

    if (importeCobrado === null) {
      // No se inventa. Queda en pie la otra mitad del cerrojo, el marcador
      // `payments.checkout_amount`. Se grita porque un COMPLETED sin `amount` es
      // su API cambiando de forma.
      console.error("[conciliación] ⚠️ cobro confirmado sin importe: no se concilia", {
        sujeto: etiqueta,
        captura: capturaId,
        evento: evento.id,
        tipo: evento.rawType,
      });
    } else {
      // ⚠️ LA MONEDA ANTES QUE EL IMPORTE: un número en otra moneda es
      // perfectamente comparable y perfectamente falso. El precedente es M-01
      // (Stripe convirtiendo por geolocalización sin avisar).
      const monedaCobrada = evento.currency?.toUpperCase() ?? null;
      const monedasDebidas = [...new Set(cobros.map((p) => p.currency.toUpperCase()))];

      if (monedaCobrada === null || monedasDebidas.some((m) => m !== monedaCobrada)) {
        console.error("[conciliación] 🔴 el cobro llegó en otra moneda que la reserva", {
          sujeto: etiqueta,
          pasarela: paypalProvider.key,
          captura: capturaId,
          evento: evento.id,
          cobrado: `${importeCobrado} ${monedaCobrada ?? "(sin moneda)"}`,
          debido: monedasDebidas.join(", "),
        });
        return NextResponse.json(
          {
            status: "descuadre",
            sujeto: etiqueta,
            error:
              `el cobro llegó en ${monedaCobrada ?? "(sin moneda)"} y lo debido está en ` +
              `${monedasDebidas.join(", ")}: no se acredita`,
          },
          { status: 500 },
        );
      }
    }

    // Se sella ANTES de confirmar para que `yaAcreditado` sea fiable ante una
    // reentrega que llegue en medio. Con PayPal este es el ÚNICO sitio donde se
    // sella: el adaptador no puede hacerlo al abrir el cobro porque entonces la
    // captura todavía no existe.
    await sellarReferencia(capturaId!);

    const descuadre = await llamar(true, importeCobrado);
    if (descuadre) return descuadre;
    return NextResponse.json({ status: "ok", tipo: evento.rawType, sujeto: etiqueta });
  };

  if (evento.kind === "cobro-confirmado") {
    if (!capturaId) {
      // Un COMPLETED sin id de captura es su API cambiando de forma, y sellar
      // `null` rompería el reembolso para siempre. 500 y que reintente.
      console.error("[paypal] 🔴 captura confirmada sin id", { sujeto: etiqueta, evento: evento.id });
      return NextResponse.json({ status: "sin-captura", sujeto: etiqueta }, { status: 500 });
    }
    return await cobroEntrante();
  }

  // Terminal: DENIED o DECLINED. Libera el horario y devuelve el crédito que
  // financiaba el pago que se cayó (eso lo hace `confirm_payment` con
  // `p_success` falso, que ni mira el importe).
  const descuadre = await llamar(false, null);
  if (descuadre) return descuadre;
  return NextResponse.json({ status: "ok", tipo: evento.rawType, sujeto: etiqueta });
}
