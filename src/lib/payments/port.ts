import "server-only";

/**
 * EL PUERTO DE PAGOS — el del Doc 6 §6.2, recortado a lo que el código hace.
 *
 * POR QUÉ EXISTE. MN-03 pide dLocal como pasarela de respaldo. Este hueco se
 * dejó con la forma exacta y con Stripe dentro, para que el segundo proveedor
 * costara la mitad. Ya hay segundo proveedor: `dlocal-provider.ts`.
 *
 * ⚠️ AQUÍ ESTUVO ESCRITO, Y ERA FALSO: «no hay cuenta de dLocal: dLocal Go
 * espera a que el sitio pase su revisión, que espera al merge dev→main». El
 * alta del sandbox de dLocal Go es LIBRE —se registra un email y da claves al
 * momento— y la revisión comercial solo bloquea producción, exactamente igual
 * que el KYC de Stripe solo bloquea *live mode*. Desde el 1-sep-2026 hay cuenta
 * y las claves están en `.env.local`.
 *
 * Se deja escrito porque es el MISMO error que costó tres meses con Stripe: dar
 * por bloqueado un sandbox por un trámite que solo afecta a producción, y no
 * volver a comprobarlo. Lo que sí sigue rechazado es la cuenta de PRODUCCIÓN de
 * dLocal (ver CLAUDE.md, «dos webs de la misma marca sin conectar»), que es otra
 * cosa y no impide escribir ni probar nada.
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

/**
 * ⚠️ HAY DOS FORMAS DE COBRAR Y NO SE PARECEN EN NADA — el desajuste nº 1 con
 * dLocal Go, y el que obligó a ensanchar este tipo.
 *
 * Stripe devuelve un `client_secret` con el que NOSOTROS montamos su formulario
 * DENTRO de nuestra pantalla (MN-01, `ui_mode: 'form'`). dLocal Go devuelve una
 * `redirect_url` a su propio checkout alojado y la persona SE VA de nuestro
 * sitio. No es una diferencia de nombres: es que en un caso el alumno nunca
 * sale y en el otro sí.
 *
 * ── ¿Y SmartFields, que sí sería embebido? NO ESTÁ DISPONIBLE ───────────────
 * dLocal Go tiene un checkout transparente (SmartFields) que daría la forma
 * embebida, pero exige `allow_transparent: true` en la cuenta, que lo activa su
 * soporte a petición. Comprobado contra el sandbox el 1-sep-2026: un
 * `POST /v1/payments` con `"direct": true` devuelve **200 con `"direct": false`**
 * — no da error, simplemente ignora la petición y sirve el checkout alojado de
 * siempre. O sea que no es cuestión de mandar otro parámetro: hasta que soporte
 * lo habilite, la redirección es el ÚNICO camino, y por eso el tipo se ensancha
 * en vez de forzar a dLocal a fingir un `clientSecret` que no existe.
 *
 * `modo` es el discriminante. Es obligatorio en las dos variantes a propósito:
 * sin él, un `if (salida.clientSecret)` en el navegador trata la redirección
 * como "no hay cobro" y cae al camino simulado — que es exactamente el fallo
 * silencioso que este proyecto ya conoce (ver `simulated-provider.ts`).
 */

