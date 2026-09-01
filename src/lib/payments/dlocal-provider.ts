import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  DlocalGoError,
  aUnidadMayor,
  aUnidadMenor,
  dlocalgoFetch,
  firmaCuadra,
  firmaDeCabecera,
  firmarNotificacion,
  isDlocalGoConfigured,
  recuperarPago,
  type PagoDlocalGo,
  type ReembolsoDlocalGo,
} from "@/lib/dlocalgo";
import type {
  ChargeInput,
  ChargeResult,
  CobroRef,
  PspProvider,
  RefundInput,
  RefundResult,
  WebhookInput,
  WebhookVerificacion,
} from "./port";

/**
 * EL ADAPTADOR DE dLOCAL GO — el segundo PSP, y el que demuestra que el puerto
 * servía para algo.
 *
 * Todo lo escrito aquí está comprobado **contra el sandbox real**
 * (`api-sbx.dlocalgo.com`, cuenta propia, 1-sep-2026), no contra la
 * documentación. Donde la doc y la API se contradicen, manda la API y queda
 * anotado. Esa distinción no es pedantería: la tabla oficial de parámetros de
 * payouts y lo que el endpoint acepta de verdad NO coinciden, y creerle a la
 * tabla habría costado un pago rechazado por tutor.
 *
 * ── LOS CINCO DESAJUSTES CON EL PUERTO, Y CÓMO SE RESUELVE CADA UNO ─────────
 *
 * 1. FORMA DEL COBRO → `redirect_url`, no `client_secret`. El puerto ensanchó
 *    `ChargeResult` con `modo: 'redireccion'`. SmartFields (que sería embebido)
 *    NO está disponible: `"direct": true` se ignora en silencio y vuelve
 *    `"direct": false`. Ver `ChargeRedirigido` en `port.ts`.
 *
 * 2. EL WEBHOOK NO TRAE EVENTO, TRAE UN PING (`{"payment_id":"DP-283"}`). La
 *    deduplicación se sintetiza como `dlocalgo:<id>:<status>` releyendo el
 *    estado de la API. Ver `verifyWebhook` abajo y `WebhookEvent.id` en el
 *    puerto.
 *
 * 3. UNIDADES → dLocal usa unidad mayor (`500.00`), el puerto usa `amountMinor`.
 *    La división vive en `lib/dlocalgo.ts` (`aUnidadMayor`) y en ningún sitio
 *    antes, con el cuidado de que CLP y PYG NO tienen céntimos.
 *
 * 4. IDEMPOTENCIA → no hay cabecera; el sustituto es `order_id` único, y
 *    repetirlo es un 400 (`5009`), no la respuesta cacheada. Se EMULA. Es lo
 *    más delicado del archivo y tiene su propio bloque en `charge`.
 *
 * 5. CADUCIDAD → relativa (`expiration_type` + `expiration_value`), no época
 *    Unix. Se convierte en `charge`. El enum real es [HOURS, DAYS, MINUTES] y
 *    el valor mínimo es 1 (comprobado: `-5` devuelve «must be greater than or
 *    equal to 1»).
 *
 * ── LO QUE ESTE ARCHIVO NO HACE ────────────────────────────────────────────
 * No decide políticas: ni la caducidad (la calcula `api/pagos/checkout`, porque
 * entra en la clave de idempotencia), ni el importe (sale de
 * `payments.gross_amount`, regla de oro 2), ni si una reserva merece cobro.
 * Recibe y ejecuta. Igual que el de Stripe.
 *
 * ── LO QUE FALTA POR EJERCITAR, DICHO CLARO ────────────────────────────────
 * Un cobro COMPLETADO. Todo lo de arriba se probó creando cobros, leyéndolos y
 * provocando sus errores, pero pagar uno exige rellenar el formulario alojado
 * de dLocal con una tarjeta de prueba en un navegador. Hasta que eso pase, NO
 * están verificados de punta a punta: la firma real de una notificación (el
 * algoritmo sí está implementado según su doc, pero nadie ha visto llegar una),
 * el `POST /v1/refunds` sobre un cobro pagado (hoy devuelve «Transaction not
 * found» porque no hay ninguno) y la transición PENDING→PAID. Es exactamente el
 * mismo estado en el que estuvo Stripe antes de PAC-03, y se cierra igual: con
 * un cobro de prueba de punta a punta.
 */

