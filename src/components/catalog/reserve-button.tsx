import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * CTA "Reservar". Sin sesión → login conservando el destino (S-35). Con sesión,
 * el flujo de reserva/checkout llega en EP-06 (S2), así que hoy queda inhabilitado.
 */
export function ReserveButton({
  isAuthed,
  productId,
}: {
  isAuthed: boolean;
  productId: string;
}) {
  if (!isAuthed) {
    return (
      <Button asChild size="lg">
        <Link href={`/login?next=/products/${productId}`}>Reservar</Link>
      </Button>
    );
  }
  return (
    <Button size="lg" disabled title="La reserva llega en el próximo sprint">
      Reservar (pronto)
    </Button>
  );
}
