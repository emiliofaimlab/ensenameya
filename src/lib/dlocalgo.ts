import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cliente de dLocal Go. **Solo servidor** — el par `API_KEY:SECRET_KEY` puede
 * crear cobros, reembolsos y payouts en nombre del comercio. Misma regla que
 * `service_role`, `STRIPE_API_KEY` y `DAILY_API_KEY`: el `server-only` de arriba
 * rompe el build si alguien lo importa desde un componente cliente, en vez de
 * filtrar la credencial en el bundle.
 *
 * Es el gemelo de `lib/stripe.ts` y ocupa su mismo sitio en el invariante que
 * hace barato tener dos PSP: `dlocalgoFetch` solo se importa desde ESTE archivo
 * y desde `lib/payments/dlocal-provider.ts`. Si aparece un tercero, algo se ha
 * escapado del puerto.
 *
 * ⚠️ NO HAY SDK. dLocal Go no publica cliente de Node, así que aquí abajo hay
 * `fetch` a pelo. Eso quita la red que el SDK de Stripe pone gratis —reintentos,
 * tipos, `Idempotency-Key`— y esas tres ausencias son justo las que explican la
 * forma del adaptador. Ver `dlocal-provider.ts`.
 *
 * LA CREDENCIAL ES EL INTERRUPTOR, como el resto del proyecto: sin las dos
 * claves no se llama a nadie y el checkout devuelve 503 diciendo cuál falta.
 * Encender dLocal es poner las variables y cambiar la fila de
 * `payment_routing_rules` — en ese orden, y lo segundo lo decide Jose.
 */

/**
 * ⚠️ POR DEFECTO, SANDBOX. Y es una decisión de seguridad, no una comodidad.
 *
 * Los dos ambientes son dos HOSTS distintos con dos juegos de claves distintos
 * (`api-sbx.dlocalgo.com` y `api.dlocalgo.com`); no hay un prefijo en la clave
 * que distinga uno de otro como en Stripe (`sk_test_` / `sk_live_`). O sea que
 * el código NO PUEDE saber solo si la credencial que le han puesto mueve dinero
 * de verdad.
 *
 * Ante esa duda, el default se equivoca hacia el lado barato: apuntar a sandbox
 * con claves de producción da errores de autenticación —ruidoso e inofensivo—,
 * mientras que apuntar a producción con claves de sandbox... también falla, sí,
 * pero el día que alguien copie las claves buenas sin tocar esta variable, el
 * primer cobro sería real. Pasar a producción es un acto explícito.
 */
const BASE_SANDBOX = "https://api-sbx.dlocalgo.com";
const BASE_LIVE = "https://api.dlocalgo.com";

export function dlocalgoBase(): string {
  return process.env.DLOCALGO_API_BASE?.trim() || BASE_SANDBOX;
}

/** ¿Estamos apuntando al host que mueve dinero de verdad? Solo para el log. */
export function dlocalgoEsProduccion(): boolean {
  return dlocalgoBase().startsWith(BASE_LIVE);
}

function credenciales(): { apiKey: string; secretKey: string } | null {
  const apiKey = process.env.DLOCALGO_API_KEY;
  const secretKey = process.env.DLOCALGO_SECRET_KEY;
  if (!apiKey || !secretKey) return null;
  return { apiKey, secretKey };
}

/**
 * ¿Hay credencial para hablar con dLocal Go?
 *
 * Las DOS claves hacen falta para todo: a diferencia de Stripe —donde la
 * publicable solo la necesita el navegador y por eso `isStripeConfigured()`
 * mira solo la secreta— aquí las dos viajan juntas en cada petición, dentro de
 * la misma cabecera `Authorization`. No hay una pregunta del cobro distinta de
 * la del reembolso, y por eso el adaptador contesta lo mismo a las dos.
 */
export function isDlocalGoConfigured(): boolean {
  return credenciales() !== null;
}

/**
 * ⚠️ LA CABECERA ES `Bearer <apiKey>:<secretKey>`, CON LOS DOS PEGADOS POR DOS
 * PUNTOS Y SIN BASE64.
 *
 * Parece Basic Auth y no lo es: no se codifica nada. Escribirlo como Basic
 * —que es el reflejo al ver `usuario:clave`— devuelve 401 sin más explicación.
 */
