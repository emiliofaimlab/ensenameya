import "server-only";

import type Stripe from "stripe";

import {
  actualizarCuentaDeDestinatario,
  adjuntarCuentaBancaria,
  crearCuentaDeDestinatario,
  crearTransferencia,
  isStripeConfigured,
  publishableKey,
  recuperarCuentaDeDestinatario,
  recuperarTransferencia,
  stripe,
  transferenciaPorMarca,
} from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { marcaDe } from "./port";
import {
  claveDeCuenta,
  cuerpoDeTransferencia,
  desenlaceDeTransferencia,
  estadoDeLaCuenta,
  parametrosDeCuenta,
  parametrosDeCuentaBancaria,
  parametrosDelTitular,
  veredictoDeFallo,
  yaTieneEstaCuenta,
  type BeneficiarioStripe,
} from "./stripe-payout-mapeo";
import type {
  ChargeInput,
  ChargeResult,
  CobroRef,
  PayoutInput,
  PayoutResult,
  PspProvider,
  RefundInput,
  RefundResult,
  WebhookEvent,
  WebhookInput,
  WebhookVerificacion,
} from "./port";

/**
 * EY-176 · CÓMO VIAJA EL SUJETO DEL COBRO DENTRO DE STRIPE, Y POR QUÉ ASÍ.
 *
 * `client_reference_id` es un campo de texto libre y hasta hoy llevaba el uuid
 * de la reserva pelado. Con los pedidos hay dos cosas que pueden ir ahí, y
 * confundirlas sería acreditar el dinero al sujeto equivocado.
 *
 * ⚠️ LA RESERVA SIGUE VIAJANDO PELADA, A PROPÓSITO. Solo el pedido lleva
 * prefijo (`order_<uuid>`). Así, cualquier Checkout Session que estuviera ya
 * ABIERTA cuando se despliega esto —creada con el formato viejo— se sigue
 * leyendo bien: sin prefijo = reserva, que es exactamente lo que era. Poner
 * `booking_` también habría sido más simétrico y habría dejado esas Sessions
 * sin sujeto reconocible durante las horas que viven.
 */
const PREFIJO_PEDIDO = "order_";

/** Lo que se escribe en `client_reference_id`. */
function referenciaExterna(ref: CobroRef): string {
  return ref.tipo === "order" ? `${PREFIJO_PEDIDO}${ref.id}` : ref.id;
}

/**
 * La copia en metadata. La de la Session NO baja al PaymentIntent, y los
 * eventos de reembolso y disputa solo traen el PaymentIntent: sin esta segunda
 * copia no habría forma de mapear un reembolso a lo que pagó.
 *
 * Se usan claves DISTINTAS (`booking_id` / `order_id`) en vez de una genérica
 * para que un evento viejo y uno nuevo no se puedan malinterpretar entre sí, y
 * para que el panel de Stripe siga siendo legible por una persona.
 */
function metadatosDeRef(ref: CobroRef): Record<string, string> {
  return ref.tipo === "order" ? { order_id: ref.id } : { booking_id: ref.id };
}

/** El camino de vuelta: de lo que trae el evento, a nuestro vocabulario. */
function refDeSesion(sesion: Stripe.Checkout.Session): CobroRef | null {
  const externa = sesion.client_reference_id ?? null;
  if (externa?.startsWith(PREFIJO_PEDIDO)) {
    return { tipo: "order", id: externa.slice(PREFIJO_PEDIDO.length) };
  }
  // La metadata se mira ANTES de caer al `client_reference_id` pelado: los
  // eventos que no son de Session no traen ese campo, y ahí la metadata es lo
  // único que hay.
  const pedido = sesion.metadata?.order_id;
  if (pedido) return { tipo: "order", id: pedido };

  const reserva = externa ?? sesion.metadata?.booking_id ?? null;
  return reserva ? { tipo: "booking", id: reserva } : null;
}

/**
 * EL ADAPTADOR DE STRIPE — el único que hoy mueve dinero.
 *
 * Aquí dentro vive TODO lo que habla la lengua de Stripe en el flujo de cobro:
 * los parámetros de la Checkout Session, la taxonomía de errores de reembolso y
 * el parseo del webhook. Fuera de este archivo (y de `lib/stripe.ts`, que es el
 * cliente del SDK y la caja fuerte de tarjetas) nadie debería importar `stripe`.
 * Ese es el invariante que hace barato el adaptador de dLocal: para saber qué
 * hay que reimplementar basta con abrir dos ficheros.
 *
 * Lo que este archivo NO hace, y es deliberado: no decide políticas. Ni la
 * caducidad de la Session (X-02, se calcula desde la reserva porque entra en la
 * clave de idempotencia), ni el importe (sale de `payments.gross_amount`, regla
 * de oro 2), ni si una reserva merece cobro. Recibe y ejecuta.
 */

/**
 * ¿Stripe dice que ese cargo ya estaba devuelto?
 *
 * X-02 · el webhook reembolsa los cobros que llegan cuando la reserva ya no
 * espera pago. Ese cargo puede haberlo devuelto ya otra mano: alguien desde el
 * panel de Stripe, o el reembolso de plataforma (RN-37 / X-01). Cuando pasa, la
 * API responde 400 con `charge_already_refunded` — y si no se reconoce, el
 * webhook devolvería 500 y Stripe reintentaría el mismo evento durante tres
 * días contra una operación que nunca va a poder completarse.
 *
 * No es lo mismo que la idempotencia: la `idempotencyKey` cubre que NOSOTROS
 * pidamos dos veces el mismo reembolso; esto cubre que lo pidiera otro.
 */
function esCargoYaReembolsado(e: unknown): boolean {
  const err = e as { type?: string; code?: string };
  return (
    err?.type === "StripeInvalidRequestError" &&
    err?.code === "charge_already_refunded"
  );
}

