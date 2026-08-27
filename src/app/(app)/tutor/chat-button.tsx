"use client";

import { pedirAbrirHilo } from "@/components/chat/open-thread";
import { Button } from "@/components/ui/button";

/**
 * El botón «Chat» de las próximas mentorías del panel del tutor.
 *
 * ── POR QUÉ EXISTE ESTE FICHERO ─────────────────────────────────────────────
 * `tutor/page.tsx` es un componente de SERVIDOR: allí no hay `onClick` que
 * valga. Hasta el 27-ago esto era un `<Link href={'/chat/' + booking_id}>`, que
 * en un componente de servidor sale gratis; ahora que el destino es la burbuja
 * hace falta una pizca de cliente, y la casa ya tiene sitio para ella —esta
 * misma carpeta guarda `student-link.tsx`, `tier.ts` y `students.ts` por el
 * mismo motivo: piezas pequeñas de una sola pantalla viven al lado de la
 * pantalla, no en `components/`—. No se convierte la página entera en cliente
 * por un botón: perdería las seis consultas en paralelo del servidor.
 *
 * ── LO QUE VIAJA ES EL ID DE LA RESERVA, NO EL DE LA CONVERSACIÓN ───────────
 * Y es lo único que este panel tiene: consulta `sessions`, donde hay
 * `booking_id` y no hay `conversation_id`. Traducirlo aquí costaría una consulta
 * más por fila (o un join) para un dato que solo hace falta si alguien pulsa; la
 * traducción vive donde ya vivía —la RPC `conversation_of_booking`— y la hace
 * quien atiende la petición. Por eso `PeticionDeHilo` acepta las dos formas.
 *
 * ⚠️ Aquí NO hay respaldo a `/chat/<id>` si la burbuja no abriera, y es
 * deliberado: este panel cuelga del layout `(app)`, que monta el launcher
 * siempre salvo en `/admin/*` (ver `AppChrome`), así que la burbuja está. El
 * único sitio donde el respaldo hace falta de verdad es la campana, que también
 * se pinta en la sala —donde NO hay burbuja— y por eso lo lleva.
 */
export function ChatDeReservaButton({ bookingId }: { bookingId: string }) {
  return (
    <Button
      variant="ghost"
      // Mismas clases que tenía el `<Link>` al que sustituye: esto es un cambio
      // de destino, no de diseño.
      className="h-9 rounded-[8px] px-3 text-[13px] text-[#595959]"
      onClick={() => pedirAbrirHilo({ bookingId })}
    >
      Chat
    </Button>
  );
}