function cabeceraAuth(apiKey: string, secretKey: string): string {
  return `Bearer ${apiKey}:${secretKey}`;
}

/** Lo que dLocal Go devuelve cuando algo va mal: `{code, message}`. */
export type ErrorDlocalGo = { code: number; message: string };

export class DlocalGoError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "DlocalGoError";
  }

  /**
   * `5009 Order id is duplicated` — el `order_id` ya se usó.
   *
   * NO es "ya hiciste esta petición, aquí tienes la respuesta de antes", que es
   * lo que haría una `Idempotency-Key` de Stripe: es un rechazo seco. La
   * diferencia es el motivo entero de que el adaptador tenga que emular la
   * idempotencia por su cuenta. Ver `dlocal-provider.ts`.
   */
  get esOrderIdDuplicado(): boolean {
    return this.code === 5009;
  }

  /**
   * ¿Fue el momento o fue la petición? Mismo criterio que `esFalloTransitorio`
   * en el adaptador de Stripe, y con el mismo peso: decide si una fila de la
   * cola de reembolsos se queda `pending` o salta a `failed`.
   *
   * Sin SDK no hay taxonomía de tipos, así que se clasifica por HTTP: 429 y
   * 5xx son del proveedor y se reintentan; 4xx es nuestra petición y repetirla
   * dará el mismo error mañana.
   */
  get esTransitorio(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/**
 * Una llamada a la API. Perezosa con la credencial a propósito: instanciar o
 * validar en el top-level revienta `next build` cuando la clave no está en el
 * entorno de build, que es exactamente el estado del proyecto hasta que se
 * configure en Vercel.
 *
 * ⚠️ SIN REINTENTOS. Sin SDK no hay reintento con backoff, y añadirlo a ciegas
 * aquí sería peligroso: `POST /v1/payments` NO es idempotente (ver 5009 arriba)
 * y `POST /v1/payouts` no tiene NINGUNA clave de idempotencia —comprobado
 * contra el sandbox el 1-sep-2026: el cuerpo documentado no admite `external_id`
 * ni equivalente—, así que un reintento automático de un payout es un pago
 * doble. Quien quiera reintentar, que lo decida con la fila delante.
 */
export async function dlocalgoFetch<T>(
  metodo: "GET" | "POST",
  ruta: string,
  cuerpo?: unknown,
): Promise<T> {
  const cred = credenciales();
  if (!cred) throw new Error("dLocal Go no configurado (faltan DLOCALGO_API_KEY / DLOCALGO_SECRET_KEY)");

  const res = await fetch(`${dlocalgoBase()}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: cabeceraAuth(cred.apiKey, cred.secretKey),
      "Content-Type": "application/json",
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    // Nada de caché: son cobros y saldos.
    cache: "no-store",
  });

  const texto = await res.text();
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    // Respuesta no-JSON (un 502 de su balanceador, una página de error).
    if (!res.ok) throw new DlocalGoError(res.status, null, texto.slice(0, 200) || res.statusText);
  }

  if (!res.ok) {
    const err = datos as Partial<ErrorDlocalGo> | null;
    throw new DlocalGoError(
      res.status,
      typeof err?.code === "number" ? err.code : null,
      err?.message ?? res.statusText,
    );
  }
  return datos as T;
}

/**
 * ── UNIDADES ────────────────────────────────────────────────────────────────
 *
 * El puerto habla en unidades MENORES (`amountMinor`, como `payments.
 * gross_amount`); dLocal Go habla en unidades mayores con dos decimales
 * (`500.00`). La división vive AQUÍ y en ningún sitio antes: un importe
 * dividido de más arriba viajaría ya adulterado por el resto del código, y la
 * regla de oro 2 dice que el importe sale de `payments.gross_amount` — no de
 * `payments.gross_amount` pasado por las manos de alguien.
 *
 * ⚠️ NO TODAS LAS MONEDAS TIENEN DOS DECIMALES. El peso chileno y el guaraní
 * NO tienen céntimos: 5000 CLP son cinco mil pesos, no cincuenta. Dividir por
 * 100 a ciegas cobraría la centésima parte, y el error saldría en la única
 * dirección que nadie reporta —de menos—. Los dos son monedas de payout de
 * dLocal Go (CL y PY), así que el caso no es teórico.
 */
const SIN_CENTIMOS = new Set(["CLP", "PYG", "JPY", "KRW", "VND", "ISK"]);

export function exponenteDe(currency: string): 0 | 2 {
  return SIN_CENTIMOS.has(currency.toUpperCase()) ? 0 : 2;
}

/** De unidades menores a lo que dLocal Go espera en el cuerpo. */
export function aUnidadMayor(amountMinor: number, currency: string): number {
  return exponenteDe(currency) === 0 ? amountMinor : amountMinor / 100;
}

/** El camino de vuelta: de lo que dLocal Go devuelve, a unidades menores. */
export function aUnidadMenor(amount: number, currency: string): number {
  return Math.round(exponenteDe(currency) === 0 ? amount : amount * 100);
}

/**
 * ── LA FIRMA DE LAS NOTIFICACIONES ──────────────────────────────────────────
 *
 * `HMAC-SHA256(API_KEY + rawBody, SECRET_KEY)`, en hexadecimal. La cabecera que
 * llega es:
 *
 *   Authorization: V2-HMAC-SHA256, Signature: <hex>
 *
 * ⚠️ EL MENSAJE LLEVA LA API KEY PEGADA DELANTE DEL CUERPO, sin separador. Y el
 * SECRETO es la clave del HMAC, no parte del mensaje. Cambiar esos dos papeles
 * es el error clásico y produce una firma que no cuadra nunca — o, si alguien
 * "lo arregla" quitando la verificación, un endpoint público capaz de marcar
 * reservas como pagadas con un POST.
 *
 * ⚠️ Y `rawBody` ES LA CADENA EXACTA que llegó por la red. Lee `WebhookInput`
 * en `port.ts` antes de tocar nada de esto.
 *
 * ⚠️ SIN TIMESTAMP NI NONCE, y conviene decirlo porque es una diferencia real
 * con Stripe: la firma de dLocal Go no incluye la hora, así que **no caduca**.
 * Quien capture una notificación válida puede reproducirla mañana y la firma
 * seguirá cuadrando. Lo que impide que eso haga daño NO es la firma: es que el
 * webhook vuelve a preguntar el estado a la API (`GET /v1/payments/{id}`) y que
 * `confirm_payment` es idempotente. Por eso el webhook no se puede "simplificar"
 * creyéndose el cuerpo.
 */
const PREFIJO_FIRMA = "V2-HMAC-SHA256";

export function firmarNotificacion(rawBody: string): string | null {
  const cred = credenciales();
  if (!cred) return null;
  return createHmac("sha256", cred.secretKey)
    .update(cred.apiKey + rawBody, "utf8")
    .digest("hex");
}

/** Saca el hexadecimal de `V2-HMAC-SHA256, Signature: <hex>`. */
export function firmaDeCabecera(cabecera: string | null): string | null {
  if (!cabecera) return null;
  if (!cabecera.includes(PREFIJO_FIRMA)) return null;
  const m = /Signature\s*:\s*([0-9a-fA-F]+)/.exec(cabecera);
  return m?.[1]?.toLowerCase() ?? null;
}

/**
 * Compara en tiempo constante. `===` sobre cadenas se corta en el primer byte
 * distinto y filtra, byte a byte, cuánto se acertó: con suficientes intentos
 * eso construye una firma válida sin conocer el secreto.
 */
export function firmaCuadra(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada, "hex");
  const b = Buffer.from(recibida, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * ── OBJETOS DE LA API, con lo que de verdad se lee ──────────────────────────
 * Transcritos de las respuestas REALES del sandbox (1-sep-2026), no solo de la
 * documentación: `direct` y `balance_currency` no salen en la tabla de la doc y
 * sí en el JSON.
 */
export type PagoDlocalGo = {
  id: string;
  amount: number;
  currency: string;
  /** La moneda del SALDO del comercio. En esta cuenta, USD. */
  balance_currency?: string;
  country?: string;
  order_id: string;
  status: "PENDING" | "PAID" | "REJECTED" | "CANCELLED" | "EXPIRED";
  rejected_reason?: string;
  /** A dónde se manda a la persona a pagar. Ver el desajuste 1 del adaptador. */
  redirect_url?: string;
  created_date?: string;
  approved_date?: string;
};

export type ReembolsoDlocalGo = {
  id: string;
  payment_id?: string;
  amount?: number;
  currency?: string;
  status: "PENDING" | "SUCCESS" | "REJECTED" | "CANCELLED";
};

/** `GET /v1/payments/{id}` — la única fuente de verdad del estado de un cobro. */
export async function recuperarPago(id: string): Promise<PagoDlocalGo> {
  return await dlocalgoFetch<PagoDlocalGo>("GET", `/v1/payments/${encodeURIComponent(id)}`);
}

/**
 * ── PAYOUTS (C2) ────────────────────────────────────────────────────────────
 *
 * `POST /v1/payouts` es, en palabras de su propia documentación, «a withdrawal
 * that a merchant makes from its available dLocal Go balance to the bank account
 * of a third party». O sea: paga a OTRA persona, sale del balance de dLocal Go,
 * y **cobrar por Stripe no lo financia**. Esa última frase no es un matiz
 * contable, es la que decide qué órdenes se pueden mandar (ver
 * `payouts.funding_provider` y su comentario en `20260901130000`).
 *
 * ⚠️ LOS OCHO ESTADOS, Y QUE NO SON LOS NUESTROS. dLocal Go usa
 * `PENDING · PROCESSING · ON_HOLD · DELIVERED · COMPLETED · CANCELLED ·
 * REJECTED · FAILED`; `public.payout_status` usa
 * `pending · scheduled · processing · paid · failed · on_hold`. Se parecen lo
 * justo para equivocarse: su `ON_HOLD` **no** es nuestro `on_hold` (el nuestro
 * lo pone un admin y `manage_payout('release')` lo devuelve a 'scheduled', o
 * sea que traducirlo así reenviaría una orden que el proveedor ya tiene). La
 * traducción vive en `dlocal-provider.ts` y solo allí.
 */
export type EstadoPayoutDlocalGo =
  | "PENDING"
  | "PROCESSING"
  | "ON_HOLD"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"
  | "FAILED";

/**
 * Un payout tal como lo devuelve la API.
 *
 * ⚠️ TODO ES OPCIONAL MENOS `id` Y `status`, Y NO ES PEREZA. Al escribir esto
 * la cuenta de sandbox devolvía `403 {"code":3001,"message":"Invalid
 * Credentials."}` a TODA petición —incluidas las que sí funcionaron el mismo día
 * con estas mismas claves— así que la forma exacta de la respuesta **no está
 * verificada contra la API viva**, al revés que todo lo demás de este archivo.
 * Lo que sí está verificado por quien abrió la cuenta: los ocho estados, que el
 * cuerpo no admite `external_id` ni equivalente, y que un 400 puede haber creado
 * el payout igual.
 *
 * Consecuencia práctica: los campos que el barrido de reconciliación necesita se
 * leen con `campoNumero`/`campoTexto` probando VARIOS nombres, y lo que no se
 * puede leer se trata como «podría ser nuestro» (ver `dlocal-provider.ts`).
 * Cuando alguien pueda volver a llamar a la API, se transcribe la respuesta real
 * aquí y esos alias sobran.
 */
export type PayoutDlocalGo = {
  id: string;
  status: EstadoPayoutDlocalGo | string;
  /** El importe en unidad MAYOR, como todo en esta API. */
  transfer_amount?: number;
  amount?: number;
  /** La moneda que recibe el beneficiario. */
  currency_to_pay?: string;
  currency?: string;
  transfer_country?: string;
  country?: string;
  beneficiary_document?: string;
  created_date?: string;
  created_at?: string;
  status_code?: string | number;
  status_detail?: string;
  [k: string]: unknown;
};

/** Lee un número de un payout probando los nombres que puede traer. */
export function campoNumero(p: PayoutDlocalGo, ...claves: string[]): number | null {
  for (const k of claves) {
    const v = p[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** Lo mismo para texto. Devuelve en mayúsculas: los códigos de país y moneda lo son. */
export function campoTexto(p: PayoutDlocalGo, ...claves: string[]): string | null {
  for (const k of claves) {
    const v = p[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim().toUpperCase();
  }
  return null;
}

/**
 * El cuerpo del `POST /v1/payouts`.
 *
 * Los trece campos de abajo son EXACTAMENTE lo que devuelve
 * `payout_beneficiary(payout_id)` más `transfer_amount`, y esa correspondencia
 * es deliberada: la construye la base de datos, que es quien tiene los datos y
 * quien sabe qué exige cada país. Este archivo no compone beneficiarios.
 */
export type NuevoPayoutDlocalGo = {
  transfer_amount: number;
  transfer_country: string;
  currency_to_pay: string;
  flow_type: string;
  purpose: string;
  beneficiary_first_name: string;
  beneficiary_last_name: string;
  beneficiary_document: string;
  beneficiary_document_type: string;
  bank_code: string;
  bank_account: string;
  bank_account_type?: string | null;
  bank_branch?: string | null;
};

/**
 * 🔴 CREAR UN PAYOUT. Es la llamada que mueve dinero de verdad y la única de
 * este archivo que NO SE PUEDE REINTENTAR A CIEGAS.
 *
 * No hay `Idempotency-Key`, no hay `external_id`, y `order_id` —el sustituto que
 * salva al cobro— no existe en payouts. Además un 400 puede haber creado el
 * payout igual. Quien llame a esto tiene que haber leído la emulación de
 * idempotencia de `dlocal-provider.ts` entera; no hay atajo.
 */
export async function crearPayout(cuerpo: NuevoPayoutDlocalGo): Promise<PayoutDlocalGo> {
  return await dlocalgoFetch<PayoutDlocalGo>("POST", "/v1/payouts", cuerpo);
}

/** `GET /v1/payouts/{id}` — el estado de una orden que ya tiene identidad. */
export async function recuperarPayout(id: string): Promise<PayoutDlocalGo> {
  return await dlocalgoFetch<PayoutDlocalGo>("GET", `/v1/payouts/${encodeURIComponent(id)}`);
}

/**
 * `GET /v1/payouts` — el listado, que es lo que SUSTITUYE a la clave de
 * idempotencia que la API no tiene.
 *
 * ⚠️ La forma de la envoltura tampoco está verificada (ver `PayoutDlocalGo`), y
 * los listados de esta API son estilo Spring: `page` / `page_size` con
 * `totalElements`. Se aceptan las tres formas que puede tener el array —`data`,
 * `content`, `results`— y también que la respuesta sea el array pelado. Si
 * ninguna cuadra devuelve `null`, que NO es lo mismo que una lista vacía: una
 * lista vacía prueba que nuestro payout no existe; un `null` no prueba nada, y
 * quien llama tiene que tratarlo como duda y no como ausencia.
 */
export async function listarPayouts(pagina = 0, tam = 100): Promise<PayoutDlocalGo[] | null> {
  const bruto = await dlocalgoFetch<unknown>(
    "GET",
    `/v1/payouts?page=${pagina}&page_size=${tam}`,
  );
  if (Array.isArray(bruto)) return bruto as PayoutDlocalGo[];
  if (bruto && typeof bruto === "object") {
    for (const k of ["data", "content", "results", "payouts"]) {
      const v = (bruto as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as PayoutDlocalGo[];
    }
  }
  return null;
}

/**
 * ¿Este error es «no hay saldo»?
 *
 * ⚠️ NO ES UN FALLO PERMANENTE y por eso se reconoce aparte: es dinero que se
 * debe y que saldrá en cuanto se fondee el balance. Comprobado en el sandbox
 * (75 USD sobre un saldo menor → «Insufficient funds»). Se reconoce por TEXTO,
 * como el «ya reembolsado» de los reembolsos, porque dLocal no publica un código
 * para esto; si el mensaje cambia, el error cae a `rechazado`, que manda la
 * orden a revisión humana en vez de reintentarla eternamente.
 *
 * ⚠️ Y AL REVÉS TAMBIÉN IMPORTA: la comprobación de fondos corre ANTES que la de
 * campos, así que recibir esto **no dice nada** sobre si el resto del payload es
 * válido. Un payout que solo ha visto «insufficient funds» sigue sin estar
 * probado.
 */
export function esSaldoInsuficiente(e: DlocalGoError): boolean {
  return /insufficient\s+funds|saldo\s+insuficiente|not\s+enough\s+(funds|balance)/i.test(
    e.message,
  );
}