/**
 * ¿El fallo fue del momento o del contenido de la petición?
 *
 * X-01 lo necesita para decidir algo que no tiene vuelta atrás: si una fila de
 * la cola de reembolsos se queda `pending` (y se reintenta en la pasada
 * siguiente) o se marca `failed` (y se queda ahí hasta que una persona la
 * mire). Marcar `failed` un 429 de Stripe sería quedarse con el dinero del
 * alumno por un mal minuto del proveedor; dejar `pending` un
 * `charge_already_refunded` sería reintentar cada cinco minutos para siempre.
 *
 * Los tres de aquí son los que Stripe documenta como reintentables y ninguno
 * dice nada de lo que pedimos: la red se cayó, su API tuvo un problema, o
 * fuimos demasiado rápido. Todo lo demás —`StripeInvalidRequestError` sobre
 * todo— es la petición, y repetirla dará el mismo error mañana.
 *
 * ⚠️ `StripeIdempotencyError` NO entra: significa que reusamos una clave de
 * idempotencia con parámetros distintos, o sea que algo cambió el importe de
 * una fila ya intentada. Reintentar eso a ciegas es justo lo que no se debe
 * hacer con dinero — que salte a `failed` y lo mire alguien.
 */
function esFalloTransitorio(e: unknown): boolean {
  const tipo = (e as { type?: string })?.type;
  return (
    tipo === "StripeConnectionError" ||
    tipo === "StripeAPIError" ||
    tipo === "StripeRateLimitError"
  );
}

/** Lo que se puede contar de un error sin filtrar nada del beneficiario. */
function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : "error desconocido";
}

/**
 * Las frases de `payout_beneficiary_stripe` que significan «este tutor todavía no
 * puede cobrar por aquí», no «esta orden está muerta».
 *
 * ⚠️ SON LAS DE *ESA* FUNCIÓN Y NO LAS DE OTRA. Copiar el regex de Wise o de
 * PayPal no casaría con ninguna, todas caerían en `rechazado`, y `rechazado`
 * escribe 'failed' y manda NTF-16 a un tutor cuyo único pecado es no haber puesto
 * su fecha de nacimiento — que es un campo OPCIONAL del formulario justamente
 * porque sin él se sigue cobrando por dLocal, Wise o PayPal.
 *
 * Lo que NO entra aquí, a propósito: «no existe el payout» y «el payout está en X
 * y no se puede ejecutar». Esas dos no las arregla nadie rellenando nada.
 */
const FRASES_SIN_DATOS =
  /no tiene cuenta bancaria registrada|no hay reglas de cobro para|falta la fecha de nacimiento del titular|no ha aceptado las condiciones/i;

/**
 * El `pi_…` del evento. Llega como id en los eventos de Session, pero puede
 * venir expandido si algún día se pide con `expand`; y en una Session expirada
 * (nadie pagó) no viene en absoluto.
 */
function idDePaymentIntent(sesion: Stripe.Checkout.Session): string | null {
  const pi = sesion.payment_intent;
  if (typeof pi === "string") return pi;
  return pi?.id ?? null;
}

/**
 * De la taxonomía de Stripe a la nuestra.
 *
 * ⚠️ `payment_intent.payment_failed` NO es `cobro-fallido` y por eso no aparece
 * aquí: una tarjeta rechazada deja la Session abierta y el alumno reintenta con
 * otra. Si lo tratáramos como fallo terminal le habríamos liberado el horario a
 * alguien que estaba a punto de pagar. Los únicos fallos terminales son
 * `expired` y `async_payment_failed`. (Y es también la respuesta a la pregunta
 * de la minuta sobre «si Stripe falla»: reintentar un rechazo en otro PSP es
 * reintentar un rechazo.)
 */
function traducirTipo(
  tipo: string,
  sesion: Stripe.Checkout.Session,
): WebhookEvent["kind"] {
  switch (tipo) {
    // `payment_status` importa: con métodos diferidos la Session se completa
    // ANTES de que el dinero exista.
    case "checkout.session.completed":
      return sesion.payment_status === "unpaid" ? "cobro-en-curso" : "cobro-confirmado";
    // Métodos no instantáneos (transferencia, débito bancario): el dinero llega
    // días después de que la Session se completara.
    case "checkout.session.async_payment_succeeded":
      return "cobro-confirmado";
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return "cobro-fallido";
    default:
      return "otro";
  }
}

