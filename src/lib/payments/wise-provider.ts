import "server-only";

import { createSign } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  WiseError,
  cuentaDeWise,
  desenlaceDeTransfer,
  esCredencialInvalida,
  referenciaSegura,
  retoDeSca,
  uuidDePago,
  type BeneficiarioWise,
} from "./wise-mapeo";
import type {
  ChargeResult,
  PayoutInput,
  PayoutResult,
  PspProvider,
  RefundResult,
  WebhookVerificacion,
} from "./port";

/**
 * WISE — el cuarto riel de payout, y el primero que no cobra NI está atado a un
 * balance de cobro.
 *
 * No cobra, no reembolsa y no escucha webhooks: `payment_routing_rules` no lo
 * nombra en `charge_providers` de ninguna fila. Los tres métodos contestan que
 * no saben, igual que hace PayPal, que es la forma que este repositorio usa para
 * «existe en la interfaz y no en la realidad».
 *
 * ── EL FLUJO SON CUATRO PASOS, NO UNO ───────────────────────────────────────
 * A diferencia de dLocal (un POST) y de PayPal (un POST), pagar por Wise es:
 *
 *   1. QUOTE       POST /v3/profiles/{id}/quotes         — fija el tipo de cambio
 *   2. RECIPIENT   POST /v1/accounts                     — da de alta al destinatario
 *   3. TRANSFER    POST /v1/transfers                    — crea la orden
 *   4. FUND        POST /v3/…/transfers/{id}/payments    — saca el dinero del saldo
 *
 * Solo el 3 crea algo que se pueda pagar dos veces, y por eso es el único que
 * lleva clave de idempotencia. Los pasos 1 y 2 se pueden repetir sin coste, y el
 * 4 es explícitamente reintentable («The transfer will remain in
 * incoming_payment_waiting status until funded»).
 *
 * 🔴 EL DINERO SALE DE NUESTRO SALDO EN WISE, Y HOY ESE SALDO ES CERO.
 * Medido el 7-sep-2026: `GET /v4/profiles/136151426/balances` devuelve `[]`, y
 * por eso la opción de pago `BALANCE` llega `disabled: true` en todos los
 * presupuestos. Los pasos 1, 2 y 3 funcionan; el 4 va a fallar hasta que alguien
 * abra una cuenta multidivisa en USD y la fondee. Eso es una gestión de negocio,
 * no una tarea de código, y el adaptador está escrito para que ese día no haya
 * que tocar nada: la transferencia se queda viva en `incoming_payment_waiting` y
 * el job reintenta el fondeo en cada pasada.
 *
 * ── QUÉ ESTÁ PROBADO, Y CONTRA QUÉ ─────────────────────────────────────────
 * El recorrido entero se ejercitó contra `api.transferwise.com` con el token
 * real el 7-sep-2026, creando y cancelando una transferencia de verdad
 * (`2357375084`, USD→GBP): destinatario creado, requisitos leídos,
 * transferencia creada en `incoming_payment_waiting`, barrido reencontrándola
 * por su `customerTransactionId`, y cancelación y borrado del destinatario.
 *
 * 🟢 Y AHÍ SE DESPEJÓ LA ÚNICA DUDA QUE QUEDABA DEL CONTRATO. Wise exige repetir
 * el mismo `customerTransactionId` para reintentar, pero un presupuesto solo
 * sirve para una transferencia y caduca a los 30 minutos — o sea que un
 * reintento tardío llega con el mismo identificador y un presupuesto DISTINTO, y
 * la documentación no dice qué pasa entonces. Medido: **devuelve la transferencia
 * que ya existía** (200 con el mismo id), no crea una segunda. La idempotencia
 * aguanta el caso del job, que es exactamente el que importa.
 *
 * ⚠️ LO QUE NO ESTÁ PROBADO ES EL DINERO. El fondeo se ejecutó y devolvió lo que
 * tenía que devolver con la cuenta vacía —422 con
 * `errorCode: balance.payment-option-unavailable`—, así que el camino está
 * recorrido pero nadie ha visto todavía a un tutor cobrar por aquí. Eso no pasa
 * hasta que haya saldo, y a diferencia de PayPal, este riel NO está cerrado.
 *
 * ⚠️ QUIÉN COME LA CONVERSIÓN. `payouts.currency` es USD y el tutor cobra en su
 * moneda. Se manda `sourceAmount` = `payouts.amount`, así que lo que sale de
 * nuestro saldo es exactamente el importe de la orden y la comisión de Wise sale
 * de dentro: el tutor absorbe el coste de conversión. Es la MISMA regla que
 * dLocal desde el 2-sep (`spreadDeLiquidacion`), no una decisión nueva — y aquí
 * es además exacta, porque Wise da el tipo medio de mercado y la comisión
 * explícita en el presupuesto, en vez de un spread medio que hay que estimar.
 */