/** Mismo criterio y mismo formato que en Stripe: solo el pedido lleva prefijo. */
const PREFIJO_PEDIDO = "order_";

/**
 * `order_id` es lo único que viaja a dLocal con nuestro sujeto dentro, así que
 * lleva las dos cosas: la clave de idempotencia (que es lo que le da unicidad y
 * determinismo) y, dentro de ella, el sujeto del cobro. `api/pagos/checkout` la
 * compone como `booking-<uuid>-c<epoch>-v5` / `order-<uuid>-c<epoch>-v5`.
 *
 * ⚠️ NO se inventa aquí un formato propio: si esta función y la clave del
 * checkout divergieran, el `order_id` dejaría de ser determinista por reserva y
 * cada recarga abriría un cobro nuevo.
 */
function ordenExterna(input: ChargeInput): string {
  return input.idempotencyKey;
}

/** Lo que se manda como `description`: legible en su panel, sin PII. */
function descripcionDe(input: ChargeInput): string {
  const primera = input.lineas[0]?.concepto ?? "Mentoría";
  return input.lineas.length > 1
    ? `${primera} (+${input.lineas.length - 1})`
    : primera;
}

/**
 * De `order_id` de vuelta a nuestro sujeto.
 *
 * El formato de la clave del checkout es `<tipo>-<uuid>-c<epoch>-v<n>`, así que
 * el uuid es lo que va entre el primer guion y `-c`. Se saca con una expresión
 * anclada en el uuid y no partiendo por guiones, porque el uuid LLEVA guiones
 * dentro y `split('-')` lo destroza.
 */
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const RE_ORDEN = new RegExp(`^(booking|order)-(${UUID})`);

export function refDeOrdenExterna(orderId: string | null | undefined): CobroRef | null {
  if (!orderId) return null;
  const m = RE_ORDEN.exec(orderId);
  if (m) {
    return { tipo: m[1] === "order" ? "order" : "booking", id: m[2]! };
  }
  // Compatibilidad con el otro formato posible: `order_<uuid>` pelado, el mismo
  // que usa `client_reference_id` en Stripe. No lo produce este adaptador, pero
  // reconocerlo es gratis y evita que un cobro creado a mano quede huérfano.
  if (orderId.startsWith(PREFIJO_PEDIDO)) {
    const id = orderId.slice(PREFIJO_PEDIDO.length);
    return new RegExp(`^${UUID}$`).test(id) ? { tipo: "order", id } : null;
  }
  return new RegExp(`^${UUID}$`).test(orderId) ? { tipo: "booking", id: orderId } : null;
}

/**
 * DESAJUSTE 5 · de época Unix a caducidad relativa.
 *
 * El puerto trae `expiresAt` en segundos Unix porque Stripe lo quiere así y
 * porque el valor entra en la clave de idempotencia (X-02). dLocal lo quiere en
 * unidades relativas desde AHORA.
 *
 * ⚠️ LA CONVERSIÓN NO ES DETERMINISTA Y NO PUEDE SERLO: depende de `Date.now()`,
 * así que dos llamadas para la misma reserva producen valores distintos. Con
 * Stripe eso sería un error de idempotencia; aquí no importa, porque la
 * idempotencia la resuelve el `order_id` y la emulación de `charge` — el cobro
 * repetido ni siquiera llega a crearse. Es justo el motivo de que la emulación
 * NO pueda basarse en "mandar los mismos parámetros".
 *
 * Suelo de 1 minuto: es el mínimo que acepta la API. Si la reserva ya venció
 * mientras se abría el checkout, se manda 1 y que el cobro nazca casi muerto —
 * mejor eso que un 400 que deja al alumno sin pantalla. La red de seguridad
 * real es X-02 en el webhook, como siempre.
 */
