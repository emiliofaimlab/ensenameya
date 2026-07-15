import type { Database } from "@/lib/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending_payment: "Pago pendiente",
  pending_acceptance: "Esperando al tutor",
  confirmed: "Confirmada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
  refunded: "Reembolsada",
};

/** Instante UTC → fecha y hora local del usuario (RN-01/02). */
export function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
