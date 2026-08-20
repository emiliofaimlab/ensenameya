import "server-only";

/**
 * EL PUERTO DE PAGOS — el del Doc 6 §6.2, recortado a lo que el código hace.
 *
 * POR QUÉ EXISTE. MN-03 pide dLocal como pasarela de respaldo, y no hay cuenta
 * de dLocal: dLocal Go espera a que el sitio pase su revisión, que espera al
 * merge `dev`→`main`. Escribir el adaptador sin sandbox sería escribir código
 * que nadie puede ejecutar — el patrón que ya produjo `process_notifications()`
 * marcando correos como enviados sin enviar ninguno. Lo que sí se puede hacer
 * hoy, y es la mitad del coste, es dejar el hueco con la forma exacta y meter
 * a Stripe dentro. Esto NO cambia nada para nadie: mismas llamadas, mismos
 * parámetros, mismos importes.
 *
 * ── QUÉ SE QUITÓ DEL DOC 6, Y POR QUÉ ──────────────────────────────────────
 * El doc mete `payout()` en la misma interfaz. En este repo NO existe ni un
 * adaptador de payouts ni una sola llamada a un PSP para pagar al tutor:
 * `manage_payout` mueve estados dentro de Postgres y la dispara un admin a mano
 * desde `/admin/payouts`. Un método que nadie implementa es PEOR que no tener
 * puerto, porque el día que llegue dLocal alguien lo rellenará a ciegas
 * creyendo que hay un flujo detrás. Cuando exista el job de payouts, el método
 * entra con él y no antes. (CLAUDE.md: los Docs son el objetivo, el código
 * manda.)
 *
 * ── POR QUÉ DOS INTERFACES Y NO UNA ────────────────────────────────────────
 * Porque hay DOS proveedores hoy y solo uno es un PSP. El simulado
 * (`payment_routing_rules.charge_provider = 'simulated'`, `payments.provider`,
 * `confirm_simulated_payment`) no abre nada contra nadie: el propio navegador
 * cierra la reserva por RPC. No tiene reembolsos —el job los filtra por
 * `provider = 'stripe'`— ni webhook que firmar. Meterlo en una única interfaz
 * lo obligaría a implementar `refund` y `verifyWebhook` lanzando excepciones,
 * que es la versión disfrazada del método muerto de arriba.
 *
 * Así que: `PaymentProvider` es lo que TODO proveedor de cobro sabe hacer, y
 * `PspProvider` añade lo que solo sabe hacer quien de verdad mueve dinero. El
 * adaptador de dLocal, cuando haya sandbox, implementará `PspProvider` entero.
 */

/** Lo que el navegador necesita para montar el formulario alojado del PSP. */
export type ChargeEmbebido = {
  ok: true;
  /** El secreto de la sesión de pago. Es de un solo uso y de un solo cobro. */
  clientSecret: string;
  /**
   * La clave pública del proveedor. Es un Stripe-ismo hoy y se llama como en
   * el contrato de `StripeEmbed`, a propósito: inventarle un nombre neutro con
   * una sola implementación delante es adivinar. El día que dLocal necesite
   * otra cosa aquí, el nombre lo decidirá el segundo caso, no el primero.
   */
  publishableKey: string;
};

/** El proveedor respondió, pero sin lo que hace falta para cobrar. */
export type ChargeFallido = { ok: false; error: string };

export type ChargeResult = ChargeEmbebido | ChargeFallido;

/**
 * Lo que hace falta para abrir un cobro.
 *
 * ⚠️ `amountMinor` SIEMPRE viene de `payments.gross_amount` (regla de oro 2).
 * El puerto no calcula importes, no aplica políticas y no mira el navegador:
 * recibe el número que `create_booking` congeló y lo manda tal cual.
 */
