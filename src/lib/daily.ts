import "server-only";

/**
 * Cliente de la API de Daily (EP-08). **Solo servidor**: `DAILY_API_KEY` crea
 * salas y FIRMA los meeting-tokens de acceso — en el navegador cualquiera
 * podría fabricarse entrada a cualquier clase. Misma regla que `service_role`.
 */
const API = "https://api.daily.co/v1";

/**
 * La CREDENCIAL es el interruptor (mismo patrón que el PSP): con
 * `DAILY_API_KEY` se usa Daily real; sin ella, la sala va simulada. Así el
 * proyecto sigue siendo demo-able sin cuenta, y activar el proveedor es poner
 * la variable — sin tocar código ni flags aparte.
 *
 * Deliberadamente NO hay fallback a simulado cuando Daily falla estando
 * configurado: un error del proveedor debe verse, no disfrazarse de clase.
 */
export function isDailyConfigured(): boolean {
  return Boolean(process.env.DAILY_API_KEY);
}

function apiKey(): string {
  const key = process.env.DAILY_API_KEY;
  if (!key) throw new Error("DAILY_API_KEY no configurada");
  return key;
}

async function daily(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  return res;
}

/**
 * Crea la sala si no existe y devuelve su URL. Idempotente: si Daily responde
 * que ya existe, se recupera — dos participantes entrando a la vez no chocan.
 * `exp` cierra la sala sola pasada la ventana de acceso (RN-18): aunque alguien
 * guarde la URL, Daily deja de admitir a nadie.
 */
export async function ensureRoom(name: string, expiresAt: Date): Promise<string> {
  const exp = Math.floor(expiresAt.getTime() / 1000);

  const created = await daily("/rooms", {
    method: "POST",
    body: JSON.stringify({
      name,
      privacy: "private", // sin token no se entra
      properties: { exp, eject_at_room_exp: true },
    }),
  });

  if (created.ok) {
    const room = (await created.json()) as { url: string };
    return room.url;
  }

  // 400 con "already exists" → la sala ya está; se recupera su URL.
  const existing = await daily(`/rooms/${name}`);
  if (existing.ok) {
    const room = (await existing.json()) as { url: string };
    return room.url;
  }

  const body = await created.text();
  throw new Error(`Daily no pudo crear la sala: ${created.status} ${body.slice(0, 200)}`);
}

/**
 * Firma un meeting-token acotado a (sala, usuario, expiración). El tutor entra
 * como `owner` (puede expulsar/controlar la sala); el alumno, no.
 * No se almacena (Doc 1 §1.4.11).
 */
export async function mintToken(opts: {
  room: string;
  userName: string;
  userId: string;
  isOwner: boolean;
  expiresAt: Date;
}): Promise<string> {
  const res = await daily("/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: opts.room,
        user_name: opts.userName,
        user_id: opts.userId,
        is_owner: opts.isOwner,
        exp: Math.floor(opts.expiresAt.getTime() / 1000),
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Daily no pudo firmar el token: ${res.status} ${body.slice(0, 200)}`);
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}
