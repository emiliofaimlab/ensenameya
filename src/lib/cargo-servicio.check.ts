/**
 * `npm run check:cargo` — que el 5 % del navegador y el 5 % de la base digan lo
 * mismo.
 *
 * 🔴 POR QUÉ EXISTE ESTA COMPROBACIÓN, que es lo único que la justifica.
 *
 * El cargo por servicio está escrito DOS VECES a propósito:
 *
 *   · en SQL, `public.cargo_por_servicio(bigint, numeric)` con la constante
 *     `v_pct := 5.00` dentro del trigger `payments_cargo_por_servicio`
 *     (`supabase/migrations/20260916120000_el_alumno_paga_el_servicio.sql`).
 *     **Esta es la que manda**: es la que decide lo que se cobra de verdad y la
 *     que `confirm_payment` concilia — si la pasarela cobró otra cosa, ABORTA.
 *
 *   · en TypeScript, `serviceFee()` y `SERVICE_FEE_PCT` en `src/lib/booking.ts`.
 *     Esta solo PINTA, y existe porque el resumen del checkout tiene que
 *     enseñar la cifra antes de que exista ninguna fila de `payments`.
 *
 * Si divergen, el alumno ve un importe y paga otro. Y no lo dice nadie: no hay
 * build en rojo, ni typecheck, ni 500 — la pantalla se ve perfecta con el
 * número equivocado. Es exactamente el fallo mudo contra el que avisa la regla
 * de oro 11, aplicado al dinero.
 *
 * Se corre sin red y sin credenciales, como las otras quince.
 */
import { readFileSync } from "node:fs";
import { serviceFee, SERVICE_FEE_PCT } from "./booking.ts";

const MIGRACION =
  "supabase/migrations/20260916120000_el_alumno_paga_el_servicio.sql";

let fallos = 0;
let aserciones = 0;

function afirmar(condicion: boolean, que: string): void {
  aserciones += 1;
  if (!condicion) {
    fallos += 1;
    console.error(`  ✗ ${que}`);
  }
}

// ── 1 · La aritmética de TypeScript ────────────────────────────────────────
//
// Importes en unidades mínimas (céntimos). Los casos elegidos son los que de
// verdad se dan, no una batería decorativa.
const CASOS: Array<[base: number, esperado: number, porQue: string]> = [
  [0, 0, "reserva cubierta entera por un regalo → sin cargo (decisión 2)"],
  [2000, 100, "20,00 US$ → 1,00 US$"],
  [2500, 125, "25,00 US$ → 1,25 US$"],
  [1234, 62, "redondeo al alza desde 61,7"],
  // El medio céntimo SUBE en los dos motores, y por eso los dos casos están
  // aquí: `Math.round` de JS y `round(numeric)` de Postgres redondean media
  // unidad hacia arriba. Es la única coincidencia de la que depende que las dos
  // fórmulas den lo mismo, así que se afirma en vez de darse por supuesta.
  [1230, 62, "61,5 → 62"],
  [1210, 61, "60,5 → 61"],
  [10, 1, "el mínimo que ya genera cargo: 0,10 US$ → 0,01 US$"],
  [9, 0, "por debajo de 0,10 US$ el cargo redondea a cero"],
  [-500, 0, "base negativa (regalo que vale más que la mentoría) → 0, no abono"],
];

for (const [base, esperado, porQue] of CASOS) {
  const dio = serviceFee(base);
  afirmar(dio === esperado, `serviceFee(${base}) = ${dio}, esperado ${esperado} · ${porQue}`);
}

// Nunca negativo y nunca mayor que la base: dos propiedades que cualquier
// reescritura de la fórmula tiene que seguir cumpliendo.
for (let base = -50; base <= 5000; base += 7) {
  const c = serviceFee(base);
  afirmar(c >= 0, `serviceFee(${base}) no puede ser negativo`);
  afirmar(c <= Math.max(0, base), `serviceFee(${base}) no puede pasarse de la base`);
}

// ── 2 · Que el SQL diga el MISMO porcentaje ────────────────────────────────

const sql = readFileSync(MIGRACION, "utf8");

const pctEnSql = sql.match(/v_pct\s*:=\s*([\d.]+)\s*;/);
afirmar(
  pctEnSql !== null,
  `${MIGRACION} debe fijar el porcentaje con \`v_pct := <n>;\` — si se movió, esta comprobación deja de vigilar nada y hay que arreglarla, no borrarla`,
);
if (pctEnSql) {
  afirmar(
    Number(pctEnSql[1]) === SERVICE_FEE_PCT,
    `el SQL cobra ${pctEnSql[1]} % y el navegador pinta ${SERVICE_FEE_PCT} %: el alumno vería una cifra y pagaría otra`,
  );
}

// ── 3 · Que el SQL use la MISMA fórmula ────────────────────────────────────
//
// No se puede ejecutar PL/pgSQL desde aquí (sin red, sin base), así que lo que
// se comprueba es que la fórmula del fichero siga siendo `round(base * pct/100)`
// con su suelo en cero. Si alguien la cambia a `trunc`, a `ceil` o le quita el
// `greatest`, esto salta y obliga a venir a mirar las dos.
afirmar(
  /greatest\(\s*0\s*,\s*round\(\s*greatest\(\s*0\s*,\s*p_base\s*\)\s*\*\s*p_pct\s*\/\s*100\.0\s*\)\s*\)/.test(sql),
  "cargo_por_servicio() en SQL ya no es `greatest(0, round(greatest(0,base) * pct / 100.0))`: si cambió el redondeo o el suelo, `serviceFee()` de booking.ts tiene que cambiar igual",
);

// ── 4 · Que el cargo siga DENTRO de gross_amount ───────────────────────────
//
// Todo el diseño se sostiene en esto: si el cargo dejara de sumarse a
// `gross_amount`, las seis funciones de dinero que hablan de
// `gross_amount - credit_amount` cobrarían de menos y `confirm_payment`
// abortaría con el dinero ya cobrado.
afirmar(
  /new\.gross_amount\s*:=\s*greatest\(\s*v_gross\s*,\s*v_credito\s*\)/.test(sql),
  "el trigger ya no mete el cargo dentro de gross_amount: eso rompe confirm_payment, marcar_cobro_abierto, enqueue_refund y el Route Handler del checkout de una vez",
);

if (fallos > 0) {
  console.error(`\n✗ ${fallos} de ${aserciones} aserciones fallaron`);
  process.exit(1);
}
console.log(`OK · cargo por servicio del ${SERVICE_FEE_PCT} % · ${aserciones} aserciones · TS y SQL de acuerdo`);
