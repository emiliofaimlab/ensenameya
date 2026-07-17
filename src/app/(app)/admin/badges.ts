import type { Database } from "@/lib/database.types";

type Approval = Database["public"]["Enums"]["tutor_approval_status"];
type Identity = Database["public"]["Enums"]["identity_verification_status"];
type DocStatus = Database["public"]["Enums"]["document_status"];
type PaymentStatus = Database["public"]["Enums"]["payment_status"];
type BookingStatus = Database["public"]["Enums"]["booking_status"];

type BadgeSpec = { label: string; variant: "default" | "secondary" | "destructive" | "outline" };

/** Etiquetas de los enums reales de la BD (M1/M2), en un solo sitio. */
export const APPROVAL_BADGE: Record<Approval, BadgeSpec> = {
  approved: { label: "Aprobado", variant: "default" },
  pending: { label: "Pendiente", variant: "secondary" },
  rejected: { label: "Rechazado", variant: "destructive" },
  suspended: { label: "Suspendido", variant: "destructive" },
};

export const IDENTITY_BADGE: Record<Identity, BadgeSpec> = {
  approved: { label: "aprobada", variant: "default" },
  pending: { label: "en revisión", variant: "secondary" },
  rejected: { label: "rechazada", variant: "destructive" },
  not_submitted: { label: "sin enviar", variant: "outline" },
};

/**
 * Ojo con `pending`: para el TUTOR es "En revisión" (se lo estamos revisando),
 * pero aquí el lector es el admin, que ES quien revisa. Llamarlo "En revisión"
 * le sugiere que ya hay una decisión en marcha y que no le toca actuar, justo
 * al revés. El tutor tiene su propia etiqueta en `tutor/verification`.
 */
export const DOC_BADGE: Record<DocStatus, BadgeSpec> = {
  approved: { label: "Aprobado", variant: "default" },
  pending: { label: "Sin revisar", variant: "secondary" },
  rejected: { label: "Rechazado", variant: "destructive" },
};

/** M6 — estados del pago (US-1104). */
export const PAYMENT_BADGE: Record<PaymentStatus, BadgeSpec> = {
  paid: { label: "Pagado", variant: "default" },
  authorized: { label: "Autorizado", variant: "secondary" },
  pending: { label: "Pendiente", variant: "secondary" },
  failed: { label: "Fallido", variant: "destructive" },
  refunded: { label: "Reembolsado", variant: "outline" },
  partially_refunded: { label: "Reembolso parcial", variant: "outline" },
};

/** M4 — estados de la reserva (US-1104). */
export const BOOKING_BADGE: Record<BookingStatus, BadgeSpec> = {
  confirmed: { label: "Confirmada", variant: "default" },
  completed: { label: "Completada", variant: "default" },
  in_progress: { label: "En curso", variant: "default" },
  pending_payment: { label: "Esperando pago", variant: "secondary" },
  pending_acceptance: { label: "Esperando al tutor", variant: "secondary" },
  cancelled: { label: "Cancelada", variant: "destructive" },
  refunded: { label: "Reembolsada", variant: "outline" },
};
