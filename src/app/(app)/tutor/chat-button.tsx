"use client";

import { MessageSquareIcon } from "lucide-react";

import { pedirAbrirHilo } from "@/components/chat/open-thread";
import { cn } from "@/lib/utils";

/**
 * El botón «Chat» de las filas de sesión y de reserva del panel del tutor.
 *
 * ── POR QUÉ EXISTE ESTE FICHERO ─────────────────────────────────────────────
 * `tutor/page.tsx` es un componente de SERVIDOR: allí no hay `onClick` que
 * valga. Hasta el 27-ago esto era un `<Link href={'/chat/' + booking_id}>`, que
 * en un componente de servidor sale gratis; ahora que el destino es la burbuja
 * hace falta una pizca de cliente, y la casa ya tiene sitio para ella —esta
 * misma carpeta guarda `student-link.tsx`, `tier.ts` y `students.ts` por el
 * mismo motivo: piezas pequeñas de una sola pantalla viven al lado de la
 * pantalla, no en `components/`—. No se convierte la página entera en cliente
 * por un botón: perdería las consultas en paralelo del servidor.
 *
 * ── G-04 · DEJÓ DE SER UN BOTÓN DE TEXTO ────────────────────────────────────
 * Era `[ Chat ]` con la palabra escrita. En una fila que ya lleva título,
 * alumno, hora y otro botón, tres etiquetas de texto se comían el ancho y la
 * fila envolvía. El paquete v2 lo fija como el primero de los tres
 * botones-icono de 36 px (chat · ojo · videocámara), así que aquí solo cambia
 * la forma: el destino y el porqué de abajo son los mismos.
 *
 * ⚠️ `aria-label` y `title` llevan LO MISMO y no son opcionales: sin texto
 * visible, el botón se anunciaba como «botón» a secas.
 *
 * ⚠️ Las clases son las de `PanelIconButton` (G-04) copiadas, y eso duele.
 * No se reutiliza el componente porque `PanelIconButton` pinta un `<a href>` y
 * esto no navega a ningún sitio: abre la burbuja de chat en la propia página.
 * Un `<a>` sin `href` con `onClick` no recibe foco ni responde al teclado, que
 * es peor accesibilidad de la que se gana. Lo correcto es que
 * `PanelIconButton` sepa pintarse como `<button>`; mientras no lo sepa, esta
 * copia se mantiene a la vista, junto a su motivo.
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
export function ChatDeReservaButton({
  bookingId,
  className,
}: {
  bookingId: string;
  className?: string;
}) {
  const etiqueta = "Abrir el chat de esta reserva";
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={() => pedirAbrirHilo({ bookingId })}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-[10px] border border-[#e0e0e0] bg-card text-[#4d4d4d] transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <MessageSquareIcon aria-hidden className="size-4" />
    </button>
  );
}
