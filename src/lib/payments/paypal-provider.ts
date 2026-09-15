import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { marcaDe } from "./port";
import {
  PaypalError,
  aDecimal,
  aMenor,
  desenlace,
  enlaceDePago,
  eventoDeWebhook,
  loteDuplicadoSinEnlace,
  loteYaExistente,
  ordenDeCobro,
  receptorDe,
  type BeneficiarioPaypal,
  type EventoPaypal,
  type LotePaypal,
  type OrdenPaypal,
} from "./paypal-mapeo";
import type {
  ChargeInput,
  ChargeResult,
  PayoutInput,
  PayoutResult,
  PspProvider,
  RefundInput,
  RefundResult,
  WebhookInput,
  WebhookVerificacion,
} from "./port";

/**
 * PAYPAL — PAGA AL TUTOR Y, DESDE EL 15-SEP-2026, TAMBIÉN COBRA AL ALUMNO.
 *
 * ⚠️ AQUÍ PONÍA «RIEL DE PAYOUT, Y SOLO DE PAYOUT», y eso ya es falso. Lo que lo
 * cambió es una petición del cliente —que el checkout ofrezca un radio entre
 * tarjeta y PayPal— y una comprobación: la cuenta cobra con las claves que ya
 * estaban puestas, sin pedirle nada a PayPal. Ver el bloque del cobro en
 * `paypal-mapeo.ts` para lo que se midió.
 *
 * ── QUÉ SE MIDIÓ ANTES DE ESCRIBIR ESTO (sandbox, 3-sep-2026) ──────────────
 *
 * Ni una línea de aquí es de la documentación sola. Todo lo que decide la forma
 * del adaptador se llamó primero:
 *
 *   · `POST /v1/oauth2/token` → 200, token de 32.400 s, 29 scopes, `payouts`
 *     entre ellos. App `APP-95E44123S48102351`.
 *   · `POST /v1/payments/payouts` → **201**, `batch_status: PENDING`, y al
 *     consultarlo `PROCESSING` con su `payout_item_id`.
 *   · El MISMO `sender_batch_id` otra vez → **400** `USER_BUSINESS_ERROR`,
 *     `issue: "Batch with given sender_batch_id already exists"`, y en `link` la
 *     URL del lote que ya existía.
 *
 * ── 🔑 POR QUÉ ESTE ADAPTADOR ES UN TERCIO DEL DE dLOCAL ───────────────────
 *
 * Por ese último punto. dLocal Go **no** deduplica, así que su adaptador carga
 * con un barrido de huérfanos —páginas de `GET /v1/payouts` buscando nuestra
 * marca— para el caso de «un 400 puede haber creado el payout igual».
 *
 * Aquí ese caso no existe. `sender_batch_id` ES la clave de idempotencia:
 *
 *   · si la creación cuajó y no nos enteramos, repetirla devuelve 400 CON EL
 *     ENLACE del lote. Eso no es un error, es la respuesta que buscábamos.
 *   · si no cuajó, repetirla crea el lote. Una vez.
 *
 * O sea que reintentar es la operación de recuperación, y no hace falta buscar
 * nada. **No se escribe barrido.** El día que PayPal deje de deduplicar habrá
 * que escribirlo, y se notará: el 400 dejará de traer `link`.
 *
 * ponytail: sin barrido, sin caché de páginas, sin cotejo por parecido. El techo
 * es que dependemos de que ese 400 traiga el enlace; si un día no lo trae, el
 * adaptador devuelve `en-duda` en vez de adoptar, que es el fallo seguro.
 *
 * ── EL CICLO COMPLETO, QUE AQUÍ TIENE UN PASO DE MÁS ───────────────────────
 *
 * 🔑 APROBAR NO ES PAGAR. Con `intent: CAPTURE` PayPal autoriza y el dinero
 * sigue siendo del alumno hasta que el comercio captura, así que un cobro pasa
 * por TRES momentos y no dos:
 *
 *   `charge()` → el alumno aprueba → `CHECKOUT.ORDER.APPROVED`
 *              → `capturarOrden()` → `PAYMENT.CAPTURE.COMPLETED` → acreditado
 *
 * Ese orden es el fallo seguro: si algo se rompe entre medias, NO se cobró nada
 * y el hold de la reserva caduca solo. Lo contrario —capturar al abrir— dejaría
 * dinero cobrado esperando a que algo funcione.
 *
 * ── LO QUE ESTE PROVEEDOR SIGUE SIN HACER ──────────────────────────────────
 *
 * 🎁 **No cobra REGALOS.** No es una limitación de PayPal: es que
 * `/api/webhooks/paypal` atiende reservas y pedidos, y el camino del regalo son
 * ~150 líneas más que ya están escritas dos veces. Lo cierra
 * `api/pagos/checkout`, que descarta este riel cuando el sujeto es un regalo —
 * ahí está el porqué entero.
 *
 * Y sigue faltando el interruptor: `missingChargeConfig()` exige
 * `PAYPAL_WEBHOOK_ID`, o sea que el riel no cobra hasta que la ruta esté
 * desplegada Y el webhook dado de alta en PayPal. Ver ahí.
 */

