/**
 * Escala logarítmica para el deslizador de precio de P04 (decisión sobre
 * EY-114, tras ver el catálogo real).
 *
 * El problema: con un tutor a 120 US$ y ocho entre 10 y 25, una escala lineal
 * deja todo el catálogo útil en el primer 12 % del recorrido y los dos pomos a
 * 15 píxeles uno del otro. En logarítmica, pasar de 10 a 20 US$ ocupa lo mismo
 * que pasar de 60 a 120: la distancia es la RAZÓN entre precios, que es como
 * la gente compara precios de verdad.
 *
 * **Los datos no cambian.** La vista, la consulta y la URL siguen llevando
 * precios reales en unidades menores; esto sólo traduce posición ↔ precio para
 * el control.
 */

/** Posiciones del deslizador. 100 da pasos de ~2,6 % en un rango de 12×. */
export const STEPS = 100;

/**
 * Los precios se redondean al dólar: nadie quiere filtrar por 17,43 US$.
 *
 * ponytail: en la mitad barata del recorrido el paso logarítmico es más fino
 * que un dólar, así que 26 de cada 100 posiciones repiten el precio de la
 * anterior — el pomo se mueve y la cifra no. Es cosmético y monótono (nunca
 * produce un rango invertido, comprobado sobre las 5.151 combinaciones). Si
 * molesta, la salida es bajar STEPS, no afinar el redondeo: precios con
 * céntimos en un filtro son peores.
 */
const REDONDEO = 100;

/**
 * Un precio de 0 rompería el logaritmo (`ln(0) = -∞`), y `price_amount` admite
 * 0 por check de BD. El dominio del log arranca en 1 unidad menor y la posición
 * 0 se ancla al mínimo real, así que un catálogo con algo gratis sigue
 * funcionando.
 */
const piso = (v: number) => Math.max(v, 1);

export type Bounds = { min: number; max: number };

/** Posición del deslizador (0…STEPS) → precio en unidades menores. */
export function posToPrice(pos: number, b: Bounds): number {
  if (pos <= 0) return b.min;
  if (pos >= STEPS) return b.max;

  const lnMin = Math.log(piso(b.min));
  const lnMax = Math.log(piso(b.max));
  // Un único precio en el catálogo —o datos corruptos con max < min— no dan
  // rango que repartir: se devuelve el mínimo y el filtro no acota nada.
  // Con un catálogo casi plano (p. ej. 10,00–10,50 US$) el redondeo deja sólo
  // los dos extremos: correcto, aunque el deslizador quede testimonial.
  if (lnMax <= lnMin) return b.min;

  const bruto = Math.exp(lnMin + (pos / STEPS) * (lnMax - lnMin));
  // Se acota a los extremos tras redondear: el redondeo no puede sacar el valor
  // del catálogo ni hacer que un extremo interior parezca el tope.
  const redondeado = Math.round(bruto / REDONDEO) * REDONDEO;
  return Math.min(Math.max(redondeado, b.min), b.max);
}

/** Precio en unidades menores → posición del deslizador (0…STEPS). */
export function priceToPos(price: number, b: Bounds): number {
  if (price <= b.min) return 0;
  if (price >= b.max) return STEPS;

  const lnMin = Math.log(piso(b.min));
  const lnMax = Math.log(piso(b.max));
  if (lnMax <= lnMin) return 0;

  const pos = ((Math.log(piso(price)) - lnMin) / (lnMax - lnMin)) * STEPS;
  return Math.min(Math.max(Math.round(pos), 0), STEPS);
}