const API = process.env.WISE_API_URL ?? "https://api.transferwise.com";

/** Cuántas transferencias trae cada página del barrido. Tope duro de Wise: 200. */
const PAGINA = 200;

/**
 * ⚠️ EL PERFIL NO ES UNA VARIABLE DE ENTORNO. Se pregunta una vez y se guarda.
 *
 * ponytail: podría ser `WISE_PROFILE_ID`, pero sería una variable más que se
 * puede poner mal y que solo se descubriría al fallar un pago. El token ya
 * identifica la cuenta; preguntarle a quién pertenece es una llamada y quita un
 * ajuste. El techo es que un token con dos perfiles de empresa elegiría el
 * primero: el día que eso pase, aquí entra la variable.
 */
let perfilCache: number | null = null;

/** 429 y 5xx = el momento, no la orden. Vuelve a la cola. */
function esTransitorio(e: unknown): boolean {
  return !(e instanceof WiseError) || e.status === 429 || e.status >= 500;
}

/**
 * ⚠️ ESTA API RESPONDE JSON *O* TEXTO PLANO. Medido: el endpoint de fondeo con
 * un id inexistente devuelve `content-type: text/plain` y el cuerpo
 * `transfer.invalid-state`. Un `await r.json()` lanza ahí y el job convierte esa
 * excepción en `en-duda`, que deja la fila congelada en 'processing' para
 * siempre. Se lee como texto y se parsea si se puede.
 */
