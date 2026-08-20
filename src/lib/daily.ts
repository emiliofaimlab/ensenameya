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
 * Margen que se le suma a la duración de la mentoría para decidir cuánto puede
 * estar UN PARTICIPANTE conectado de seguido. Ver `participantEjectAfterSec`.
 *
 * Dos horas y no veinte minutos porque el tope se cuenta desde que esa persona
 * entró, no desde que empieza la clase: quien abre la sala un rato antes tiene
 * que llegar al final igualmente. Es un tope de COSTE, no de puntualidad.
 */
const PARTICIPANT_GRACE_MS = 2 * 60 * 60_000;

/**
 * MN-05 · Segundos que Daily deja a un participante dentro antes de echarlo
 * (`eject_after_elapsed`, se cuenta desde SU entrada, y se reinicia si vuelve).
 *
 * ⚠️ ESTO EXISTE POR CULPA DE MN-05 Y HAY QUE ENTENDER POR QUÉ, o el día que
 * alguien lo vea "de más" lo borrará y llegará una factura.
 *
 * Hasta MN-05 el tope lo ponía `eject_at_room_exp` gratis: la sala expiraba en
 * `fin + 10 min`, así que nadie podía quedarse dentro más allá de eso. Ahora la
 * sala expira SIETE DÍAS después, y `eject_at_room_exp` echa a la gente… a los
 * siete días. Una pestaña olvidada con la cámara abierta serían ~10 000
 * minutos-participante facturados por una clase de una hora.
 *
 * Y sí, es compatible con lo que dice el plan (§20.10): «la sala abierta 7 días
 * no cuesta nada, se factura por minuto-participante». Exacto — una sala VACÍA
 * no cuesta nada. Lo que cuesta es la gente dentro, y de eso `exp` ya no protege.
 */
export function participantEjectAfterSec(startsAt: Date, endsAt: Date): number {
  const ms = endsAt.getTime() - startsAt.getTime() + PARTICIPANT_GRACE_MS;
  return Math.round(ms / 1000);
}

/**
 * Crea la sala si no existe y devuelve su URL. Idempotente: si Daily responde
 * que ya existe, se recupera — dos participantes entrando a la vez no chocan.
 * `exp` cierra la sala sola pasada la ventana de acceso (RN-18): aunque alguien
 * guarde la URL, Daily deja de admitir a nadie.
 *
 * MN-05 · Ese `exp` ya no es «fin + 10 min»: es `sessions.access_closes_at`, o
 * sea el fin + 7 días que pidió el cliente (P-6). Lo calcula la BD y lo devuelve
 * `join_session`; aquí solo se aplica. El tope de permanencia de cada persona
 * pasó a `eject_after_elapsed` — ver `participantEjectAfterSec`.
 *
 * MN-05a · Este `exp` es el de la SALA y ya no manda sobre el del token: el
 * meeting-token se firma corto por su cuenta (ver `mintToken`). Por eso abrir
 * la sala días antes y dejarla abierta días después —lo que pidió el cliente en
 * MN-05— dejó de ser un riesgo: lo que se alargaba con la sala no era la sala,
 * eran las CREDENCIALES de entrada.
 *
 * Y que quede escrito para no volver a discutirlo: **Daily no factura por sala
 * abierta, sino por minuto-participante**. Una sala vacía con el `exp` lejano
 * no cuesta nada — el coste nunca fue un argumento contra MN-05; el token sí.
 *
 * Ojo al tocar la ventana: cuando la sala ya existe, más abajo se le REAPLICAN
 * las propiedades en cada join. Un cambio de fórmula alcanza a las salas ya
 * creadas, pero solo en el siguiente join, nunca antes. Con salas que ahora
 * viven una semana eso deja de ser teórico: la sala de una clase reprogramada
 * sigue por ahí con el `exp` viejo hasta que alguien vuelva a entrar.
 */
