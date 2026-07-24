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

/** Chip de modelo, sin precio (P01/P05: el importe va aparte y más grande). */
export function modelLabel(p: {
  pricingModel: PricingModel;
  packageNumSessions: number | null;
}): string {
  switch (p.pricingModel) {
    case "per_session":
      return "Clase única";
    case "per_hour":
      return "Por hora";
    case "per_package":
      return `Paquete · ${p.packageNumSessions ?? 1} sesiones`;
  }
}

/** "Equivale a $16 por sesión · 6 sesiones" — solo tiene sentido en paquetes. */
export function perSessionLabel(p: {
  pricingModel: PricingModel;
  priceAmount: number;
  currency: string;
  packageNumSessions: number | null;
}): string | null {
  if (p.pricingModel !== "per_package") return null;
  const n = p.packageNumSessions ?? 0;
  if (n < 2) return null;
  return `Equivale a ${formatMoney(Math.round(p.priceAmount / n), p.currency)} por sesión · ${n} sesiones`;
}

/** "4 × 60 min" — sesiones incluidas por duración de cada una. */
export function sessionsLabel(p: {
  sessionDurationMin: number | null;
  packageNumSessions: number | null;
}): string | null {
  if (!p.sessionDurationMin) return null;
  return `${p.packageNumSessions ?? 1} × ${p.sessionDurationMin} min`;
}

/** Conectores: sin filtrarlos, "Profesora de Matemáticas" daba "PD". */
const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "en",
  "para",
  "con",
  "a",
]);

/** Iniciales para el avatar-fallback (el nombre real no es público). */
export function initialsFrom(text: string | null): string {
  const base = (text ?? "").trim();
  if (!base) return "T";
  const words = base
    .split(/\s+/)
    .filter((w) => !STOPWORDS.has(w.toLowerCase()));
  return (words.length > 0 ? words : base.split(/\s+/))
    .slice(0, 2)
    .map((w) => w[0]!)
    .join("")
    .toUpperCase();
}

/** URL pública de un objeto de Storage (buckets `avatars` / `product-images`). */
export function storageUrl(bucket: string, path: string | null): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/** 25.000 → "25k+" (cifras de vitrina de P01/P02); por debajo de mil, tal cual. */
export function compactCount(n: number): string {
  return n >= 1000 ? `${Math.floor(n / 1000)}k+` : String(n);
}

/** "paquete" / "sesión" / "hora" — el sufijo del precio en P05 ("$96 · paquete"). */
export function priceUnitLabel(p: { pricingModel: PricingModel }): string {
  switch (p.pricingModel) {
    case "per_session":
      return "sesión";
    case "per_hour":
      return "hora";
    case "per_package":
      return "paquete";
  }
}