async function cuerpoDe(r: Response): Promise<unknown> {
  const texto = await r.text().catch(() => "");
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

/**
 * Saca el mensaje de un error de Wise sin casarse con una forma, porque hay dos:
 * `POST /v1/accounts` devuelve `{errors:[{code,message,path}]}` y
 * `POST /v1/transfers` devuelve `{errors:[{code,message,field}]}`. Un parser que
 * solo conozca una de las dos se come la mitad de los diagnósticos.
 */
function mensajeDe(cuerpo: unknown, ruta: string): string {
  if (typeof cuerpo === "string") return cuerpo;
  const errs = (cuerpo as { errors?: Array<{ message?: string; code?: string }> })?.errors;
  if (Array.isArray(errs) && errs.length) {
    return errs.map((e) => e.message ?? e.code ?? "?").join("; ");
  }
  const m = (cuerpo as { message?: string })?.message;
  return m ?? ruta;
}

async function wiseFetch(ruta: string, init?: RequestInit): Promise<unknown> {
  const token = process.env.WISE_API_TOKEN ?? "";
  const cabeceras = (extra?: Record<string, string>): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
    ...(extra ?? {}),
  });

  let r = await fetch(`${API}${ruta}`, { ...init, headers: cabeceras() });

  // ── El reto de SCA, si llega ──────────────────────────────────────────────
  //
  // 🟢 Hoy no llega: medido el 7-sep-2026, los dos endpoints protegidos de esta
  // cuenta responden `x-2fa-approval-result: APPROVED` sin 403 y sin reto. La
  // SCA es una obligación PSD2 (Reino Unido y EEE) y este perfil es una LLC de
  // Estados Unidos. Esto está escrito porque son quince líneas y porque el día
  // que Wise cambie de criterio, el síntoma sería que los payouts dejan de salir
  // sin que nada lo explique.
  //
  // ⚠️ Un 403 SIN la cabecera NO es SCA (medido: `GET /v1/transfers/999999999`
  // devuelve 403 `forbidden.error` a secas). `retoDeSca` comprueba las dos
  // cosas; firmar a ciegas sería reintentar en bucle un error de permisos.
  const ott = retoDeSca(r.status, r.headers);
  if (ott) {
    const clave = process.env.WISE_PRIVATE_KEY;
    if (!clave) {
      throw new WiseError(
        403,
        null,
        "Wise pide SCA y falta WISE_PRIVATE_KEY: hay que generar un par RSA y subir la pública en Settings → API tokens",
      );
    }
    // Se firma el valor literal del token de un solo uso, en ASCII, con
    // RSASSA-PKCS1-v1_5 y SHA-256. Ni el cuerpo, ni la URL, ni un sello de
    // tiempo. Y la cabecera de vuelta es `X-Signature` — varias fuentes de
    // terceros dicen `x-2fa-signature` y están equivocadas; el ejemplo oficial
    // de Wise usa esta.
    const firma = createSign("RSA-SHA256").update(ott, "ascii").sign(clave, "base64");
    r = await fetch(`${API}${ruta}`, {
      ...init,
      headers: cabeceras({ "x-2fa-approval": ott, "X-Signature": firma }),
    });
  }

  const cuerpo = await cuerpoDe(r);
  if (!r.ok) throw new WiseError(r.status, cuerpo, `Wise ${r.status}: ${mensajeDe(cuerpo, ruta)}`);
  return cuerpo;
}

async function perfil(): Promise<number> {
  if (perfilCache) return perfilCache;
  const perfiles = (await wiseFetch("/v2/profiles")) as Array<{ id: number; type: string }>;
  const elegido = perfiles.find((p) => p.type === "BUSINESS") ?? perfiles[0];
  if (!elegido) throw new WiseError(404, perfiles, "el token de Wise no tiene ningún perfil");
  perfilCache = elegido.id;
  return elegido.id;
}

type Transfer = { id: number; status: string; customerTransactionId?: string };

/**
 * 🔴 EL BARRIDO. Es lo que separa «no se creó nada» de «no lo sé», y esa
 * diferencia es la que autoriza a volver a mandar un pago.
 *
 * ⚠️ SE COTEJA POR `customerTransactionId` Y NUNCA POR LA REFERENCIA — justo al
 * revés que dLocal, que busca su marca dentro de `description`. Aquí no se
 * puede: `details.reference` se recorta a doce caracteres en Argentina, así que
 * dos órdenes distintas pueden acabar con la misma referencia. El
 * `customerTransactionId` vuelve entero en cada fila del listado.
 *
 * Devuelve el transfer si lo encuentra, `null` si demostró que no está, y lanza
 * si se quedó sin poder demostrarlo.
 */
async function barrer(perfilId: number, ctxId: string, desde: string): Promise<Transfer | null> {
  // Cinco minutos de margen contra el desfase de relojes: `claimedAt` lo pone
  // nuestro servidor y el sello de creación lo pone el de Wise. Mirar de más es
  // gratis; mirar de menos es no encontrar un pago que existe.
  const inicio = new Date(new Date(desde).getTime() - 5 * 60 * 1000).toISOString();
  for (let offset = 0; ; offset += PAGINA) {
    const pagina = (await wiseFetch(
      `/v1/transfers?profile=${perfilId}&limit=${PAGINA}&offset=${offset}` +
        `&createdDateStart=${encodeURIComponent(inicio)}`,
    )) as Transfer[];
    const nuestra = pagina.find((t) => t.customerTransactionId === ctxId);
    if (nuestra) return nuestra;
    // Una página incompleta es el final del listado, y por tanto la prueba.
    if (pagina.length < PAGINA) return null;
  }
}