const API = process.env.PAYPAL_API_URL ?? "https://api-m.sandbox.paypal.com";

/**
 * ⚠️ EL TOKEN SE CACHEA, y no por rendimiento: PayPal limita las peticiones a
 * `/v1/oauth2/token`, y un lote de 200 órdenes pidiendo token en cada una es
 * cómo se llega al 429 sin haber pagado a nadie. Dura 9 h; se renueva un minuto
 * antes por si el reloj va justo.
 *
 * ponytail: una variable de módulo, no un cliente con estado. El proceso de un
 * job vive minutos; una caché con expiración y bloqueo sería más código que la
 * llamada que ahorra.
 */
let tokenCache: { valor: string; expiraEn: number } | null = null;

/**
 * La credencial, que es la MISMA para cobrar y para pagar: una sola app de
 * PayPal. Por eso `missingChargeConfig` y `missingPayoutConfig` son la misma
 * función y no dos listas que se desincronizan.
 */
function faltaCredencial(): string | null {
  if (!process.env.PAYPAL_CLIENT_ID) return "falta PAYPAL_CLIENT_ID";
  if (!process.env.PAYPAL_SECRET) return "falta PAYPAL_SECRET";
  return null;
}

/** 401/403 = la credencial, no la orden. Ver `PayoutResult.sin-credencial`. */
function esCredencialInvalida(e: unknown): boolean {
  return e instanceof PaypalError && (e.status === 401 || e.status === 403);
}

/**
 * Ese cargo ya está devuelto. PayPal lo dice con un 422 cuyo `issue` es
 * `CAPTURE_FULLY_REFUNDED`, no con un 409 ni con un 200.
 *
 * ⚠️ Se mira el `issue` y NO el texto del mensaje: el texto es prosa que PayPal
 * puede reescribir, y confundir «ya estaba devuelto» con «rechazado» deja la
 * fila de la cola reintentando para siempre un reembolso que ya ocurrió.
 */
function yaReembolsado(e: PaypalError): boolean {
  if (e.status !== 422) return false;
  const d = (e.cuerpo as { details?: Array<{ issue?: string }> })?.details ?? [];
  return d.some((x) => x.issue === "CAPTURE_FULLY_REFUNDED");
}

/** 429 y 5xx = el momento, no la orden. Vuelve a la cola. */
function esTransitorio(e: unknown): boolean {
  return !(e instanceof PaypalError) || e.status === 429 || e.status >= 500;
}

async function token(): Promise<string> {
  const ahora = Date.now();
  if (tokenCache && tokenCache.expiraEn > ahora) return tokenCache.valor;

  const id = process.env.PAYPAL_CLIENT_ID ?? "";
  const secreto = process.env.PAYPAL_SECRET ?? "";
  const r = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secreto}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) {
    throw new PaypalError(r.status, cuerpo, `PayPal no dio token (${r.status})`);
  }
  const t = cuerpo as { access_token: string; expires_in: number };
  tokenCache = { valor: t.access_token, expiraEn: ahora + (t.expires_in - 60) * 1000 };
  return t.access_token;
}