export async function ensureRoom(
  name: string,
  expiresAt: Date,
  /** US-1801 · solo con el sí de los DOS (RN-42). Es propiedad de SALA. */
  recording = false,
  /** MN-05 · tope de permanencia por persona. Sin default a propósito: con la
   *  sala viva 7 días, olvidarlo es dejar el contador de Daily corriendo. */
  ejectAfterSec: number,
): Promise<string> {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const properties = {
    exp,
    // Con `exp` a 7 días esto ya no es el tope real de nadie; se queda porque
    // es el barrido final de la sala. El tope de verdad es la línea de abajo.
    eject_at_room_exp: true,
    eject_after_elapsed: ejectAfterSec,
    // Acuerdo de la reunión del 17-jul (00:24:48): el chat de la sala es el
    // NUESTRO (EP-17, panel lateral de LV01). El de Daily se apaga por dos
    // razones: no queremos dos chats, y el suyo se cobra aparte como
    // almacenamiento. Es propiedad de SALA, no del iframe.
    //
    // MN-04 lo confirma y lo hace más visible: el panel nuestro va ahora
    // acoplado a la derecha del vídeo y se abre desde un botón dentro de la
    // propia barra de Daily (`customTrayButtons`). Si esta línea se pusiera a
    // `true`, la barra tendría DOS iconos de chat que abren cosas distintas.
    enable_chat: false,
    // N-18 · sin antesala: quien pulsa «entrar» ya decidió entrar, y el paso
    // intermedio de Daily solo añade una pantalla que no es nuestra.
    //
    // ⚠️ Propiedad EXCLUSIVA de Daily Prebuilt, así que NO se borra "porque no
    // parece hacer nada": hoy es lo único que quita esa pantalla.
    //
    // (Corrección: esta nota decía que MN-04 obligaría a migrar a
    // `createCallObject` y se llevaría por delante esta línea. El cliente
    // reformuló el punto el 20-ago —«un embed de Daily a pantalla completa y el
    // chat incrustado a la derecha»— y el rediseño se hizo SOBRE Prebuilt: el
    // vídeo, la barra de controles y la reconexión de US-803 siguen siendo de
    // Daily. Prebuilt se queda, y esta propiedad con él.)
    enable_prejoin_ui: false,
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
 * MN-05a · Margen tras el fin de la mentoría: una sesión se alarga un poco y el
 * token la acompaña. Es el margen DEL TOKEN, no la ventana de acceso (que la
 * fija `session_access_window` en la BD y desde MN-05 son 7 DÍAS a cada lado):
 * son dos números distintos, y desde hoy ya ni siquiera se parecen — que es
 * exactamente lo que MN-05a se adelantó a preparar.
 */
const TOKEN_GRACE_MS = 10 * 60_000;

/**
 * Suelo de vida del token contado desde que se firma. Sin él, un join
 * autorizado DESPUÉS de `endsAt + TOKEN_GRACE_MS` —que con MN-05 ya no es un
 * caso raro, sino la rutina de quien vuelve a la sala al día siguiente a por
 * los materiales— recibiría un token ya caducado y el alumno vería nuestro 502
 * sin entender nada. Es corto a propósito: quien necesite más tiempo vuelve a
 * pedir el endpoint, que es quien autoriza.
 *
 * Sí, en un join de los últimos minutos este suelo deja el token vivo algo más
 * allá del cierre de la ventana. No abre nada: la barrera es la SALA, y quien
 * la cierra es su `exp` (`access_closes_at`) con `eject_at_room_exp` detrás. Un
 * token vivo diez minutos de más no sirve para entrar a una sala expirada.
 */
const TOKEN_MIN_LIFE_MS = 10 * 60_000;

/** `exp` (epoch en segundos) del meeting-token. Ver las dos constantes de arriba. */
function tokenExpiry(endsAt: Date, now = Date.now()): number {
  const exp = Math.max(endsAt.getTime() + TOKEN_GRACE_MS, now + TOKEN_MIN_LIFE_MS);
  return Math.floor(exp / 1000);
}

/**
 * Firma un meeting-token acotado a (sala, usuario, expiración). El tutor entra
 * como `owner` (puede expulsar/controlar la sala); el alumno, no.
 * No se almacena (Doc 1 §1.4.11).
 *
 * MN-05a · El `exp` sale del fin de la SESIÓN, nunca del de la sala. Antes se
 * le pasaba el mismo `Date` que a `ensureRoom` y no se notaba porque la ventana
 * eran 10 minutos. Ese día ya llegó: con MN-05 la sala vive 7 días, así que
 * heredar su `exp` sería firmar credenciales de acceso válidas una semana — lo
 * contrario exacto de «token efímero, no almacenado». Por eso el parámetro se
 * llama `endsAt` y no `expiresAt`: para que el `exp` de la sala no pueda
 * colarse aquí. **No lo cambies de nombre ni le pases `closes_at`.**
 */
export async function mintToken(opts: {
  room: string;
  userName: string;
  userId: string;
  isOwner: boolean;
  /** Fin de la sesión (`sessions.end_at`), NO el cierre de la ventana ni el de la sala. */
  endsAt: Date;
}): Promise<string> {
  const res = await daily("/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: opts.room,
        user_name: opts.userName,
        user_id: opts.userId,
        is_owner: opts.isOwner,
        exp: tokenExpiry(opts.endsAt),
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