export type ChargeInput = {
  bookingId: string;
  /** En unidades menores, como en la BD. */
  amountMinor: number;
  /** ISO-4217 tal como está en `payments.currency`. */
  currency: string;
  /** Lo que verá la persona como concepto del cobro. */
  concepto: string;
  /** El cliente ya dado de alta en el proveedor. */
  customerRef: string;
  /**
   * Cuándo caduca el cobro, en época Unix EN SEGUNDOS.
   *
   * Lo calcula quien llama y no el adaptador, y no es un descuido: ese valor
   * entra en la clave de idempotencia (X-02, ver `api/pagos/checkout`), así que
   * moverlo aquí dentro —para, por ejemplo, ajustarlo al mínimo legal de cada
   * proveedor— cambiaría la clave y rompería los checkouts ya abiertos.
   */
  expiresAt: number;
  /** PAC-02 · la casilla del alumno, que nace desmarcada. */
  guardarMedioDePago: boolean;
  /** Absoluta y con protocolo. */
  returnUrl: string;
  /** Un doble clic no puede abrir dos cobros para la misma reserva. */
  idempotencyKey: string;
};

/** Lo que hace falta para devolver dinero ya cobrado. */
export type RefundInput = {
  /** La referencia del cargo EN EL PROVEEDOR (`pi_…` en Stripe). */
  chargeRef: string;
  /** Parcial (RN-37 al 50 %, US-704). Sin él se devuelve el cargo entero. */
  amountMinor?: number;
  /** Va a la metadata del proveedor; sirve para conciliar, no para decidir. */
  metadata: Record<string, string>;
  idempotencyKey: string;
};

/**
 * Cómo acabó un reembolso, ya clasificado por el adaptador.
 *
 * La clasificación es del proveedor y por eso vive detrás del puerto: cada PSP
 * tiene su taxonomía de errores y quien llama no puede conocerlas todas. Lo que
 * sí es común —y es lo que decide si una fila de la cola se queda `pending` o
 * salta a `failed`— son estos cinco desenlaces. Marcar `failed` un 429 sería
 * quedarse con el dinero del alumno por un mal minuto del proveedor; dejar
 * `pending` un rechazo definitivo sería reintentarlo cada cinco minutos para
 * siempre.
 */
export type RefundResult =
  /** El dinero salió. */
  | { estado: "reembolsado"; refundId: string; amountMinor: number; currency: string }
  /**
   * El proveedor creó el reembolso y lo dejó sin completar (fondos retenidos,
   * cuenta sin saldo). Tiene referencia pero el dinero NO se movió.
   */
  | {
      estado: "no-completado";
      refundId: string;
      /** El estado tal como lo nombra el proveedor, para el log y la cola. */
      detalle: string;
      amountMinor: number;
      currency: string;
    }
  /** Ese cargo ya lo devolvió otra mano (el panel del PSP, otro camino nuestro). */
  | { estado: "ya-reembolsado" }
  /** Fue el momento, no la petición: se reintenta. */
  | { estado: "transitorio"; mensaje: string; causa: unknown }
  /** Fue la petición: repetirla dará el mismo error mañana. */
  | { estado: "rechazado"; mensaje: string; causa: unknown };

/**
 * Un evento de webhook ya verificado y traducido a nuestro vocabulario.
 *
 * La traducción es la mitad del trabajo que se ahorra el día del adaptador de
 * dLocal: la lógica del webhook (X-02, el cobro tardío, la idempotencia) no
 * tiene nada de Stripe dentro, solo el parseo lo tenía.
 */
export type WebhookEvent = {
  /**
   * El id del evento EN EL PROVEEDOR. Es la clave de deduplicación que come
   * `confirm_payment` (US-703), así que tiene que ser el del proveedor y no uno
   * nuestro.
   */
  id: string;
  /** El tipo tal cual lo manda el proveedor. Se conserva para el log y la respuesta. */
  rawType: string;
  /** El mismo evento, en vocabulario nuestro. */
  kind: "cobro-confirmado" | "cobro-en-curso" | "cobro-fallido" | "otro";
  /** La reserva a la que pertenece, si el evento la trae. */
  bookingId: string | null;
  /** La referencia del cargo (`pi_…`): la que traen los eventos de reembolso. */
  chargeRef: string | null;
  /** El id del objeto que disparó el evento. Solo para el log. */
  objectRef: string | null;
  /** Importe y moneda del objeto, para cuando el reembolso no los dé. */
  amountMinor: number | null;
  currency: string | null;
};