async function paypalFetch(ruta: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(`${API}${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) {
    const d = (cuerpo as { message?: string; name?: string })?.message;
    throw new PaypalError(r.status, cuerpo, `PayPal ${r.status}: ${d ?? ruta}`);
  }
  return cuerpo;
}

/**
 * CAPTURAR UNA ORDEN APROBADA — el paso que Stripe y dLocal no tienen.
 *
 * Con `intent: CAPTURE`, aprobar NO mueve dinero: PayPal autoriza y espera a
 * que el comercio capture. Hasta esta llamada el dinero sigue siendo del alumno.
 *
 * ✅ Y ESE ORDEN ES EL FALLO SEGURO. Si el alumno cierra la pestaña después de
 * aprobar, o si esta llamada nunca ocurre, **no se ha cobrado nada**: PayPal
 * caduca la orden y el hold de la reserva se libera solo con
 * `expire-stale-bookings`. Lo contrario —capturar al abrir y confirmar
 * después— dejaría dinero cobrado esperando a que algo funcione.
 *
 * Se llama desde el webhook y no desde la vuelta del navegador, a propósito:
 * `CHECKOUT.ORDER.APPROVED` llega aunque la persona cierre la pestaña, y una
 * segunda vía de captura serían dos caminos compitiendo por el mismo dinero.
 *
 * Devuelve `ya-capturada` sin ser un error: PayPal responde 422
 * `ORDER_ALREADY_CAPTURED` a la segunda entrega del mismo evento, y eso es
 * exactamente lo que queríamos que pasara.
 */
export async function capturarOrden(
  ordenId: string,
): Promise<{ estado: "capturada" | "ya-capturada" } | { estado: "fallo"; error: string }> {
  try {
    await paypalFetch(`/v2/checkout/orders/${ordenId}/capture`, {
      method: "POST",
      // La orden ES la clave: capturar dos veces la misma no puede cobrar dos
      // veces, y PayPal lo garantiza con el 422 de abajo. La cabecera va igual
      // porque su reintento interno tampoco debe duplicar.
      headers: { "PayPal-Request-Id": `captura-${ordenId}` },
      body: "{}",
    });
    return { estado: "capturada" };
  } catch (e) {
    if (e instanceof PaypalError && yaCapturada(e)) return { estado: "ya-capturada" };
    return { estado: "fallo", error: e instanceof Error ? e.message : "PayPal no capturó la orden" };
  }
}

/** El 422 que dice «esa orden ya está capturada». Mismo criterio que `yaReembolsado`. */
function yaCapturada(e: PaypalError): boolean {
  if (e.status !== 422) return false;
  const d = (e.cuerpo as { details?: Array<{ issue?: string }> })?.details ?? [];
  return d.some((x) => x.issue === "ORDER_ALREADY_CAPTURED");
}

export const paypalProvider: PspProvider = {
  key: "paypal",
  opensRemoteCheckout: true,

  // ── Lo que sí cobra ───────────────────────────────────────────────────────
  //
  /**
   * 🔴 EXIGE `PAYPAL_WEBHOOK_ID` ADEMÁS DE LA CREDENCIAL, Y ESA TERCERA
   * VARIABLE ES TODO EL FRENO DE MANO DE ESTA FASE.
   *
   * Sin ella este método devuelve un motivo, el checkout descarta el candidato
   * (`route.ts`: «la credencial es el interruptor, candidato a candidato») y
   * PayPal se comporta exactamente como ayer: no cobra. Con ella, cobra.
   *
   * ⚠️ Y LA VARIABLE NO ES UN SECRETO QUE INVENTARSE: es el id que devuelve dar
   * de alta el webhook en PayPal (`POST /v1/notifications/webhooks` o su panel),
   * apuntando a `https://<origen>/api/webhooks/paypal` y suscrito a
   * `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`,
   * `PAYMENT.CAPTURE.DENIED` y `PAYMENT.CAPTURE.DECLINED`. Sandbox y producción
   * son webhooks distintos con ids distintos, como las claves.
   *
   * ⚠️ NO ES CELO: `charge_providers` lleva a PayPal desde `20260915120000`, y
   * esa lista no es solo lo que el alumno puede ELEGIR — es también la CADENA DE
   * RESPALDO. Sin este freno, un fallo de Stripe bastaría para abrir un cobro
   * por PayPal en un entorno donde el webhook no esté dado de alta, y ese cobro
   * se paga sin que nada lo acredite: un alumno con el dinero fuera y sin clase.
   *
   * La ruta ya existe (`/api/webhooks/paypal`), así que lo que esta variable
   * vigila ahora no es «¿está escrito?» sino «¿está dado de alta EN ESTE
   * ENTORNO?» — que es la pregunta que de verdad importa y la que nadie recuerda
   * hacerse. Ponerla ES el despliegue, como toda la tabla de integraciones de
   * CLAUDE.md.
   */
  missingChargeConfig() {
    const falta = faltaCredencial();
    if (falta) return falta;
    if (!process.env.PAYPAL_WEBHOOK_ID) {
      return (
        "falta PAYPAL_WEBHOOK_ID: sin webhook un cobro por PayPal se paga y no confirma la " +
        "reserva, así que el riel se queda cerrado a propósito"
      );
    }
    return null;
  },

  /**
   * ABRE EL COBRO Y DEVUELVE A DÓNDE MANDAR AL ALUMNO.
   *
   * 🔑 TRES LÍNEAS DE TRABAJO REAL, Y ESO ES TODO EL ADAPTADOR. Comparado con
   * dLocal Go —250 líneas de `sujetoDelCobro` + `refGuardada` + `sellarRef`—
   * la diferencia entera es `PayPal-Request-Id`: repetir la llamada con la
   * misma cabecera devuelve LA MISMA ORDEN (medido, 15-sep-2026), así que la
   * memoria de «este sujeto ya tiene un cobro abierto» la lleva PayPal y no
   * nuestra base. Como `idempotencyKey` es determinista por sujeto, recargar el
   * checkout reencuentra la orden en vez de abrir otra. Es el trato de Stripe.
   *
   * ⚠️ NO SE SELLA `provider_payment_id` AQUÍ, Y HAY QUE SABERLO: lo sella el
   * webhook al confirmar, igual que con Stripe. `enqueue_refund` copia esa
   * columna a la cola de reembolsos, así que **mientras no exista
   * `/api/webhooks/paypal` un cobro por aquí no se puede devolver**. Esa ruta es
   * la pieza siguiente, no una mejora opcional.
   *
   * `customerRef` y `notificationUrl` se ignoran a propósito: PayPal no tiene
   * Customer que reutilizar (el vault de PayPal/Venmo está apagado en la app
   * live) y su webhook se configura UNA vez en su panel, como el de Stripe.
   */
  async charge(input: ChargeInput): Promise<ChargeResult> {
    try {
      const orden = (await paypalFetch("/v2/checkout/orders", {
        method: "POST",
        // 🔑 La idempotencia entera del cobro está en esta cabecera.
        headers: { "PayPal-Request-Id": input.idempotencyKey },
        body: JSON.stringify(ordenDeCobro(input)),
      })) as OrdenPaypal;

      const url = enlaceDePago(orden);
      if (url) return { ok: true, modo: "redireccion", redirectUrl: url, providerRef: orden.id };

      // 🔴 La orden EXISTE y no admite aprobación — típicamente porque ya se
      // aprobó o ya se pagó, que es lo que devuelve repetir la petición
      // idempotente después de pagar. `en-duda` y no `nada`: hay un cobro vivo
      // ahí, y dejar que la cadena pruebe otro riel es cómo se le cobra dos
      // veces a la misma persona.
      return {
        ok: false,
        error: `la orden ${orden.id} de PayPal está en ${orden.status} y no admite aprobación`,
        creado: "en-duda",
      };
    } catch (e) {
      // Un 4xx de PayPal es un rechazo ANTES de crear nada: la API responde con
      // el id de la orden o con el error, nunca con las dos cosas. Eso es lo
      // único que autoriza a la cadena a probar el siguiente candidato.
      //
      // Todo lo demás —red, 429, 5xx— puede haber creado la orden sin que nos
      // enteremos. `en-duda` y se para, que es el criterio del puerto: abrir un
      // cobro de más le cuesta dinero a un alumno, no abrirlo le cuesta un
      // reintento. Y el reintento es gratis: la misma cabecera devuelve la orden
      // que se hubiera creado.
      const rechazo = e instanceof PaypalError && e.status >= 400 && e.status < 500 && e.status !== 429;
      return {
        ok: false,
        error: e instanceof Error ? e.message : "PayPal no pudo abrir el cobro",
        creado: rechazo ? "nada" : "en-duda",
      };
    }
  },

  // ── Lo que este riel todavía no hace ──────────────────────────────────────
  /**
   * ⚠️ NO PREGUNTA POR `PAYPAL_WEBHOOK_ID`, al revés que `missingChargeConfig`,
   * y esa asimetría es el porqué de que el puerto tenga tres preguntas y no una
   * (ver `missingPayoutConfig` en `port.ts`). Devolver dinero solo necesita la
   * credencial; atar la cola de reembolsos a una variable que no usa dejaría
   * `refunds-process` parado por una clave del cobro. El caso es real: un cobro
   * que entró por PayPal cuando el webhook estaba puesto hay que poder
   * devolverlo aunque alguien quite esa variable después.
   */
  canRefund: () => faltaCredencial() === null,

  /**
   * DEVOLVER UN COBRO. `POST /v2/payments/captures/{id}/refund`.
   *
   * 🔑 `chargeRef` ES EL ID DE LA CAPTURA y no el de la orden — lo sella así el
   * webhook a propósito (ver `eventoDeWebhook`). Con el de la orden esto sería
   * un 404 permanente.
   *
   * La idempotencia vuelve a ser `PayPal-Request-Id`, igual que en el cobro: el
   * job reintenta la misma fila con la misma clave y PayPal devuelve el
   * reembolso que ya hizo en vez de hacer otro. Es lo que dLocal no tiene y por
   * lo que su X-02 se protege anotando antes de llamar.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    // Sin importe, el cargo entero: es lo que PayPal hace con el cuerpo vacío, y
    // la decisión P-1 de este sistema (un cobro tardío no se retiene ni en
    // parte). Con importe, su formato decimal.
    // `currency` es opcional en el puerto y aquí se asume USD si falta, igual
    // que en dLocal y por lo mismo: es la moneda real del proyecto hoy (y con
    // `aDecimal` dividiendo siempre por 100, una moneda sin céntimos ya pediría
    // más que un valor por defecto).
    const moneda = (input.currency ?? "USD").toUpperCase();
    const cuerpo =
      input.amountMinor == null
        ? {}
        : { amount: { value: aDecimal(input.amountMinor), currency_code: moneda } };

    try {
      const hecho = (await paypalFetch(`/v2/payments/captures/${input.chargeRef}/refund`, {
        method: "POST",
        headers: { "PayPal-Request-Id": input.idempotencyKey },
        body: JSON.stringify(cuerpo),
      })) as { id: string; status?: string; amount?: { value?: string; currency_code?: string } };

      const importe = aMenor(hecho.amount?.value) ?? input.amountMinor ?? 0;
      const monedaDevuelta = hecho.amount?.currency_code ?? moneda;

      // ⚠️ `COMPLETED` Y NADA MÁS ES DINERO FUERA. `PENDING` es real y pasa
      // cuando el saldo no cubre el reembolso: PayPal lo acepta y lo deja
      // colgado. Marcar eso como devuelto manda al alumno a esperar un dinero
      // que no ha salido — el mismo error que `UNCLAIMED` en el payout, que ya
      // desarmó un correo una vez.
      if (hecho.status && hecho.status !== "COMPLETED") {
        return {
          estado: "no-completado",
          refundId: hecho.id,
          detalle: hecho.status,
          amountMinor: importe,
          currency: monedaDevuelta,
        };
      }
      return {
        estado: "reembolsado",
        refundId: hecho.id,
        amountMinor: importe,
        currency: monedaDevuelta,
      };
    } catch (e) {
      // Ese cargo ya lo devolvió otra mano (el panel de PayPal, otro camino
      // nuestro). No es un fallo: la cola lo cierra sin mover nada.
      if (e instanceof PaypalError && yaReembolsado(e)) return { estado: "ya-reembolsado" };

      // 429 y 5xx son el momento; el resto es la petición y repetirla mañana
      // dará lo mismo. Mismo corte que en `charge`.
      const transitorio = esTransitorio(e);
      return {
        estado: transitorio ? "transitorio" : "rechazado",
        mensaje: e instanceof Error ? e.message : "PayPal no aceptó el reembolso",
        causa: e,
      };
    }
  },

  /**
   * ⚠️ LA VERIFICACIÓN ES UNA LLAMADA A PAYPAL, NO UN HMAC EN CASA — por eso el
   * puerto admite que este método sea asíncrono.
   *
   * PayPal firma con un certificado suyo: comprobarlo localmente obliga a
   * descargar la cadena de `paypal-cert-url`, validarla y cachearla, o sea a
   * escribir y mantener criptografía para ahorrarse una llamada. Su endpoint de
   * verificación hace exactamente eso y lo mantiene él.
   *
   * ponytail: el techo es que un webhook cuesta un viaje a la API de PayPal. Si
   * algún día el volumen lo hiciera doler, la salida es cachear el certificado,
   * no quitar la comprobación.
   *
   * 🔴 `PAYPAL_WEBHOOK_ID` NO ES OPCIONAL Y NO TIENE RESPALDO. Sin él no hay
   * nada contra lo que verificar, y «lo dejo pasar» convertiría esta ruta en un
   * endpoint público capaz de marcar reservas como pagadas con un POST (RN-34).
   * Por eso devuelve `sin-secreto`, que la ruta traduce a 503 y PayPal reintenta.
   */
  async verifyWebhook(input: WebhookInput): Promise<WebhookVerificacion> {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      return {
        ok: false,
        motivo: "sin-secreto",
        error: "falta PAYPAL_WEBHOOK_ID: no hay contra qué verificar la firma",
      };
    }

    const h = input.headers ?? {};
    const firma = h["paypal-transmission-sig"];
    if (!firma) {
      return { ok: false, motivo: "sin-firma", error: "la petición no trae paypal-transmission-sig" };
    }

    // ⚠️ `webhook_event` VA COMO OBJETO PARSEADO, no como la cadena cruda, y es
    // lo único de esta llamada que sorprende: PayPal reserializa el cuerpo por
    // su cuenta para comprobar la firma. El crudo sigue llegando hasta aquí
    // igualmente porque `WebhookInput` lo exige para todos, y porque parsear es
    // reversible mientras que recomponer el crudo desde un objeto no lo es.
    let cuerpo: EventoPaypal;
    try {
      cuerpo = JSON.parse(input.rawBody) as EventoPaypal;
    } catch {
      return { ok: false, motivo: "firma-invalida", error: "el cuerpo del webhook no es JSON" };
    }

    let veredicto: { verification_status?: string };
    try {
      veredicto = (await paypalFetch("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: JSON.stringify({
          auth_algo: h["paypal-auth-algo"],
          cert_url: h["paypal-cert-url"],
          transmission_id: h["paypal-transmission-id"],
          transmission_sig: firma,
          transmission_time: h["paypal-transmission-time"],
          webhook_id: webhookId,
          webhook_event: cuerpo,
        }),
      })) as { verification_status?: string };
    } catch (e) {
      // 🔴 NO SE DA POR BUENA. Si la API de verificación no contesta, lo honesto
      // es `sin-secreto` → 503 → PayPal reintenta. Tratar un fallo de red como
      // «firma válida» es la puerta trasera de la que avisa `WebhookInput`.
      return {
        ok: false,
        motivo: "sin-secreto",
        error: `PayPal no pudo verificar la firma: ${e instanceof Error ? e.message : "error"}`,
      };
    }

    if (veredicto.verification_status !== "SUCCESS") {
      return {
        ok: false,
        motivo: "firma-invalida",
        error: `PayPal dice ${veredicto.verification_status ?? "(sin veredicto)"}`,
      };
    }

    return { ok: true, evento: eventoDeWebhook(cuerpo) };
  },

  // ── Lo que hace desde el principio ────────────────────────────────────────
  missingPayoutConfig: () => faltaCredencial(),

  async payout(input: PayoutInput): Promise<PayoutResult> {
    const marca = marcaDe(input.payoutId, input.intento);

    // ── Camino 1 · la orden ya tiene identidad: solo se mira ────────────────
    // Consultar no crea, así que un fallo de credencial aquí puede devolver la
    // orden a la cola intacta (`pudoCrear: false`).
    if (input.providerPayoutId) {
      try {
        const lote = (await paypalFetch(
          `/v1/payments/payouts/${input.providerPayoutId}`,
        )) as LotePaypal;
        return desenlace(lote, marca, false);
      } catch (e) {
        if (esCredencialInvalida(e)) {
          return { estado: "sin-credencial", mensaje: (e as Error).message, pudoCrear: false };
        }
        return { estado: "transitorio", mensaje: (e as Error).message, causa: e };
      }
    }

    // ── Camino 2 · hay que crearla ──────────────────────────────────────────
    //
    // ⚠️ EL DESTINO NO SALE DE AQUÍ. Se pide a `payout_identifier_beneficiary`,
    // viaja al cuerpo del POST y ahí muere: no se devuelve, no se registra y no
    // entra en ningún mensaje de error. Un correo en un log es PII en un log.
    const admin = createAdminClient();
    const { data: benef, error: eBenef } = await admin.rpc("payout_identifier_beneficiary", {
      p_payout_id: input.payoutId,
      p_channel: "paypal",
    });

    if (eBenef) {
      // ⚠️ REGLA DE ORO 9 DISFRAZADA DE PROBLEMA DEL TUTOR. Un 42501 aquí no es
      // «este tutor no declaró su PayPal»: es que a `service_role` le falta el
      // `execute` y NINGUNA orden se va a pagar. Confundirlos dejaría la cola
      // entera parada con un mensaje que culpa a los tutores.
      const esPermiso =
        (eBenef as { code?: string }).code === "42501" ||
        /permission denied|not allowed/i.test(eBenef.message);
      if (esPermiso) {
        return {
          estado: "transitorio",
          mensaje: `payout_identifier_beneficiary no es ejecutable por service_role (regla de oro 9): ${eBenef.message}`,
          causa: eBenef,
        };
      }
      // ⚠️ «EL TUTOR NO HA RELLENADO EL FORMULARIO» NO ES «ESTA ORDEN ESTÁ
      // MUERTA». Esto devolvía `rechazado` para todo, y `rechazado` manda la
      // fila a 'failed': un tutor colombiano que todavía no ha escrito su correo
      // de PayPal —hoy, todos, porque el canal acaba de reabrirse— se habría
      // quedado con la liquidación enterrada en vez de esperando a que la
      // rellene. `sin-datos` existe exactamente para esto.
      //
      // El canal cerrado va por el mismo camino a propósito: tampoco es culpa de
      // la orden, y cuando alguien reabra el canal esa liquidación tiene que
      // seguir viva. Lo que sí es `rechazado` es una orden que no se puede
      // ejecutar (ya pagada, cancelada): esa no la arregla nadie rellenando nada.
      const sinDestino =
        /no ha registrado su destino|está cerrado y no se puede pagar/i.test(eBenef.message);
      if (sinDestino) return { estado: "sin-datos", mensaje: eBenef.message };

      return { estado: "rechazado", mensaje: eBenef.message, causa: eBenef };
    }

    // 🔑 A QUIÉN Y CÓMO. La cuenta conectada gana al correo siempre: ver
    // `receptorDe`, que lleva la medición del 4-sep escrita al lado.
    const receptor = receptorDe(benef as BeneficiarioPaypal);
    if (!receptor) {
      return {
        estado: "sin-datos",
        mensaje: "el tutor no tiene ni cuenta de PayPal conectada ni correo de cobro",
      };
    }

    try {
      const lote = (await paypalFetch("/v1/payments/payouts", {
        method: "POST",
        body: JSON.stringify({
          sender_batch_header: {
            sender_batch_id: marca,
            email_subject: "Tu liquidación de Enséñame Ya",
          },
          items: [
            {
              recipient_type: receptor.recipient_type,
              receiver: receptor.receiver,
              amount: { value: aDecimal(input.amountMinor), currency: input.currency },
              sender_item_id: input.payoutId,
            },
          ],
        }),
      })) as LotePaypal;
      return desenlace(lote, marca, false);
    } catch (e) {
      // 🔑 EL LOTE YA EXISTÍA. No es un fallo: es una creación anterior que
      // cuajó sin que nos enterásemos. Se adopta con su id. Esto es lo que
      // sustituye al barrido de huérfanos de dLocal.
      const yaExiste = loteYaExistente(e);
      if (yaExiste) {
        try {
          const lote = (await paypalFetch(`/v1/payments/payouts/${yaExiste}`)) as LotePaypal;
          return desenlace(lote, marca, true);
        } catch (e2) {
          // Sabemos que hay un lote y no podemos mirarlo. La orden NO vuelve a
          // la cola: crearía un segundo pago del mismo dinero.
          //
          // ⚠️ El id del lote va DENTRO del mensaje porque `en-duda` no tiene
          // campo para él, y perderlo es lo que convierte «hay un pago que
          // conciliar» en «busca tú a ver». Es la cadena que el admin pega en
          // el panel de PayPal.
          return {
            estado: "en-duda",
            mensaje: `lote ${yaExiste} existe y no se pudo consultar: ${(e2 as Error).message}`,
            causa: e2,
          };
        }
      }

      // 🔴 EL MISMO DUPLICADO, PERO SIN EL ENLACE QUE LO IDENTIFICA. PayPal dice
      // que el lote existe y no dice cuál. Antes esto caía hasta el `rechazado`
      // del final —o sea, «el proveedor no creó nada»— que es exactamente lo
      // contrario de lo que acaba de contestar. Y desde AUD-01 un rechazo puede
      // bajar al siguiente riel: pagaríamos otra vez el dinero que este lote ya
      // puede estar pagando.
      //
      // `en-duda` deja la fila en 'processing', no se reintenta sola jamás y sale
      // en el contador que el job marca como «debe ser 0». Que una persona mire
      // es el desenlace correcto cuando hay un pago que no podemos identificar.
      if (loteDuplicadoSinEnlace(e)) {
        return {
          estado: "en-duda",
          mensaje:
            `PayPal dice que el lote ${marca} ya existe pero no devolvió su enlace. ` +
            `Búscalo en el panel por ese sender_batch_id antes de tocar la orden: ` +
            (e as Error).message,
          causa: e,
        };
      }

      if (esCredencialInvalida(e)) {
        return { estado: "sin-credencial", mensaje: (e as Error).message, pudoCrear: false };
      }

      // Fondos: no es un fallo permanente, es dinero que se debe y saldrá cuando
      // haya saldo. Marcarlo 'failed' sería enterrarlo.
      const nombre = (e as PaypalError).cuerpo as { name?: string } | null;
      if (nombre?.name === "INSUFFICIENT_FUNDS") {
        return { estado: "sin-fondos", mensaje: (e as Error).message };
      }

      if (esTransitorio(e)) {
        return { estado: "transitorio", mensaje: (e as Error).message, causa: e };
      }
      return { estado: "rechazado", mensaje: (e as Error).message, causa: e };
    }
  },
};

