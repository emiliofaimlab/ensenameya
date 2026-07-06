import type { Database } from "@/lib/database.types";

type PricingModel = Database["public"]["Enums"]["pricing_model"];

/** Monto en unidades menores → texto de moneda. */
export function formatMoney(amountMinor: number, currency: string): string {
  // ponytail: asume 2 decimales (USD/EUR/…). Revisar si entran monedas de 0
  // decimales (JPY, CLP) — ahí el divisor cambia.
  return new Intl.NumberFormat("es", { style: "currency", currency }).format(
    amountMinor / 100,
  );
}

/** Etiqueta de precio según el modelo (RN-10). */
export function priceLabel(p: {
  pricingModel: PricingModel;
  priceAmount: number;
  currency: string;
  packageNumSessions: number | null;
}): string {
  const money = formatMoney(p.priceAmount, p.currency);
  switch (p.pricingModel) {
    case "per_session":
      return `${money} / sesión`;
    case "per_hour":
      return `${money} / hora`;
    case "per_package":
      return `${money}${p.packageNumSessions ? ` · ${p.packageNumSessions} sesiones` : ""}`;
  }
}

/** Iniciales para el avatar-fallback (el nombre real no es público). */
export function initialsFrom(text: string | null): string {
  const base = (text ?? "").trim();
  if (!base) return "T";
  return base
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]!)
    .join("")
    .toUpperCase();
}
