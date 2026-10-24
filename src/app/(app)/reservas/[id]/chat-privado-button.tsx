"use client";

import { pedirAbrirHilo } from "@/components/chat/open-thread";
import { Button } from "@/components/ui/button";

/**
 * B4 · «Escribirle en privado», en la reserva de una clase GRUPAL.
 *
 * Ahí el chat principal es el del grupo, y el hilo 1:1 con el tutor pasa a
 * segundo plano: no se pinta entero en la ficha, se abre en la burbuja. La
 * página es de servidor y no tiene `onClick`, por eso este fichero —el mismo
 * motivo que `tutor/chat-button.tsx`—. Viaja el id de la RESERVA: la traduce a
 * conversación quien atiende la petición (`conversation_of_booking`).
 */
export function ChatPrivadoButton({ bookingId }: { bookingId: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9 shrink-0 rounded-[8px] px-3.5 text-[13px]"
      onClick={() => pedirAbrirHilo({ bookingId })}
    >
      Escribirle en privado
    </Button>
  );
}
