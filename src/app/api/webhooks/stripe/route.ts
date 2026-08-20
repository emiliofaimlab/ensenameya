import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { stripeProvider } from "@/lib/payments/stripe-provider";
import type { Database } from "@/lib/database.types";

/** El estado de la reserva tal y como lo declara el esquema, no un `string`
 *  suelto: `late_payment_refunds.booking_status` es esta misma enumeración. */
type EstadoReserva = Database["public"]["Enums"]["booking_status"];

/**
 * EP-20 / PAC-03 · webhook de Stripe. Cierra RN-34, el criterio que EY-56 dio
 * por cumplido en julio sin que existiera.
 *
 * Es el ÚNICO sitio donde un cobro pasa a `paid`. El navegador no confirma
 * pagos: el alumno puede cerrar la pestaña justo después de pagar y el dinero
 * existe igual, o puede volver a la página de éxito sin haber pagado nada.
 *
 * ── Las cuatro trampas que tiene este archivo ──────────────────────────────
 * 1. `req.text()`, nunca `req.json()`. Stripe firma un HMAC sobre la cadena
 *    EXACTA del cuerpo; `JSON.parse` + `stringify` reordena claves y cambia
 *    espacios, y la firma deja de cuadrar. El cuerpo se lee UNA vez y entra
 *    tal cual en `verifyWebhook`. **La verificación se queda en el borde**: el
 *    puerto le da forma, no la generaliza — si algún día lo que entra ahí es un
 *    objeto ya parseado, la firma no protege nada.
 * 2. Firma inválida → **400**, no 500. Un 500 hace que Stripe reintente
 *    durante tres días un payload que no va a validar nunca.
 * 3. `payment_intent.payment_failed` NO está en la lista. Una tarjeta
 *    rechazada deja la Session abierta y el alumno reintenta con otra; si
 *    canceláramos ahí, le habríamos liberado el horario a alguien que estaba
 *    a punto de pagar. Los únicos fallos terminales son `expired` y
 *    `async_payment_failed`. La traducción vive en `traducirTipo`, dentro del
 *    adaptador, y ese comentario va con ella.
 * 4. X-02 · **un cobro que llega tarde no se acredita: se devuelve.** Ver el
 *    bloque de `cobroEntrante` más abajo; es la parte de este archivo donde de
 *    verdad se mueve dinero fuera y la que hay que leer entera antes de
 *    tocarla.
 *
 * Lo que este archivo YA NO sabe, desde el puerto de pagos: cómo se llaman los
 * eventos de Stripe, cómo se firma un webhook y cómo se pide un reembolso. Todo
 * eso es del adaptador. Lo que queda aquí es la lógica —X-02, la idempotencia,
 * el sello del `pi_`— y no tiene nada de Stripe dentro.
 */

/** Node, no edge: la verificación de firma usa crypto de Node. Es el runtime por defecto. */
export const runtime = "nodejs";

/** Estados de `payments` en los que el cobro ya está contabilizado. */
const YA_CONTABILIZADO = ["paid", "refunded", "partially_refunded"];

