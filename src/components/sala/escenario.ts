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

/**
 * B11 · La rejilla de cámaras SIN SCROLL: cuántas columnas y de qué ancho
 * para que `n` teselas 16:9 quepan enteras en `ancho` × `alto` (ya sin el
 * relleno del contenedor). Prueba cada número de columnas y se queda con el
 * que da la tesela más grande; con pocas personas en un móvil sale una
 * columna, con un grupo en escritorio salen varias.
 *
 * Antes la rejilla era `auto-fit` con un mínimo de 280 px y `overflow-auto`:
 * con 4 personas en un móvil la cuarta quedaba debajo de la barra, y con 11
 * casi nadie se veía sin desplazar.
 */
export function galeria(
  n: number,
  ancho: number,
  alto: number,
  gap = 8,
  aspecto = 16 / 9,
): { columnas: number; anchoTesela: number } {
  if (n <= 0 || ancho <= 0 || alto <= 0) return { columnas: 1, anchoTesela: 0 };
  let mejor = { columnas: 1, anchoTesela: 0 };
  for (let c = 1; c <= n; c++) {
    const filas = Math.ceil(n / c);
    const w = Math.floor(
      Math.min((ancho - gap * (c - 1)) / c, ((alto - gap * (filas - 1)) / filas) * aspecto),
    );
    if (w > mejor.anchoTesela) mejor = { columnas: c, anchoTesela: w };
  }
  return mejor;
}
