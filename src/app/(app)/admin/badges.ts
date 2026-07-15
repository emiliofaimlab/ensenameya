import type { Database } from "@/lib/database.types";

type Approval = Database["public"]["Enums"]["tutor_approval_status"];
type Identity = Database["public"]["Enums"]["identity_verification_status"];
type DocStatus = Database["public"]["Enums"]["document_status"];

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

export const DOC_BADGE: Record<DocStatus, BadgeSpec> = {
  approved: { label: "Aprobado", variant: "default" },
  pending: { label: "En revisión", variant: "secondary" },
  rejected: { label: "Rechazado", variant: "destructive" },
};
