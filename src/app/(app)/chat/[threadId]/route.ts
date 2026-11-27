import { NextResponse } from "next/server";

import { destinoDeUsuario, getSessionContext } from "@/lib/auth/server";
import { conversationIdOfBooking } from "@/components/chat/conversations";

/**
 * `/chat/<id>` ya NO es una pantalla (27-nov): el chat vive solo en la burbuja.
 *
 * La URL sigue viva porque está en correos ya enviados (NTF-21, `rutaFor`) y no
 * se pueden reescribir. Esto la convierte en un rebote: a tu panel con
 * `?chat=<conversación>`, y la burbuja (`chat-bubble.tsx`) abre ese hilo.
 *
 * Route Handler y no `page.tsx` con `redirect()` a propósito: un 307 HTTP no es
 * RSC, así que no puede caer en la pantalla en blanco de la regla de oro 13.
 *
 * El id puede ser de conversación o de RESERVA (enlaces anteriores a M-12): se
 * traduce aquí con `conversation_of_booking`, que va con la sesión y su RLS.
 * Un id ajeno no resuelve nada y la burbuja dice «No pudimos abrir…».
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const ctx = await getSessionContext();

  if (!ctx.user) {
    return rebote(`/login?next=${encodeURIComponent(`/chat/${threadId}`)}`);
  }

  const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId);
  const conversationId = esUuid
    ? ((await conversationIdOfBooking(threadId)) ?? threadId)
    : null;

  const destino = await destinoDeUsuario(ctx.user.id, ctx.roles);
  if (!conversationId) return rebote(destino);
  const sep = destino.includes("?") ? "&" : "?";
  return rebote(`${destino}${sep}chat=${conversationId}`);
}

/**
 * `Location` RELATIVO a propósito: con `new URL(x, req.url)` el host salía
 * como `localhost` detrás de `next start` (no el que tecleó el navegador) y la
 * cookie de sesión no viajaba. El navegador resuelve el relativo contra la URL
 * en la que ya está.
 */
function rebote(ruta: string) {
  return new NextResponse(null, { status: 307, headers: { Location: ruta } });
}
