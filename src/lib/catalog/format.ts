// Imports relativos y con extensión, no `@/lib/…`: este módulo lo carga
// también `npm run check:email` con node a pelo (vía `email-templates.ts`),
// y node no resuelve el alias `@/`. Mismo motivo por el que
// `email-templates.ts` importa `./catalog/format.ts`.
import { bookingTotal, SESION_INDIVIDUAL } from "../booking.ts";
import { formatEnMoneda } from "../dinero.ts";
import type { Database } from "../database.types.ts";

type PricingModel = Database["public"]["Enums"]["pricing_model"];

/**
 * Monto en unidades menores → texto de moneda.
 *
 * Delega el exponente en `lib/dinero.ts`. Antes dividía entre 100 SIEMPRE con
 * un `ponytail:` que decía «revisar si entran monedas de 0 decimales»: entraron
 * el 11-sep-2026, cuando los precios pasaron a pintarse también en la moneda
 * del visitante. Cinco mil pesos chilenos son `5000`, y dividirlos enseñaba
 * «50,00 CLP» — un error de dos órdenes de magnitud en la dirección que nadie
 * reporta, la de menos.
 */
export function formatMoney(amountMinor: number, currency: string): string {
  return formatEnMoneda(amountMinor, currency);
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
      // B1.3 · era "Sesión única", una de las cinco formas de decir lo mismo.
      return SESION_INDIVIDUAL;
    case "per_hour":
      return "Por hora";
    case "per_package":
      return `Paquete · ${p.packageNumSessions ?? 1} sesiones`;
  }
}

/**
 * "6 sesiones · US$ 16,00 c/u" — solo tiene sentido en paquetes.
 *
 * §5.14 · antes decía «Equivale a US$ 16,00 por sesión · 6 sesiones»: la misma
 * información, pero enterraba en medio de la frase lo único que se compara de
 * un vistazo —cuánto sale CADA sesión— y dejaba el recuento de cierre, donde ya
 * lo repite la línea de arriba ("6 × 60 min"). Ahora abre el recuento y cierra
 * el precio unitario, que es el orden en que se lee.
 *
 * ⚠️ La firma no cambia porque esto se ve en cuatro sitios, no en uno: la
 * tarjeta del catálogo, el panel de reserva de la ficha, el resumen del
 * checkout y `checkout-form`. Cualquiera de ellos que reescriba el texto por su
 * cuenta es como acaban divergiendo la vitrina y el pago en el precio de un
 * paquete.
 */
export function perSessionLabel(p: {
  pricingModel: PricingModel;
  priceAmount: number;
  currency: string;
  packageNumSessions: number | null;
}): string | null {
  if (p.pricingModel !== "per_package") return null;
  const n = p.packageNumSessions ?? 0;
  if (n < 2) return null;
  return `${n} sesiones · ${formatMoney(Math.round(p.priceAmount / n), p.currency)} c/u`;
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
  /**
   * El MISMO importe que `amount`, en unidades menores y sin formatear.
   *
   * Existe desde el 11-sep-2026 porque `<Precio>` necesita convertirlo a la
   * moneda del visitante, y de una cadena ya formateada no se puede. Se
   * devuelve aquí, y no se recalcula en la superficie, justamente para que la
   * cifra convertida y la cifra en dólares no puedan salir de dos cuentas
   * distintas — que es el fallo RV-08 que este bloque lleva evitando.
   */
  amountMinor: number;
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
        return { amount: tarifa, amountMinor: p.priceAmount, note: "por hora", isTotal: false };
      }
      // La duración no se repite aquí: la tarjeta y el panel ya la enseñan
      // ("1 × 90 min"), y en un pie de 11px cada palabra cuesta.
      return {
        amount: formatMoney(bookingTotal(p), p.currency),
        amountMinor: bookingTotal(p),
        note: `${tarifa} / hora`,
        isTotal: true,
      };
    case "per_session":
      return { amount: tarifa, amountMinor: p.priceAmount, note: "por sesión", isTotal: true };
    case "per_package": {
      // El precio del paquete YA es el total de la reserva: `create_booking`
      // cobra `price_amount` una vez y agenda las N sesiones.
      const n = p.packageNumSessions ?? 1;
      return {
        amount: tarifa,
        amountMinor: p.priceAmount,
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