/**
 * ── LOG IN WITH PAYPAL: CONECTAR LA CUENTA DEL TUTOR ────────────────────────
 *
 * Existe por lo que se midió el 4-sep: pagar a un correo tecleado no entrega si
 * ese correo no está confirmado, y eso no se puede saber al guardarlo. Aquí el
 * tutor entra en PayPal, PayPal nos firma quién es, y nos quedamos con su
 * `payer_id` — que sí entrega.
 *
 * Son dos funciones y ninguna clase: una construye la URL a la que se le manda
 * y la otra canjea lo que trae de vuelta.
 */

/** El dominio de la web de PayPal, deducido del de la API. */
function webDePaypal(): string {
  return API.includes("sandbox") ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
}

/**
 * A dónde se manda al tutor. `state` viaja de ida y vuelta sin tocar: es lo
 * único que impide que el callback acepte un código traído por cualquiera.
 *
 * ⚠️ `openid` NO basta. El `payer_id` viene con `paypal-attributes`, y ese
 * atributo hay que marcarlo además en el panel de la app («Log in with PayPal»
 * → Account ID). Sin él PayPal devuelve el perfil sin id y no hay nada que
 * guardar — el callback lo detecta y lo dice.
 */
export function urlDeConexionPaypal(opts: { returnUrl: string; state: string }): string | null {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId) return null;
  const q = new URLSearchParams({
    flowEntry: "static",
    client_id: clientId,
    response_type: "code",
    // 🔴 `paypalattributes` VA SIN GUION. Con guion PayPal responde «invalid
    // scope» y no lo dice hasta que el tutor ya está en su pantalla, así que
    // parece un fallo de configuración del panel y no lo es. Medido el
    // 4-sep-2026: las cinco variantes probadas y solo la del guion falla.
    //
    // `profile` y `email` van porque el destino se crea con el nombre y el
    // correo que firma PayPal, sin que el tutor teclee nada.
    scope: [
      "openid",
      "profile",
      "email",
      "https://uri.paypal.com/services/paypalattributes",
    ].join(" "),
    redirect_uri: opts.returnUrl,
    state: opts.state,
  });
  return `${webDePaypal()}/connect?${q.toString()}`;
}

