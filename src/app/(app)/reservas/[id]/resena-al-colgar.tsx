"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReviewForm } from "./resena/review-form";

/**
 * EY-220 · el pop-up de reseña que ve el ALUMNO al colgar.
 *
 * Lo monta el detalle de la reserva solo cuando el SERVIDOR ya decidió que toca
 * (`?resena=1` + alumno + reseñable + sin reseña): este componente no vuelve a
 * preguntar nada, solo se abre. Dentro va el MISMO formulario que la página
 * `/reservas/[id]/resena`.
 *
 * Al cerrarlo —guardar, «Más tarde», la X o Escape— se quita el `?resena=1`
 * con `replace`, para que recargar o volver atrás no lo reabra. «Más tarde» no
 * toca nada más: el correo de reseña (NTF-14) sale igual al completarse.
 */
export function ResenaAlColgar({
  bookingId,
  tutor,
  suggestedName,
}: {
  bookingId: string;
  tutor: string;
  suggestedName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  function cerrar() {
    setOpen(false);
    router.replace(`/reservas/${bookingId}`, { scroll: false });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : cerrar())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>¿Cómo te fue con {tutor}?</DialogTitle>
          <DialogDescription>
            Tu opinión ayuda a otros estudiantes a elegir. Te toma un minuto.
          </DialogDescription>
        </DialogHeader>
        <ReviewForm
          bookingId={bookingId}
          existing={null}
          suggestedName={suggestedName}
          alTerminar={cerrar}
          textoDescartar="Más tarde"
        />
      </DialogContent>
    </Dialog>
  );
}