export const stripeProvider: PspProvider = {
  key: "stripe",
  opensRemoteCheckout: true,

  /**
   * El embed necesita LAS DOS claves: la secreta para crear la Session y la
   * publicable para que el navegador monte el iframe. Sin la publicable el
   * formulario no aparecería y el alumno se quedaría mirando un hueco, así que
   * se dice cuál falta en vez de caer al simulado — caer al simulado aquí sería
   * regalar mentorías (mismo criterio que Daily).
   *
   * Ojo: `isStripeConfigured()` sigue mirando SOLO la secreta y se usa donde
   * basta con ella (listar y borrar tarjetas, el job de reembolsos). Acoplarlas
   * dejaría esas pantallas sin funcionar por una clave que no usan.
   */
  missingChargeConfig() {
    if (!isStripeConfigured()) return "Stripe no configurado (falta STRIPE_API_KEY)";
    if (!publishableKey()) {
      return "Stripe no configurado (falta STRIPE_PUBLISHABLE_KEY)";
    }
    return null;
  },

  /**
   * Devolver dinero solo necesita la clave secreta. Sin ella la cola de
   * reembolsos NO se toca: las filas siguen `pending` y salen enteras en la
   * primera pasada con Stripe encendido. Marcarlas de cualquier otra forma
   * sería inventarse que el dinero se movió.
   */
  canRefund: isStripeConfigured,

  /**
   * ⚠️ AQUÍ PONÍA QUE STRIPE NO PODÍA PAGAR «Y NO ES CUESTIÓN DE CREDENCIALES»,
   * porque Connect exigía un KYC bloqueado. Esa premisa era de agosto y ya no se
   * sostiene: la cuenta de Stripe está operativa en sandbox y producción, y lo
   * único que este riel necesita de nosotros es la misma `STRIPE_API_KEY` — la
   * misma que cobra y la misma que reembolsa.
   *
   * Y desde el 10-sep-2026 tampoco hace falta nada POR TUTOR antes de pagar: la
   * cuenta de destinatario la crea `payout()` con los datos que el tutor teclea en
   * nuestro formulario. Si le faltan la fecha de nacimiento o la aceptación —los
   * dos campos opcionales—, lo dice `payout()` con `sin-datos`, que deja la fila
   * quieta y contada en vez de parar el lote entero por una persona.
   */
  missingPayoutConfig() {
    return isStripeConfigured() ? null : "falta STRIPE_API_KEY";
  },

  /**
   * ── EL PAYOUT · STRIPE VUELVE, Y EL TUTOR NO LO VE ──────────────────────
   *
   * 🔑 LA DIFERENCIA CON LO QUE SE BORRÓ EL 9-SEP NO ES EL CÓDIGO, ES QUIÉN DA
   * DE ALTA LA CUENTA. Aquí vivían ~130 líneas que resolvían la cuenta conectada
   * del tutor con `destino_connect`: el tutor se daba de alta EN Stripe, veía su
   * marca y les entregaba a ELLOS sus coordenadas. Eso no vuelve, y su
   * `destino_connect` no se usa.
   *
   * Lo que vuelve —decisión D-1, **aprobada por el cliente el 10-sep-2026**— es
   * otra cosa: **la cuenta la creamos nosotros** con los datos que el tutor
   * teclea en NUESTRO formulario. En su historial pone «Transferencia bancaria»,
   * igual que dLocal y que Wise, y el nombre de Stripe no aparece en ningún sitio.
   *
   * ── LA RECETA SON TRES LLAMADAS Y UNA TRANSFERENCIA ─────────────────────
   *
   *   1. `POST /v1/accounts`                        — cuenta de destinatario
   *   2. `POST /v1/accounts/{id}`                   — titular + aceptación
   *   3. `POST /v1/accounts/{id}/external_accounts` — su cuenta bancaria
   *   4. `POST /v1/transfers`                       — el dinero
   *
   * Verificada de punta a punta contra *test mode* el 10-sep-2026 en España
   * (`transfers: active`, `payouts_enabled: true`, `currently_due: []`, y una
   * transferencia creada) y país por país en catorce sitios más.
   *
   * 🔑 Y LO QUE PIDE CADA PAÍS ES DISTINTO, ASÍ QUE NO HAY MAPA POR PAÍS. España
   * y México no piden nada más; Colombia y Chile piden `individual.id_number`;
   * Panamá pide `address.line1` y `.city`; seis países exigen `routing_number` en
   * la cuenta bancaria. Se manda TODO lo que devuelve la RPC y **quien decide qué
   * falta es Stripe**, en `requirements.currently_due`. Un mapa nuestro sería una
   * segunda lista de países que mantener sincronizada con la suya, que es el
   * error que este proyecto ya pagó con `wise_account_type`.
   *
   * ⚠️ COLOMBIA Y CHILE NO SE PUEDEN PAGAR TODAVÍA, y no por el código: sus
   * cuentas bancarias exigen `account_type` y `payout_beneficiary_stripe` no lo
   * devuelve. El desenlace es `sin-datos` —la orden espera y baja al siguiente
   * candidato, que es Wise, que sí les llega— y se arregla con una migración, no
   * aquí. Está escrito en `stripe-payout-mapeo.ts` con la medición al lado.
   *
   * ⚠️ US Y BR NO SE PUEDEN CREAR, y no es un fallo: nuestra plataforma es
   * estadounidense y el acuerdo `recipient` no vale de US a US/BR (mensaje
   * literal de la API). El veredicto es `sin-datos`, la orden sigue viva y la
   * paga Wise, que es el único riel que llega a los dos.
   *
   * ⚠️ Y SOLO SIRVE SI EL COBRO ENTRÓ POR STRIPE. `ataduraDeBalance` es `true`
   * para este riel (`lib/payments.ts`) y la puerta del balance del job descarta
   * la orden antes de llegar aquí si el dinero está en el balance de otro. No es
   * una limitación de este archivo: una transferencia sale del saldo de Stripe, y
   * a Stripe no le consta lo que cobró dLocal.
   *
   * ── POR QUÉ NO HAY BARRIDO DE PÁGINAS ──────────────────────────────────
   *
   * Porque esta API sí tiene idempotencia. La marca (`EY-<payout>-<intento>`,
   * la de `port.marcaDe`) viaja como `Idempotency-Key` Y como `transfer_group`:
   *
   *   · crear dos veces devuelve la MISMA transferencia, no dos (medido);
   *   · y si la clave caducó (24 h), `transferenciaPorMarca` la encuentra en una
   *     sola llamada con un filtro exacto, y una lista vacía DEMUESTRA que no se
   *     creó nada — medido: `transfer_group` inexistente → `[]`, `has_more:false`.
   *
   * Eso es lo que permite devolver `sin-rastro` —la única salida que autoriza a
   * mandar el pago otra vez— con una prueba y no con una corazonada. El adaptador
   * de dLocal Go necesita 300 líneas para esto mismo porque su API no ofrece ni
   * una de las dos cosas.
   */
  async payout(input: PayoutInput): Promise<PayoutResult> {
    // LA MARCA, de `port.marcaDe` y no de una copia local: es la misma cadena que
    // dLocal escribe en `description` y PayPal en `sender_batch_id`, y tener dos
    // definiciones de ella sería tener dos formas de no encontrar un pago.
    const marca = marcaDe(input.payoutId, input.intento);

    /**
     * 🔴 EL BARRIDO. Es lo que separa «no se creó nada» de «no lo sé», y esa
     * diferencia es la que autoriza a volver a mandar un pago.
     *
     * `dudaReal` dice si en este camino PUDO crearse una transferencia sin que
     * nos enterásemos. Cuando no pudo —solo se estaba consultando—, un fallo del
     * barrido es `transitorio` y la orden vuelve a la cola intacta; cuando sí
     * pudo, es `en-duda` y la fila se queda quieta hasta que la mire una persona.
     * Confundirlos es elegir pagar dos veces o congelar dinero.
     */
    const barrer = async (dudaReal: boolean): Promise<PayoutResult> => {
      try {
        const tr = await transferenciaPorMarca(marca);
        if (tr) return desenlaceDeTransferencia(tr, true);
        return {
          estado: "sin-rastro",
          mensaje: `no hay ninguna transferencia con transfer_group ${marca}`,
        };
      } catch (e) {
        if (veredictoDeFallo(e) === "sin-credencial") {
          return { estado: "sin-credencial", mensaje: mensajeDe(e), pudoCrear: dudaReal };
        }
        if (!dudaReal) return { estado: "transitorio", mensaje: mensajeDe(e), causa: e };
        return {
          estado: "en-duda",
          mensaje: `falló el barrido que comprobaba si ${marca} llegó a crearse: ${mensajeDe(e)}`,
          causa: e,
        };
      }
    };

    // ── Camino 1 · la orden ya tiene identidad ──────────────────────────────
    // Se pregunta por ella y se sigue su estado. Consultar no crea nada, así que
    // cualquier fallo del momento devuelve la fila a la cola intacta.
    if (input.providerPayoutId) {
      try {
        const tr = await recuperarTransferencia(input.providerPayoutId);
        return desenlaceDeTransferencia(tr, false);
      } catch (e) {
        const v = veredictoDeFallo(e);
        if (v === "sin-credencial") {
          return { estado: "sin-credencial", mensaje: mensajeDe(e), pudoCrear: false };
        }
        if (v !== "no-existe") {
          return { estado: "transitorio", mensaje: mensajeDe(e), causa: e };
        }
        // ⚠️ EL `tr_…` ANOTADO NO EXISTE EN STRIPE. Pasa de verdad: se borran los
        // datos de prueba del sandbox, se cambia de cuenta. NO se da por perdido
        // —eso mandaría el pago otra vez sin prueba— sino que se barre por la
        // marca, que es lo único que puede demostrar algo. Si el barrido no
        // encuentra nada, `sin-rastro` limpia el identificador fantasma y la
        // orden vuelve a la cola. Mismo criterio que `esCustomerInexistente`.
      }
      return await barrer(false);
    }

    // ── Camino 2 · se reclamó antes y no sabemos si llegó a crearse ─────────
    //
    // 🔴 AQUÍ NO SE CREA NADA. Una pasada anterior ganó esta fila y pudo llegar a
    // llamar a Stripe. Reintentar la creación sería elegir pagar dos veces; lo
    // único honesto es buscar la marca y adoptar lo que haya.
    if (input.reanudar) return await barrer(true);

    // ── Camino 3 · crear ────────────────────────────────────────────────────
    const admin = createAdminClient();

    // ⚠️ QUIÉN ES EL TUTOR HACE FALTA ANTES QUE NADA, y por dos motivos: su
    // cuenta de destinatario se REUSA entre liquidaciones (vive en
    // `tutor_profiles.stripe_connect_account_id`) y la clave de idempotencia de
    // la creación va por tutor, no por payout.
    const { data: orden, error: eOrden } = await admin
      .from("payouts")
      .select("tutor_id")
      .eq("id", input.payoutId)
      .maybeSingle();
    if (eOrden || !orden?.tutor_id) {
      // No se ha llamado a nadie. `transitorio` y no `rechazado`: si esto falla,
      // falla para todas las órdenes y el problema es nuestro, no de la orden.
      return {
        estado: "transitorio",
        mensaje: `no se pudo leer el tutor del payout: ${eOrden?.message ?? "la fila no está"}`,
        causa: eOrden,
      };
    }
    const tutorId = orden.tutor_id;

    // ⚠️ EL BENEFICIARIO NO SALE DE AQUÍ. Se pide a `payout_beneficiary_stripe`,
    // viaja al cuerpo de las llamadas y ahí muere: no se devuelve, no se registra
    // y no entra en ningún mensaje de error. Un número de cuenta en un log es PII
    // en un log.
    const { data: benef, error: eBenef } = await admin.rpc("payout_beneficiary_stripe", {
      p_payout_id: input.payoutId,
    });

    if (eBenef) {
      // ⚠️ REGLA DE ORO 9 DISFRAZADA DE PROBLEMA DEL TUTOR. Un 42501 aquí no es
      // «este tutor no rellenó el formulario»: es que a `service_role` le falta el
      // `execute` y NINGUNA orden se va a pagar. Confundirlos dejaría la cola
      // entera parada con un mensaje que culpa a los tutores.
      const esPermiso =
        (eBenef as { code?: string }).code === "42501" ||
        /permission denied|not allowed/i.test(eBenef.message);
      if (esPermiso) {
        return {
          estado: "transitorio",
          mensaje: `payout_beneficiary_stripe no es ejecutable por service_role (regla de oro 9): ${eBenef.message}`,
          causa: eBenef,
        };
      }
      if (FRASES_SIN_DATOS.test(eBenef.message)) {
        return { estado: "sin-datos", mensaje: eBenef.message };
      }
      return { estado: "rechazado", mensaje: eBenef.message, causa: eBenef };
    }

    const b = benef as unknown as BeneficiarioStripe;

    // 🔑 LOS DOS CUERPOS SE MONTAN **ANTES** DE LLAMAR A STRIPE, y el orden
    // importa: si con lo que el tutor tiene registrado no se puede describir ni el
    // titular ni la cuenta bancaria, no tiene ningún sentido haber creado una
    // cuenta de destinatario que se quedaría vacía para siempre en el panel.
    const titular = parametrosDelTitular(b, Math.floor(Date.now() / 1000));
    if ("motivo" in titular) return { estado: "sin-datos", mensaje: titular.motivo };
    const banco = parametrosDeCuentaBancaria(b);
    if ("motivo" in banco) return { estado: "sin-datos", mensaje: banco.motivo };

    /**
     * Deja la cuenta de destinatario del tutor lista para recibir, o dice por qué
     * no. Devuelve la cuenta, o el desenlace que le corresponde a la orden.
     *
     * ⚠️ EL DESTINO SALE SIEMPRE DE `cuenta.id` Y NO DE UNA VARIABLE APARTE. Con
     * tres ramas —reusar la guardada, crear una nueva, reemplazar una fantasma—
     * un identificador que se va reasignando es la forma de transferir al
     * `acct_…` de otro momento. Aquí el objeto y su id son la misma cosa.
     */
    const asegurarCuenta = async (): Promise<{ cuenta: Stripe.Account } | PayoutResult> => {
      try {
        const { data: perfil, error: ePerfil } = await admin
          .from("tutor_profiles")
          .select("stripe_connect_account_id")
          .eq("profile_id", tutorId)
          .maybeSingle();
        if (ePerfil) {
          return {
            estado: "transitorio",
            mensaje: `no se pudo leer la cuenta de destinatario del tutor (¿grant de columna?): ${ePerfil.message}`,
            causa: ePerfil,
          };
        }

        const guardada = perfil?.stripe_connect_account_id ?? null;
        let previa: Stripe.Account | null = null;
        if (guardada) {
          try {
            previa = await recuperarCuentaDeDestinatario(guardada);
          } catch (e) {
            if (veredictoDeFallo(e) !== "no-existe") throw e;
            // La cuenta guardada ya no existe (sandbox borrado, cuenta eliminada
            // a mano). Sin esta rama ese tutor no volvería a cobrar NUNCA por
            // este riel: cada pasada preguntaría por un `acct_…` fantasma. Es el
            // mismo criterio que `esCustomerInexistente` con las fichas de
            // cliente, y por la misma razón: el id que guardamos lo reusamos a
            // ciegas en cada pasada.
            console.warn(
              "[C2] la cuenta de destinatario guardada no existe en Stripe: se crea otra",
              { payout: input.payoutId, cuentaFantasma: guardada },
            );
          }
        }

        let cuenta: Stripe.Account;
        if (previa) {
          cuenta = previa;
        } else {
          cuenta = await crearCuentaDeDestinatario(
            parametrosDeCuenta(b, tutorId),
            claveDeCuenta(tutorId),
          );

          // 🔴 SE ANOTA ANTES DE SEGUIR. Si esto no cuaja, la cuenta existe en
          // Stripe y esta base no lo sabe: la clave de idempotencia la
          // reencuentra durante 24 h, pero pasado ese plazo se crearía una
          // segunda. No es dinero, así que se para aquí con `transitorio` y se
          // deja dicho en el log CON el `acct_…` dentro, que es lo que permite
          // arreglarlo a mano.
          const { error: eGuardar } = await admin
            .from("tutor_profiles")
            .update({ stripe_connect_account_id: cuenta.id })
            .eq("profile_id", tutorId);
          if (eGuardar) {
            console.error("[C2] 🔴 cuenta de destinatario creada y NO anotada", {
              payout: input.payoutId,
              tutor: tutorId,
              cuenta: cuenta.id,
              error: eGuardar.message,
            });
            return {
              estado: "transitorio",
              mensaje: `se creó la cuenta ${cuenta.id} y no se pudo anotar: ${eGuardar.message}`,
              causa: eGuardar,
            };
          }
        }

        // ── ¿Puede recibir ya? ─────────────────────────────────────────────
        let estado = estadoDeLaCuenta(cuenta);
        if (!estado.lista) {
          // Los datos del titular se remandan tal cual: es un `update` con los
          // mismos valores, o sea idempotente, y es lo que arregla al tutor que
          // completó su fecha de nacimiento después de que la cuenta existiera.
          cuenta = await actualizarCuentaDeDestinatario(cuenta.id, titular.params);

          // ⚠️ LA CUENTA BANCARIA **SOLO SI NO ESTÁ YA**. `POST
          // …/external_accounts` no es idempotente: llamarlo otra vez adjunta
          // una segunda copia del mismo IBAN.
          if (!yaTieneEstaCuenta(cuenta, b)) {
            await adjuntarCuentaBancaria(cuenta.id, banco.params);
            // Se relee: `payouts_enabled` cambia al adjuntar la cuenta y el
            // objeto que teníamos es de antes de adjuntarla.
            cuenta = await recuperarCuentaDeDestinatario(cuenta.id);
          }
          estado = estadoDeLaCuenta(cuenta);
        }

        if (!estado.lista) {
          // 🔴 NO SE TRANSFIERE A UNA CUENTA QUE NO PUEDE SACAR EL DINERO AL
          // BANCO. Medido: sin cuenta bancaria adjunta, `transfers` llega a
          // `active` con `payouts_enabled: false`. Transferir ahí escribiría
          // 'paid' y mandaría NTF-12 «Se pagó tu liquidación» con el dinero
          // atrapado en un saldo que el tutor no ve y del que no puede sacarlo.
          //
          // Y las dos salidas NO son la misma: lo que falta un dato lo arregla el
          // tutor en el formulario (`sin-datos`), y lo que está en revisión lo
          // arregla el tiempo (`transitorio`).
          return estado.enRevision
            ? { estado: "transitorio", mensaje: estado.motivo, causa: null }
            : { estado: "sin-datos", mensaje: estado.motivo };
        }

        return { cuenta };
      } catch (e) {
        const v = veredictoDeFallo(e);
        if (v === "sin-credencial") {
          // Nada de esto crea una transferencia, así que la orden vuelve intacta.
          return { estado: "sin-credencial", mensaje: mensajeDe(e), pudoCrear: false };
        }
        // `sin-datos` es el camino de US y BR (el acuerdo `recipient` no vale de
        // una plataforma estadounidense) y también el de un dato del tutor que
        // Stripe valida y rechaza —un código postal español de seis cifras, un
        // `routing_number` que falta—. La orden espera y baja al siguiente
        // candidato; no muere.
        if (v === "sin-datos") return { estado: "sin-datos", mensaje: mensajeDe(e) };
        // ⚠️ `no-existe` AQUÍ NO PUEDE SER `rechazado`, que escribiría 'failed' y
        // mandaría NTF-16. Significa que la cuenta desapareció entre dos llamadas
        // —el `retrieve` que la vio y el `update` que ya no—, y eso se arregla
        // solo: la pasada siguiente entra por la rama de la cuenta fantasma y crea
        // otra. Sin esta línea, borrar una cuenta a mano en el panel enterraría la
        // liquidación de ese tutor.
        if (v === "transitorio" || v === "no-existe") {
          return { estado: "transitorio", mensaje: mensajeDe(e), causa: e };
        }
        return { estado: "rechazado", mensaje: mensajeDe(e), causa: e };
      }
    };

    const resuelta = await asegurarCuenta();
    // `estado` lo lleva todo desenlace del puerto y no lo lleva la cuenta: es la
    // misma clase de unión discriminada que el resto del módulo.
    if ("estado" in resuelta) return resuelta;
    const cuenta = resuelta.cuenta;

    // ── La transferencia ────────────────────────────────────────────────────
    try {
      const tr = await crearTransferencia(
        cuerpoDeTransferencia({
          marca,
          amountMinor: input.amountMinor,
          // La moneda del SALDO (`payouts.currency`), no la del tutor: una
          // transferencia mueve dinero dentro de Stripe. Convertir a su moneda es
          // cosa del payout que la cuenta conectada hace a su banco.
          currency: input.currency,
          destino: cuenta.id,
        }),
      );
      return desenlaceDeTransferencia(tr, false);
    } catch (e) {
      const v = veredictoDeFallo(e);
      if (v === "sin-credencial") {
        // ⚠️ `pudoCrear: true`: la credencial pudo caerse DESPUÉS del POST, y en
        // ese caso la duda es real. La fila no se toca.
        return { estado: "sin-credencial", mensaje: mensajeDe(e), pudoCrear: true };
      }
      if (v === "sin-fondos") {
        // No es un fallo permanente: es dinero que se debe y que saldrá cuando
        // operaciones retire el saldo de Stripe. Marcarlo 'failed' sería
        // enterrarlo.
        return { estado: "sin-fondos", mensaje: mensajeDe(e) };
      }
      if (v === "no-existe") {
        // El destino desapareció entre el `retrieve` y el `POST`. Se arregla solo
        // en la pasada siguiente, que crea otra cuenta y la reanota.
        return {
          estado: "transitorio",
          mensaje: `la cuenta de destinatario ${cuenta.id} no existe al transferir: ${mensajeDe(e)}`,
          causa: e,
        };
      }
      if (v === "transitorio") {
        // ⚠️ AQUÍ NO SE PUEDE DEVOLVER LA ORDEN A LA COLA A CIEGAS: un timeout
        // puede dejar una transferencia creada que nadie ha anotado, y la clave de
        // idempotencia solo la protege 24 h. Por eso se barre ANTES de rendirse:
        // `barrer(true)` adopta lo que haya y solo devuelve `sin-rastro` cuando ha
        // demostrado que no hay nada.
        return await barrer(true);
      }
      return { estado: "rechazado", mensaje: mensajeDe(e), causa: e };
    }
  },

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        customer: input.customerRef,
        client_reference_id: referenciaExterna(input.ref),
        // X-02 · en segundos Unix, no en milisegundos: Stripe cuenta épocas en
        // segundos y pasarle `Date.now()` a secas daría un año del 57000 que
        // rebota con "no puede ser más de 24 horas". El razonamiento del valor
        // está en `api/pagos/checkout`, que es quien lo calcula.
        expires_at: input.expiresAt,
        // Solo tarjeta. Por defecto Stripe ofrece los métodos activos de la
        // cuenta y salían Cash App Pay, Amazon Pay y Klarna: irrelevantes para
        // Latinoamérica y ruido en una pantalla que se quiere simple. Fijarlo
        // aquí también apaga los métodos que se activen mañana en el panel sin
        // que nadie lo revise. Los locales (C-13) entran por aquí cuando se
        // decida el mercado.
        //
        // ⚠️ **PAYPAL NO CABE AQUÍ, Y NO ES CUESTIÓN DE ACTIVARLO** (V-7,
        // comprobado el 26-ago-2026). PayPal por Stripe exige que la CUENTA
        // DEL COMERCIO esté en uno de 30 países europeos; la nuestra es
        // `country: US` —`Ensename Ya, LLC`, Florida, el mismo dato del §39
        // que valida dLocal—, así que Stripe no se lo ofrece. La prueba no es
        // el 400 de la API, que es genérico: en
        // `/v1/payment_method_configurations` del sandbox aparecen 43 métodos
        // marcados on/off y `paypal` **no figura en absoluto**. Está ausente,
        // no apagado.
        //
        // La vía que sí existe es el *PayPal custom payment method*: adaptador
        // alojado por nosotros, acceso en preview bajo petición y comisión de
        // Stripe ADEMÁS de la de PayPal, a negociar. O sea una épica con parte
        // comercial, no dos líneas. Si algún día se aprueba, entra por aquí.
        payment_method_types: ["card"],
        // M-01 · La app presupuesta y confirma «45,00 US$» en tres pantallas y la
        // pasarela cobraba «PAB 46,80», un 4 % más, con un tipo de 1,0400. El
        // balboa está anclado 1:1 al dólar desde 1904: ese tipo no es una
        // conversión, es el margen del *adaptive pricing* de Stripe, que convierte
        // por geolocalización sin avisar. El alumno ve un precio durante toda la
        // compra y otro justo donde pone la tarjeta.
        //
        // Se apaga AQUÍ y no en el panel a propósito: en el panel se pierde el día
        // que se cree otra cuenta o se pase de sandbox a live, y el fallo vuelve
        // sin que nadie lo note. El importe y la moneda vienen del puerto, que los
        // sacó de `payments`, así que una sola moneda de punta a punta.
        adaptive_pricing: { enabled: false },
        // EY-176 · UNA LÍNEA POR MENTORÍA, y el total es su suma. Es la mitad
        // de «un cobro con varias líneas dentro» (P-3): un solo PaymentIntent,
        // un solo cargo en la tarjeta, y el desglose viaja dentro.
        //
        // ⚠️ Con `ui_mode: 'form'` el alumno NO ve estas líneas —Stripe pinta
        // solo los campos de la tarjeta—, así que el desglose que se lee es el
        // nuestro. Estas sirven para el importe, para el recibo de Stripe y
        // para que el panel del PSP diga qué se vendió; ponerlas bien es lo que
        // hace conciliable un cargo de tres mentorías.
        //
        // Para una reserva suelta esto produce EXACTAMENTE el mismo objeto que
        // antes del refactor: una línea, mismo importe, mismo nombre.
        line_items: input.lineas.map((l) => ({
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: l.amountMinor,
            product_data: { name: l.concepto },
          },
          quantity: 1,
        })),
        // La metadata de la Session NO baja al PaymentIntent, y los eventos de
        // reembolso y disputa solo traen el PaymentIntent. Sin esta segunda copia
        // no habría forma de mapear un reembolso a su reserva (o a su pedido).
        metadata: metadatosDeRef(input.ref),
        // ── PAC-02 · GUARDAR LA TARJETA, Y POR QUÉ LA CASILLA CAMBIÓ DE DUEÑO ──
        //
        // `allow_redisplay_filters` es lo que hace que la pasarela OFREZCA las
        // tarjetas ya guardadas: sin él pide una nueva cada vez y la pantalla
        // de "Métodos de pago" no sirve de nada. `limited` es como se marca lo
        // guardado dentro de un cobro; `always`, lo guardado desde otro sitio
        // (el alta desde el perfil lo fuerza — ver `lib/stripe.ts`).
        //
        // `payment_method_save: 'enabled'` es NUEVO y es la mitad de D-3
        // (§20.14): es Stripe quien pinta ahora la casilla de «guardar esta
        // tarjeta», dentro de su formulario y con su texto en español (sale del
        // `locale` de más abajo). Hasta hoy la pintábamos nosotros antes de
        // montar el iframe y se traducía en `setup_future_usage`, que se fija AL
        // CREAR esta Session; con el formulario montado ya al llegar al
        // checkout, la Session existe antes de que nadie marque nada, así que
        // esa casilla no podía llegar a tiempo. Este parámetro mueve el
        // consentimiento al momento de confirmar, que es donde corresponde.
        //
        // ⚠️ NO SE PONEN LOS DOS. `setup_future_usage` guarda la tarjeta sin
        // preguntar; la casilla pregunta. Juntos, la casilla queda de adorno:
        // se guarda igual la marque o no. Y no esperes que la API te avise:
        // comprobado contra *test mode* el 20-ago-2026 —Session `cs_test_a1htHL…`
        // creada con `payment_method_save=enabled` Y
        // `payment_intent_data[setup_future_usage]=on_session` a la vez, sin un
        // solo error—. Va uno u otro, y el que decide es este fichero.
        //
        // ⚠️ TODO ESTE BLOQUE EXIGE `customer` EN LA SESSION — no es nuevo de
        // `payment_method_save`, ya lo exigía el filtro. Sin Customer la API
        // responde, literal y comprobado contra *test mode* el 20-ago-2026:
        // «`saved_payment_method_options` requires a customer. You can attach a
        // customer and set this option together later via the update
        // endpoint.» Lo hay siempre porque
        // `api/pagos/checkout` pasa por `ensureCustomer` antes de llamar aquí;
        // el día que alguien abra un cobro sin dar de alta al cliente, esto
        // revienta con un 400 y no con un cobro a medias.
        //
        // Lo que Stripe pone cuando la persona MARCA la casilla es su propio
        // `setup_future_usage` (`off_session`), más permisivo que el
        // `on_session` que poníamos nosotros. Cambia cómo se autentica la
        // tarjeta —pide 3DS ahora para no pedirlo en un cargo futuro— y NO lo
        // que hacemos con ella: no existe un solo camino que cobre fuera de una
        // Session con la persona delante. Es el mismo trato que ya se aceptó en
        // el alta de tarjeta desde el perfil, y por el mismo motivo: la
        // alternativa es bajar a SetupIntent + Elements y mantener un segundo
        // formulario de pago.
        saved_payment_method_options: {
          allow_redisplay_filters: ["always", "limited"],
          payment_method_save: "enabled",
        },
        payment_intent_data: {
          metadata: metadatosDeRef(input.ref),
          // SIN `setup_future_usage`: lee el bloque de arriba antes de añadirlo.
        },
        // MN-01 · `form`, no `embedded_page`. Los dos montan el formulario DENTRO
        // de nuestra pantalla en vez de mandar a checkout.stripe.com (reunión
        // 7-ago) y los dos siguen siendo un iframe de Stripe, así que el PAN no
        // toca nuestro DOM y el proyecto se queda en PCI-DSS SAQ A. La
        // diferencia es qué pinta Stripe dentro: con `embedded_page` pintaba su
        // pantalla entera —incluido SU resumen del pedido, duplicando el
        // nuestro— y su interior no se podía reestilizar (los tipos del SDK no
        // exponen `appearance` ni `layout` en ese modo). Con `form` pinta solo
        // el formulario de pago, que es exactamente lo que pidió el cliente:
        // «solo queremos los inputs de la tarjeta […] y no todo ese contenido
        // de Stripe».
        //
        // ⚠️ ESTA CADENA NO LA VALIDA EL TYPECHECK. La unión de `ui_mode` en el
        // SDK acaba en `OtherString`, así que traga cualquier cosa y el error
        // sale como un 400 de la API en tiempo de ejecución. Ya mordió una vez
        // (`embedded` vs `embedded_page`). Los cuatro valores buenos de hoy son
        // `hosted_page`, `embedded_page`, `elements` y `form`: si tocas esto,
        // ejercítalo contra *test mode* antes de creerte que compila.
        ui_mode: "form",
        // MN-02 · el titular de la tarjeta. Va también en el alta de tarjeta
        // desde el perfil (`lib/stripe.ts`), porque el cliente pidió las dos.
        //
        // ⚠️ **REQUERIDO desde V-4a (24-ago), y antes era opcional.** El 20-ago
        // el cliente lo pidió opcional (P-5) y el 24 pidió lo contrario. Es
        // marcha atrás deliberada, no un descuido: si lo vuelves a poner en
        // `true` «porque estorba al alumno», estás deshaciendo la decisión.
        //
        // Lo que NO se puede hacer es la otra mitad de V-4: el literal. El
        // cliente pidió que dijera «Titular de la tarjeta» y la etiqueta la
        // escribe Stripe dentro de su iframe — `NameCollection.Individual`
        // solo tiene `enabled` y `optional`, y `custom_text` no cubre este
        // campo. Con `locale: 'es'` sale «Nombre completo»; el «(opcional)»
        // que lo acompañaba lo pintaba Stripe a partir de este parámetro y
        // desaparece solo al ponerlo en `false`.
        //
        // ⚠️ Cambiar esto es cambiar los parámetros de la Session → sube
        // `VERSION_PARAMS` en `api/pagos/checkout` (ya subido a v4).
        // Comprobado contra *test mode* el 26-ago: la API lo acepta y lo
        // devuelve en la Session.
        name_collection: { individual: { enabled: true, optional: false } },
        // Sin esto Stripe rotula el formulario según el navegador y en un sitio
        // en español salía "Payment method" / "Save my information". Con el
        // checkout alojado se notaba menos porque era otra página; embebido,
        // media pantalla quedaba en otro idioma.
        locale: "es",
        // Fuera del checkout alojado NO existe `success_url` ni `cancel_url`: hay
        // un único `return_url` al que Stripe lleva ya pagado. Cancelar es no
        // rellenar el formulario, así que no hay a dónde volver. Sigue viviendo
        // en la Session y no en la llamada del navegador: es la confirmación de
        // ESTA reserva y no tiene por qué viajar por el cliente.
        return_url: input.returnUrl,
      },
      // Un doble clic o un reintento de red no debe abrir dos cobros para la
      // misma reserva. La compone quien llama: ver `api/pagos/checkout`.
      { idempotencyKey: input.idempotencyKey },
    );

    if (!session.client_secret) {
      // ⚠️ `en-duda` y no 'nada': llegar aquí significa que la Session SÍ se
      // creó —la respuesta trae el objeto— y lo que falta es el secreto con el
      // que montarla. Hay un cobro vivo en Stripe, así que la cadena no puede
      // probar otro proveedor.
      return {
        ok: false,
        error: "Stripe no devolvió client_secret",
        creado: "en-duda",
      };
    }
    // La publicable viaja con la respuesta en vez de por `NEXT_PUBLIC_*`: así el
    // interruptor de Stripe sigue siendo UNA sola cosa (las claves del servidor) y
    // no hay que acordarse de una variante pública en Vercel. Es pública por
    // diseño —solo permite crear tokens—, así que no roza la regla de oro 3.
    // El `?? ""` no llega a pasar, pero la garantía la pone EL LLAMADOR, no el
    // adaptador: `api/pagos/checkout` invoca `missingChargeConfig()` antes de
    // llamar aquí y corta con 503 si falta cualquiera de las dos claves. Quien
    // escriba el adaptador de dLocal tiene que saber que ese contrato es del
    // puerto y no de la implementación: si su ruta no llama a
    // `missingChargeConfig()`, este `?? ""` deja de ser inalcanzable.
    return {
      ok: true,
      // A2 · el discriminante. Stripe monta el formulario DENTRO de nuestra
      // pantalla; dLocal Go manda a la suya. Sin este campo, el navegador
      // distinguía los dos casos por la forma del objeto y trataba «no hay
      // clientSecret» como «camino simulado» — ver `respuesta-de-cobro.ts`.
      modo: "embebido",
      clientSecret: session.client_secret,
      publishableKey: publishableKey() ?? "",
    };
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    let reembolso: Stripe.Refund;
    try {
      reembolso = await stripe().refunds.create(
        {
          payment_intent: input.chargeRef,
          // ⚠️ PARCIAL cuando quien llama lo pide. RN-37 devuelve el 50 % si el
          // alumno cancela tarde y el admin puede devolver el trozo que quiera
          // (US-704). El importe llega de fuera —copiado de `payments` al
          // encolar— y NUNCA se calcula aquí: dos sitios calculando el mismo
          // porcentaje son dos sitios que pueden discrepar (regla de oro 2).
          // Sin importe se devuelve el cargo entero, que es lo que pide X-02.
          ...(input.amountMinor === undefined ? {} : { amount: input.amountMinor }),
          // La taxonomía de Stripe solo admite 'duplicate' | 'fraudulent' |
          // 'requested_by_customer'. Es el tercero SIEMPRE, también cuando
          // cancela el tutor, cuando vence el plazo o cuando el cobro llegó
          // tarde: 'fraudulent' metería la tarjeta y el correo del alumno en las
          // listas de bloqueo de Radar por una cancelación normal, o por un
          // fallo nuestro.
          reason: "requested_by_customer",
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );
    } catch (e) {
      if (esCargoYaReembolsado(e)) return { estado: "ya-reembolsado" };
      const mensaje = e instanceof Error ? e.message : "error desconocido";
      // `causa` viaja para que quien llama pueda relanzar EL ERROR ORIGINAL en
      // vez de uno nuestro: el webhook lo hace, y así el log sigue diciendo lo
      // que dijo siempre.
      return esFalloTransitorio(e)
        ? { estado: "transitorio", mensaje, causa: e }
        : { estado: "rechazado", mensaje, causa: e };
    }

    const comun = {
      refundId: reembolso.id,
      amountMinor: reembolso.amount,
      currency: reembolso.currency,
    };
    // Stripe puede responder con el reembolso ya rechazado (fondos retenidos,
    // cuenta del comercio sin saldo). Tiene `re_…` pero el dinero NO se movió:
    // darlo por bueno sería mentir en la única tabla que dice que se devolvió.
    if (reembolso.status === "failed" || reembolso.status === "canceled") {
      return { estado: "no-completado", detalle: reembolso.status, ...comun };
    }
    return { estado: "reembolsado", ...comun };
  },

  verifyWebhook(input: WebhookInput): WebhookVerificacion {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    // Sin secreto no se procesa NADA. Aceptar sin verificar sería dejar que
    // cualquiera marque reservas como pagadas con un POST.
    if (!secret) {
      return {
        ok: false,
        motivo: "sin-secreto",
        error: "STRIPE_WEBHOOK_SECRET no configurada",
      };
    }
    if (!input.signature) {
      return { ok: false, motivo: "sin-firma", error: "sin firma" };
    }

    let evento: Stripe.Event;
    try {
      // ⚠️ `input.rawBody` es la cadena EXACTA del cuerpo. Ver `WebhookInput`
      // en `port.ts` antes de tocar esta línea.
      evento = stripe().webhooks.constructEvent(input.rawBody, input.signature, secret);
    } catch (e) {
      return {
        ok: false,
        motivo: "firma-invalida",
        error: `firma inválida: ${e instanceof Error ? e.message : "?"}`,
      };
    }

    // El objeto del evento. El cast es el de siempre y es deliberado: los
    // eventos que nos interesan son todos de Checkout Session, y de los demás
    // solo se leen campos que cualquier objeto de Stripe puede tener o no
    // (`metadata`) — acaban en `kind: 'otro'` y se ignoran igual.
    const sesion = evento.data.object as Stripe.Checkout.Session;

    return {
      ok: true,
      evento: {
        id: evento.id,
        rawType: evento.type,
        kind: traducirTipo(evento.type, sesion),
        // El sujeto del cobro viaja en `client_reference_id` y, por si acaso,
        // en metadata. Se comprueban los dos: el primero solo existe en los
        // eventos de Session. Ver `refDeSesion` para el formato.
        ref: refDeSesion(sesion),
        chargeRef: idDePaymentIntent(sesion),
        objectRef: sesion.id ?? null,
        amountMinor: sesion.amount_total ?? null,
        currency: sesion.currency ?? null,
      },
    };
  },
};
