/**
 * ── DINERO: LO QUE NO DEPENDE NI DE RED NI DE SESIÓN ────────────────────────
 *
 * Módulo NEUTRO a propósito: sin `server-only`, sin `"use client"`, sin
 * imports. Lo cargan tres mundos distintos y los tres tienen que poder:
 *
 *   · Server Components (el catálogo, el checkout, los paneles),
 *   · Client Components (`<Precio>`, el slot-picker, el formulario de pago),
 *   · `node` a pelo, vía `src/lib/catalog/format.ts`, que es quien lo importa
 *     para `npm run check:email` y `npm run check:dinero`.
 *
 * Por eso los imports que lo referencian son RELATIVOS y con extensión `.ts`:
 * node no resuelve el alias `@/`. Mismo motivo que `catalog/format.ts`.
 */

/**
 * ⚠️ NO TODAS LAS MONEDAS TIENEN DOS DECIMALES. Cinco mil pesos chilenos son
 * `5000`, no `500000`: dividir entre 100 a ciegas enseña la centésima parte, y
 * el error sale en la única dirección que nadie reporta —de menos—.
 *
 * Vivía en `dlocalgo.ts`, que es `server-only`, así que un Client Component no
 * podía importarlo y `formatMoney` seguía dividiendo entre 100 siempre. Está
 * aquí para que los dos lados usen LA MISMA tabla; `dlocalgo.ts` la reexporta.
 */
const SIN_CENTIMOS = new Set(["CLP", "PYG", "JPY", "KRW", "VND", "ISK"]);

export function exponenteDe(currency: string): 0 | 2 {
  return SIN_CENTIMOS.has(currency.toUpperCase()) ? 0 : 2;
}

/**
 * PAÍS (ISO-3166 alpha-2) → MONEDA (ISO-4217).
 *
 * Es geografía, no política de cobro, y por eso vive en código y no en
 * `payout_country_rules`: esa tabla contesta «¿dónde puede cobrar un TUTOR?»,
 * que es la pregunta del payout, y el dictado del 9-sep separó a propósito las
 * dos claves. Mezclarlas haría que añadir un país de payout cambiase el precio
 * que ve un alumno.
 *
 * Sobrar aquí no cuesta nada: si la moneda no está entre las que cotiza el
 * proveedor de tasas, `monedaDelVisitante()` devuelve `null` y se pinta el USD
 * a secas. O sea que una entrada de más es inofensiva y una de menos solo
 * significa «a ese visitante no le convertimos».
 *
 * ⚠️ VE no está por omisión deliberada, no por olvido: el bolívar no lo cotiza
 * nadie en este stack —dLocal devuelve 400 para VE y Wise no tiene VES entre
 * sus 103 monedas—, así que ponerlo aquí solo serviría para prometer una
 * conversión que después no existe.
 */
export const MONEDA_POR_PAIS: Readonly<Record<string, string>> = {
  // Latinoamérica — el mercado de la plataforma.
  AR: "ARS",
  BO: "BOB",
  BR: "BRL",
  CL: "CLP",
  CO: "COP",
  CR: "CRC",
  DO: "DOP",
  GT: "GTQ",
  HN: "HNL",
  MX: "MXN",
  NI: "NIO",
  PE: "PEN",
  PY: "PYG",
  UY: "UYU",
  // Dolarizados: sin conversión que hacer, pero listados para que se vea que
  // son un «no» a propósito y no un hueco.
  EC: "USD",
  PA: "USD",
  SV: "USD",
  US: "USD",
  // Europa y resto, por si el catálogo se mira desde fuera.
  AT: "EUR",
  BE: "EUR",
  CY: "EUR",
  DE: "EUR",
  EE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GR: "EUR",
  HR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  MT: "EUR",
  NL: "EUR",
  PT: "EUR",
  SI: "EUR",
  SK: "EUR",
  CH: "CHF",
  CZ: "CZK",
  DK: "DKK",
  GB: "GBP",
  HU: "HUF",
  IS: "ISK",
  NO: "NOK",
  PL: "PLN",
  RO: "RON",
  RS: "RSD",
  SE: "SEK",
  TR: "TRY",
  UA: "UAH",
  AE: "AED",
  EG: "EGP",
  IL: "ILS",
  IN: "INR",
  PK: "PKR",
  AU: "AUD",
  CA: "CAD",
};