/** Lo que PayPal nos cuenta del tutor. `payerId` es lo único imprescindible. */
export type CuentaPaypalConectada = {
  payerId: string;
  email: string | null;
  nombre: string | null;
};

/**
 * Canjea el `code` del callback y devuelve la identidad.
 *
 * ⚠️ El token que sale de aquí es DEL TUTOR, no nuestro, y no se guarda: se usa
 * para una llamada y se tira. Lo que se conserva es el `payer_id`, que no es un
 * secreto — es a dónde se paga.
 */
export async function canjearCodigoPaypal(
  code: string,
  returnUrl: string,
): Promise<CuentaPaypalConectada> {
  const id = process.env.PAYPAL_CLIENT_ID ?? "";
  const secreto = process.env.PAYPAL_SECRET ?? "";
  if (!id || !secreto) throw new Error("faltan PAYPAL_CLIENT_ID / PAYPAL_SECRET");

  const basic = Buffer.from(`${id}:${secreto}`).toString("base64");
  const tokenRes = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: returnUrl,
    }).toString(),
    cache: "no-store",
  });
  const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(`PayPal no canjeó el código: ${token.error_description ?? tokenRes.status}`);
  }

  // `schema=paypalv1.1` es el que trae `payer_id`. Sin ese parámetro la
  // respuesta es el perfil OpenID estándar, que no lo lleva.
  const infoRes = await fetch(`${API}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  const info = (await infoRes.json()) as {
    payer_id?: string;
    user_id?: string;
    name?: string;
    emails?: { value?: string; primary?: boolean; confirmed?: boolean }[];
  };
  if (!infoRes.ok) throw new Error(`PayPal no devolvió el perfil: ${infoRes.status}`);

  // `user_id` viene como URI («…/user/…/<payer_id>»); `payer_id` va suelto
  // cuando el atributo Account ID está marcado en la app. Se acepta cualquiera
  // de los dos para no depender de un formato que no controlamos.
  const payerId = info.payer_id?.trim() || info.user_id?.split("/").pop()?.trim() || "";
  if (!payerId) {
    throw new Error(
      "PayPal no devolvió el identificador de cuenta. Falta marcar el atributo " +
        "«Account ID» en Log in with PayPal, en el panel de la app.",
    );
  }

  const principal = info.emails?.find((e) => e.primary) ?? info.emails?.[0];
  return { payerId, email: principal?.value?.trim() ?? null, nombre: info.name?.trim() ?? null };
}
