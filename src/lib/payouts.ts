import es from "react-phone-number-input/locale/es.json";

import type { Database } from "@/lib/database.types";

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

/**
 * A0 · ISO-3166-1 alpha-2 → nombre en castellano ("MX" → "México").
 *
 * Los nombres NO se escriben a mano: salen del locale que ya trae
 * `react-phone-number-input`, la misma fuente que usa el selector de país del
 * teléfono. Así, el día que la tabla de ruteo abra un país nuevo, el
 * desplegable del tutor lo nombra solo — que es justo lo que `payoutCountries()`
 * intenta conseguir sacando la lista del dato y no del TSX.
 *
 * El `Record` es un ensanche del tipo del locale, cuyas claves son una unión
 * cerrada de códigos: aquí el código llega como `string` (viene de la BD) y lo
 * que interesa es que un código desconocido devuelva algo legible en vez de
 * romper el tipo. Se cae al propio código, nunca a "undefined" en pantalla.
 */
export function nombrePais(code: string): string {
  return (es as Record<string, string | undefined>)[code] ?? code;
}

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