/** Por qué no se pudo verificar un webhook. Quien llama lo traduce a HTTP. */
export type WebhookRechazo =
  /** No hay secreto configurado: no se puede verificar NADA. */
  | { motivo: "sin-secreto"; error: string }
  /** La petición no trae firma. */
  | { motivo: "sin-firma"; error: string }
  /** Trae firma y no cuadra. */
  | { motivo: "firma-invalida"; error: string };

export type WebhookVerificacion =
  | { ok: true; evento: WebhookEvent }
  | ({ ok: false } & WebhookRechazo);

/**
 * ⚠️ EL CUERPO CRUDO, Y ES LA LÍNEA MÁS DELICADA DE ESTE ARCHIVO.
 *
 * `rawBody` es la CADENA EXACTA que llegó por la red — `await req.text()`,
 * nunca `req.json()`. La firma es un HMAC sobre esos bytes: `JSON.parse` +
 * `stringify` reordena claves y cambia espacios, y la firma deja de cuadrar.
 * Es el fallo clásico de este refactor y no avisa: el día que alguien cambie
 * este `string` por un objeto ya parseado, o la verificación empieza a fallar
 * siempre, o —peor— alguien la quita para «arreglarlo» y el webhook pasa a ser
 * un endpoint público capaz de marcar reservas como pagadas con un POST.
 * Que el tipo sea `string` es la barrera. No se toca. (RN-34)
 */
export type WebhookInput = { rawBody: string; signature: string | null };

/**
 * La identidad de un proveedor. Es todo lo que tienen en común los dos que hay
 * hoy, y a propósito: cualquier otro método aquí sería un método que el
 * simulado tendría que fingir.
 */
export interface PaymentProvider {
  /** `'stripe' | 'dlocal' | 'simulated' | …` — el mismo valor que `payments.provider`. */
  readonly key: string;
  /**
   * ¿Hay un PSP al otro lado?
   *
   * El checkout lo pregunta ANTES de dar de alta al Customer, y el orden
   * importa: al revés, el camino simulado empezaría a llamar a Stripe, que hoy
   * no lo hace. Es además el discriminante que estrecha a `PspProvider`, así
   * que preguntarlo no es un `if` suelto sino la puerta de entrada al resto de
   * la interfaz.
   */
  readonly opensRemoteCheckout: boolean;
}

/**
 * Un PSP de verdad: abre cobros fuera de casa, devuelve dinero y habla por
 * webhook firmado. Hoy solo Stripe. Mañana, dLocal, y sin tocar el flujo.
 */
export interface PspProvider extends PaymentProvider {
  readonly opensRemoteCheckout: true;
  /**
   * Qué credencial falta para ABRIR UN COBRO, o `null` si está listo. LA
   * CREDENCIAL ES EL INTERRUPTOR: ningún proveedor se cae al simulado por su
   * cuenta; se dice qué falta y se devuelve 503.
   *
   * ⚠️ Es la pregunta del COBRO, no la de «¿está configurado?». Cobrar puede
   * exigir más que devolver —en Stripe, la clave publicable del navegador— y
   * confundirlas dejaría la cola de reembolsos parada por una clave que no usa.
   * Para eso está `canRefund()`.
   */
  missingChargeConfig(): string | null;
  charge(input: ChargeInput): Promise<ChargeResult>;
  /** ¿Puede mover dinero de vuelta? Es menos exigente que cobrar: ver arriba. */
  canRefund(): boolean;
  refund(input: RefundInput): Promise<RefundResult>;
  /** El cuerpo crudo entra aquí. Lee arriba `WebhookInput` antes de tocarlo. */
  verifyWebhook(input: WebhookInput): WebhookVerificacion;
}

/** El que no sale de casa: hoy, el simulado. */
export interface LocalProvider extends PaymentProvider {
  readonly opensRemoteCheckout: false;
}

/**
 * Lo que devuelve el enrutador. Es una unión DISCRIMINADA por
 * `opensRemoteCheckout`, y eso no es cosmética: `if (!p.opensRemoteCheckout)`
 * estrecha el resto a `PspProvider` sin un solo cast, así que el compilador
 * impide llamar a `charge()` sobre algo que no cobra.
 */
export type AnyProvider = PspProvider | LocalProvider;
