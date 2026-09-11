import "server-only";

/**
 * Cliente de Referral Factory (RF). **Server-only, y sin `NEXT_PUBLIC_`.**
 *
 * RF deja de ser una pantalla embebida y pasa a ser SOLO backend: la app emite
 * el enlace, pinta las cifras desde nuestra base y toca RF en dos momentos —al
 * dar de alta al referidor (primera visita a `/referidos`) y al convertir (el
 * cron)—. Ninguno de los dos está en el camino crítico de registro ni de pago,
 * y eso no es elegancia: medido el 10-sep-2026, RF normalmente responde en
 * menos de 1 s pero tiene **picos de más de 25 s** (3 de 40 llamadas). Una
 * pantalla que lo esperase se quedaría colgada un cuarto de minuto.
 *
 * ⚠️ LA CREDENCIAL ES EL INTERRUPTOR (CLAUDE.md). Sin `REFERRAL_FACTORY_API_KEY`
 * nada revienta: `/referidos` se pinta con el aviso de «todavía no está activo»
 * y el cron responde `sin-credencial` con 200. Poner la variable es el
 * despliegue.
 *
 * Lo que la API hace y NO hace, medido con la clave real de la cuenta del
 * cliente (INSTRUCCIONES-DESARROLLO.md §1):
 *
 *   · `POST users` → 201 con `id, code, url, sharing[], qr{}`, y **no manda
 *     ningún correo** al usuario creado (comprobado en el buzón). Con
 *     `referrer_code` el usuario nace colgando de ese referidor; un código
 *     inválido da 422.
 *   · `PUT users/{id} {campaign_id, qualified:true}` → 200, fija `qualified_at`
 *     y sube el contador del referidor al instante. **No existe**
 *     `POST users/{id}/qualify` ni `/convert`: son 404.
 *   · `GET users?campaign_id=` **IGNORA el filtro** y devuelve todos, paginado
 *     de 25. Por eso la pantalla no lo usa para nada.
 *   · `account`, `me`, `plan`, `webhooks`, `events` → 404. No hay webhooks que
 *     enganchar: la conversión la detecta nuestro cron, no un aviso de RF.
 */

const BASE = "https://api.referral-factory.com/api/v1";

/**
 * Por debajo del pico conocido de RF (>25 s) a propósito: más vale cortar y
 * reintentar en la pasada siguiente que dejar una petición de Vercel colgada.
 * Ninguna de las dos llamadas es urgente —el enlace se prepara en la visita
 * siguiente y la recompensa se contabiliza en la hora siguiente—, así que un
 * timeout aquí no pierde nada.
 */
const TIMEOUT_MS = 8_000;

export type RfCampaign = {
  id: number;
  name: string;
  lang: string | null;
  url: string;
  code: string;
  status: string;
  reach?: number | null;
  live?: boolean | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

export type RfReward = {
  id: number;
  campaign_id: number;
  name: string;
  reward_for: string | null;
  type: string | null;
  value: string | number | null;
  when_referral: string | null;
};

export type RfUser = {
  id: number;
  code: string;
  url: string;
  email?: string | null;
  first_name?: string | null;
  referrals_count?: number | null;
  converted_referrals_count?: number | null;
  sharing?: { social: string; url: string }[] | null;
  qr?: { url?: string | null } | Record<string, unknown> | null;
};

/**
 * Error de RF con el `status` a la vista: quien llama decide si reintenta.
 *
 * La distinción importa en el cron: un 422 «email already exists» es
 * PERMANENTE (reintentarlo cada hora para siempre no lo arregla) y un timeout o
 * un 5xx es transitorio. Sin el status no se pueden separar y se acaba tratando
 * todo igual, que es como una cola se atasca en silencio.
 */
export class ReferralFactoryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ReferralFactoryError";
  }

  /** ¿Vale la pena reintentarlo en la pasada siguiente? */
  get retriable(): boolean {
    // 0 = red caída o timeout nuestro. 429 y 5xx = mal minuto de RF.
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

async function rf<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.REFERRAL_FACTORY_API_KEY;
  if (!key) throw new ReferralFactoryError(0, "REFERRAL_FACTORY_API_KEY no configurada");

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
      // Nunca cacheado: `POST users` crea y `GET campaigns` lo pide el admin
      // justo para ver lo último que hay en RF.
      cache: "no-store",
    });
  } catch (e) {
    throw new ReferralFactoryError(
      0,
      e instanceof Error && e.name === "AbortError"
        ? `RF no respondió en ${TIMEOUT_MS} ms (${method} ${path})`
        : `RF inalcanzable (${method} ${path}): ${String(e)}`,
    );
  } finally {
    clearTimeout(t);
  }

  const texto = await res.text();
  if (!res.ok) {
    // RF devuelve `{message}` o `{errors:{campo:[…]}}` según el fallo. Se
    // conserva el cuerpo crudo recortado: es lo único que dice POR QUÉ.
    throw new ReferralFactoryError(res.status, `RF ${res.status} ${method} ${path}: ${texto.slice(0, 300)}`);
  }
  return (texto ? JSON.parse(texto) : {}) as T;
}

/** El interruptor. Sin clave, ni la pantalla ni el cron llaman a RF. */
export function isReferralFactoryConfigured(): boolean {
  return Boolean(process.env.REFERRAL_FACTORY_API_KEY?.trim());
}

export const listCampaigns = () => rf<{ data: RfCampaign[] }>("GET", "campaigns");

export const listRewards = () => rf<{ data: RfReward[] }>("GET", "rewards");

/**
 * Da de alta a alguien en una campaña. Con `referrer_code`, nace colgando de
 * ese referidor — que es la única forma que hay de atribuir: RF no tiene
 * ninguna llamada para emparejar a dos usuarios que ya existen.
 */
export const createUser = (p: {
  campaign_id: number;
  first_name: string;
  email: string;
  referrer_code?: string;
}) => rf<{ data: RfUser }>("POST", "users", p);

/** Marca la conversión. `PUT`, no `POST .../qualify`: eso es 404 en RF. */
export const qualifyUser = (id: number, campaign_id: number) =>
  rf<{ data: RfUser }>("PUT", `users/${id}`, { campaign_id, qualified: true });

/** El QR que devuelve RF, que no siempre viene y no siempre trae `url`. */
export function qrUrlDe(u: RfUser): string | null {
  const qr = u.qr as { url?: unknown } | null | undefined;
  return typeof qr?.url === "string" ? qr.url : null;
}
