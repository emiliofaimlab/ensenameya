import type { Database } from "@/lib/database.types";

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

/** M7 — etiquetas y color de badge por estado de payout. */
export const PAYOUT_BADGE: Record<
  PayoutStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  paid: { label: "Pagado", variant: "default" },
  processing: { label: "Procesando", variant: "secondary" },
  scheduled: { label: "Programado", variant: "secondary" },
  pending: { label: "En retención", variant: "outline" },
  failed: { label: "Fallido", variant: "destructive" },
  on_hold: { label: "Retenido", variant: "destructive" },
};

export type MoneyByCurrency = { currency: string; amount: number };

/** El balance del tutor viene de `tutor_balance` como jsonb por moneda. */
export type TutorBalance = {
  available: MoneyByCurrency[];
  in_retention: MoneyByCurrency[];
  paid_out: MoneyByCurrency[];
};
