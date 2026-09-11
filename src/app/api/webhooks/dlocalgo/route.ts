import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { dlocalProvider, eventoDePago } from "@/lib/payments/dlocal-provider";
import { DlocalGoError } from "@/lib/dlocalgo";
import type { OrderStatus } from "@/lib/orders/tipos";
import type { Database } from "@/lib/database.types";

type EstadoReserva = Database["public"]["Enums"]["booking_status"];

/**
 * A2 · webhook de dLocal Go. El gemelo de `/api/webhooks/stripe`, y hace
 * EXACTAMENTE lo mismo: es el único sitio donde un cobro de dLocal pasa a
 * `paid`. El navegador no confirma pagos.
 *
 * ⚠️ LLAMA A LA MISMA `confirm_payment` / `confirm_order_payment` QUE EL DE
 * STRIPE, y eso es el requisito, no una casualidad (regla de oro 2): lo que se
 * DEBE sale de `payments.gross_amount` menos `payments.credit_amount`, congelado
 * por `create_booking`, y lo calcula la propia función dentro de la base.
 *
 * 🔴 LO QUE SÍ VIAJA AHORA ES LO QUE dLOCAL COBRÓ, y hay que leer de dónde:
 * **de `GET /v1/payments/{id}`, jamás del cuerpo del POST**. El cuerpo no trae
 * importe —ni lo traerá—, así que quien mande la notificación no puede elegirlo;
 * el número sale de la misma relectura que ya decide el estado. Con eso
 * `confirm_payment` concilia lo cobrado contra lo debido y aborta si no cuadra,
 * que es la mitad en profundidad del cerrojo contra el crédito acuñado (aplicar
 * crédito, abrir el cobro descontado y quitar el crédito después). Ver el bloque
 * de `importeCobrado`.
 *
 * ── POR QUÉ ES UN FICHERO APARTE Y NO UNA RAMA DEL DE STRIPE ────────────────
 * Porque lo que separa a los dos es la FIRMA, y la firma es lo primero que
 * ocurre: una ruta con dos verificadores decidiendo cuál aplicar según la
 * cabecera es una ruta donde un fallo de enrutado convierte el webhook en un
 * endpoint sin firmar. Dos rutas, dos secretos, cada una con un solo camino.
 * La LÓGICA (X-02, idempotencia, sellado) sí es la misma, y por eso se lee
 * igual: si tocas una, mira la otra.
 *
 * ── LAS TRES DIFERENCIAS CON EL DE STRIPE ──────────────────────────────────
 *
 * 1. ⚠️ **EL CUERPO NO DICE QUÉ PASÓ.** Es `{"payment_id":"DP-283"}` y nada
 *    más: sin tipo de evento, sin estado, sin importe, sin hora. Así que este
 *    archivo verifica la firma y **vuelve a preguntarle a la API** por el
 *    estado (`GET /v1/payments/{id}`, dentro de `eventoDePago`). No es una
 *    llamada de más que se pueda ahorrar: es lo único que impide que el estado
 *    lo elija quien manda el POST.
 *
 * 2. **La firma no caduca.** No lleva timestamp ni nonce, así que una
 *    notificación capturada se puede reproducir mañana y cuadrará. Lo que hace
 *    eso inofensivo es (1) releer el estado y (2) que `confirm_payment` sea
 *    idempotente. Las dos cosas juntas, no una.
 *
 * 3. **El `DP-…` ya está sellado antes de llegar aquí.** Con Stripe, el `pi_`
 *    se sella en este webhook; con dLocal lo sella el adaptador al CREAR el
 *    cobro, porque es la única forma de reencontrarlo si el alumno recarga (ver
 *    `dlocal-provider.ts`). Aquí se vuelve a sellar de todos modos, y no es
 *    redundante: cubre el cobro creado por otra vía y hace que la comparación
 *    de `yaAcreditado` no dependa de que el sellado previo ocurriera.
 *
 * ── 🎁 EL TERCER SUJETO: UN COBRO QUE NO TIENE RESERVA ─────────────────────
 *
 * «Regalar una mentoría» cobra por adelantado una fila de `credits` con
 * `source='gift'` (`20260912110000` §10). Ese cobro tiene que ir a
 * `confirm_gift_payment` y **jamás a `confirm_payment`**: no hay `payments`, no
 * hay `bookings`, y la segunda trataría un id de crédito como uno de reserva.
 *
 * CÓMO SE DISTINGUE AQUÍ —y es donde este webhook tiene mejor mano que el de
 * Stripe—: **por `credits.provider_payment_id`**, que es exactamente para lo que
 * existe `credits_provider_pid_idx`. El `DP-…` se sella al ABRIR el cobro
 * (`marcar_cobro_regalo`, desde `api/pagos/checkout`) porque dLocal lo exige
 * antes de redirigir, así que cuando llega la notificación ya está escrito. Y
 * ese `payment_id` es el del cuerpo FIRMADO, no algo que mande un navegador.
 *
 * De respaldo se mira el sujeto del `order_id` (`credits.id`), que es el único
 * camino que tiene Stripe. Los dos apuntan a la misma fila; tener los dos es lo
 * que hace que un `order_id` que no se pueda parsear no acabe en «ignorado» con
 * 200 y el regalo cobrado y sin activar (regla de oro 11).
 *
 * 🔴 LA IDEMPOTENCIA DEL REGALO NO ES `payment_webhook_events`: su PK es
 * `(event_id, booking_id)` con `booking_id NOT NULL` (`20260827160000:59-68`),
 * así que un regalo no cabe ahí. La pone `confirm_gift_payment` POR ESTADO —si
 * el crédito ya no está en 'pending_payment', devuelve su estado y no hace
 * nada— y con dLocal eso importa el doble: su firma no caduca y su notificación
 * es un PING repetible durante 30 días.
 *
 * ⚠️ Y EL REGALO NO TIENE X-02: `late_payment_refunds` solo admite `booking_id`
 * o `order_id` (check de `20260827170000`), así que un cobro de regalo que llega
 * tarde no se puede devolver desde aquí sin una migración. Se grita y la salida
 * es manual. Ver `cobroDeRegaloEntrante`.
 *
 * ── QUÉ SIGUE SIN EJERCITARSE ──────────────────────────────────────────────
 * Nadie ha visto llegar una notificación real: exige pagar un cobro en el
 * formulario alojado de dLocal con una tarjeta de prueba. El algoritmo de firma
 * está implementado según su documentación y verificado contra su propio
 * ejemplo de código, pero NO contra una petición suya. Es el mismo hueco que
 * tuvo Stripe hasta PAC-03.
 */

