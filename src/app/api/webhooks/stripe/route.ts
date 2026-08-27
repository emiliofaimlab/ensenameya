import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { stripeProvider } from "@/lib/payments/stripe-provider";
import type { OrderStatus } from "@/lib/orders/tipos";
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
 * 5. ⚠️ EY-176 · **un evento puede acreditar N reservas.** Ver el bloque de
 *    abajo; es la trampa más cara del fichero y la que costó la ficha entera.
 *
 * Lo que este archivo YA NO sabe, desde el puerto de pagos: cómo se llaman los
 * eventos de Stripe, cómo se firma un webhook y cómo se pide un reembolso. Todo
 * eso es del adaptador. Lo que queda aquí es la lógica —X-02, la idempotencia,
 * el sello del `pi_`— y no tiene nada de Stripe dentro.
 *
 * ── ⚠️⚠️ EY-176 · UN CARGO, N LÍNEAS: LO QUE HAY QUE ENTENDER ANTES DE TOCAR ──
 *
 * Desde el carrito, un cobro puede apuntar a **una reserva suelta** o a **un
 * pedido de N reservas**. Lo dice `evento.ref.tipo`, que el adaptador saca del
 * `client_reference_id`.
 *
 * Con un pedido hay UN cargo y por tanto UN evento para N reservas. El fallo
 * que eso abría —y que estaba escrito en el esquema, no supuesto— era que
 * `payment_webhook_events.event_id` fuese clave primaria: llamar N veces a
 * `confirm_payment` con el mismo evento confirmaba la primera línea y devolvía
 * un no-op SILENCIOSO en las demás, que se quedaban en `pending_payment` hasta
 * que el cron las cancelaba siete minutos después. Cobradas y sin clase.
 * La clave pasó a ser `(event_id, booking_id)` en `20260827160000`, y por eso
 * aquí se llama a `confirm_order_payment`, que las recorre TODAS en una
 * transacción. **Nunca acredites una línea de un pedido por separado.**
 *
 * Y la otra mitad, X-02 para pedidos: `late_payment_refunds.provider_payment_id`
 * es `not null unique`, o sea una fila por cargo. Encaja porque el criterio de
 * «¿sigue esperándose este cobro?» pasa a ser **de todas las líneas a la vez**
 * (P-1): si una sola ha dejado de esperarlo, el pedido no se puede entregar
 * entero y se devuelve el cargo ENTERO sin acreditar nada.
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

  // El sujeto del cobro lo trae el evento ya extraído (`client_reference_id` o,
  // por si acaso, la metadata: el adaptador mira los dos) y ya clasificado en
  // reserva suelta o pedido.
  const ref = evento.ref;

  if (!ref) {
    // No es nuestro, o es un evento que no lleva sujeto. 200 para que Stripe
    // no reintente: no hay nada que arreglar reintentando.
    return NextResponse.json({ status: "ignorado", tipo: evento.rawType });
  }

  /** Para los registros: `booking <uuid>` o `pedido <uuid>`. */
  const etiqueta = ref.tipo === "order" ? `pedido ${ref.id}` : `booking ${ref.id}`;

  /**
   * `confirm_payment` ya es idempotente por tres vías: descarta el `event_id`
   * repetido para ESA reserva (US-703 + EY-176), no reprocesa un pago que ya
   * esté resuelto y desde X-02 cuenta 'failed' como resuelto. Por eso aquí no
   * hace falta una tabla de deduplicación aparte — se le pasa el id del evento
   * y él decide.
   *
   * ⚠️ Y CON UN PEDIDO SE LLAMA A `confirm_order_payment`, NO N VECES A
   * `confirm_payment`. Las dos cosas funcionarían desde que la clave primaria
   * es compuesta, pero solo la primera es ATÓMICA: si la petición se cortara
   * entre la línea 2 y la 3, quedarían dos acreditadas y una muriendo. Dentro
   * de la función, o entran las N o no entra ninguna, y el reintento de Stripe
   * encuentra el trabajo entero por hacer.
   */
  const llamar = async (exito: boolean) => {
    if (ref.tipo === "order") {
      const { error } = await admin.rpc("confirm_order_payment", {
        p_order_id: ref.id,
        p_success: exito,
        p_event_id: evento.id,
      });
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await admin.rpc("confirm_payment", {
      p_booking_id: ref.id,
      p_success: exito,
      p_event_id: evento.id,
    });
    if (error) throw new Error(error.message);
  };

  /**
   * ⚠️ EL SELLO DEL `pi_`, Y CON UN PEDIDO VA EN **TODAS** LAS LÍNEAS.
   *
   * No es cosmético y no es opcional: `enqueue_refund` (X-01) COPIA
   * `payments.provider_payment_id` a la fila de la cola en el momento de
   * encolar. Una línea sin sellar se encolaría sin referencia y el job la
   * marcaría `failed` con «sin provider_payment_id» — o sea, un reembolso de
   * política que nunca se paga. Sellar solo la primera línea de un pedido
   * dejaría a las demás sin poder devolver el dinero nunca.
   *
   * Se escribe ANTES de confirmar, igual que en la compra suelta, para que la
   * comparación de `yaAcreditado` sea fiable ante una reentrega que llegue en
   * medio.
   */
  const sellarReferencia = async (pi: string) => {
    if (ref.tipo === "order") {
      const conPedidos = admin;
      const { data: lineas, error: eLineas } = await conPedidos
        .from("bookings")
        .select("id")
        .eq("order_id", ref.id);
      if (eLineas) throw new Error(eLineas.message);

      const { error } = await admin
        .from("payments")
        .update({ provider_payment_id: pi })
        .in(
          "booking_id",
          (lineas ?? []).map((b) => b.id),
        );
      if (error) throw new Error(error.message);

      // Y la cabecera, que es por donde se localiza el cargo desde el panel.
      const { error: eOrden } = await conPedidos
        .from("orders")
        .update({ provider_payment_id: pi })
        .eq("id", ref.id);
      if (eOrden) throw new Error(eOrden.message);
      return;
    }

    const { error } = await admin
      .from("payments")
      .update({ provider_payment_id: pi })
      .eq("booking_id", ref.id);
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
    /**
     * En qué estado estaba lo que el cobro decía pagar. Con una reserva es su
     * `booking_status`; con un pedido, su `order_status` — y en ese caso la
     * reserva es `null`, porque un pedido de tres puede tener sus líneas en
     * tres estados distintos y elegir una sería inventarse el motivo.
     */
    estado: { reserva: EstadoReserva; pedido: null } | { reserva: null; pedido: OrderStatus },
  ): Promise<NextResponse> => {
    const descripcion = estado.reserva ?? estado.pedido;

    if (!pi) {
      // Sin referencia no hay nada que devolver. Pasa de forma legítima con
      // Sessions de importe 0 (no crean PaymentIntent), donde tampoco hay
      // dinero que devolver. Cualquier otro caso es un cobro que existe y que
      // no sabemos localizar: se grita en el log y NO se confirma nada.
      console.error("[X-02] cobro huérfano sin PaymentIntent", {
        sujeto: etiqueta,
        session: evento.objectRef,
        evento: evento.id,
        estado: descripcion,
      });
      return NextResponse.json({ status: "huerfano-sin-referencia", sujeto: etiqueta });
    }

    const { data: previo } = await admin
      .from("late_payment_refunds")
      .select("provider_refund_id")
      .eq("provider_payment_id", pi)
      .maybeSingle();
    if (previo) {
      return NextResponse.json({
        status: "ya-reembolsado",
        sujeto: etiqueta,
        reembolso: previo.provider_refund_id,
      });
    }

    // Sin `amountMinor`: se devuelve el cargo entero. Un cobro por una reserva
    // que no existe no se retiene ni en parte, y la política de cancelación
    // (RN-37) aquí no pinta nada — no hubo cancelación, hubo un cobro que no
    // debió pasar.
    //
    // ⚠️ CON UN PEDIDO, «ENTERO» SIGNIFICA LAS N LÍNEAS, Y ES LA DECISIÓN P-1.
    // No se devuelve la línea que se cayó y se acreditan las demás: el alumno
    // compró un pedido, no un surtido. Devolver el cargo entero es además lo
    // único que cabe en `late_payment_refunds`, cuyo `provider_payment_id` es
    // `unique` — una fila por cargo. Las dos cosas apuntan al mismo sitio.
    const salida = await stripeProvider.refund({
      chargeRef: pi,
      metadata: {
        ...(ref.tipo === "order" ? { order_id: ref.id } : { booking_id: ref.id }),
        motivo: "x02_cobro_tardio",
      },
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
        sujeto: etiqueta,
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
    const { error: errorInsert } = await admin
      .from("late_payment_refunds")
      .upsert(
        {
          // Excluyentes por `check` en la tabla: una fila habla de una reserva
          // suelta o de un pedido, nunca de las dos (20260827170000).
          booking_id: estado.reserva ? ref.id : null,
          order_id: estado.pedido ? ref.id : null,
          provider: "stripe",
          provider_payment_id: pi,
          provider_refund_id: reembolso?.refundId ?? null,
          event_id: evento.id,
          // Del objeto de reembolso, no de `payments.gross_amount`: lo que vale
          // es lo que se movió de verdad. Si Stripe dijo que ya estaba devuelto,
          // se cae al importe de la Session, que es lo único que tenemos.
          amount: reembolso?.amountMinor ?? evento.amountMinor ?? 0,
          currency: (reembolso?.currency ?? evento.currency ?? "usd").toUpperCase(),
          booking_status: estado.reserva,
          order_status: estado.pedido,
          reason:
            estado.pedido !== null
              ? `cobro de un pedido de ${etiqueta.slice(7)} recibido con el pedido en '${estado.pedido}'`
              : `cobro recibido con la reserva en '${estado.reserva}'`,
        },
        { onConflict: "provider_payment_id", ignoreDuplicates: true },
      );
    if (errorInsert) throw new Error(errorInsert.message);

    // A ojos de operaciones esto es un incidente, no un trámite: alguien pagó
    // por una clase que ya no existía. Se registra como error a propósito.
    console.error("[X-02] cobro tardío reembolsado", {
      sujeto: etiqueta,
      estado: descripcion,
      pi,
      reembolso: reembolso?.refundId ?? "(ya estaba)",
    });

    // Ni la reserva ni el pedido se tocan, y `payments` tampoco: ese cobro no
    // era suyo. Siguen cancelados (o siguen pagados por el cobro bueno, si esto
    // era un duplicado) y sus filas de `payments` conservan su propio estado.
    return NextResponse.json({
      status: "reembolsado",
      sujeto: etiqueta,
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
    const conPedidos = admin;

    // ── Las líneas del sujeto y el estado del pedido, si lo hay ──────────────
    //
    // ⚠️ CON UN PEDIDO ESTO SON N RESERVAS, y todo lo de abajo razona sobre el
    // conjunto. Una reserva suelta es el mismo código con una lista de uno: se
    // unifica a propósito, porque dos versiones de la comprobación «¿sigue
    // esperándose este cobro?» es como una de las dos se queda atrás.
    //
    // ⚠️ EL ERROR DE LECTURA SE RELANZA, NO SE TRATA COMO «NO EXISTE». Si a
    // `service_role` le faltara un grant sobre `orders` (regla de oro 9: se
    // salta la RLS pero NO los grants, y eso muerde en TIEMPO DE EJECUCIÓN),
    // `data` llegaría null igual que si el pedido fuera de otro entorno. Darlo
    // por «ajeno» devolvería 200, Stripe dejaría de reintentar y el cobro se
    // quedaría cobrado y sin acreditar PARA SIEMPRE. Un 500 lo arregla solo en
    // cuanto se ponga el grant.
    let pedido: { id: string; status: OrderStatus } | null = null;
    if (ref.tipo === "order") {
      const { data, error } = await conPedidos
        .from("orders")
        .select("id, status")
        .eq("id", ref.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      pedido = data;
    }

    const { data: reservas, error: eReservas } =
      ref.tipo === "order"
        ? await conPedidos.from("bookings").select("id, status").eq("order_id", ref.id)
        : await admin.from("bookings").select("id, status").eq("id", ref.id);
    if (eReservas) throw new Error(eReservas.message);

    const lineas = reservas ?? [];

    // El sujeto no está en ESTA base de datos. Pasa de verdad: la cuenta de
    // Stripe en *test mode* es una sola y la comparten dev, los previews y el
    // `stripe listen` de quien esté probando en local. Un evento de otro
    // entorno no es nuestro y sobre todo NO se reembolsa: allí puede estar
    // perfectamente confirmado. 200 para que Stripe deje de reintentar.
    if (lineas.length === 0 || (ref.tipo === "order" && !pedido)) {
      return NextResponse.json({ status: "ajeno", sujeto: etiqueta });
    }

    const { data: pagos, error: ePagos } = await admin
      .from("payments")
      .select("booking_id, status, provider_payment_id")
      .in(
        "booking_id",
        lineas.map((b) => b.id),
      );
    if (ePagos) throw new Error(ePagos.message);

    // Reentrega del cobro que YA acreditamos. Es el caso que hay que distinguir
    // con cuidado, porque se parece al huérfano: las reservas tampoco están en
    // `pending_payment` (las movimos nosotros al cobrarlas). La diferencia es
    // que este `pi_…` es EL de este cobro y sus pagos están contabilizados. Sin
    // esta comprobación, un simple reintento de Stripe reembolsaría el cobro
    // bueno.
    //
    // El sello de `provider_payment_id` se escribe ANTES de confirmar (abajo)
    // justamente para que esta comparación sea fiable: si se sellara después,
    // una reentrega que llegara en medio no encontraría el `pi_` y trataría el
    // pago legítimo como huérfano.
    //
    // ⚠️ `every` Y NO `some`: con un pedido hace falta que TODAS las líneas
    // estén selladas y contabilizadas. Bastaría con que una no lo estuviera
    // para que esto no fuese una reentrega limpia sino un estado a medias, y
    // darlo por acreditado dejaría esa línea sin cobrar y sin devolver.
    const cobros = pagos ?? [];
    const yaAcreditado =
      pi !== null &&
      cobros.length === lineas.length &&
      cobros.every(
        (p) => p.provider_payment_id === pi && YA_CONTABILIZADO.includes(p.status),
      );

    // ⚠️ P-1 · TODO O NADA. Con un pedido no vale «alguna sigue esperando»:
    // hace falta que lo hagan TODAS. Si el cron venció una a los 7 minutos, ese
    // pedido ya no se puede entregar completo, así que no se acredita ninguna
    // línea y el cargo vuelve entero.
    const esperaCobro = lineas.every((b) => b.status === "pending_payment");

    if (!esperaCobro && !yaAcreditado) {
      // El horario ya se liberó (lo canceló el cron o el propio alumno), o ya
      // estaba pagado y esto es un segundo cobro. En los dos casos el dinero se
      // devuelve: no hay clase que dar a cambio.
      return await reembolsarCobroHuerfano(
        pi,
        pedido
          ? { reserva: null, pedido: pedido.status }
          : { reserva: lineas[0]!.status, pedido: null },
      );
    }

    // Camino normal. Se guarda el PaymentIntent y no la Session porque es el
    // que traen los eventos de reembolso y disputa.
    //
    // Antes este fallo no tumbaba el webhook. Ahora sí: el sello es lo que
    // distingue nuestro cobro de uno huérfano —y lo que `enqueue_refund` copia
    // a la cola de reembolsos—, así que confirmar sin él dejaría el cobro
    // pagado y sin referencia. Mejor 500 y que Stripe reintente.
    if (pi) await sellarReferencia(pi);

    await llamar(true);
    return NextResponse.json({ status: "ok", tipo: evento.rawType, sujeto: etiqueta });
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
    // Se traga el error a propósito, que es lo que hacía antes: aquí no hay
    // dinero que proteger. En el camino BUENO no se traga — ver `cobroEntrante`.
    try {
      await sellarReferencia(pi);
    } catch (e) {
      console.error("[webhook] no se pudo sellar el pi_ de un cobro fallido", {
        sujeto: etiqueta,
        pi,
        error: e instanceof Error ? e.message : e,
      });
    }
  }

  return NextResponse.json({ status: "ok", tipo: evento.rawType, sujeto: etiqueta });
}
