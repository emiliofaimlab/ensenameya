/**
 * `npm run check:dinero` — la aritmética de la conversión, sin red ni base.
 *
 * Existe porque el fallo que cubre NO se ve: convertir un precio a una moneda
 * de cero decimales dividiendo entre 100 enseña la centésima parte, y el error
 * sale siempre de MENOS, que es la dirección que nadie reporta. Lo mismo que ya
 * documenta `dlocalgo.ts` para los payouts, ahora también para la vitrina.
 */
import assert from "node:assert/strict";
import {
  convertirDesdeUsd,
  decimalesOrientativos,
  exponenteDe,
  formatEnMoneda,
  monedaDePais,
  textoOrientativo,
} from "./dinero.ts";
import {
  formatMoney,
  GRATIS,
  perSessionLabel,
  priceDisplay,
  priceLabel,
} from "./catalog/format.ts";

const casos: [string, () => void][] = [
  [
    "el exponente distingue las monedas sin céntimos",
    () => {
      assert.equal(exponenteDe("USD"), 2);
      assert.equal(exponenteDe("mxn"), 2);
      assert.equal(exponenteDe("CLP"), 0);
      assert.equal(exponenteDe("PYG"), 0);
    },
  ],
  [
    "12,00 USD a peso chileno son 11.400 CLP, no 114",
    () => {
      // 1200 unidades menores de USD = 12,00 US$. A 950 CLP/USD.
      assert.equal(convertirDesdeUsd(1200, 950, "CLP"), 11_400);
    },
  ],
  [
    "12,00 USD a peso mexicano conserva los céntimos en unidades menores",
    () => {
      // 12 × 18,3474 = 220,1688 MXN → 22017 unidades menores (redondeo).
      assert.equal(convertirDesdeUsd(1200, 18.3474, "MXN"), 22_017);
    },
  ],
  [
    "una tasa que no sirve devuelve null, nunca 0 ni el importe original",
    () => {
      assert.equal(convertirDesdeUsd(1200, null, "MXN"), null);
      assert.equal(convertirDesdeUsd(1200, 0, "MXN"), null);
      assert.equal(convertirDesdeUsd(1200, -3, "MXN"), null);
      assert.equal(convertirDesdeUsd(1200, Number.NaN, "MXN"), null);
    },
  ],
  [
    "una cifra grande no enseña céntimos y una pequeña sí",
    () => {
      // 220,17 MXN → por encima de 100, los céntimos son ruido de la tasa.
      assert.equal(decimalesOrientativos(22_017, "MXN"), 0);
      // 11,04 EUR → por debajo de 100, quitarlos pierde información real.
      assert.equal(decimalesOrientativos(1104, "EUR"), 2);
      // Sin céntimos, nunca hay decimales que enseñar.
      assert.equal(decimalesOrientativos(11_400, "CLP"), 0);
    },
  ],
  [
    "el formato respeta el exponente de la moneda",
    () => {
      // 11.400 CLP, no 114. El separador exacto lo pone Intl según ICU, así que
      // se comprueba el número que aparece, no la puntuación.
      const clp = formatEnMoneda(11_400, "CLP").replace(/\D/g, "");
      assert.equal(clp, "11400");
      const usd = formatEnMoneda(1200, "USD").replace(/\D/g, "");
      assert.equal(usd, "1200"); // 12,00
    },
  ],
  [
    "el texto orientativo lleva su «≈» delante",
    () => {
      assert.ok(textoOrientativo(11_400, "CLP").startsWith("≈ "));
    },
  ],
  [
    "el mapa de países no promete conversiones que no existen",
    () => {
      assert.equal(monedaDePais("MX"), "MXN");
      assert.equal(monedaDePais("mx"), "MXN");
      // Dolarizados: la moneda es USD, así que no habrá segunda línea.
      assert.equal(monedaDePais("EC"), "USD");
      // Venezuela, fuera a propósito: nadie cotiza el bolívar en este stack.
      assert.equal(monedaDePais("VE"), null);
      assert.equal(monedaDePais(null), null);
      assert.equal(monedaDePais(""), null);
    },
  ],
  [
    "EY-219 · una oferta a 0 se anuncia «Gratis», sin unidad ni cero",
    () => {
      const base = { currency: "USD", packageNumSessions: null };
      assert.equal(GRATIS, "Gratis");
      assert.equal(priceLabel({ ...base, pricingModel: "per_session", priceAmount: 0 }), "Gratis");
      assert.equal(priceLabel({ ...base, pricingModel: "per_hour", priceAmount: 0 }), "Gratis");
      assert.equal(
        priceLabel({ ...base, pricingModel: "per_package", priceAmount: 0, packageNumSessions: 4 }),
        "Gratis · 4 sesiones",
      );
      // Un precio de verdad no cambia.
      assert.ok(priceLabel({ ...base, pricingModel: "per_session", priceAmount: 1500 }).endsWith(" / sesión"));
    },
  ],
  [
    "EY-219 · la cifra grande dice «Gratis» y la nota no reintroduce el cero",
    () => {
      const porHora = priceDisplay({
        pricingModel: "per_hour",
        priceAmount: 0,
        currency: "USD",
        sessionDurationMin: 90,
        packageNumSessions: null,
      });
      assert.equal(porHora.amount, "Gratis");
      assert.equal(porHora.amountMinor, 0);
      assert.ok(!/\d/.test(porHora.note), `nota con cifra: «${porHora.note}»`);
      const paquete = priceDisplay({
        pricingModel: "per_package",
        priceAmount: 0,
        currency: "USD",
        sessionDurationMin: 60,
        packageNumSessions: 6,
      });
      assert.equal(paquete.amount, "Gratis");
      assert.equal(paquete.note, "paquete · 6 sesiones");
      // «6 sesiones · $0,00 c/u» no se pinta.
      assert.equal(
        perSessionLabel({ pricingModel: "per_package", priceAmount: 0, currency: "USD", packageNumSessions: 6 }),
        null,
      );
    },
  ],
  [
    "EY-219 · formatMoney NO dice «Gratis»: recibos y payouts siguen en cifra",
    () => {
      assert.ok(/0/.test(formatMoney(0, "USD")));
      assert.notEqual(formatMoney(0, "USD"), "Gratis");
    },
  ],
];

let fallos = 0;
for (const [nombre, fn] of casos) {
  try {
    fn();
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.error(`  ✗ ${nombre}`);
    console.error(`    ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (fallos > 0) {
  console.error(`\n✗ dinero: ${fallos} de ${casos.length} comprobaciones fallaron`);
  process.exit(1);
}
console.log(`\n✓ dinero: ${casos.length} comprobaciones, la conversión respeta el exponente`);
