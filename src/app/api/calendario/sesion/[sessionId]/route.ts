import { SUFIJO_ICS } from "@/lib/calendar/feed";
import { construirIcs } from "@/lib/calendar/ics";
import type { EventoFeed } from "@/lib/calendar/rpc";
import { createClient } from "@/lib/supabase/server";

/**
 * «Añadir al calendario» — el .ics de UNA clase, para descargar.
 *
 * ── EN QUÉ SE DIFERENCIA DEL FEED DE AL LADO ────────────────────────────────
 * `/api/calendario/<token>` lo pide un servidor de Google o de Apple, sin
 * cookies, y por eso autoriza con un token en la URL. Esto lo pide el NAVEGADOR
 * del usuario, que sí trae sesión: la autorización es la RLS y no hay ni una
 * línea de comprobación a mano. `sessions_select_participant`
 * (`20260709140000:147`) solo devuelve las clases donde participas, y el
 * `grant select on public.sessions to authenticated` de la misma migración es
 * todo lo que hace falta. Sin fila = 404, igual que en
 * `api/chat/<hilo>/download`. Cero `service_role`, cero migraciones.
 *
 * ⚠️ Y ES UNA COPIA, NO UNA SUSCRIPCIÓN. La cabecera de `20260826210000` ya lo
 * dejó escrito: un .ics descargado se congela y miente en cuanto la reserva
 * cambia. Se ofrece igual porque suscribir el feed son tres pasos y esto es un
 * clic; quien quiera que se actualice solo tiene la tarjeta de Mi cuenta, y el
 * botón lo dice.
 */

/** El contenido cambia con la reserva: nada de caché de Vercel. */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId: bruto } = await params;
  // El `.ics` del final es cosmético (el cliente mira el `Content-Type`), pero
  // es lo que hace que el archivo descargado se llame como se espera.
  const sessionId = bruto.endsWith(SUFIJO_ICS)
    ? bruto.slice(0, -SUFIJO_ICS.length)
    : bruto;

  const supabase = await createClient();
  // Mismo encadenado que ya corre en `room/[sessionId]/page.tsx`: `sessions`
  // tiene una sola FK a `bookings`, así que no hay ambigüedad de embed (regla
  // de oro 10). El nombre de la contraparte NO se pide a propósito — `sessions`
  // tiene DOS FK a `profiles` y traerlo obligaría a nombrar la FK a cambio de
  // añadir «con María G.» al título.
  const { data: s } = await supabase
    .from("sessions")
    .select(
      "id, start_at, end_at, status, session_ref, sequence_no, created_at, updated_at, bookings(status, num_sessions, products(title))",
    )
    .eq("id", sessionId)
    .maybeSingle();

  // Sin fila = la RLS no te deja verla, o no existe. Misma respuesta para las
  // dos: no se confirma la existencia de clases ajenas.
  if (!s) {
    return new Response("Esta clase no existe.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const b = s.bookings;
  const cancelada =
    s.status === "cancelled" ||
    b?.status === "cancelled" ||
    b?.status === "refunded";

  const evento: EventoFeed = {
    session_id: s.id,
    start_at: s.start_at,
    end_at: s.end_at,
    created_at: s.created_at,
    updated_at: s.updated_at,
    // Mismo criterio que el `case` de `calendar_feed` (`20260826210000:326`).
    estado: cancelada
      ? "cancelada"
      : b?.status === "pending_acceptance"
        ? "tentativa"
        : "confirmada",
    // ⚠️ `0` no es arbitrario. El feed calcula el SEQUENCE como segundos entre
    // el alta y el último cambio, así que siempre será mayor que este: si el
    // usuario descarga hoy y mañana se suscribe, gana el del feed — que es el
    // orden correcto. Al revés no puede pasar.
    secuencia: 0,
    titulo: b?.products?.title ?? "Mentoría",
    con: null,
    session_ref: s.session_ref,
    sequence_no: s.sequence_no,
    num_sessions: b?.num_sessions ?? 1,
  };

  const ics = construirIcs({
    eventos: [evento],
    // Las fechas van en UTC con Z, así que la zona solo sería una pista de
    // presentación — y en un evento suelto no pinta nada.
    timezone: "UTC",
    origin: new URL(request.url).origin,
    suelto: true,
  });

  // El nombre del archivo se filtra aunque venga de la BD: va dentro de una
  // cabecera y ahí una comilla o un salto de línea no son un detalle.
  const nombre = (s.session_ref ?? s.id).replace(/[^\w-]/g, "");

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // `attachment`, al revés que el feed: allí una descarga suelta es el
      // fallo, aquí es el objetivo.
      "content-disposition": `attachment; filename="clase-${nombre}.ics"`,
      "cache-control": "no-store, private",
    },
  });
}