export async function POST(req: Request) {
  // ⚠️ EL CUERPO CRUDO. `req.text()` y no `req.json()`, y viaja como cadena
  // hasta el verificador. Lee la trampa 1 de arriba antes de tocar estas
  // cuatro líneas: es la diferencia entre un webhook firmado y un endpoint
  // público capaz de marcar reservas como pagadas con un POST.
  const crudo = await req.text();
  const verificacion = stripeProvider.verifyWebhook({
    rawBody: crudo,
    signature: req.headers.get("stripe-signature"),
  });

  if (!verificacion.ok) {
    // Sin secreto es un fallo NUESTRO de configuración (503, que Stripe
    // reintenta); una firma que no cuadra es un 400 definitivo, porque
    // reintentar el mismo payload no lo va a validar nunca.
    return NextResponse.json(
      { error: verificacion.error },
      { status: verificacion.motivo === "sin-secreto" ? 503 : 400 },
    );
  }
  const evento = verificacion.evento;

  const admin = createAdminClient();

  // El booking lo trae el evento ya extraído (`client_reference_id` o, por si
  // acaso, la metadata: el adaptador mira los dos).
  const bookingId = evento.bookingId;

  if (!bookingId) {
    // No es nuestro, o es un evento que no lleva reserva. 200 para que Stripe
    // no reintente: no hay nada que arreglar reintentando.
    return NextResponse.json({ status: "ignorado", tipo: evento.rawType });
  }

  /**
   * `confirm_payment` ya es idempotente por tres vías: descarta el `event_id`
   * repetido (US-703), no reprocesa un pago que ya esté resuelto y desde X-02
   * cuenta 'failed' como resuelto. Por eso aquí no hace falta una tabla de
   * deduplicación aparte — se le pasa el id del evento y él decide.
   */
  const llamar = async (exito: boolean) => {
    const { error } = await admin.rpc("confirm_payment", {
      p_booking_id: bookingId,
      p_success: exito,
      p_event_id: evento.id,
    });
    if (error) throw new Error(error.message);
  };

  /**
   * X-02 · DEVOLVER UN COBRO QUE NO DEBIÓ OCURRIR.
   *
   * Aquí se mueve dinero de verdad —`refunds.create`— y es el único sitio del
   * proyecto que lo hace. Ojo con confundirlo con los reembolsos de plataforma
   * (RN-37, `cancel_booking` / admin): esos hoy solo escriben
   * `payments.status='refunded'` en Postgres y no tocan el PSP. Este SÍ, porque
   * el cargo entró por una reserva que ya no existía.
   *
   * IDEMPOTENCIA POR DOS CAMINOS, y hacen falta los dos:
   *   · la tabla `late_payment_refunds` tiene `provider_payment_id` UNIQUE y se
   *     consulta antes de llamar a la API: cubre la reentrega normal, que es
   *     lo que hace Stripe durante tres días cuando no le respondemos 2xx;
   *   · la `idempotencyKey` en la propia llamada: cubre la carrera de dos
   *     entregas simultáneas, donde las dos leerían la tabla vacía. Stripe
   *     devuelve el MISMO reembolso en vez de crear otro.
   * Sin la clave, dos entregas a la vez devolverían el dinero dos veces.
   *
   * El orden es: reembolsar primero, anotar después. Si el `insert` falla, el
   * webhook devuelve 500, Stripe reintenta y la segunda vuelta recupera el
   * mismo reembolso por la clave de idempotencia y vuelve a intentar anotarlo.
   * Al revés —anotar y luego reembolsar— una caída en medio dejaría constancia
   * de un reembolso que nunca se hizo, que es la mentira peor de las dos.
   */
  const reembolsarCobroHuerfano = async (
    pi: string | null,
    estadoReserva: EstadoReserva,
  ): Promise<NextResponse> => {
    if (!pi) {
      // Sin referencia no hay nada que devolver. Pasa de forma legítima con
      // Sessions de importe 0 (no crean PaymentIntent), donde tampoco hay
      // dinero que devolver. Cualquier otro caso es un cobro que existe y que
      // no sabemos localizar: se grita en el log y NO se confirma la reserva.
      console.error("[X-02] cobro huérfano sin PaymentIntent", {
        booking: bookingId,
        session: evento.objectRef,
        evento: evento.id,
        estadoReserva,
      });
      return NextResponse.json({ status: "huerfano-sin-referencia", booking: bookingId });
    }

    const { data: previo } = await admin
      .from("late_payment_refunds")
      .select("provider_refund_id")
      .eq("provider_payment_id", pi)
      .maybeSingle();
    if (previo) {
      return NextResponse.json({
        status: "ya-reembolsado",
        booking: bookingId,
        reembolso: previo.provider_refund_id,
      });
    }

    // Sin `amountMinor`: se devuelve el cargo entero. Un cobro por una reserva
    // que no existe no se retiene ni en parte, y la política de cancelación
    // (RN-37) aquí no pinta nada — no hubo cancelación, hubo un cobro que no
    // debió pasar.
    const salida = await stripeProvider.refund({
      chargeRef: pi,
      metadata: { booking_id: bookingId, motivo: "x02_cobro_tardio" },
      idempotencyKey: `x02-reembolso-${pi}`,
    });

    if (salida.estado === "transitorio" || salida.estado === "rechazado") {
      // Se relanza EL ERROR ORIGINAL del proveedor, no uno nuestro: el webhook
      // devuelve 500, Stripe reintenta y el log dice lo que decía siempre.
      throw salida.causa;
    }

    if (salida.estado === "ya-reembolsado") {
      // Ya lo devolvió otra mano (panel de Stripe, reembolso de plataforma).
      // Se anota igual para que quede la constancia y no se reintente eternamente.
      console.error("[X-02] el cargo ya estaba reembolsado en el PSP", {
        booking: bookingId,
        pi,
      });
    }

    // ⚠️ `no-completado` (el PSP creó el reembolso y lo dejó en 'failed') se
    // trata aquí IGUAL que uno bueno, que es lo que este archivo hacía antes
    // del puerto: X-02 nunca ha mirado el estado del reembolso. La cola de X-01
    // sí lo mira y lo marca `failed`. La discrepancia es real y es previa; se
    // deja anotada en vez de corregirse de tapadillo, porque cambiarla es
    // cambiar comportamiento y merece su propia ficha.
    const reembolso = salida.estado === "ya-reembolsado" ? null : salida;

    // Constancia. `upsert` ignorando duplicados y no `insert` a secas: dos
    // entregas simultáneas pueden llegar aquí las dos, y una violación de
    // unicidad devolvería 500 por algo que ya está bien resuelto.
    const { error: errorInsert } = await admin.from("late_payment_refunds").upsert(
      {
        booking_id: bookingId,
        provider: "stripe",
        provider_payment_id: pi,
        provider_refund_id: reembolso?.refundId ?? null,
        event_id: evento.id,
        // Del objeto de reembolso, no de `payments.gross_amount`: lo que vale
        // es lo que se movió de verdad. Si Stripe dijo que ya estaba devuelto,
        // se cae al importe de la Session, que es lo único que tenemos.
        amount: reembolso?.amountMinor ?? evento.amountMinor ?? 0,
        currency: (reembolso?.currency ?? evento.currency ?? "usd").toUpperCase(),
        booking_status: estadoReserva,
        reason: `cobro recibido con la reserva en '${estadoReserva}'`,
      },
      { onConflict: "provider_payment_id", ignoreDuplicates: true },
    );
    if (errorInsert) throw new Error(errorInsert.message);

    // A ojos de operaciones esto es un incidente, no un trámite: alguien pagó
    // por una clase que ya no existía. Se registra como error a propósito.
    console.error("[X-02] cobro tardío reembolsado", {
      booking: bookingId,
      estadoReserva,
      pi,
      reembolso: reembolso?.refundId ?? "(ya estaba)",
    });

    // La reserva NO se toca y `payments` tampoco: ese cobro no era suyo. La
    // reserva sigue cancelada (o sigue pagada por el cobro bueno, si esto era
    // un duplicado) y su fila de `payments` conserva su propio estado.
    return NextResponse.json({
      status: "reembolsado",
      booking: bookingId,
      reembolso: reembolso?.refundId ?? null,
    });
  };

  /**
   * X-02 · antes de acreditar un cobro, comprobar que la reserva sigue
   * esperándolo. Esta es la red de seguridad de verdad; el `expires_at` de la
   * Session (ver `api/pagos/checkout`) solo hace el caso raro, porque el mínimo
   * que Stripe acepta son 30 minutos y la reserva muere a los 20.
   */
  const cobroEntrante = async (): Promise<NextResponse> => {
    const pi = evento.chargeRef;

    const [{ data: reserva, error: eReserva }, { data: pago, error: ePago }] = await Promise.all([
      admin.from("bookings").select("status").eq("id", bookingId).maybeSingle(),
      admin
        .from("payments")
        .select("status, provider_payment_id")
        .eq("booking_id", bookingId)
        .maybeSingle(),
    ]);
    if (eReserva) throw new Error(eReserva.message);
    if (ePago) throw new Error(ePago.message);

    // La reserva no está en ESTA base de datos. Pasa de verdad: la cuenta de
    // Stripe en *test mode* es una sola y la comparten dev, los previews y el
    // `stripe listen` de quien esté probando en local. Un evento de otro
    // entorno no es nuestro y sobre todo NO se reembolsa: allí puede estar
    // perfectamente confirmado. 200 para que Stripe deje de reintentar.
    if (!reserva) {
      return NextResponse.json({ status: "ajeno", booking: bookingId });
    }

    // Reentrega del cobro que YA acreditamos. Es el caso que hay que distinguir
    // con cuidado, porque se parece al huérfano: la reserva tampoco está en
    // `pending_payment` (la movimos nosotros al cobrarla). La diferencia es que
    // este `pi_…` es EL de esta reserva y su pago está contabilizado. Sin esta
    // comprobación, un simple reintento de Stripe reembolsaría el cobro bueno.
    //
    // El sello de `provider_payment_id` se escribe ANTES de confirmar (abajo)
    // justamente para que esta comparación sea fiable: si se sellara después,
    // una reentrega que llegara en medio no encontraría el `pi_` y trataría el
    // pago legítimo como huérfano.
    const yaAcreditado =
      pi !== null &&
      pago?.provider_payment_id === pi &&
      YA_CONTABILIZADO.includes(pago?.status ?? "");

    if (reserva.status !== "pending_payment" && !yaAcreditado) {
      // El horario ya se liberó (lo canceló el cron o el propio alumno), o la
      // reserva ya estaba pagada y esto es un segundo cobro. En los dos casos
      // el dinero se devuelve: no hay clase que dar a cambio.
      return await reembolsarCobroHuerfano(pi, reserva.status);
    }

    // Camino normal. Se guarda el PaymentIntent y no la Session porque es el
    // que traen los eventos de reembolso y disputa.
    if (pi) {
      const { error } = await admin
        .from("payments")
        .update({ provider_payment_id: pi })
        .eq("booking_id", bookingId);
      // Antes este fallo no tumbaba el webhook. Ahora sí: el sello es lo que
      // distingue nuestro cobro de uno huérfano, y confirmar sin él dejaría la
      // reserva pagada y sin referencia — la siguiente reentrega la vería como
      // un cobro tardío y la reembolsaría. Mejor 500 y que Stripe reintente.
      if (error) throw new Error(error.message);
    }

    await llamar(true);
    return NextResponse.json({ status: "ok", tipo: evento.rawType, booking: bookingId });
  };

  // El `switch` es sobre NUESTRO vocabulario, no sobre el de Stripe: qué evento
  // del proveedor cae en cada rama lo decide `traducirTipo` en el adaptador, y
  // ahí está también el porqué de que `payment_intent.payment_failed` no sea un
  // fallo terminal.
  switch (evento.kind) {
    // La Session se completó pero el dinero todavía no existe (métodos
    // diferidos). No es un cobro y no se acredita nada.
    case "cobro-en-curso":
      return NextResponse.json({ status: "en-curso", tipo: evento.rawType });

    // Cobro confirmado — instantáneo o diferido, el mismo filtro para los dos:
    // el diferido es justo el caso en que la reserva lleva mucho rato muerta.
    case "cobro-confirmado":
      return await cobroEntrante();

    // Fallo terminal. `expired` es además el que libera el horario cuando el
    // alumno abandona el checkout.
    case "cobro-fallido":
      await llamar(false);
      break;

    default:
      return NextResponse.json({ status: "ignorado", tipo: evento.rawType });
  }

  // Solo quedan los caminos de fallo. La referencia externa se guarda aquí
  // DESPUÉS de resolver, y su fallo no tumba el webhook: no hay cobro que
  // proteger, y perder el `pi_` de un pago fallido solo complica una
  // conciliación futura. (En `expired` no hay PaymentIntent siquiera.)
  const pi = evento.chargeRef;
  if (pi) {
    await admin
      .from("payments")
      .update({ provider_payment_id: pi })
      .eq("booking_id", bookingId);
  }

  return NextResponse.json({ status: "ok", tipo: evento.rawType, booking: bookingId });
}