function caducidadRelativa(expiresAt: number): { expiration_type: "MINUTES"; expiration_value: number } {
  const minutos = Math.ceil((expiresAt - Date.now() / 1000) / 60);
  return { expiration_type: "MINUTES", expiration_value: Math.max(1, minutos) };
}

/**
 * DESAJUSTE 4 · DÓNDE SE RECUERDA EL COBRO ABIERTO.
 *
 * En `payments.provider_payment_id` / `orders.provider_payment_id`, que ya
 * existen y que con Stripe sella el webhook. Aquí hay que sellarlo ANTES, al
 * crear, y el motivo es que no hay otra forma de reencontrar el cobro:
 *
 *   · `GET /v1/payments` NO lista los cobros PENDING (comprobado: seis cobros
 *     creados, `totalElements: 0`);
 *   · el filtro `?order_id=` se ignora y devuelve vacío;
 *   · y `POST` repetido da 400, no el cobro anterior.
 *
 * Así que la memoria es nuestra o no hay memoria. Sin ella, cada recarga del
 * checkout —que desde D-2 (§20.14) monta el cobro al LLEGAR, no al pulsar—
 * abriría un cobro nuevo en dLocal.
 */
async function refGuardada(ref: CobroRef): Promise<string | null> {
  const admin = createAdminClient();
  if (ref.tipo === "order") {
    const { data, error } = await admin
      .from("orders")
      .select("provider_payment_id")
      .eq("id", ref.id)
      .maybeSingle();
    // ⚠️ El error se relanza, no se trata como «no hay». Regla de oro 9: a
    // `service_role` puede faltarle un grant y eso muerde en TIEMPO DE
    // EJECUCIÓN. Confundirlo con «no hay cobro previo» abriría un cobro nuevo
    // en cada recarga sin que nadie se entere.
    if (error) throw new Error(error.message);
    return data?.provider_payment_id ?? null;
  }
  const { data, error } = await admin
    .from("payments")
    .select("provider_payment_id")
    .eq("booking_id", ref.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.provider_payment_id ?? null;
}

/**
 * Sella el `DP-…` en TODAS las filas del sujeto, igual que hace el webhook de
 * Stripe y por la misma razón: `enqueue_refund` (X-01) copia
 * `payments.provider_payment_id` a la cola, y una línea sin sellar se encolaría
 * sin referencia y moriría como «sin provider_payment_id».
 */
async function sellarRef(ref: CobroRef, providerRef: string): Promise<void> {
  const admin = createAdminClient();
  if (ref.tipo === "order") {
    const { data: lineas, error: eLineas } = await admin
      .from("bookings")
      .select("id")
      .eq("order_id", ref.id);
    if (eLineas) throw new Error(eLineas.message);

    const { error } = await admin
      .from("payments")
      .update({ provider_payment_id: providerRef })
      .in("booking_id", (lineas ?? []).map((b) => b.id));
    if (error) throw new Error(error.message);

    const { error: eOrden } = await admin
      .from("orders")
      .update({ provider_payment_id: providerRef })
      .eq("id", ref.id);
    if (eOrden) throw new Error(eOrden.message);
    return;
  }
  const { error } = await admin
    .from("payments")
    .update({ provider_payment_id: providerRef })
    .eq("booking_id", ref.id);
  if (error) throw new Error(error.message);
}

/**
 * ¿Ese cobro sigue sirviendo para pagar **este** sujeto y **este** importe?
 *
 * ⚠️ LAS TRES CONDICIONES SON OBLIGATORIAS, Y LAS DOS ÚLTIMAS SE AÑADIERON
 * PORQUE FALTABAN. La revisión adversarial encontró que mirar solo `PENDING`
 * deja pasar el cobro de OTRO sujeto, y con él otro importe:
 *
 *   · el alumno tiene un pedido O con dos líneas (B1 25 $, B2 50 $) y entra en
 *     `/pedidos/O/pagar` → se abre un cobro de 75 $, que `sellarRef` estampa en
 *     la fila de `payments` de LAS DOS líneas, que es lo correcto para que
 *     `enqueue_refund` encuentre la referencia;
 *   · no paga, y luego abre la reserva B1 suelta desde «Mis reservas» —esa
 *     pantalla no sabe qué es un `order_id`, y no tiene por qué saberlo—;
 *   · `refGuardada` devuelve el mismo `DP-…`, sigue `PENDING`, y se le reabre.
 *     La pantalla dice «25 $» y dLocal cobra **75 $**.
 *
 * Es exactamente lo que prohíbe la regla de oro 2: el importe deja de salir del
 * `payments.gross_amount` del sujeto. Y no es una carrera ni un caso raro — son
 * tres clics en la interfaz que ya existe.
 *
 * Por eso se compara contra el cobro recuperado de la API y no contra lo que
 * creemos haber guardado: `order_id` dice de quién es y `amount` cuánto vale,
 * los dos según dLocal, que es quien va a cobrar.
 */
function reutilizable(pago: PagoDlocalGo, input: ChargeInput): boolean {
  if (pago.status !== "PENDING" || !pago.redirect_url) return false;

  // ¿Es de este sujeto? `order_id` es determinista y codifica la referencia.
  const suyo = refDeOrdenExterna(pago.order_id);
  if (!suyo || suyo.tipo !== input.ref.tipo || suyo.id !== input.ref.id) return false;

  // ¿Por este importe? En unidades menores, que es donde vive la verdad; el
  // cobro viaja en unidad mayor y CLP/PYG no tienen céntimos (ver `SIN_CENTIMOS`).
  const esperado = input.lineas.reduce((s, l) => s + l.amountMinor, 0);
  return aUnidadMenor(pago.amount, pago.currency) === esperado;
}

export const dlocalProvider: PspProvider = {
  /** El mismo valor que `payments.provider` y `payment_routing_rules`. */
  key: "dlocal",
  opensRemoteCheckout: true,

  /**
   * Las DOS claves, y no hay una pregunta distinta para el cobro y para el
   * reembolso: viajan juntas en la misma cabecera `Authorization`. Por eso
   * `missingChargeConfig` y `canRefund` miran lo mismo, al revés que en Stripe
   * —donde la publicable solo la necesita el navegador—. Ojo: eso NO significa
   * que se puedan fusionar en el puerto; significa que este proveedor contesta
   * lo mismo a las dos preguntas.
   */
  missingChargeConfig() {
    return isDlocalGoConfigured()
      ? null
      : "dLocal Go no configurado (faltan DLOCALGO_API_KEY / DLOCALGO_SECRET_KEY)";
  },

  canRefund: isDlocalGoConfigured,

  /**
   * DESAJUSTE 4 · LA EMULACIÓN DE LA IDEMPOTENCIA. Léelo entero antes de tocar.
   *
   * El contrato del puerto dice: «llamar dos veces con la misma
   * `idempotencyKey` da el mismo cobro». Stripe lo cumple solo. dLocal no tiene
   * con qué, así que se cumple aquí, en tres pasos:
   *
   *   1. ¿Hay ya un `DP-…` sellado para este sujeto? Se le pregunta a la API por
   *      él. Si sigue `PENDING`, se devuelve SU `redirect_url` y no se crea
   *      nada. Este es el camino normal de una recarga.
   *   2. Si no hay, se crea con `order_id` = la clave (determinista por
   *      reserva) y se sella ANTES de devolver nada.
   *   3. Si aun así vuelve `5009 Order id is duplicated` —dos pestañas creando
   *      a la vez, o un sello que no llegó a escribirse— se relee el sello y se
   *      reintenta el paso 1. Si tampoco entonces hay nada que reabrir, se falla
   *      en vez de inventarse un `order_id` distinto: crear un segundo cobro
   *      para la misma reserva es justo lo que la clave existe para impedir.
   *
   * ⚠️ EL ORDEN «CREAR → SELLAR → DEVOLVER» NO SE PUEDE ALTERAR. Si se
   * devolviera la URL antes de sellar y el proceso muriera en medio, existiría
   * un cobro abierto en dLocal que esta base de datos no conoce: nadie podría
   * reencontrarlo (no se lista, no se busca por `order_id`) y, si alguien lo
   * pagara, el webhook lo trataría como huérfano. El fallo del sellado tumba el
   * checkout a propósito.
   */
  async charge(input: ChargeInput): Promise<ChargeResult> {
    // ── 1 · ¿ya hay uno abierto? ─────────────────────────────────────────────
    const guardada = await refGuardada(input.ref);
    if (guardada) {
      try {
        const previo = await recuperarPago(guardada);
        if (reutilizable(previo, input)) {
          return { ok: true, modo: "redireccion", redirectUrl: previo.redirect_url!, providerRef: previo.id };
        }
        // Existe pero ya no sirve (pagado, caducado, rechazado). No se abre otro
        // por las buenas: si estaba PAID, el webhook ya lo habrá acreditado y
        // `api/pagos/checkout` ni siquiera llega aquí (la reserva no estaría en
        // `pending_payment`). Llegar aquí con un cobro muerto significa que el
        // sujeto sigue esperando pago, así que sí toca uno nuevo — y como el
        // `order_id` es determinista, chocará y lo resolverá el paso 3.
      } catch (e) {
        // Un `DP-…` que la API no reconoce (cuenta cambiada, datos de sandbox
        // borrados). Se sigue adelante y se abre uno nuevo, que es lo mismo que
        // hace el rescate del Customer perdido en el checkout de Stripe.
        if (!(e instanceof DlocalGoError) || e.status !== 404) throw e;
      }
    }

    // ── 2 · crear ────────────────────────────────────────────────────────────
    // ⚠️ EL IMPORTE ES LA SUMA DE LAS LÍNEAS Y DE NADA MÁS (regla de oro 2).
    // dLocal Go NO acepta desglose por líneas —no hay `line_items`—, así que el
    // detalle que Stripe conserva en su panel aquí se pierde y solo viaja el
    // total. Es una pérdida real de conciliación y no tiene arreglo por API: lo
    // que la sostiene es que el desglose sigue en `payments`, una fila por
    // mentoría, que es donde manda.
    const totalMenor = input.lineas.reduce((s, l) => s + l.amountMinor, 0);

    const cuerpo = {
      amount: aUnidadMayor(totalMenor, input.currency),
      currency: input.currency.toUpperCase(),
      // Opcional de verdad: sin él su checkout le pregunta el país a la persona.
      ...(input.payerCountry ? { country: input.payerCountry.toUpperCase() } : {}),
      order_id: ordenExterna(input),
      description: descripcionDe(input),
      // Las dos URL de vuelta. `success_url` es a donde va tras pagar;
      // `back_url` es el «volver» de su checkout. Se apuntan las dos al mismo
      // sitio: nuestra pantalla de confirmación ya sabe distinguir pagado de no
      // pagado leyendo la reserva, y mandar el «volver» a otro lado dejaría al
      // alumno en una pantalla que no explica qué pasó con su dinero.
      success_url: input.returnUrl,
      back_url: input.returnUrl,
      notification_url: input.notificationUrl,
      ...caducidadRelativa(input.expiresAt),
    };

    let pago: PagoDlocalGo;
    try {
      pago = await dlocalgoFetch<PagoDlocalGo>("POST", "/v1/payments", cuerpo);
    } catch (e) {
      // ── 3 · el choque ──────────────────────────────────────────────────────
      if (e instanceof DlocalGoError && e.esOrderIdDuplicado) {
        const reintento = await refGuardada(input.ref);
        if (reintento) {
          const previo = await recuperarPago(reintento);
          // Mismo cerrojo que arriba, y aquí importa igual: que el `order_id`
          // haya chocado no prueba que el cobro de dLocal sea de este sujeto y
          // por este importe — solo que la clave se repite.
          if (reutilizable(previo, input)) {
            return { ok: true, modo: "redireccion", redirectUrl: previo.redirect_url!, providerRef: previo.id };
          }
        }
        // Hay un cobro con nuestro `order_id` en dLocal y no sabemos cuál es.
        // NO se inventa una clave nueva: se dice la verdad y que lo mire alguien.
        return {
          ok: false,
          error:
            "dLocal Go dice que este cobro ya existe y no se puede recuperar (order_id duplicado sin referencia guardada)",
        };
      }
      if (e instanceof DlocalGoError) return { ok: false, error: e.message };
      throw e;
    }

    if (!pago.redirect_url) {
      return { ok: false, error: "dLocal Go no devolvió redirect_url" };
    }

    // SELLAR ANTES DE DEVOLVER. Si esto lanza, el checkout falla — a propósito.
    await sellarRef(input.ref, pago.id);

    return { ok: true, modo: "redireccion", redirectUrl: pago.redirect_url, providerRef: pago.id };
  },

  /**
   * `POST /v1/refunds` — `{payment_id, amount?}`. Sin `amount` devuelve el cobro
   * entero, igual que en Stripe y que es lo que pide X-02.
   *
   * ⚠️ SIN CLAVE DE IDEMPOTENCIA, y esto es peor que en el cobro. En el cobro el
   * `order_id` al menos CHOCA; aquí no hay nada: dos llamadas iguales crean dos
   * reembolsos. Lo que impide el doble pago es, entonces, enteramente nuestro:
   *   · X-01 mira `refund_requests.status` y solo procesa `pending`;
   *   · X-02 mira `late_payment_refunds.provider_payment_id`, que es UNIQUE,
   *     ANTES de llamar.
   * Las dos comprobaciones ya existían como cinturón; con dLocal pasan a ser el
   * único tirante. Quien quite una de las dos «porque la clave de idempotencia
   * ya lo cubre» estará quitando lo único que lo cubre.
   *
   * ⚠️ `metadata` NO VIAJA. dLocal Go no tiene campo de metadatos en el
   * reembolso, así que los ids de conciliación que Stripe sí guarda en su panel
   * aquí se quedan solo en nuestro log y en `refund_requests`. No se falsifica
   * metiéndolos en otro campo.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    let reembolso: ReembolsoDlocalGo;
    try {
      reembolso = await dlocalgoFetch<ReembolsoDlocalGo>("POST", "/v1/refunds", {
        payment_id: input.chargeRef,
        ...(input.amountMinor === undefined
          ? {}
          : { amount: aUnidadMayor(input.amountMinor, input.currency ?? "USD") }),
      });
    } catch (e) {
      if (!(e instanceof DlocalGoError)) throw e;
      // dLocal no publica un código para «ya reembolsado». El más cercano es un
      // 400 cuyo mensaje lo dice; se reconoce por texto y NO se asume: si el
      // mensaje cambia, esto cae a `rechazado`, que es el lado seguro (para la
      // cola de X-01 significa «que lo mire una persona», no «reintentar
      // eternamente»).
      if (/already\s+refunded|refunded\s+already/i.test(e.message)) {
        return { estado: "ya-reembolsado" };
      }
      return e.esTransitorio
        ? { estado: "transitorio", mensaje: e.message, causa: e }
        : { estado: "rechazado", mensaje: e.message, causa: e };
    }

    const moneda = (reembolso.currency ?? input.currency ?? "USD").toUpperCase();
    const comun = {
      refundId: reembolso.id,
      amountMinor:
        reembolso.amount !== undefined
          ? aUnidadMenor(reembolso.amount, moneda)
          : (input.amountMinor ?? 0),
      currency: moneda,
    };

    // ⚠️ `PENDING` NO ES «REEMBOLSADO», Y ESTA ES LA DIFERENCIA MÁS CARA CON
    // STRIPE. Stripe crea el reembolso ya en `succeeded` salvo excepción; dLocal
    // Go devuelve `PENDING` de serie y el dinero se mueve después. Darlo por
    // bueno marcaría la fila como `refunded` con el dinero todavía dentro, que
    // es exactamente la mentira que X-01 existe para no repetir (la BD daba por
    // devuelto lo que nadie había devuelto).
    //
    // Se clasifica como `no-completado`, que la cola trata como `failed` +
    // revisión humana. Es DEMASIADO severo para un `PENDING` sano y se sabe: lo
    // correcto sería un estado «en vuelo» que la cola reconsulte, y ese estado
    // no existe hoy en el puerto. Se deja severo a propósito —un reembolso que
    // se revisa de más es recuperable; uno dado por hecho, no— y se anota como
    // lo que es: una ficha pendiente, no un descuido.
    if (reembolso.status === "REJECTED" || reembolso.status === "CANCELLED") {
      return { estado: "no-completado", detalle: reembolso.status, ...comun };
    }
    if (reembolso.status === "PENDING") {
      return { estado: "no-completado", detalle: "PENDING", ...comun };
    }
    return { estado: "reembolsado", ...comun };
  },

  /**
   * DESAJUSTE 2 · EL WEBHOOK.
   *
   * ⚠️ ESTO NO VERIFICA UN EVENTO: VERIFICA UN PING. El cuerpo entero es
   * `{"payment_id":"DP-283"}` — sin tipo, sin id de evento, sin hora, sin
   * estado. Así que aquí solo se puede hacer una cosa honesta: comprobar la
   * firma y decir «me hablan de este cobro». QUÉ le ha pasado al cobro lo tiene
   * que preguntar el Route Handler a la API, porque el cuerpo no lo dice y
   * creérselo sería dejar que el remitente elija el estado.
   *
   * Por eso `verifyWebhook` devuelve `kind: 'otro'` y `ref: null` SIEMPRE, y el
   * evento útil lo compone `eventoDePago()` con la respuesta de
   * `GET /v1/payments/{id}`. Es una firma distinta a la del puerto en espíritu
   * —el de Stripe sale de aquí ya completo— pero la interfaz se respeta: el
   * puerto es síncrono y no puede llamar a la API.
   *
   * ⚠️ LA FIRMA NO CADUCA (no lleva timestamp ni nonce): una notificación
   * capturada se puede reproducir mañana y cuadrará. Lo que hace que eso sea
   * inofensivo es precisamente releer el estado y que `confirm_payment` sea
   * idempotente. No se puede "optimizar" fiándose del cuerpo.
   */
  verifyWebhook(input: WebhookInput): WebhookVerificacion {
    const esperada = firmarNotificacion(input.rawBody);
    if (!esperada) {
      return {
        ok: false,
        motivo: "sin-secreto",
        error: "dLocal Go no configurado (faltan DLOCALGO_API_KEY / DLOCALGO_SECRET_KEY)",
      };
    }
    const recibida = firmaDeCabecera(input.signature);
    if (!recibida) {
      return { ok: false, motivo: "sin-firma", error: "sin firma" };
    }
    if (!firmaCuadra(esperada, recibida)) {
      return { ok: false, motivo: "firma-invalida", error: "firma inválida" };
    }

    // ⚠️ Se parsea DESPUÉS de verificar, y sobre la misma cadena que se firmó.
    let paymentId: string | null = null;
    try {
      const cuerpo = JSON.parse(input.rawBody) as { payment_id?: string };
      paymentId = cuerpo.payment_id ?? null;
    } catch {
      paymentId = null;
    }
    if (!paymentId) {
      return { ok: false, motivo: "firma-invalida", error: "cuerpo sin payment_id" };
    }

    return {
      ok: true,
      evento: {
        // Provisional: identifica el PING, no el hecho. `eventoDePago()` lo
        // reemplaza por `dlocalgo:<id>:<status>` en cuanto se sabe el estado.
        id: `dlocalgo:${paymentId}:sin-consultar`,
        rawType: "notification",
        kind: "otro",
        ref: null,
        chargeRef: paymentId,
        objectRef: paymentId,
        amountMinor: null,
        currency: null,
      },
    };
  },
};

/**
 * La segunda mitad del webhook: preguntar a la API qué le pasó al cobro y
 * traducirlo al vocabulario del puerto.
 *
 * Vive aquí y no en el Route Handler porque es lo único que habla la lengua de
 * dLocal (nombres de estado incluidos), que es el invariante de todo el puerto:
 * para saber qué hay que reimplementar en un tercer PSP basta con abrir dos
 * ficheros.
 */
export async function eventoDePago(paymentId: string): Promise<{
  pago: PagoDlocalGo;
  evento: import("./port").WebhookEvent;
}> {
  const pago = await recuperarPago(paymentId);

  /**
   * ⚠️ LA CLAVE DE DEDUPLICACIÓN, y el porqué de que lleve el estado dentro.
   *
   * `confirm_payment` descarta un `event_id` ya visto para esa reserva. Con
   * Stripe cada entrega trae su `evt_…`. Aquí, si la clave fuese solo el
   * `payment_id`, la PRIMERA notificación del cobro ganaría y todas las demás
   * se descartarían para siempre — incluida la que de verdad importa. Con el
   * estado dentro, una reentrega del mismo hecho se descarta (que es lo que
   * queremos) y una transición real pasa.
   */
  const id = `dlocalgo:${pago.id}:${pago.status}`;

  /**
   * De su taxonomía a la nuestra.
   *
   * ⚠️ `REJECTED` NO ES `cobro-fallido`, y es el mismo criterio que hace que
   * `payment_intent.payment_failed` no lo sea en Stripe: una tarjeta rechazada
   * deja el cobro vivo y la persona reintenta con otra —el propio objeto lo
   * dice, `rejected_reason` se describe como «the reason for the LAST payment
   * attempt's rejection» y convive con `status: PENDING`—. Tratarlo como fallo
   * terminal le liberaría el horario a alguien que está a punto de pagar.
   *
   * Los terminales son `EXPIRED` y `CANCELLED`.
   */
  const kind: import("./port").WebhookEvent["kind"] =
    pago.status === "PAID"
      ? "cobro-confirmado"
      : pago.status === "EXPIRED" || pago.status === "CANCELLED"
        ? "cobro-fallido"
        : pago.status === "PENDING"
          ? "cobro-en-curso"
          : "otro";

  return {
    pago,
    evento: {
      id,
      rawType: `payment.${pago.status.toLowerCase()}`,
      kind,
      ref: refDeOrdenExterna(pago.order_id),
      // En dLocal el cargo y el cobro son EL MISMO objeto: no hay un `pi_`
      // aparte de la Session. `DP-…` es lo que se sella y lo que se reembolsa.
      chargeRef: pago.id,
      objectRef: pago.id,
      amountMinor: aUnidadMenor(pago.amount, pago.currency),
      currency: pago.currency?.toUpperCase() ?? null,
    },
  };
}
