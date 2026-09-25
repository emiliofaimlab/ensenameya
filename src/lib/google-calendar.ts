import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Google Calendar por API (reunión del 25-sep). El feed suscribible sigue
 * existiendo; esto es para que el evento aparezca AL INSTANTE, que el feed no
 * puede porque Google lo relee cada 8-24 h.
 *
 * La credencial es el interruptor: sin `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
 * la tarjeta no ofrece conectar y el sync responde `sin-credencial`.
 *
 * ⚠️ `calendar.events` es un permiso SENSIBLE para Google: hasta que la app
 * pase su verificación, la pantalla de permiso dice «app no verificada» y solo
 * entran 100 usuarios. Eso se arregla en la consola de Google, no aquí.
 */
const SCOPES = "openid email https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export function googleCalendarConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export const redirectUri = (origin: string) => `${origin}/api/calendario/google/callback`;

export function urlDeConsentimiento(origin: string, state: string, email?: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES,
    // `offline` + `consent`: sin los dos, Google no devuelve refresh token la
    // segunda vez que alguien conecta, y sin él no hay nada que guardar.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  if (email) p.set("login_hint", email);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function token(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
  });
  return { ok: res.ok, json: (await res.json()) as Record<string, string> };
}

/** Canjea el `code` del callback. `email` sale del id_token, que llega por TLS
 *  directo de Google: no hace falta verificar su firma. */
export async function canjearCodigo(code: string, origin: string) {
  const { ok, json } = await token({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(origin),
  });
  if (!ok || !json.refresh_token) return null;
  let email: string | null = null;
  try {
    email = JSON.parse(Buffer.from(json.id_token.split(".")[1], "base64url").toString()).email ?? null;
  } catch {
    // Sin correo se conecta igual; solo se pinta «Conectado».
  }
  return { refreshToken: json.refresh_token, email };
}

export async function revocar(refreshToken: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: "POST",
  }).catch(() => {});
}

// ── Cifrado del refresh token ────────────────────────────────────────────────
// ponytail: la clave es el hash del client secret, así que no hay otra variable
// que configurar. Rotar el secreto deja los tokens guardados ilegibles y el
// usuario reconecta — que tras una filtración es justo lo que se quiere.
const clave = () => createHash("sha256").update(process.env.GOOGLE_CLIENT_SECRET!).digest();

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(), iv);
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function descifrar(b64: string): string {
  const b = Buffer.from(b64, "base64");
  const d = createDecipheriv("aes-256-gcm", clave(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

// ── Sincronizar ──────────────────────────────────────────────────────────────

/** El id del evento ES el de la sesión sin guiones: el hex cabe en el base32hex
 *  que exige Google, y así no hace falta tabla de correspondencias. */
const eventId = (sessionId: string) => sessionId.replaceAll("-", "");

const ESTADO = { confirmada: "confirmed", tentativa: "tentative", cancelada: "cancelled" } as const;

type Fila = {
  session_id: string;
  booking_id: string;
  user_id: string;
  soy_tutor: boolean;
  refresh_token: string;
  start_at: string;
  end_at: string;
  estado: keyof typeof ESTADO;
  titulo: string;
  con: string | null;
};

/**
 * Deja el calendario de cada participante conectado como dice la BD. Idempotente:
 * PUT sobre el id fijo, y si no existe se crea. Una sesión anulada que nunca
 * llegó a Google no se crea para anularla.
 *
 * `sesiones` null + `usuario` = todas las futuras de ese usuario (al conectar).
 */
export async function sincronizar(
  origin: string,
  { sesiones, usuario }: { sesiones: string[] | null; usuario?: string },
) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("google_calendar_eventos", {
    p_sesiones: sesiones as string[],
    p_user: usuario,
  });
  if (error) throw new Error(`google_calendar_eventos: ${error.message}`);

  const accesos = new Map<string, string | null>();
  const resultado = { hechos: 0, fallos: 0, desconectados: 0 };

  for (const f of (data ?? []) as Fila[]) {
    if (!accesos.has(f.user_id)) {
      const { ok, json } = await token({
        grant_type: "refresh_token",
        refresh_token: descifrar(f.refresh_token),
      }).catch(() => ({ ok: false, json: {} as Record<string, string> }));
      if (!ok && json.error === "invalid_grant") {
        // Revocado desde la cuenta de Google: se olvida la conexión y la
        // tarjeta vuelve a ofrecer conectar.
        await admin.from("google_calendar_connections").delete().eq("user_id", f.user_id);
        resultado.desconectados++;
      }
      accesos.set(f.user_id, ok ? json.access_token : null);
    }
    const access = accesos.get(f.user_id);
    if (!access) continue;

    const detalle = `${origin}${f.soy_tutor ? "/tutor" : ""}/reservas/${f.booking_id}`;
    const evento = {
      id: eventId(f.session_id),
      summary: f.con ? `${f.titulo} · con ${f.con}` : f.titulo,
      description: `Mentoría en Enséñame Ya.\nSala: ${origin}/room/${f.session_id}\nDetalle: ${detalle}`,
      location: `${origin}/room/${f.session_id}`,
      start: { dateTime: f.start_at },
      end: { dateTime: f.end_at },
      status: ESTADO[f.estado],
    };
    const cab = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };

    let res = await fetch(`${API}/${evento.id}`, { method: "PUT", headers: cab, body: JSON.stringify(evento) });
    if (res.status === 404 && f.estado !== "cancelada") {
      res = await fetch(API, { method: "POST", headers: cab, body: JSON.stringify(evento) });
    }
    if (res.ok || res.status === 404) {
      resultado.hechos++;
    } else {
      resultado.fallos++;
      console.error("google-calendar: sync falló", f.session_id, res.status, await res.text());
    }
  }
  return resultado;
}
