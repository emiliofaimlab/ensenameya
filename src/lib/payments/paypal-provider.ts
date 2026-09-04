import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { marcaDe } from "./port";
import {
  PaypalError,
  aDecimal,
  desenlace,
  loteYaExistente,
  receptorDe,
  type BeneficiarioPaypal,
  type LotePaypal,
} from "./paypal-mapeo";
import type {
  ChargeResult,
  PayoutInput,
  PayoutResult,
  PspProvider,
  RefundResult,
  WebhookVerificacion,
} from "./port";

/**
 * PAYPAL — RIEL DE PAYOUT, Y SOLO DE PAYOUT.
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
 * ── LO QUE ESTE PROVEEDOR NO HACE ──────────────────────────────────────────
 *
 * No cobra, no reembolsa y no escucha webhooks. `payment_routing_rules` no lo
 * nombra en `charge_providers` de ninguna fila, así que ese camino no se recorre.
 * Los tres métodos contestan que no saben, igual que `stripeProvider.payout()`
 * contesta `sin-ejecutor`: es la forma que ya usa este repositorio para «existe
 * en la interfaz y no en la realidad», y es preferible a una excepción, que
 * convierte un error de ruteo en un 500 sin nombre.
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

/** 401/403 = la credencial, no la orden. Ver `PayoutResult.sin-credencial`. */
function esCredencialInvalida(e: unknown): boolean {
  return e instanceof PaypalError && (e.status === 401 || e.status === 403);
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

export const paypalProvider: PspProvider = {
  key: "paypal",
  opensRemoteCheckout: true,

  // ── Lo que este riel no hace ──────────────────────────────────────────────
  missingChargeConfig: () =>
    "PayPal no es pasarela de cobro en este sistema: ninguna fila de payment_routing_rules lo nombra en charge_providers",
  async charge(): Promise<ChargeResult> {
    // `creado: 'nada'` es correcto y no es una suposición: no se ha llamado a
    // nadie. Es lo que autoriza a la cadena de respaldo a probar el siguiente.
    return {
      ok: false,
      error: "PayPal no cobra en este sistema, solo paga al tutor",
      creado: "nada",
    };
  },
  canRefund: () => false,
  async refund(): Promise<RefundResult> {
    throw new Error("PayPal no reembolsa aquí: no cobra, así que no hay nada suyo que devolver");
  },
  verifyWebhook(): WebhookVerificacion {
    return { ok: false, motivo: "sin-firma", error: "PayPal no manda webhooks a este sistema" };
  },

  // ── Lo que sí hace ────────────────────────────────────────────────────────
  missingPayoutConfig() {
    if (!process.env.PAYPAL_CLIENT_ID) return "falta PAYPAL_CLIENT_ID";
    if (!process.env.PAYPAL_SECRET) return "falta PAYPAL_SECRET";
    return null;
  },

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
    scope: "openid https://uri.paypal.com/services/paypal-attributes",
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