/** La moneda de un país, o `null` si no la conocemos. */
export function monedaDePais(pais: string | null | undefined): string | null {
  if (!pais) return null;
  return MONEDA_POR_PAIS[pais.toUpperCase()] ?? null;
}

/**
 * Unidades menores → texto de moneda, respetando el exponente real.
 *
 * `decimales` existe para la CIFRA CONVERTIDA: un importe orientativo no gana
 * nada con céntimos («≈ 220,17 MXN» finge una precisión que la tasa no tiene),
 * pero por debajo de 100 unidades quitarlos sí pierde información de verdad
 * («≈ 11 €» por 11,04). Sin el argumento se usa el exponente de la moneda, que
 * es lo correcto para un importe EXACTO.
 */
export function formatEnMoneda(
  amountMinor: number,
  currency: string,
  decimales?: number,
): string {
  const exp = exponenteDe(currency);
  const mayor = exp === 0 ? amountMinor : amountMinor / 100;
  const d = decimales ?? exp;
  return new Intl.NumberFormat("es", {
    style: "currency",
    currency,
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(mayor);
}

/**
 * USD (unidades menores) → moneda destino (unidades menores), a una tasa que
 * dice cuántas unidades de destino da UN dólar.
 *
 * Devuelve `null` si la tasa no sirve. `null` nunca es 0 ni 1: es «no hay
 * conversión que enseñar», y quien llama tiene que pintar el USD a secas.
 */
export function convertirDesdeUsd(
  amountMinorUsd: number,
  tasa: number | null,
  monedaDestino: string,
): number | null {
  if (tasa === null || !Number.isFinite(tasa) || tasa <= 0) return null;
  if (!Number.isFinite(amountMinorUsd)) return null;
  const enDestino = (amountMinorUsd / 100) * tasa;
  return Math.round(enDestino * 10 ** exponenteDe(monedaDestino));
}

/**
 * Cuántos decimales enseñarle a una cifra CONVERTIDA. Ver `formatEnMoneda`.
 * Se calcula sobre la unidad mayor, que es lo que lee la persona.
 */
export function decimalesOrientativos(
  amountMinor: number,
  currency: string,
): 0 | 2 {
  const exp = exponenteDe(currency);
  if (exp === 0) return 0;
  return amountMinor / 100 >= 100 ? 0 : 2;
}

/** El texto de una cifra convertida, con su «≈» delante. */
export function textoOrientativo(
  amountMinor: number,
  currency: string,
): string {
  return `≈ ${formatEnMoneda(amountMinor, currency, decimalesOrientativos(amountMinor, currency))}`;
}

/**
 * ── LAS DOS CIFRAS DE UN PRECIO ────────────────────────────────────────────
 *
 * La cuenta entera, en un sitio, sin React y sin red. La hacen los dos lados:
 * `usePrecio()` en cliente con el contexto, y `textosDePrecio()` en servidor con
 * `monedaDelVisitante()`. Que sea UNA función es el punto: si el `<option>` de
 * un desplegable y la cifra grande de debajo redondearan distinto, el mismo
 * precio saldría con dos números en la misma pantalla.
 *
 * `local` es `null` cuando no hay conversión que enseñar, y entonces `usd` es
 * la única cifra. No es un caso de error: es lo que se pintaba antes de que
 * esto existiera.
 */
export function dosCifras(
  amountMinor: number,
  currency: string,
  fx: { moneda: string; tasa: number } | null,
): { local: string | null; usd: string } {
  const usd = formatEnMoneda(amountMinor, currency);
  // La tabla de tasas solo sabe convertir DESDE dólares (`source_currency` es
  // siempre USD en la doc de dLocal). Un precio en otra moneda se pinta tal
  // cual en vez de cruzar tasas, que es inventarse un número.
  if (!fx || currency.toUpperCase() !== "USD") return { local: null, usd };

  const enLocal = convertirDesdeUsd(amountMinor, fx.tasa, fx.moneda);
  if (enLocal === null) return { local: null, usd };
  return { local: textoOrientativo(enLocal, fx.moneda), usd };
}
