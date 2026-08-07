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
export async function ensureRoom(
  name: string,
  expiresAt: Date,
  /** US-1801 · solo con el sí de los DOS (RN-42). Es propiedad de SALA. */
  recording = false,
): Promise<string> {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const properties = {
    exp,
    eject_at_room_exp: true,
    // Acuerdo de la reunión del 17-jul (00:24:48): el chat de la sala es el
    // NUESTRO (EP-17, panel lateral de LV01). El de Daily se apaga por dos
    // razones: no queremos dos chats, y el suyo se cobra aparte como
    // almacenamiento. Es propiedad de SALA, no del iframe.
    enable_chat: false,
    // Sin consentimiento la sala ni ofrece el botón de grabar: el permiso no
    // se pide en la interfaz, se quita del proveedor (RN-42).
    enable_recording: recording ? "cloud" : false,
  };

  const created = await daily("/rooms", {
    method: "POST",
    body: JSON.stringify({ name, privacy: "private", properties }),
  });

  if (created.ok) {
    const room = (await created.json()) as { url: string };
    return room.url;
  }

  // 400 con "already exists" → la sala ya está; se recupera su URL.
  // Se le reaplican las propiedades: el consentimiento puede haber llegado
  // DESPUÉS de que el primero entrara y creara la sala, y sin este PATCH la
  // grabación se quedaría apagada toda la clase.
  const existing = await daily(`/rooms/${name}`, {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
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

/**
 * RN-42 / NTF-19: una grabación vive 30 días desde que la clase termina. Vive
 * aquí y no en la ruta que la sirve porque hay DOS consumidores —el endpoint
 * que da el enlace y el job que borra— y si cada uno tuviera su número la
 * retención publicada dejaría de significar una sola cosa.
 */
export const RECORDING_DAYS = 30;

/** Grabación de una sala, tal como la devuelve Daily. */
export type DailyRecording = {
  id: string;
  duration: number;
  start_ts: number;
  status: string;
};

/**
 * US-1802 · las grabaciones de una sala. Se consultan a Daily en el momento en
 * vez de sincronizarlas a una tabla nuestra: el fichero vive en el proveedor y
 * una copia de sus metadatos solo añadiría un sitio más donde quedar desfasado.
 */
export async function listRecordings(room: string): Promise<DailyRecording[]> {
  const res = await daily(`/recordings?room_name=${encodeURIComponent(room)}`);
  if (!res.ok) return [];
  const { data } = (await res.json()) as { data?: DailyRecording[] };
  return (data ?? []).filter((r) => r.status === "finished");
}

/**
 * Enlace de descarga firmado por Daily. Es efímero (lo caduca el proveedor), y
 * por eso se pide al hacer clic y no se guarda en ninguna parte — mismo criterio
 * que los meeting-tokens y que las URLs firmadas de Storage.
 */
export async function recordingLink(id: string): Promise<string | null> {
  const res = await daily(`/recordings/${id}/access-link`);
  if (!res.ok) return null;
  const { download_link, link } = (await res.json()) as {
    download_link?: string;
    link?: string;
  };
  return download_link ?? link ?? null;
}

/**
 * Borra una grabación en el proveedor. Es lo que convierte la retención de
 * 30 días en un borrado de verdad y no solo en un 410 al pedir el enlace
 * (`/api/cron/recordings-purge`).
 *
 * Un 404 cuenta como éxito: significa que ya no está, que es exactamente el
 * estado que buscábamos. Sin eso, un reintento tras una purga a medias se
 * quedaría atascado para siempre en la misma sesión.
 */
export async function deleteRecording(id: string): Promise<boolean> {
  const res = await daily(`/recordings/${id}`, { method: "DELETE" });
  return res.ok || res.status === 404;
}
