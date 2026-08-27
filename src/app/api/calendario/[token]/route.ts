import { createAdminClient } from "@/lib/supabase/admin";
import { SUFIJO_ICS } from "@/lib/calendar/feed";
import { construirIcs } from "@/lib/calendar/ics";
import type { RespuestaFeed } from "@/lib/calendar/rpc";

/**
 * EY-188 / B5.5 · El feed de calendario, **por suscripción**.
 *
 * Esta es la única ruta pública del proyecto que autoriza con algo que no es la
 * sesión, así que conviene decir por qué existe así:
 *
 * Quien pide esta URL NO es el navegador del usuario. Es un servidor de Google
 * o de Apple, cada pocas horas, sin cookies y sin posibilidad de mandar
 * cabeceras nuestras. Un `.ics` que se descarga una vez se queda congelado y
 * miente en cuanto la reserva cambia; una URL que el calendario relee solo es
 * lo que hace que una cancelación llegue sin que el usuario toque nada.
 *
 * ── EN QUÉ SE PARECE Y EN QUÉ NO A LOS CRON ─────────────────────────────────
 * Se parece en el patrón: sin configuración se cae con elegancia (503), y con
 * credencial equivocada no se filtra nada. Se diferencia en lo importante:
 * `CRON_SECRET` es UN secreto global que viaja en una cabecera `Authorization`;
 * este es **por usuario, vive en la base de datos y viaja en la URL**, porque un
 * cliente de calendario no sabe mandar cabeceras. Es un secreto de menor
 * calidad por definición, y por eso lo que abre está recortado al mínimo: solo
 * lectura, solo de su dueño y sin datos personales de la otra parte más allá de
 * su nombre enmascarado. Ver la cabecera de `20260826210000` para el detalle de
 * qué expone exactamente si se filtra y cómo se revoca.
 *
 * ── POR QUÉ NO SE CONSULTAN LAS TABLAS A PELO ───────────────────────────────
 * Este handler usa `service_role`, que **se salta la RLS entera**. Si armara la
 * consulta aquí, el filtro «solo las sesiones de este usuario» sería una línea
 * de TypeScript, y equivocarse en esa línea es publicar la agenda de toda la
 * plataforma en una URL sin sesión. Con la RPC no puede pasar: el handler no
 * conoce ningún id de usuario, solo pasa el token, y quien lo traduce a filas es
 * SQL. Efecto secundario agradable: al ser `security definer`, no hace falta el
 * `grant select on products to service_role` que exigiría la regla de oro 9 —y
 * que haría falta el día que alguien reescriba esto como consulta directa.
 */

/** Nada de caché de Vercel: el contenido cambia con cada reserva. */
export const dynamic = "force-dynamic";

function textoPlano(cuerpo: string, status: number): Response {
  return new Response(cuerpo, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: bruto } = await params;

  // El `.ics` del final es cosmético —los clientes miran el `Content-Type`—
  // pero la URL se pega a mano en un cuadro de diálogo y un humano necesita
  // reconocer qué está pegando. Se recorta antes de buscar el token.
  const token = bruto.endsWith(SUFIJO_ICS)
    ? bruto.slice(0, -SUFIJO_ICS.length)
    : bruto;

  // Las credenciales son el interruptor: sin clave de servicio el feed no
  // existe, pero la app no se cae ni devuelve una traza. 503 es además lo que
  // hace que un cliente de calendario reintente más tarde en vez de dar la
  // suscripción por muerta.
  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    return textoPlano("Sincronización de calendario no configurada.", 503);
  }

  const { data, error } = await supabase.rpc("calendar_feed", {
    p_token: token,
  });

  if (error) {
    // No se devuelve el mensaje de Postgres: esta ruta la puede llamar
    // cualquiera y los errores de la base describen el esquema.
    console.error("[calendario] fallo al leer el feed:", error.message);
    return textoPlano("No se pudo generar el calendario.", 500);
  }

  const feed = data as RespuestaFeed;

  // ⚠️ 404 Y NO 401, a propósito. Ante un 401 hay clientes —Calendario de Apple
  // entre ellos— que le piden usuario y contraseña al usuario, que es lo peor
  // que puede pasar cuando lo que ocurre es que el enlace se revocó. Un enlace
  // revocado tiene que parecer lo que es: un calendario que ya no está.
  if (!feed) {
    return textoPlano("Este calendario ya no existe.", 404);
  }

  const ics = construirIcs({
    eventos: feed.eventos,
    timezone: feed.timezone,
    // El origen sale de la propia petición, igual que en el cron de correo: es
    // la URL que el usuario pegó en su calendario, así que los enlaces de
    // dentro apuntan solos al despliegue que la atiende.
    origin: new URL(request.url).origin,
  });

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // `inline` y no `attachment`: quien abra la URL en el navegador no debe
      // acabar con una descarga suelta, que es justo el .ics congelado que esta
      // ficha viene a sustituir.
      "content-disposition": 'inline; filename="ensenameya.ics"',
      // La URL lleva un secreto dentro: que no la guarde ningún intermediario.
      "cache-control": "no-store, private",
    },
  });
}
