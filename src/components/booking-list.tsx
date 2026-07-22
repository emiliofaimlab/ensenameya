"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/catalog/format";
import { BOOKING_STATUS_LABEL, formatSessionTime } from "@/lib/booking";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ReviewDialog } from "@/components/review-dialog";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

export type BookingRow = {
  id: string;
  status: BookingStatus;
  total_amount: number;
  currency: string;
  product_title: string;
  sessions: { id: string; start_at: string; status: string }[];
  review?: { rating: number; comment: string | null } | null;
};

// La reserva debe estar viva y la sesión aún abierta para ofrecer la sala. El
// gate real de la ventana (RN-18) lo pone el server; el enlace lleva a la sala,
// que muestra la cuenta regresiva si aún no abre.
const ROOM_BOOKING = new Set<BookingStatus>(["confirmed", "in_progress"]);
const ROOM_SESSION = new Set(["scheduled", "in_progress"]);

// Chat disponible mientras la reserva está viva o recién completada (EP-17).
const CHAT_BOOKING = new Set<BookingStatus>(["confirmed", "in_progress", "completed"]);

const CANCELLABLE = new Set<BookingStatus>([
  "pending_payment",
  "pending_acceptance",
  "confirmed",
]);

const badgeVariant = (s: BookingStatus) =>
  s === "confirmed" || s === "completed"
    ? "default"
    : s === "cancelled" || s === "refunded"
      ? "destructive"
      : "secondary";

/**
 * US-603 / US-606 — lista de reservas. `mode="tutor"` muestra Aceptar/Rechazar
 * en las `pending_acceptance` (RN-38); `mode="student"` es solo lectura.
 */
export function BookingList({
  bookings,
  mode,
}: {
  bookings: BookingRow[];
  mode: "tutor" | "student";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function respond(id: string, accept: boolean) {
    if (!accept && !window.confirm("¿Rechazar la reserva? Se reembolsa el 100 % al alumno.")) {
      return;
    }
    setBusy(id);
    const supabase = createClient();
    const { error } = await supabase.rpc("respond_booking", {
      p_booking_id: id,
      p_accept: accept,
    });
    setBusy(null);
    if (error) return toast.error(error.message || "No se pudo actualizar la reserva.");
    toast.success(accept ? "Reserva confirmada." : "Reserva rechazada y reembolsada.");
    router.refresh();
  }

  async function cancel(id: string) {
    if (
      !window.confirm(
        "¿Cancelar la reserva? Se aplica la política de reembolso: ≥24 h = 100 %, <24 h = 50 % (si cancela el tutor, 100 %).",
      )
    ) {
      return;
    }
    setBusy(id);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("cancel_booking", { p_booking_id: id });
    setBusy(null);
    if (error) return toast.error(error.message || "No se pudo cancelar la reserva.");
    const pct = (data as { refund_pct?: number } | null)?.refund_pct;
    toast.success(
      pct != null ? `Reserva cancelada. Reembolso del ${pct} %.` : "Reserva cancelada.",
    );
    router.refresh();
  }

  if (bookings.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {mode === "tutor"
          ? "No tienes reservas por ahora."
          : "Aún no tienes reservas. Explora tutores y reserva tu primera clase."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {bookings.map((b) => (
        <li key={b.id}>
          <Card>
            <CardContent className="flex flex-col gap-3 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{b.product_title}</span>
                <Badge variant={badgeVariant(b.status)}>
                  {BOOKING_STATUS_LABEL[b.status]}
                </Badge>
              </div>

              <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
                {b.sessions
                  .slice()
                  .sort((a, c) => a.start_at.localeCompare(c.start_at))
                  .map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="first-letter:uppercase">
                        {formatSessionTime(s.start_at)}
                      </span>
                      {ROOM_BOOKING.has(b.status) && ROOM_SESSION.has(s.status) ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/room/${s.id}`}>Ir a la sala</Link>
                        </Button>
                      ) : null}
                    </li>
                  ))}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {formatMoney(b.total_amount, b.currency)}
                </span>
                {CHAT_BOOKING.has(b.status) ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/chat/${b.id}`}>Chat</Link>
                  </Button>
                ) : null}
                {mode === "tutor" && b.status === "pending_acceptance" ? (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy === b.id} onClick={() => respond(b.id, true)}>
                      Aceptar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === b.id}
                      onClick={() => respond(b.id, false)}
                    >
                      Rechazar
                    </Button>
                  </div>
                ) : CANCELLABLE.has(b.status) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === b.id}
                    onClick={() => cancel(b.id)}
                  >
                    Cancelar
                  </Button>
                ) : mode === "student" && b.status === "completed" ? (
                  // US-901 (RN-17): reseñar solo tras completar; editar la existente.
                  <ReviewDialog
                    bookingId={b.id}
                    productTitle={b.product_title}
                    completedAt={b.sessions.at(-1)?.start_at ?? null}
                    existing={b.review}
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
