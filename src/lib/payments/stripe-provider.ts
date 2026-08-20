import "server-only";

import type Stripe from "stripe";

import { isStripeConfigured, publishableKey, stripe } from "@/lib/stripe";
import type {
  ChargeInput,
  ChargeResult,
  PspProvider,
  RefundInput,
  RefundResult,
  WebhookEvent,
  WebhookInput,
  WebhookVerificacion,
} from "./port";

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

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        customer: input.customerRef,
        client_reference_id: input.bookingId,
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
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountMinor,
              product_data: { name: input.concepto },
            },
            quantity: 1,
          },
        ],
        // La metadata de la Session NO baja al PaymentIntent, y los eventos de
        // reembolso y disputa solo traen el PaymentIntent. Sin esta segunda copia
        // no habría forma de mapear un reembolso a su reserva.
        metadata: { booking_id: input.bookingId },
        // Sin esto la pasarela NO ofrece las tarjetas ya guardadas: pide una
        // nueva cada vez y la pantalla de "Métodos de pago" no sirve de nada.
        // Comprobado abriendo cuatro sesiones y mirándolas: el filtro es lo único
        // que hace falta —`payment_method_save` no, y añadirlo metería una
        // segunda casilla de guardado, la de Stripe, encima de la nuestra—.
        // `limited` es como `setup_future_usage` marca lo que guarda; `always`
        // por si algún día se guarda desde otro sitio.
        saved_payment_method_options: {
          allow_redisplay_filters: ["always", "limited"],
        },
        payment_intent_data: {
          metadata: { booking_id: input.bookingId },
          // PAC-02 · solo si la persona marcó la casilla, que nace DESMARCADA.
          // `on_session` y no `off_session` a propósito: el permiso que pedimos
          // es reutilizar la tarjeta con ella delante, en su próxima reserva —
          // no cobrarle cuando no está. Es el permiso menor de los dos y es el
          // que corresponde a lo que dice la casilla.
          ...(input.guardarMedioDePago
            ? { setup_future_usage: "on_session" as const }
            : {}),
        },
        // Embedded Checkout: el formulario de tarjeta se monta DENTRO de nuestra
        // pantalla (reunión 7-ago) en vez de mandar a checkout.stripe.com. Sigue
        // siendo un iframe de Stripe, así que el PAN no toca nuestro DOM y el
        // proyecto se queda en PCI-DSS SAQ A — que era la razón de no dibujar
        // campos propios.
        // `embedded_page`, NO `embedded`: en la versión de API que tenemos fijada
        // el valor se renombró y la vieja devuelve 400. El typecheck no lo pilla
        // porque la unión del SDK acaba en `OtherString`, que traga cualquier
        // cadena — esto solo se ve llamando a la API de verdad.
        ui_mode: "embedded_page",
        // Sin esto Stripe rotula el formulario según el navegador y en un sitio
        // en español salía "Payment method" / "Save my information". Con el
        // checkout alojado se notaba menos porque era otra página; embebido,
        // media pantalla quedaba en otro idioma.
        locale: "es",
        // Con el checkout embebido NO existe `success_url` ni `cancel_url`: hay
        // un único `return_url` al que Stripe lleva ya pagado. Cancelar es no
        // rellenar el formulario, así que no hay a dónde volver.
        return_url: input.returnUrl,
      },
      // Un doble clic o un reintento de red no debe abrir dos cobros para la
      // misma reserva. La compone quien llama: ver `api/pagos/checkout`.
      { idempotencyKey: input.idempotencyKey },
    );

    if (!session.client_secret) {
      return { ok: false, error: "Stripe no devolvió client_secret" };
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
        // El booking viaja en `client_reference_id` y, por si acaso, en
        // metadata. Se comprueban los dos: el primero solo existe en los
        // eventos de Session.
        bookingId: sesion.client_reference_id ?? sesion.metadata?.booking_id ?? null,
        chargeRef: idDePaymentIntent(sesion),
        objectRef: sesion.id ?? null,
        amountMinor: sesion.amount_total ?? null,
        currency: sesion.currency ?? null,
      },
    };
  },
};
