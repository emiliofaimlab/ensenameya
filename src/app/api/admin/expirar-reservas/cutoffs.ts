/**
 * RV-20 · los plazos con los que se puede disparar `expire_stale_bookings`.
 *
 * VIVE AQUÍ, junto al Route Handler, y no en el componente: el servidor valida
 * contra esta misma lista que la pantalla ofrece. Teniéndola en un solo sitio
 * es imposible que el formulario ofrezca una opción que el handler rechace, y
 * al revés, que alguien añada un plazo al handler sin que se vea de dónde sale.
 * Es un módulo de constantes puro —sin `server-only`, sin imports— para que el
 * componente cliente pueda importarlo sin arrastrar nada del servidor.
 *
 * POR QUÉ UNA LISTA CERRADA Y NO UN CAMPO DE TEXTO. No es por inyección: el
 * parámetro viaja tipado como `interval` a través de PostgREST, así que un
 * texto raro daría un error, no una consulta ajena. Es por ALCANCE. La función
 * no toca "una reserva", sino TODAS las de la plataforma que cumplan el
 * criterio, y con `0 seconds` eso es *todas las que estén esperando respuesta
 * ahora mismo* — cancelándolas y encolando reembolsos del 100 % de verdad
 * (X-01). Esa es exactamente la vulnerabilidad que `20260715150000` cerró
 * quitándole el `execute` a `authenticated`. Con una lista cerrada, el extremo
 * destructivo hay que elegirlo a propósito, sale etiquetado como lo que es, y
 * un dedo torpe no puede escribir "0" donde quería escribir "20".
 *
 * Los `ms` son para la PREVISUALIZACIÓN, que se calcula en JavaScript. El `sql`
 * es lo único que llega a Postgres.
 */

export type Preset = {
  /** El `interval` que recibe la función. Lo único que sale de aquí hacia la BD. */
  sql: string;
  /** El mismo plazo en milisegundos, para calcular el corte de la vista previa. */
  ms: number;
  label: string;
  /** El valor que usa el cron de verdad cada 5 minutos. */
  real?: boolean;
  /** Alcance máximo: hay que avisarlo en la pantalla. */
  peligro?: boolean;
};

const MIN = 60_000;
const HORA = 60 * MIN;

/**
 * Plazo de aceptación (RN-38): el tutor no respondió → se cancela y se devuelve
 * el 100 %. Es el camino que RV-20 quiere poder verificar sin esperar un día.
 */
export const ACEPTACION: Record<string, Preset> = {
  "24h": {
    sql: "24 hours",
    ms: 24 * HORA,
    label: "24 h — el plazo real (RN-38)",
    real: true,
  },
  "1h": { sql: "1 hour", ms: HORA, label: "1 h" },
  "5m": { sql: "5 minutes", ms: 5 * MIN, label: "5 min" },
  "0": {
    sql: "0 seconds",
    ms: 0,
    label: "sin plazo — vence TODAS las que esperan respuesta",
    peligro: true,
  },
};

/**
 * Plazo de pago: la reserva se creó, nadie pagó y el horario sigue bloqueado.
 * Aquí NO hay reembolso —no se llegó a cobrar—, solo se libera el hueco.
 */
export const PAGO: Record<string, Preset> = {
  "20m": {
    sql: "20 minutes",
    ms: 20 * MIN,
    label: "20 min — el plazo real",
    real: true,
  },
  "5m": { sql: "5 minutes", ms: 5 * MIN, label: "5 min" },
  "0": {
    sql: "0 seconds",
    ms: 0,
    label: "sin plazo — vence TODAS las que están sin pagar",
    peligro: true,
  },
};

export const ACEPTACION_DEFECTO = "24h";
export const PAGO_DEFECTO = "20m";

/** Clave de la query string → preset, o `undefined` si no está en la lista. */
export function preset(
  tabla: Record<string, Preset>,
  clave: string | null | undefined,
  defecto: string,
): Preset | undefined {
  return tabla[clave ?? defecto];
}
