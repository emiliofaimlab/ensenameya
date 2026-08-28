import type { ChatMessage } from "./messages";

/**
 * El tope de la consulta previa a la reserva, en números.
 *
 * ── POR QUÉ ESTE FICHERO EXISTE ─────────────────────────────────────────────
 * Porque hasta hoy la pantalla decía «el número de mensajes es limitado» y NO
 * decía cuál. El alumno se enteraba del tope al chocar con él, en un `toast`
 * rojo escrito por una excepción de Postgres. Poner el número en la pantalla
 * obliga a tenerlo también aquí, y tenerlo aquí obliga a que sea EL MISMO que
 * impone el servidor — que es el único motivo de que esta constante viva con la
 * nota de dónde sale.
 *
 * ⚠️ ESTO NO ES LA BARRERA, ES EL CARTEL. El tope se impone dentro de
 * `send_conversation_message` (migración `20260828150000`), que es
 * `SECURITY DEFINER` y no se puede rodear desde el navegador. Si algún día los
 * dos números dejan de coincidir, el que manda es el SQL y el que miente es
 * éste. Cambiar el tope es cambiar la migración, nunca este fichero solo.
 *
 * ── ES UNO, Y ES SIMÉTRICO (decisión del cliente, 28-ago-2026) ──────────────
 * «5 mensajes máximo de lado y lado, 5 del tutor, 5 del estudiante». Cada lado
 * gasta su propio cupo de 5 en el hilo previo, y **no se recupera**: no es una
 * racha que reinicie la respuesta del otro, es un saldo.
 *
 * ⚠️ Esto SUSTITUYE a los dos topes de M-12, que eran otra cosa y solo pesaban
 * sobre el alumno:
 *
 *   · **5 seguidos** — mensajes del alumno desde el último del tutor, que **se
 *     reiniciaban** en cuanto el tutor contestaba. Con un saldo duro de 5 esa
 *     cuenta es inalcanzable (no puedes encadenar seis si solo tienes cinco),
 *     así que desapareció por inútil, no por relajarse.
 *   · **20 en total** — el mismo criterio que el de ahora («o se reserva o se
 *     habla en otra parte», §21 de los Términos), con otro número.
 *
 * ⚠️ **AL TUTOR AHORA SÍ SE LE CUENTA**, y antes no. El bloque de topes del SQL
 * entraba solo `if v_uid = v_c.student_id` porque «el tutor contesta en su
 * bandeja y ponerle tope sería castigar al que atiende». El cliente decidió lo
 * contrario. Tiene una consecuencia que hay que conocer: **un tutor que gaste
 * sus cinco no puede contestar la última pregunta del alumno.** Está aceptado;
 * si algún día escuece, lo que se sube es el tope del tutor.
 *
 * El tope de **10 hilos nuevos al día** por alumno sigue vivo en
 * `open_conversation` y NO se cuenta aquí: no es del hilo sino del catálogo
 * entero, y quien lo alcanza lo hace desde la ficha del tutor, no desde esta
 * pantalla.
 *
 * ⚠️ Y **con la compra hecha desaparece**: el SQL solo lo aplica
 * `if not v_comprado`. Por eso todo lo de aquí se calcula únicamente en un hilo
 * `esConsulta`.
 */
export const TOPE_POR_LADO = 5;

/**
 * «te quedan 4 de 5» / «te queda 1 de 5».
 *
 * El verbo concuerda a mano porque el último mensaje —el que más se lee, porque
 * es el que llega justo antes de quedarse sin turno— es precisamente el que cae
 * en el singular, y «te quedan 1 de 5» en la única frase que alguien va a leer
 * con atención es la clase de detalle que hace dudar del número entero.
 */
export function quedanLabel(quedan: number, tope: number): string {
  return `${quedan === 1 ? "te queda" : "te quedan"} ${quedan} de ${tope}`;
}

/** Lo que le queda a QUIEN MIRA en un hilo previo a la reserva. */
export type CupoConsulta = {
  /** Mensajes míos que cuentan para el tope. */
  usados: number;
  /** Cuántos me quedan antes de que se acabe mi lado de la consulta. */
  quedan: number;
  /** Gasté mi cupo: ya no puedo escribir más hasta que haya reserva. */
  agotado: boolean;
};

/**
 * El cupo, calculado con los mensajes que la pantalla YA TIENE cargados.
 *
 * Sin consulta extra a propósito: el hilo se pinta con la conversación entera
 * (la bandeja y `/chat/[id]` la traen completa, y Realtime mantiene la lista al
 * día), así que preguntarle otra vez al servidor «¿cuántos llevo?» sería un
 * viaje para contar filas que ya están en memoria — y encima se desincronizaría
 * con lo que el usuario ve mientras escribe.
 *
 * ⚠️ **Réplica exacta de la cuenta del SQL.** Cuenta los mensajes de
 * `currentUserId` con `booking_id is null`, que es literalmente el `count(*)`
 * de `send_conversation_message`. Sirve igual para el alumno y para el tutor
 * porque el SQL ya no distingue: quien pregunta por su cupo recibe el suyo.
 */
export function cupoConsulta(
  messages: ChatMessage[],
  currentUserId: string,
): CupoConsulta {
  // `!m.bookingId` y no `m.bookingId === null`: las tres pantallas que arman el
  // mensaje a mano (las dos fichas de reserva y la sala) no traen el campo, y
  // ahí `undefined` significa lo mismo que `null` — «no cuenta como reserva».
  // Da igual de todos modos: en esas tres el par ya compró y este cupo no se
  // pide nunca.
  const usados = messages.filter(
    (m) => m.senderId === currentUserId && !m.bookingId,
  ).length;

  const quedan = Math.max(0, TOPE_POR_LADO - usados);

  return { usados, quedan, agotado: quedan === 0 };
}