/**
 * Saca el dinero del saldo. Devuelve el estado que dio Wise, o el motivo del
 * rechazo.
 *
 * ⚠️ NO LANZA SI WISE RECHAZA EL FONDEO: rechazarlo es una respuesta 201 con
 * `status: "REJECTED"`, no un error HTTP. Y la lista de `errorCode` no está
 * cerrada en su documentación, así que se guarda como texto y no como enum.
 */
async function fondear(
  perfilId: number,
  transferId: number,
): Promise<{ ok: boolean; detalle: string }> {
  const ruta = `/v3/profiles/${perfilId}/transfers/${transferId}/payments`;
  try {
    const r = (await wiseFetch(ruta, {
      method: "POST",
      body: JSON.stringify({ type: "BALANCE" }),
    })) as { status?: string; errorCode?: string | null };
    if (r?.status === "COMPLETED") return { ok: true, detalle: "fondeada" };
    return { ok: false, detalle: r?.errorCode ?? r?.status ?? "fondeo rechazado" };
  } catch (e) {
    // 🔴 MEDIDO EL 7-SEP-2026 CONTRA UNA TRANSFERENCIA REAL: rechazar el fondeo
    // NO es un 201 con `status: REJECTED`, como daba a entender la documentación.
    // Es un **422** con ese cuerpo:
    //   {"type":"BALANCE","status":"REJECTED","errorCode":"balance.payment-option-unavailable"}
    // Sin este catch, `wiseFetch` lanza, el adaptador clasifica «no hay saldo»
    // como error y la orden acaba contada donde no es. El desenlace correcto de
    // una cuenta vacía es 'sin-fondos' —dinero que se debe y saldrá— y no un
    // fallo transitorio que nadie mira.
    const c = e instanceof WiseError ? (e.cuerpo as { status?: string; errorCode?: string }) : null;
    if (c && typeof c === "object" && c.status === "REJECTED") {
      return { ok: false, detalle: c.errorCode ?? "REJECTED" };
    }
    // Cualquier otra cosa sí es un error de verdad: un 403, un 5xx, o el
    // `transfer.invalid-state` en TEXTO PLANO que devuelve un id inexistente.
    throw e;
  }
}

/** ¿El rechazo del fondeo es «no hay saldo» y no «esta orden no se puede fondear»? */
function esFaltaDeSaldo(detalle: string): boolean {
  return /insufficient|payment-option-unavailable|balance/i.test(detalle);
}

