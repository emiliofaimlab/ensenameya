// Imports relativos y con extensión, no `@/lib/…`: este módulo lo carga
// también `npm run check:email` con node a pelo (vía `email-templates.ts`),
// y node no resuelve el alias `@/`. Mismo motivo por el que
// `email-templates.ts` importa `./catalog/format.ts`.
import { bookingTotal } from "../booking.ts";
import type { Database } from "../database.types.ts";

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
      return "Sesión única";
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

/**
 * URL pública de un objeto de Storage (buckets `avatars` / `product-images`).
 * Los buckets son públicos y la URL es determinista, así que no hace falta
 * cliente de Supabase (ni `await`): es lo mismo que devuelve `getPublicUrl`.
 *
 * ponytail: `encodeURI` asume que `path` viene crudo de la BD — lo está en
 * todos los usos. Si alguna vez llega ya codificado se doblaría el `%`.
 */
export function storageUrl(
  bucket: string,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}

/** 25.000 → "25k+" (cifras de vitrina de P01/P02); por debajo de mil, tal cual. */
export function compactCount(n: number): string {
  return n >= 1000 ? `${Math.floor(n / 1000)}k+` : String(n);
}

export type PriceDisplay = {
  /** La cifra grande: lo que cuesta reservar UNA vez. */
  amount: string;
  /** La línea pequeña de debajo: de dónde sale esa cifra. */
  note: string;
  /**
   * ¿la cifra grande es el cobro real? Falsa **solo** cuando es una mentoría
   * por hora sin duración declarada: ahí no hay total que calcular y lo que se
   * enseña es la tarifa. Quien la pinte puede rotularla distinto.
   */
  isTotal: boolean;
};

/**
 * RV-08 · lo que se ANUNCIA tiene que ser lo que se COBRA.
 *
 * Una mentoría de "1 × 90 min" anunciada a "30,00 US$ · hora" cobraba 45: la
 * tarifa por hora no es el precio de la reserva. Y de los tres productos por
 * hora del catálogo, dos duraban 60 min y coincidían **por casualidad**, así
 * que el fallo solo aparecía a veces — que es peor que siempre, porque nadie
 * lo reproduce. Ahora la cifra grande es el TOTAL de la reserva (el mismo que
 * congela `create_booking` en servidor, vía `bookingTotal`) y la tarifa baja a
 * texto secundario.
 *
 * ⚠️ `bookingTotal` cae a 60 min cuando no hay duración, y
 * `products.session_duration_min` es NULLABLE (`20260706120000`). Pintar ese
 * total sería mentir en el otro sentido —enseñar 30 en una clase de 90 min— y
 * una cifra grande equivocada es peor que una tarifa bien rotulada. Sin
 * duración se vuelve a anunciar la tarifa, diciendo que lo es.
 */
export function priceDisplay(p: {
  pricingModel: PricingModel;
  priceAmount: number;
  currency: string;
  sessionDurationMin: number | null;
  packageNumSessions: number | null;
}): PriceDisplay {
  const tarifa = formatMoney(p.priceAmount, p.currency);

  switch (p.pricingModel) {
    case "per_hour":
      if (!p.sessionDurationMin) {
        return { amount: tarifa, note: "por hora", isTotal: false };
      }
      // La duración no se repite aquí: la tarjeta y el panel ya la enseñan
      // ("1 × 90 min"), y en un pie de 11px cada palabra cuesta.
      return {
        amount: formatMoney(bookingTotal(p), p.currency),
        note: `${tarifa} / hora`,
        isTotal: true,
      };
    case "per_session":
      return { amount: tarifa, note: "por sesión", isTotal: true };
    case "per_package": {
      // El precio del paquete YA es el total de la reserva: `create_booking`
      // cobra `price_amount` una vez y agenda las N sesiones.
      const n = p.packageNumSessions ?? 1;
      return {
        amount: tarifa,
        note: n > 1 ? `paquete · ${n} sesiones` : "paquete",
        isTotal: true,
      };
    }
  }
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

/**
 * Quita tildes y diacríticos (EY-109). Lo usan la búsqueda —el lado almacenado
 * ya viene sin ellos (`f_unaccent`, migración `20260721120000`), así que
 * "matematicas" y "Matemáticas" buscan lo mismo— y el `slugify` del admin.
 */
export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
