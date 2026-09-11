import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";

import { dosCifras, monedaDePais } from "@/lib/dinero";
import { tasaDeVitrina, tasasParaPintar } from "@/lib/dlocalgo";
import { createClient } from "@/lib/supabase/server";
import { TZ_COOKIE } from "@/lib/tz";

/**
 * ── EN QUÉ MONEDA LE PINTAMOS LOS PRECIOS A QUIEN ESTÁ MIRANDO ─────────────
 *
 * El cliente pidió (11-sep-2026) que en cualquier sitio donde se vea un precio
 * se vea primero en la moneda local y debajo, pequeño, en dólares.
 *
 * 🔴 LO QUE ESTO **NO** ES: multi-moneda. El catálogo entero está en USD
 * (`product-form.tsx` tiene la moneda clavada y el campo deshabilitado), el
 * cobro se abre en USD y `payments.currency` se congela desde
 * `products.currency` al crear la reserva. Esto es UNA ETIQUETA: una cifra
 * orientativa para que el alumno sepa de qué orden de magnitud hablamos. Quien
 * la pinte está obligado a rotularla («≈» + «se cobra en USD»), porque lo que
 * acabe en el extracto lo fija el emisor de la tarjeta.
 *
 * `null` significa «no hay nada que enseñar» y se enseña el USD a secas. Pasa,
 * a propósito, en cuatro casos, y ninguno es un fallo:
 *   · no sabemos el país (desarrollo local sin cookie, VPN, primer byte);
 *   · el país es dolarizado (EC, PA, SV, US): no hay conversión que hacer;
 *   · no conocemos la moneda de ese país — **Venezuela entra aquí a propósito**:
 *     nadie cotiza el bolívar en este stack (dLocal devuelve 400 para VE y Wise
 *     no tiene VES entre sus 103 monedas), así que prometer una conversión
 *     sería inventarla;
 *   · el proveedor de tasas no contesta o no hay credencial.
 */
export type MonedaDelVisitante = {
  /** ISO-4217 de la moneda en la que se pinta la cifra grande. */
  moneda: string;
  /** Cuántas unidades de `moneda` da UN dólar. Publicada, sin recortar. */
  tasa: number;
};

/**
 * El país de quien está mirando. Dos fuentes, en este orden y por este motivo:
 *
 *  1. **`x-vercel-ip-country`** — la pone la plataforma, está disponible en el
 *     PRIMER BYTE y no cuesta ni una consulta. Es la que manda en producción.
 *  2. **La cookie `ey-tz` → `timezone_countries`** — el respaldo para todo lo
 *     que no corre en Vercel (`npm run dev`, `npm start` local). Es aproximada
 *     —una zona no es un país en los países multizona— y, sobre todo, NO EXISTE
 *     EN EL PRIMER RENDER de un visitante nuevo: `TimezoneSync` la escribe
 *     desde el navegador y refresca una vez. O sea que ahí el primer pintado
 *     sale en USD y el segundo ya convierte. Es aceptable para un respaldo de
 *     desarrollo; sería un parpadeo feo si fuera la fuente principal.
 *
 * ⚠️ `'UTC'` NO significa «vive en UTC»: es el valor al que cae el servidor
 * cuando no encuentra nada. Mismo criterio que `pais_de_cobro_por_zona()`.
 */
const paisDelVisitante = cache(async (): Promise<string | null> => {
  const geo = (await headers()).get("x-vercel-ip-country")?.trim().toUpperCase();
  if (geo && /^[A-Z]{2}$/.test(geo)) return geo;

  const zona = (await cookies()).get(TZ_COOKIE)?.value;
  const tz = zona ? decodeURIComponent(zona).trim() : "";
  if (!tz || tz === "UTC") return null;

  // `timezone_countries` es catálogo público con `grant select` a `anon`
  // (20260908130000), así que el cliente anónimo basta y esto funciona igual
  // sin sesión — que es justo el caso: un visitante del catálogo.
  const supabase = await createClient();
  const { data } = await supabase
    .from("timezone_countries")
    .select("country")
    .eq("timezone", tz)
    .maybeSingle();
  return data?.country ?? null;
});

/**
 * La moneda y la tasa con las que pintar precios en ESTA petición, o `null`.
 *
 * Memoizado con `cache()` de React: se resuelve UNA vez por petición aunque lo
 * pidan el layout y tres pantallas. La tabla de tasas va por `fetch` con
 * `revalidate: 3600`, así que además se comparte entre peticiones y usuarios:
 * el coste real de esto, salvo una vez por hora, es una lectura de cabecera.
 */
export const monedaDelVisitante = cache(
  async (): Promise<MonedaDelVisitante | null> => {
    const pais = await paisDelVisitante();
    const moneda = monedaDePais(pais);
    // `USD` no es un fallo: es un país dolarizado y no hay segunda línea que
    // pintar. Se corta aquí para no gastar la llamada a las tasas.
    if (!moneda || moneda === "USD") return null;

    const tasa = tasaDeVitrina(await tasasParaPintar(), "USD", moneda);
    return tasa === null ? null : { moneda, tasa };
  },
);

/**
 * El gemelo de servidor de `usePrecio()`: las dos cifras de un precio, ya en
 * texto, para los sitios donde no hay React que valga —el `label` de un
 * `<option>`, una frase montada en un Server Component, el asunto de algo.
 *
 * La aritmética es la MISMA función (`dosCifras`) que usa el cliente: si cada
 * lado hiciera su cuenta, el desplegable y la cifra grande de debajo podrían
 * enseñar dos números para el mismo precio en la misma pantalla.
 */
export async function textosDePrecio(
  amountMinor: number,
  currency: string,
): Promise<{ local: string | null; usd: string }> {
  return dosCifras(amountMinor, currency, await monedaDelVisitante());
}