/** Lo que el navegador necesita para montar el formulario alojado del PSP. */
export type ChargeEmbebido = {
  ok: true;
  modo: "embebido";
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

/**
 * El cobro vive FUERA: hay que mandar a la persona a la URL del proveedor.
 *
 * ⚠️ `providerRef` NO es decorativo y NO es lo mismo que en Stripe. Es el
 * `DP-…` del cobro, y quien llama tiene que sellarlo en
 * `payments.provider_payment_id` ANTES de mandar a nadie a pagar. Con Stripe
 * ese sello lo pone el webhook al volver; aquí no se puede esperar, porque es
 * lo ÚNICO que permite reencontrar este cobro si la persona recarga la pantalla:
 * `GET /v1/payments` no lista los cobros PENDING y no hay búsqueda por
 * `order_id` (comprobado contra el sandbox, 1-sep-2026). Sin el sello, cada
 * recarga abriría un cobro nuevo.
 */
export type ChargeRedirigido = {
  ok: true;
  modo: "redireccion";
  /** Absoluta. Caduca a las 24 h y deja de servir en cuanto se paga. */
  redirectUrl: string;
  /** La referencia del cobro EN EL PROVEEDOR. Sellar antes de redirigir. */
  providerRef: string;
};

/** El proveedor respondió, pero sin lo que hace falta para cobrar. */
export type ChargeFallido = { ok: false; error: string };

export type ChargeResult = ChargeEmbebido | ChargeRedirigido | ChargeFallido;

/**
 * EY-176 · A QUÉ APUNTA UN COBRO.
 *
 * Hasta la ficha del carrito solo había una respuesta posible —una reserva— y
 * por eso el puerto llevaba un `bookingId: string` pelado. Con el pedido hay
 * dos, y la diferencia NO es cosmética: de ella depende a quién se acredita el
 * dinero cuando vuelve el webhook. Un `string` con dos significados posibles es
 * como se acaba confirmando una reserva con el id de un pedido.
 *
 * Va como unión discriminada y no como dos campos opcionales para que el
 * compilador obligue a decidir: no existe un cobro sin sujeto ni uno con los
 * dos.
 */
export type CobroRef =
  | { tipo: "booking"; id: string }
  | { tipo: "order"; id: string };

/**
 * Una línea del cobro: qué se compra y cuánto cuesta ESA parte.
 *
 * ⚠️ `amountMinor` SIEMPRE viene de `payments.gross_amount` (regla de oro 2),
 * y con un pedido eso es una fila de `payments` POR LÍNEA — el snapshot que
 * `create_booking_line` congeló para cada mentoría. El puerto no suma, no
 * prorratea y no mira el navegador.
 */
export type LineaDeCobro = {
  /** Lo que verá la persona como concepto de esta línea. */
  concepto: string;
  /** En unidades menores, como en la BD. */
  amountMinor: number;
};

/**
 * Lo que hace falta para abrir un cobro.
 *
 * ⚠️ NO HAY UN `amountMinor` TOTAL, Y ES DELIBERADO. El total del cargo es la
 * suma de `lineas` y de nada más. Llevar además un total aparte serían dos
 * fuentes de verdad para el importe de un cobro, que es justo la clase de
 * redundancia que la regla de oro 2 existe para evitar: el día que discreparan,
 * una de las dos sería la que cobra y la otra la que se enseña.
 *
 * ⚠️ AQUÍ HABÍA UN `guardarMedioDePago: boolean`, LA CASILLA DE PAC-02, Y NO
 * VUELVE (D-3 del §20.14). Se traducía en `setup_future_usage`, un parámetro
 * que se fija AL CREAR la sesión de pago; desde que el formulario se monta al
 * llegar al checkout, la sesión ya existe cuando el alumno decidiría marcarla,
 * así que el dato llegaría tarde POR DEFINICIÓN. El consentimiento lo recoge
 * ahora el formulario del propio proveedor —en Stripe,
 * `saved_payment_method_options.payment_method_save`— o sea en el momento de
 * confirmar, que es donde tiene que estar.
 *
 * Quien lo devuelva a este tipo que sepa lo que arrastra: reaparecerían DOS
 * casillas de guardado para la misma cosa (la nuestra y la del proveedor) y la
 * clave de idempotencia dejaría de ser determinista por reserva.
 */
export type ChargeInput = {
  /** La reserva suelta o el pedido que se está cobrando. */
  ref: CobroRef;
  /**
   * Las líneas del cobro, en el orden en que se enseñan. Una para una reserva
   * suelta; N para un pedido. Nunca vacía.
   */
  lineas: LineaDeCobro[];
  /**
   * ISO-4217 tal como está en `payments.currency`. Una sola para todo el cobro:
   * `create_order` se niega a mezclar monedas en un pedido, porque sumarlas
   * sería inventarse un tipo de cambio.
   */
  currency: string;
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
  /** Absoluta y con protocolo. */
  returnUrl: string;
  /**
   * A dónde debe avisar el proveedor cuando el cobro cambie de estado.
   *
   * ⚠️ ES POR COBRO, NO POR CUENTA, y ahí está la diferencia entre los dos PSP.
   * En Stripe el webhook se configura UNA vez en su panel y vale para todo; en
   * dLocal Go viaja en cada `POST /v1/payments` (`notification_url`) y **si no
   * se manda, no hay notificación en absoluto** — el cobro se pagaría y nadie
   * se enteraría nunca. Por eso lo aporta quien llama (que es quien sabe la URL
   * base del entorno) y no el adaptador.
   *
   * Stripe lo ignora, a propósito: es el precio de que el puerto tenga una sola
   * forma. Un campo que un proveedor no usa es más barato que dos interfaces.
   */
  notificationUrl: string;
  /**
   * Un doble clic no puede abrir dos cobros para la misma reserva.
   *
   * ⚠️ CON dLocal NO ES UNA CABECERA, ES EL `order_id` — desajuste nº 4. Su API
   * no tiene `Idempotency-Key`; lo más parecido es que `order_id` sea único, y
   * repetirlo NO devuelve el cobro anterior: devuelve `5009 Order id is
   * duplicated`, un 400 seco (comprobado contra el sandbox, 1-sep-2026). Así
   * que la garantía que este campo promete —"llamar dos veces con la misma
   * clave da el mismo cobro"— la tiene que EMULAR el adaptador. Ver
   * `dlocal-provider.ts`.
   *
   * Que siga siendo determinista por reserva es, por tanto, más importante aún
   * que con Stripe: con Stripe una clave que cambia abre una Session de más
   * (inofensivo); con dLocal, un `order_id` que cambia abre un COBRO de más.
   */
  idempotencyKey: string;
  /**
   * ISO-3166-1 alfa-2 del PAGADOR, si se sabe (`payments.payer_country`).
   *
   * Opcional porque en este proyecto es nullable de verdad, y porque dLocal Go
   * lo admite ausente: comprobado contra el sandbox el 1-sep-2026, un
   * `POST /v1/payments` sin `country` devuelve 200 y su checkout le pregunta el
   * país a la persona. Stripe lo ignora — deduce el país del medio de pago.
   *
   * Mandarlo cuando se sabe es mejor: ahorra un paso y acota los métodos de
   * pago locales que se ofrecen.
   */
  payerCountry?: string | null;
};

/** Lo que hace falta para devolver dinero ya cobrado. */
export type RefundInput = {
  /** La referencia del cargo EN EL PROVEEDOR (`pi_…` en Stripe). */
  chargeRef: string;
  /** Parcial (RN-37 al 50 %, US-704). Sin él se devuelve el cargo entero. */
  amountMinor?: number;
  /**
   * ISO-4217 del importe de arriba, tal como está en `payments.currency`.
   *
   * ⚠️ HACE FALTA AUNQUE STRIPE NO LA USE, y no es un campo de adorno: Stripe
   * habla en unidades menores igual que nosotros, pero dLocal Go habla en
   * unidades MAYORES, así que su adaptador tiene que dividir — y cuánto dividir
   * depende de la moneda. El peso chileno y el guaraní no tienen céntimos.
   * Reembolsar 5000 CLP dividiendo por 100 devolvería 50 pesos en vez de 5000.
   *
   * Opcional para no romper a quien ya llamaba sin ella; el adaptador de dLocal
   * asume USD si falta, que es la moneda real de este proyecto hoy.
   */
  currency?: string;
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
   * La clave de deduplicación que come `confirm_payment` (US-703).
   *
   * ⚠️ AQUÍ DECÍA «el id del evento EN EL PROVEEDOR […] tiene que ser el del
   * proveedor y no uno nuestro», Y CON dLocal ESO ES IMPOSIBLE — desajuste nº 2.
   *
   * Stripe manda un evento con identidad propia (`evt_…`, con tipo y hora).
   * dLocal Go manda un PING: el cuerpo entero es `{"payment_id":"DP-283"}`. No
   * hay id de evento, ni tipo, ni timestamp, ni el estado que lo disparó. Dos
   * notificaciones distintas del mismo cobro —"pagado" y, más tarde,
   * "reembolsado"— llegan con EL MISMO cuerpo, byte a byte.
   *
   * Así que lo que se exige de este campo ya no es su procedencia sino su
   * COMPORTAMIENTO, que es lo que de verdad importaba: **el mismo hecho tiene
   * que producir la misma clave, y dos hechos distintos, claves distintas.** El
   * adaptador de dLocal lo cumple sintetizándola como
   * `dlocalgo:<payment_id>:<status>` con el estado que devuelve
   * `GET /v1/payments/{id}` — no el del cuerpo, que no lo trae. Reentrega del
   * mismo estado → misma clave → `confirm_payment` la descarta; transición real
   * → clave nueva → se procesa.
   *
   * Quien escriba un tercer adaptador: la pregunta no es "¿qué id manda?", es
   * "¿qué cadena identifica este hecho de forma estable?".
   */
  id: string;
  /** El tipo tal cual lo manda el proveedor. Se conserva para el log y la respuesta. */
  rawType: string;
  /** El mismo evento, en vocabulario nuestro. */
  kind: "cobro-confirmado" | "cobro-en-curso" | "cobro-fallido" | "otro";
  /**
   * A qué apunta el cobro —una reserva suelta o un pedido—, si el evento lo
   * trae. Es lo que decide si el webhook acredita UNA línea o TODAS: ver
   * `confirm_order_payment` y el porqué en
   * `20260827160000_ey176_webhook_confirma_todas_las_lineas.sql`.
   */
  ref: CobroRef | null;
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