/** Node, no edge: la verificación de firma usa `crypto` de Node. */
export const runtime = "nodejs";

/** Estados de `payments` en los que el cobro ya está contabilizado. */
const YA_CONTABILIZADO = ["paid", "refunded", "partially_refunded"];

/**
 * `check_violation` — el errcode con el que `confirm_payment` levanta las DOS
 * comprobaciones de importe (la del argumento `p_amount_charged` y la del
 * marcador `payments.checkout_amount` de `marcar_cobro_abierto`). Mismo valor y
 * mismo porqué que en el webhook de Stripe; ver `20260912110000` §7.
 */
const DESCUADRE = "23514";

/**
 * 🎁 Las columnas del regalo que este archivo necesita, y ninguna más. Mismo
 * tipo y mismo criterio que en el webhook de Stripe: `credits` no se lee con
 * `.select("*")` en ninguna parte (sus grants son por columna a propósito).
 */
type RegaloCobrado = {
  id: string;
  status: string;
  currency: string;
  provider_payment_id: string | null;
};

const COLUMNAS_REGALO = "id, status, currency, provider_payment_id";

export async function POST(req: Request) {
  // ⚠️ EL CUERPO CRUDO. `req.text()` y no `req.json()`: la firma es un HMAC
  // sobre la cadena EXACTA, y `JSON.parse` + `stringify` reordena claves y
  // cambia espacios. Lee `WebhookInput` en `port.ts` antes de tocar esto.
  const crudo = await req.text();
  const verificacion = dlocalProvider.verifyWebhook({
    rawBody: crudo,
    // dLocal firma en `Authorization`, no en una cabecera propia. Es raro y es
    // así: `Authorization: V2-HMAC-SHA256, Signature: <hex>`.
    signature: req.headers.get("authorization"),
  });

  if (!verificacion.ok) {
    // Sin credencial es un fallo NUESTRO de configuración (503, que dLocal
    // reintenta); una firma que no cuadra es un 400 definitivo, porque
    // reintentar el mismo payload no lo va a validar nunca.
    //
    // Ojo con el 400: dLocal reintenta cada 10 minutos durante 30 DÍAS
    // mientras la respuesta no sea 200. Un 500 por un fallo nuestro se
    // recupera solo; un 400 por firma inválida se para aquí, que es lo que
    // queremos.
    return NextResponse.json(
      { error: verificacion.error },
      { status: verificacion.motivo === "sin-secreto" ? 503 : 400 },
    );
  }

  const paymentId = verificacion.evento.chargeRef!;

  // ── LA SEGUNDA MITAD: preguntar QUÉ pasó ────────────────────────────────
  let evento;
  let estadoProveedor: string;
  try {
    const consulta = await eventoDePago(paymentId);
    evento = consulta.evento;
    estadoProveedor = consulta.pago.status;
  } catch (e) {
    if (e instanceof DlocalGoError && e.status === 404) {
      // Un cobro que su API no reconoce. Pasa igual que con Stripe: la cuenta
      // de sandbox es una sola y la comparten dev, los previews y quien esté
      // probando. 200 para que deje de reintentar 30 días.
      return NextResponse.json({ status: "ajeno", cobro: paymentId });
    }
    // Cualquier otro fallo al consultar: 500 y que reintente. NO se confirma
    // nada a ciegas.
    throw e;
  }

  const admin = createAdminClient();
  const ref = evento.ref;

  /**
   * 🎁 ¿ESTE COBRO ES DE UN REGALO? — dos redes, y la buena es la primera.
   *
   *   1. `credits.provider_payment_id = <DP-…>`. Es la que diseñó la migración
   *      (`credits_provider_pid_idx`) y aquí SIEMPRE está escrita: dLocal exige
   *      sellar su identificador antes de redirigir, así que el checkout ya lo
   *      hizo con `marcar_cobro_regalo`. Y no depende de que el `order_id`
   *      sobreviva ni de cómo se parsee.
   *   2. el sujeto del `order_id` (`credits.id`), por si el cobro se abrió por
   *      otra vía o el sello no llegó a escribirse.
   *
   * ⚠️ LOS DOS `error` SE RELANZAN. Regla de oro 9: a `service_role` puede
   * faltarle el grant y eso muerde en tiempo de ejecución. Leerlo como «no es un
   * regalo» mandaría el cobro al camino de la reserva, que respondería «ajeno»
   * con 200 y dejaría el regalo cobrado y sin activar para siempre.
   */
  const regaloDelCobro = async (): Promise<RegaloCobrado | null> => {
    const { data: porReferencia, error: eRef } = await admin
      .from("credits")
      .select(COLUMNAS_REGALO)
      .eq("provider_payment_id", paymentId)
      .eq("source", "gift")
      .maybeSingle();
    if (eRef) throw new Error(eRef.message);
    if (porReferencia) return porReferencia;

    if (!ref) return null;
    const { data: porSujeto, error: eSujeto } = await admin
      .from("credits")
      .select(COLUMNAS_REGALO)
      .eq("id", ref.id)
      .eq("source", "gift")
      .maybeSingle();
    if (eSujeto) throw new Error(eSujeto.message);
    return porSujeto;
  };

  /**
   * 🎁 ACREDITAR EL COBRO DE UN REGALO. Gemelo del de Stripe —si tocas uno,
   * mira el otro— con la única diferencia que separa a los dos webhooks: el
   * importe sale de la RELECTURA del cobro (`GET /v1/payments/{id}`, dentro de
   * `eventoDePago`) y no del cuerpo del POST, que es `{"payment_id":"DP-283"}` y
   * nada más. O sea que ni el importe ni el estado los elige quien manda la
   * notificación.
   *
   * ⚠️ **NO HAY X-02 PARA EL REGALO**: `late_payment_refunds` exige `booking_id`
   * u `order_id` (check de `20260827170000`) y un regalo no tiene ninguno. Un
   * cobro que llegue cuando el regalo ya no lo espera NO se devuelve solo, y
   * aquí menos que en Stripe: dLocal no tiene clave de idempotencia en
   * reembolsos, así que el único tirante sería esa fila que no se puede
   * escribir. Se grita como incidente y la salida es MANUAL.
   */
  const cobroDeRegaloEntrante = async (regalo: RegaloCobrado): Promise<NextResponse> => {
    const sujeto = `regalo ${regalo.id}`;
    const importeCobrado = evento.amountMinor;

    if (importeCobrado === null) {
      // No se inventa. Queda en pie la otra mitad del cerrojo, el marcador
      // `credits.checkout_amount` que selló `marcar_cobro_regalo_abierto` y que
      // `confirm_gift_payment` compara igual. Se grita porque un PAID sin
      // `amount` es su API cambiando de forma.
      console.error("[conciliación] ⚠️ regalo confirmado sin importe: no se concilia", {
        sujeto,
        cobro: paymentId,
        evento: evento.id,
        tipo: evento.rawType,
      });
    } else {
      // La moneda antes que el importe, por lo mismo que en la reserva: un
      // número en otra moneda es perfectamente comparable y perfectamente falso.
      const monedaCobrada = evento.currency?.toUpperCase() ?? null;
      const monedaDebida = regalo.currency.toUpperCase();

      if (monedaCobrada === null || monedaCobrada !== monedaDebida) {
        console.error("[conciliación] 🔴 el cobro del regalo llegó en otra moneda", {
          sujeto,
          pasarela: dlocalProvider.key,
          cobro: paymentId,
          evento: evento.id,
          cobrado: `${importeCobrado} ${monedaCobrada ?? "(sin moneda)"}`,
          debido: monedaDebida,
        });
        return NextResponse.json(
          {
            status: "descuadre",
            sujeto,
            error:
              `el cobro llegó en ${monedaCobrada ?? "(sin moneda)"} y el regalo está en ` +
              `${monedaDebida}: no se activa`,
          },
          { status: 500 },
        );
      }
    }

    // El sello, otra vez y con el mismo criterio que en la reserva: normalmente
    // ya está puesto por el checkout —de hecho es por donde lo hemos
    // encontrado—, y repetirlo cubre el cobro abierto por otra vía. Va ANTES de
    // confirmar porque después `marcar_cobro_regalo` ya no escribe: solo acepta
    // mientras el regalo sigue en 'pending_payment'.
    //
    // ⚠️ El `p_metadata` añade una clave HERMANA de `checkout`, no la pisa: el
    // `||` de la RPC es un merge de PRIMER NIVEL.
    if (regalo.status === "pending_payment") {
      const { data: sellada, error } = await admin.rpc("marcar_cobro_regalo", {
        p_credit_id: regalo.id,
        p_provider_payment_id: paymentId,
        p_metadata: {
          webhook: {
            pasarela: dlocalProvider.key,
            evento: evento.id,
            sellado_en: new Date().toISOString(),
          },
        },
      });
      // Un `false` aquí es raro: el regalo estaba pendiente hace dos consultas y
      // ha dejado de estarlo entre medias. No tumba el webhook —el dinero se
      // acredita igual y `confirm_gift_payment` decide— pero se ve.
      if (error || sellada !== true) {
        console.error("[webhook] 🔴 no se pudo sellar el DP- en el regalo", {
          sujeto,
          cobro: paymentId,
          error: error?.message ?? "no se tocó ninguna fila",
        });
      }
    }

    const salida = await admin.rpc("confirm_gift_payment", {
      p_credit_id: regalo.id,
      p_success: true,
      // ⚠️ Hoy la función no lo mira: su idempotencia es POR ESTADO, porque
      // `payment_webhook_events` no puede guardar un regalo (`booking_id not
      // null`). Se manda porque identifica el hecho —y con dLocal esa clave es
      // `dlocalgo:<payment_id>:<status>`, sintetizada por el adaptador— y porque
      // el día que exista dónde anotarlo, ya está puesto.
      p_event_id: evento.id,
      p_amount_charged: importeCobrado ?? undefined,
    });

    if (salida.error) {
      if (salida.error.code === DESCUADRE) {
        // A gritos antes que en silencio: la transacción se fue entera, dLocal
        // va a reintentar cada 10 minutos durante 30 días con el dinero cobrado
        // y el regalo sin activar, y la salida es MANUAL.
        console.error("[conciliación] 🔴 lo cobrado no es lo que vale el regalo: NO se activa", {
          sujeto,
          pasarela: dlocalProvider.key,
          cobro: paymentId,
          evento: evento.id,
          cobradoPorLaPasarela: importeCobrado,
          segunLaBase: salida.error.message,
          pista: salida.error.hint,
        });
        return NextResponse.json(
          { status: "descuadre", sujeto, error: salida.error.message },
          { status: 500 },
        );
      }
      throw new Error(salida.error.message);
    }

    // 🔴 EL COBRO LLEGÓ Y EL REGALO YA NO LO ESPERABA. 'active' es el camino
    // bueno y también la reentrega limpia; 'consumed', un regalo ya canjeado.
    // Cualquier otro estado significa que alguien pagó por algo que ya no
    // existe y que la función no ha tocado nada. 200 y no 500 a propósito:
    // reintentar treinta días no devuelve un euro, solo repite este log.
    const estado = salida.data;
    if (estado !== "active" && estado !== "consumed") {
      console.error("[X-02] 🔴 cobro de un regalo que ya no lo esperaba: NO se devuelve solo", {
        sujeto,
        estadoDelRegalo: estado,
        pasarela: dlocalProvider.key,
        cobro: paymentId,
        evento: evento.id,
        // A qué cobro apunta el regalo AHORA: si no es este `DP-…`, lo pagó otro
        // y este es el de más. Es el primer dato que necesita quien vaya a
        // devolver el dinero a mano.
        cobroDelRegalo: regalo.provider_payment_id,
        importe: importeCobrado,
        queHacer:
          "devolver el cargo a mano desde el panel de dLocal: late_payment_refunds no admite un regalo",
      });
      return NextResponse.json({ status: "regalo-huerfano", sujeto, estado });
    }

    return NextResponse.json({ status: "ok", tipo: evento.rawType, sujeto });
  };

  /**
   * 🎁 La pregunta se hace SOLO cuando el evento va a tocar algo, y va antes de
   * todo lo demás —incluido el `if (!ref)`— porque la red buena de aquí es el
   * `DP-…`, que no depende del `order_id`. Un PENDING no acredita ni tumba
   * nada, así que no hace falta saber de quién es para responderle.
   */
  if (evento.kind === "cobro-confirmado" || evento.kind === "cobro-fallido") {
    const regalo = await regaloDelCobro();
    if (regalo) {
      if (evento.kind === "cobro-confirmado") return await cobroDeRegaloEntrante(regalo);

      /**
       * EXPIRED o CANCELLED sobre un regalo: **no se revoca**, y es una decisión.
       * `confirm_gift_payment(p_success => false)` existe y lo dejaría en
       * 'revoked'; no se llama porque un regalo no retiene ningún horario (al
       * revés que una reserva, donde `expired` tiene que liberar el hueco) y
       * porque pueden convivir dos cobros abiertos para el mismo regalo — ver
       * `caducidadRegalo` en `api/pagos/checkout`. Tumbarlo porque uno caducó
       * dejaría el otro vivo y pagable contra un regalo muerto, y sin X-02 para
       * regalos eso es dinero cobrado que nadie devuelve. Al revés no se pierde
       * nada: la fila sigue 'pending_payment' y `caducar_creditos()` la barre a
       * los 30 días. El razonamiento completo está en el webhook de Stripe.
       */
      console.error("[webhook] cobro de un regalo caducado o fallido: no se revoca", {
        sujeto: `regalo ${regalo.id}`,
        estadoDelRegalo: regalo.status,
        cobro: paymentId,
        estadoEnElProveedor: estadoProveedor,
        evento: evento.id,
      });
      return NextResponse.json({
        status: "regalo-sin-cobrar",
        tipo: evento.rawType,
        sujeto: `regalo ${regalo.id}`,
      });
    }
  }

  if (!ref) {
    // Firmado y real, pero sin sujeto reconocible en su `order_id` (un cobro
    // creado desde su panel, por ejemplo). 200: no hay nada que arreglar
    // reintentando.
    console.error("[dlocalgo] cobro sin sujeto reconocible", {
      cobro: paymentId,
      estado: estadoProveedor,
    });
    return NextResponse.json({ status: "ignorado", cobro: paymentId });
  }

  const etiqueta = ref.tipo === "order" ? `pedido ${ref.id}` : `booking ${ref.id}`;

  /**
   * Idéntico al de Stripe, y a propósito: `confirm_payment` es idempotente por
   * `event_id` para ESA reserva, y con un pedido va `confirm_order_payment`,
   * que recorre las N líneas EN UNA TRANSACCIÓN. Nunca se acredita una línea
   * de un pedido por separado (EY-176).
   *
   * Devuelve `null` si todo fue bien, o la RESPUESTA que hay que dar si la
   * conciliación de importes tumbó la transacción — no lanza en ese caso,
   * porque un `throw` acaba en un 500 de Next con el cuerpo vacío y lo que hace
   * falta ahí es un cuerpo que diga el desajuste.
   */
  const llamar = async (
    exito: boolean,
    /**
     * 🔴 LO QUE dLOCAL COBRÓ DE VERDAD, en unidades menores, o `null` si la
     * relectura del cobro no lo trae. Sin valor por defecto a propósito: quien
     * llame tiene que decidir, porque un parámetro opcional aquí es la forma más
     * barata de volver a dejar la conciliación inerte en silencio (regla 11).
     */
    importeCobrado: number | null,
  ): Promise<NextResponse | null> => {
    // ⚠️ `undefined` Y NO LA CLAVE AUSENTE: supabase-js no serializa las claves
    // `undefined` (el mecanismo de la regla de oro 12), así que el argumento no
    // viaja y PostgREST usa el `default null`. La clave se escribe igualmente
    // para que la vea el COMPILADOR: si la RPC no la aceptara, eso es un error
    // de tipos y no un `PGRST202` en producción.
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
      /**
       * 🔴 LO COBRADO NO ES LO DEBIDO. La RPC abortó la transacción, y eso se
       * lleva por delante también el `insert` en `payment_webhook_events`: el
       * evento no queda marcado como procesado y dLocal lo va a reintentar cada
       * 10 minutos durante 30 DÍAS con el dinero ya cobrado y la reserva sin
       * confirmar.
       *
       * Es lo correcto —a gritos antes que en silencio— y por eso sale por 500
       * con los dos importes en el log y el desajuste en el cuerpo. Un 200 mudo
       * aquí dejaría una reserva pagada de menos que no mira nadie, que es la
       * regla de oro 11 con dinero dentro. La salida es MANUAL y está escrita en
       * `docs/QA-LANZAMIENTO.md`.
       */
      console.error("[conciliación] 🔴 lo cobrado no es lo debido: NO se acredita", {
        sujeto: etiqueta,
        pasarela: dlocalProvider.key,
        cobro: paymentId,
        evento: evento.id,
        tipo: evento.rawType,
        cobradoPorLaPasarela: importeCobrado,
        // El otro lado lo dice la propia función, que es quien lo leyó de
        // `payments`. Repetir aquí la resta sería una segunda fuente de verdad
        // para el importe debido — lo que prohíbe la regla de oro 2.
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

  /** El sello, en TODAS las líneas. Ver el porqué en el webhook de Stripe. */
  const sellarReferencia = async (dp: string) => {
    if (ref.tipo === "order") {
      const { data: lineas, error: eLineas } = await admin
        .from("bookings")
        .select("id")
        .eq("order_id", ref.id);
      if (eLineas) throw new Error(eLineas.message);

      const { error } = await admin
        .from("payments")
        .update({ provider_payment_id: dp })
        .in("booking_id", (lineas ?? []).map((b) => b.id));
      if (error) throw new Error(error.message);

      const { error: eOrden } = await admin
        .from("orders")
        .update({ provider_payment_id: dp })
        .eq("id", ref.id);
      if (eOrden) throw new Error(eOrden.message);
      return;
    }
    const { error } = await admin
      .from("payments")
      .update({ provider_payment_id: dp })
      .eq("booking_id", ref.id);
    if (error) throw new Error(error.message);
  };

  /**
   * X-02 · DEVOLVER UN COBRO QUE NO DEBIÓ OCURRIR. Misma política que en
   * Stripe, misma tabla y mismo orden (reembolsar → anotar).
   *
   * ⚠️ LA IDEMPOTENCIA AQUÍ ES **SOLO** LA TABLA. Con Stripe hay dos caminos:
   * el `unique` de `late_payment_refunds.provider_payment_id` y la
   * `idempotencyKey` de la llamada. dLocal Go NO tiene clave de idempotencia en
   * reembolsos, así que el segundo tirante no existe: dos entregas simultáneas
   * que leyeran la tabla vacía llamarían las dos y devolverían el dinero dos
   * veces.
   *
   * Se estrecha esa ventana anotando ANTES de llamar —al revés que en Stripe—
   * y aceptando el intercambio a conciencia: si la llamada falla después de
   * anotar, queda constancia de un reembolso que no se hizo (detectable, porque
   * `provider_refund_id` se queda null y el log lo grita), en vez de un
   * reembolso hecho dos veces (dinero que ya salió). Con dinero, la mentira
   * detectable gana a la irreversible.
   */
  const reembolsarCobroHuerfano = async (
    estado: { reserva: EstadoReserva; pedido: null } | { reserva: null; pedido: OrderStatus },
  ): Promise<NextResponse> => {
    const descripcion = estado.reserva ?? estado.pedido;

    const { data: previo } = await admin
      .from("late_payment_refunds")
      .select("provider_refund_id")
      .eq("provider_payment_id", paymentId)
      .maybeSingle();
    if (previo) {
      return NextResponse.json({
        status: "ya-reembolsado",
        sujeto: etiqueta,
        reembolso: previo.provider_refund_id,
      });
    }

    // Se reserva el sitio ANTES de mover dinero. El `unique` de
    // `provider_payment_id` es lo que convierte esta fila en un candado: una
    // segunda entrega simultánea choca aquí y no llega a llamar a la API.
    const { error: eReserva } = await admin.from("late_payment_refunds").insert({
      booking_id: estado.reserva ? ref.id : null,
      order_id: estado.pedido ? ref.id : null,
      provider: dlocalProvider.key,
      provider_payment_id: paymentId,
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

    // Sin `amountMinor`: se devuelve el cargo entero. Un cobro por una reserva
    // que no existe no se retiene ni en parte (y con un pedido, «entero»
    // significa las N líneas — decisión P-1).
    const salida = await dlocalProvider.refund({
      chargeRef: paymentId,
      currency: evento.currency ?? "USD",
      metadata: {
        ...(ref.tipo === "order" ? { order_id: ref.id } : { booking_id: ref.id }),
        motivo: "x02_cobro_tardio",
      },
      // dLocal la ignora (no tiene clave de idempotencia). Se manda igual
      // porque el puerto la exige y porque el día que la tenga, ya está puesta.
      idempotencyKey: `x02-reembolso-${paymentId}`,
    });

    if (salida.estado === "transitorio" || salida.estado === "rechazado") {
      // La fila reservada se queda con `provider_refund_id` null y el log lo
      // grita: es dinero pendiente de devolver que necesita una persona.
      console.error("[X-02] ⚠️ dLocal NO aceptó el reembolso del cobro tardío", {
        sujeto: etiqueta,
        cobro: paymentId,
        error: salida.estado,
      });
      throw salida.causa;
    }

    const refundId = salida.estado === "ya-reembolsado" ? null : salida.refundId;

    // ⚠️ AQUÍ HABÍA UN `update` SOBRE `late_payment_refunds`, Y NO PODÍA
    // FUNCIONAR. Esa tabla es **append-only a propósito**: `20260817160000:125`
    // concede a `service_role` `select, insert` y nada más, y su comentario dice
    // que es deliberado — es el registro de que se devolvió un cobro tardío, y
    // un registro que se puede reescribir no es un registro.
    //
    // El `update` devolvía 42501 y, como no se miraba el `error`, fallaba **en
    // silencio**: sin 500, sin log y sin fila cambiada. Lo cazó la revisión
    // adversarial, y es la regla de oro 9 en su forma más incómoda — no rompe
    // nada visible, solo deja de hacer lo que dice que hace.
    //
    // No se concede el grant: la solución no es hacer escribible una tabla que
    // se diseñó para no serlo. El id del reembolso queda en el log del
    // incidente de abajo, que es donde alguien va a mirar de todas formas —X-02
    // es un incidente, no un trámite— y en el propio panel de dLocal, buscando
    // por el cobro. Si algún día hace falta tenerlo en la fila, se hace bien:
    // insertándolo con ella, no reescribiéndola después.
    if (refundId) {
      console.warn("[X-02] reembolso de dLocal sin anotar en la fila (tabla append-only)", {
        cobro: paymentId,
        reembolso: refundId,
      });
    }

    // A ojos de operaciones esto es un incidente, no un trámite: alguien pagó
    // por una clase que ya no existía.
    console.error("[X-02] cobro tardío reembolsado (dlocal)", {
      sujeto: etiqueta,
      estado: descripcion,
      cobro: paymentId,
      reembolso: refundId ?? "(ya estaba)",
    });

    return NextResponse.json({ status: "reembolsado", sujeto: etiqueta, reembolso: refundId });
  };

  /**
   * X-02 · antes de acreditar, comprobar que el sujeto sigue esperando el
   * cobro. Misma forma que en Stripe: una reserva suelta es el mismo código con
   * una lista de uno, a propósito.
   */
  const cobroEntrante = async (): Promise<NextResponse> => {
    // ⚠️ EL ERROR DE LECTURA SE RELANZA, NO SE TRATA COMO «NO EXISTE» (regla de
    // oro 9: a `service_role` puede faltarle un grant y eso muerde en tiempo de
    // ejecución). Darlo por «ajeno» devolvería 200, dLocal dejaría de
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
      return NextResponse.json({ status: "ajeno", sujeto: etiqueta });
    }

    // `currency` entra en el select por la comprobación de moneda de más abajo,
    // no para comparar importes: lo debido lo calcula `confirm_payment` dentro
    // de la base (regla de oro 2). Es la misma consulta, no una de más.
    const { data: pagos, error: ePagos } = await admin
      .from("payments")
      .select("booking_id, status, provider_payment_id, currency")
      .in("booking_id", lineas.map((b) => b.id));
    if (ePagos) throw new Error(ePagos.message);

    const cobros = pagos ?? [];
    // Reentrega del cobro que YA acreditamos. `every` y no `some`: con un
    // pedido hacen falta TODAS las líneas selladas y contabilizadas.
    const yaAcreditado =
      cobros.length === lineas.length &&
      cobros.every(
        (p) => p.provider_payment_id === paymentId && YA_CONTABILIZADO.includes(p.status),
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
     * 🔴 LO QUE dLOCAL COBRÓ DE VERDAD — la mitad en profundidad del cerrojo
     * del crédito.
     *
     * Sale DEL COBRO RELEÍDO, nunca de nuestra base (comparar `gross_amount`
     * consigo mismo no concilia nada) y nunca del cuerpo del POST (que no trae
     * importe: es `{"payment_id":"DP-283"}` y nada más). Es el `amount` de
     * `GET /v1/payments/{id}` pasado a unidades menores por `eventoDePago` →
     * `evento.amountMinor`, y eso importa por dos motivos:
     *
     *   · dLocal habla en unidad MAYOR («45.00») y `payments.gross_amount` en
     *     menor; la conversión conoce las monedas sin céntimos (CLP, PYG) y vive
     *     en `aUnidadMenor`, en un solo sitio. Aquí no se multiplica por 100.
     *   · el número viene de la MISMA relectura que decide el estado, así que no
     *     lo elige quien manda la notificación. Es la diferencia nº 1 del
     *     encabezado de este archivo, usada a favor.
     *
     * ⚠️ CON UN PEDIDO ES EL TOTAL DEL CARGO, NO EL DE UNA LÍNEA: un pedido de N
     * mentorías es UN cobro `DP-…` (P-3). Repartirlo es cosa de
     * `confirm_order_payment`, que conoce el `gross_amount` y el `credit_amount`
     * de cada línea.
     *
     * ⚠️ Y NO ES `balance_currency`. El cobro se crea en `payments.currency`
     * (`amount: aUnidadMayor(totalMenor, input.currency)` en el adaptador) y la
     * relectura devuelve esa misma moneda; `balance_currency` es la del SALDO del
     * comercio (USD) y no tiene nada que ver con lo que se le cobró al alumno.
     */
    const importeCobrado = evento.amountMinor;

    if (importeCobrado === null) {
      // No se inventa. Sin importe, la conciliación POR ARGUMENTO no actúa y
      // queda en pie la del MARCADOR (`payments.checkout_amount`, que sella
      // `marcar_cobro_abierto`), que es la otra mitad del cerrojo. Se grita
      // porque un `PAID` sin `amount` es su API cambiando de forma.
      console.error("[conciliación] ⚠️ cobro confirmado sin importe: no se concilia", {
        sujeto: etiqueta,
        cobro: paymentId,
        evento: evento.id,
        tipo: evento.rawType,
      });
    } else {
      /**
       * ⚠️ LA MONEDA SE COMPRUEBA ANTES DE COMPARAR NADA: `gross_amount` está en
       * unidades menores de `payments.currency`, y un importe en otra moneda es
       * un número perfectamente comparable y una comparación perfectamente
       * falsa. El precedente es M-01 en Stripe (cobró «PAB 46,80» por «45,00
       * US$» convirtiendo por geolocalización sin avisar); aquí el cobro se crea
       * en nuestra moneda y esto no debería saltar nunca — que es exactamente el
       * motivo de que, si salta, tenga que parar el webhook.
       */
      const monedaCobrada = evento.currency?.toUpperCase() ?? null;
      const monedasDebidas = [...new Set(cobros.map((p) => p.currency.toUpperCase()))];

      if (monedaCobrada === null || monedasDebidas.some((m) => m !== monedaCobrada)) {
        console.error("[conciliación] 🔴 el cobro llegó en otra moneda que la reserva", {
          sujeto: etiqueta,
          pasarela: dlocalProvider.key,
          cobro: paymentId,
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
    // reentrega que llegue en medio. Normalmente ya está puesto por el
    // adaptador; esto lo hace idempotente y cubre el cobro creado por otra vía.
    await sellarReferencia(paymentId);

    const descuadre = await llamar(true, importeCobrado);
    if (descuadre) return descuadre;
    return NextResponse.json({ status: "ok", tipo: evento.rawType, sujeto: etiqueta });
  };

  switch (evento.kind) {
    // Sigue PENDING: el cobro está vivo pero nadie ha pagado todavía. NO se
    // acredita y NO se cancela — una tarjeta rechazada deja el cobro en este
    // estado y la persona reintenta con otra (ver `eventoDePago`).
    case "cobro-en-curso":
      return NextResponse.json({ status: "en-curso", tipo: evento.rawType });

    case "cobro-confirmado":
      return await cobroEntrante();

    // Terminal: EXPIRED o CANCELLED. Libera el horario.
    case "cobro-fallido": {
      // `null`: no hay cobro que conciliar. `confirm_payment` ni mira el
      // argumento con `p_success` falso — ahí hace lo contrario, devolver el
      // crédito que financiaba el pago que se cayó.
      const descuadre = await llamar(false, null);
      if (descuadre) return descuadre;
      return NextResponse.json({ status: "ok", tipo: evento.rawType, sujeto: etiqueta });
    }

    default:
      return NextResponse.json({ status: "ignorado", tipo: evento.rawType });
  }
}