export const wiseProvider: PspProvider = {
  key: "wise",
  opensRemoteCheckout: true,

  // ── Lo que este riel no hace ──────────────────────────────────────────────
  missingChargeConfig: () =>
    "Wise no es pasarela de cobro en este sistema: ninguna fila de payment_routing_rules lo nombra en charge_providers",
  async charge(): Promise<ChargeResult> {
    // `creado: 'nada'` no es una suposición: no se ha llamado a nadie. Es lo que
    // autoriza a la cadena de respaldo a probar el siguiente proveedor.
    return { ok: false, error: "Wise no cobra en este sistema, solo paga al tutor", creado: "nada" };
  },
  canRefund: () => false,
  async refund(): Promise<RefundResult> {
    throw new Error("Wise no reembolsa aquí: no cobra, así que no hay nada suyo que devolver");
  },
  verifyWebhook(): WebhookVerificacion {
    return { ok: false, motivo: "sin-firma", error: "Wise no manda webhooks a este sistema" };
  },

  // ── Lo que sí hace ────────────────────────────────────────────────────────
  missingPayoutConfig() {
    if (!process.env.WISE_API_TOKEN) return "falta WISE_API_TOKEN";
    // WISE_PRIVATE_KEY NO se exige: medido, esta cuenta no está sujeta a SCA. Si
    // algún día lo estuviera, `wiseFetch` lo dice con su nombre en vez de que la
    // orden muera con un 403 sin explicación.
    return null;
  },

  async payout(input: PayoutInput): Promise<PayoutResult> {
    // La clave de idempotencia. Determinista desde (payout, intento), porque un
    // identificador nuevo por reintento es cómo se paga dos veces.
    const ctxId = uuidDePago(input.payoutId, input.intento);

    let perfilId: number;
    try {
      perfilId = await perfil();
    } catch (e) {
      if (esCredencialInvalida(e)) {
        return { estado: "sin-credencial", mensaje: (e as Error).message, pudoCrear: false };
      }
      return { estado: "transitorio", mensaje: (e as Error).message, causa: e };
    }

    // ── Camino 1 · la orden ya tiene identidad ──────────────────────────────
    //
    // Se pregunta por ella y, si sigue esperando fondos, se reintenta el fondeo:
    // Wise dice explícitamente que una transferencia sin fondear se queda en
    // `incoming_payment_waiting` hasta que se fondee, y que fondear es
    // reintentable. Es el camino por el que van a pasar TODAS las órdenes
    // mientras el saldo de la cuenta siga a cero.
    if (input.providerPayoutId) {
      try {
        const t = (await wiseFetch(`/v1/transfers/${input.providerPayoutId}`)) as Transfer;
        if (t.status === "incoming_payment_waiting") {
          const f = await fondear(perfilId, t.id);
          if (!f.ok) {
            // Aquí SÍ se puede devolver 'sin-fondos': la fila ya tiene anotado su
            // `provider_payout_id`, así que dejarla como está no pierde nada y el
            // contador de bloqueos dice la verdad — que hay dinero que se debe y
            // una cuenta sin saldo, no una orden fallida.
            if (esFaltaDeSaldo(f.detalle)) {
              return {
                estado: "sin-fondos",
                mensaje: `la transferencia ${t.id} espera fondos en Wise: ${f.detalle}`,
              };
            }
            return desenlaceDeTransfer(t.status, String(t.id), false);
          }
          // Fondeada ahora mismo: se vuelve a preguntar, porque el estado que
          // teníamos es de antes de mover el dinero.
          const t2 = (await wiseFetch(`/v1/transfers/${t.id}`)) as Transfer;
          return desenlaceDeTransfer(t2.status, String(t2.id), false);
        }
        return desenlaceDeTransfer(t.status, String(t.id), false);
      } catch (e) {
        // Consultar no crea nada, así que la orden puede volver a la cola intacta.
        if (esCredencialInvalida(e)) {
          return { estado: "sin-credencial", mensaje: (e as Error).message, pudoCrear: false };
        }
        return { estado: "transitorio", mensaje: (e as Error).message, causa: e };
      }
    }

    // ── Camino 2 · se reclamó antes y no sabemos si llegó a crearse ─────────
    //
    // 🔴 AQUÍ NO SE CREA NADA. Una pasada anterior ganó esta fila y pudo llegar a
    // llamar a Wise. Reintentar la creación sería elegir pagar dos veces; lo
    // único honesto es buscar la marca y adoptar lo que haya.
    if (input.reanudar) {
      try {
        const encontrada = await barrer(perfilId, ctxId, input.claimedAt);
        if (encontrada) {
          return desenlaceDeTransfer(encontrada.status, String(encontrada.id), true);
        }
        return {
          estado: "sin-rastro",
          mensaje: `no hay ninguna transferencia con customerTransactionId ${ctxId} desde ${input.claimedAt}`,
        };
      } catch (e) {
        if (esCredencialInvalida(e)) {
          // La duda sigue en pie: la credencial se cayó DURANTE la comprobación.
          return { estado: "sin-credencial", mensaje: (e as Error).message, pudoCrear: true };
        }
        // Ni se sabe ni se puede saber. La fila se queda quieta a propósito.
        return {
          estado: "en-duda",
          mensaje: `falló el barrido que comprobaba si ${ctxId} llegó a crearse: ${(e as Error).message}`,
          causa: e,
        };
      }
    }

    // ── Camino 3 · crear ────────────────────────────────────────────────────
    //
    // ⚠️ EL DESTINO NO SALE DE AQUÍ. Se pide a `payout_beneficiary_wise`, viaja
    // al cuerpo del POST y ahí muere: no se devuelve, no se registra y no entra
    // en ningún mensaje de error. Un número de cuenta en un log es PII en un log.
    const admin = createAdminClient();
    const { data: benef, error: eBenef } = await admin.rpc("payout_beneficiary_wise", {
      p_payout_id: input.payoutId,
    });

    if (eBenef) {
      // ⚠️ REGLA DE ORO 9 DISFRAZADA DE PROBLEMA DEL TUTOR. Un 42501 aquí no es
      // «este tutor no rellenó el formulario»: es que a `service_role` le falta
      // el `execute` y NINGUNA orden se va a pagar. Confundirlos dejaría la cola
      // entera parada con un mensaje que culpa a los tutores.
      const esPermiso =
        (eBenef as { code?: string }).code === "42501" ||
        /permission denied|not allowed/i.test(eBenef.message);
      if (esPermiso) {
        return {
          estado: "transitorio",
          mensaje: `payout_beneficiary_wise no es ejecutable por service_role (regla de oro 9): ${eBenef.message}`,
          causa: eBenef,
        };
      }
      // ⚠️ LAS FRASES SON LAS DE *ESTA* FUNCIÓN, no las de PayPal. Copiar aquel
      // regex («no ha registrado su destino») no casaría con ninguna, todas
      // caerían en `rechazado`, y `rechazado` escribe 'failed' y manda NTF-16 a
      // un tutor cuyo único pecado es tener el formulario a medias. `sin-datos`
      // existe justo para eso: la orden espera, no muere.
      const sinDatos =
        /no ha registrado sus datos de cobro|son de .* y el payout es a|ya no son válidos|no le sirven a wise|no tiene país de destino/i.test(
          eBenef.message,
        );
      if (sinDatos) return { estado: "sin-datos", mensaje: eBenef.message };

      return { estado: "rechazado", mensaje: eBenef.message, causa: eBenef };
    }

    const b = benef as unknown as BeneficiarioWise;
    const montado = cuentaDeWise(b, perfilId);
    if ("motivo" in montado) {
      // No es un fallo de la orden ni de la API: es que con lo que este tutor
      // tiene registrado no se puede describir un destinatario para Wise. Espera.
      return { estado: "sin-datos", mensaje: montado.motivo };
    }

    try {
      // 1 · El presupuesto. `sourceAmount` es el importe de la orden, así que lo
      // que sale de nuestro saldo es exactamente eso y la comisión sale de
      // dentro. Caduca a los 30 minutos, por eso se pide aquí y no antes.
      const quote = (await wiseFetch(`/v3/profiles/${perfilId}/quotes`, {
        method: "POST",
        body: JSON.stringify({
          sourceCurrency: input.currency,
          targetCurrency: b.currency_to_pay,
          sourceAmount: input.amountMinor / 100,
          payOut: "BANK_TRANSFER",
        }),
      })) as { id: string };

      // 2 · El destinatario.
      //
      // ponytail: se crea uno por pago y no se guarda su id. Wise permite varias
      // transferencias al mismo destinatario, así que reutilizarlo sería más
      // barato — pero exige una columna donde guardarlo o un emparejamiento por
      // nombre y últimos dígitos, que es adivinar. El techo es que los
      // destinatarios se acumulan en el panel de Wise; si eso llega a estorbar,
      // la mejora es una columna, no una heurística.
      const cuenta = (await wiseFetch("/v1/accounts", {
        method: "POST",
        body: JSON.stringify(montado.cuenta),
      })) as { id: number };

      // 3 · Cuánto texto admite la referencia EN ESTE corredor. No es opcional y
      // no se puede tabular: el máximo va de 12 (Argentina) a 140 (Europa), y al
      // ejercitarlo salió un valor que no estaba en ninguna medición previa —18
      // en el corredor de la libra. Por eso se pregunta en vez de saberse.
      let maxRef = 12;
      try {
        const reqs = (await wiseFetch("/v1/transfer-requirements", {
          method: "POST",
          body: JSON.stringify({
            targetAccount: cuenta.id,
            quoteUuid: quote.id,
            details: { reference: "EY" },
          }),
        })) as Array<{ fields?: Array<{ group?: Array<{ key?: string; maxLength?: number }> }> }>;
        for (const bloque of reqs ?? []) {
          for (const campo of bloque.fields ?? []) {
            for (const g of campo.group ?? []) {
              if (g.key === "reference" && typeof g.maxLength === "number") maxRef = g.maxLength;
            }
          }
        }
      } catch {
        // Si no contesta, se usa el mínimo de todos los corredores medidos. Una
        // referencia corta de más es cosmética; una larga de más no sale.
      }

      // 4 · La transferencia. ES EL ÚNICO PASO QUE PUEDE PAGAR DOS VECES, y lo
      // que lo impide es que `customerTransactionId` sea el mismo en cada
      // reintento de la misma orden.
      const transfer = (await wiseFetch("/v1/transfers", {
        method: "POST",
        body: JSON.stringify({
          targetAccount: cuenta.id,
          quoteUuid: quote.id,
          customerTransactionId: ctxId,
          details: { reference: referenciaSegura(input.payoutId, maxRef) },
        }),
      })) as Transfer;

      // 5 · El fondeo. Falle o no, se devuelve 'enviado' CON el identificador:
      // la transferencia existe y la fila tiene que quedarse con su id o el
      // siguiente barrido tendría que redescubrirla. Si no hay saldo, el camino 1
      // lo reintentará en la pasada siguiente, que es para lo que existe.
      const f = await fondear(perfilId, transfer.id).catch((e) => ({
        ok: false,
        detalle: (e as Error).message,
      }));
      return {
        estado: "enviado",
        payoutId: String(transfer.id),
        detalle: f.ok ? "fondeada" : `creada, sin fondear: ${f.detalle}`,
        adoptado: false,
      };
    } catch (e) {
      if (esCredencialInvalida(e)) {
        // ⚠️ `pudoCrear: true`. La credencial pudo caerse DESPUÉS del POST de la
        // transferencia, y en ese caso la duda es real: la fila no se toca.
        return { estado: "sin-credencial", mensaje: (e as Error).message, pudoCrear: true };
      }
      if (esTransitorio(e)) {
        // ⚠️ Y AQUÍ NO SE PUEDE DEVOLVER LA ORDEN A LA COLA A CIEGAS: un timeout
        // en el paso 4 deja una transferencia creada que nadie ha anotado.
        // 'transitorio' la devuelve a 'scheduled', pero `reanudar` seguirá en
        // false... salvo que el job ya la haya reclamado, que es el caso: la
        // reclamó esta misma pasada. Por eso se barre ANTES de rendirse.
        try {
          const huerfana = await barrer(perfilId, ctxId, input.claimedAt);
          if (huerfana) {
            return desenlaceDeTransfer(huerfana.status, String(huerfana.id), true);
          }
          return { estado: "transitorio", mensaje: (e as Error).message, causa: e };
        } catch {
          return {
            estado: "en-duda",
            mensaje: `falló la creación y también el barrido que la comprobaba: ${(e as Error).message}`,
            causa: e,
          };
        }
      }
      return { estado: "rechazado", mensaje: (e as Error).message, causa: e };
    }
  },
};
