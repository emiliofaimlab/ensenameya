/**
 * Corrección 10 de la sala: pantalla compartida y documento presentado se
 * TURNAN. Lo último que se comparte ocupa el escenario; lo anterior baja a la
 * franja como otra cámara, hasta que se deja de compartir lo último.
 *
 * Claves: `doc` (la presentación) y `pantalla:<session_id>` (una por quien
 * comparta). Cada lado ordena por cuándo lo VIO aparecer: no hace falta
 * sincronizarlo, la diferencia entre dos navegadores es de un segundo.
 */
export type OrdenCompartidos = Record<string, number>;

/**
 * Conserva la hora de lo que sigue, apunta `ahora` a lo nuevo y olvida lo que
 * ya no está. Devuelve el MISMO objeto si nada cambió (se usa para ajustar
 * estado durante el render, y un objeto nuevo cada vez sería un bucle).
 */
export function actualizarOrden(
  prev: OrdenCompartidos,
  claves: readonly string[],
  ahora: number,
): OrdenCompartidos {
  const antes = Object.keys(prev);
  if (antes.length === claves.length && claves.every((c) => c in prev)) {
    return prev;
  }
  const sig: OrdenCompartidos = {};
  for (const c of claves) sig[c] = prev[c] ?? ahora;
  return sig;
}

/** Del más antiguo al más reciente: el ÚLTIMO es el que va al escenario. */
export function ordenados(orden: OrdenCompartidos): string[] {
  // `sort` es estable: en un empate gana el orden de inserción.
  return Object.keys(orden).sort((a, b) => orden[a] - orden[b]);
}
