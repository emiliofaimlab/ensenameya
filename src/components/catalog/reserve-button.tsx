import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * CTA "Reservar". Sin sesión → login conservando el destino (S-35). Con sesión →
 * selección de horario (US-601, SCR-AL04).
 */
export function ReserveButton({
  isAuthed,
  productId,
}: {
  isAuthed: boolean;
  productId: string;
}) {
  const href = isAuthed
    ? `/reservar/${productId}`
    : `/login?next=/reservar/${productId}`;
  return (
    <Button asChild size="lg">
      <Link href={href}>Reservar</Link>
    </Button>
  );
}
