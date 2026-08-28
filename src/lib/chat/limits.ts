import type { ChatMessage } from "./messages";

/**
 * M-12 · Los topes de la consulta previa a la reserva, en números.
 *
 * ── POR QUÉ ESTE FICHERO EXISTE ─────────────────────────────────────────────
 * Porque hasta hoy la pantalla decía «el número de mensajes es limitado» y NO
 * decía cuál. El alumno se enteraba del tope al chocar con él, en un `toast`
 * rojo escrito por una excepción de Postgres. Poner el número en la pantalla
 * obliga a tenerlo también aquí, y tenerlo aquí obliga a que sea EL MISMO que
 * impone el servidor — que es el único motivo de que estas constantes vivan
 * juntas y con la nota de dónde salen.
 *
 * ⚠️ ESTO NO ES LA BARRERA, ES EL CARTEL. Los topes se imponen dentro de
 * `send_conversation_message` (migración `20260820180000`, sección 3), que es
 * `SECURITY DEFINER` y no se puede rodear desde el navegador. Si algún día los
 * dos números dejan de coincidir, el que manda es el SQL y el que miente es
 * éste. Cambiar el tope es cambiar la migración, nunca este fichero solo.
 *
 * ── LOS TRES TOPES, Y QUÉ SIGNIFICA CADA UNO ────────────────────────────────
 * Son TRES y no uno, y se confunden con facilidad porque el enunciado del
 * cliente («5 mensajes máximo de lado y lado») suena al primero y describe algo
 * que el código no hace:
 *
 *   1. **5 seguidos** (`TOPE_SEGUIDOS`). Mensajes del ALUMNO desde el último
 *      del tutor. **Se reinicia en cuanto el tutor contesta**: no es un saldo
 *      que se gasta, es un freno al monólogo. En el SQL: `count(*)` de mis
 *      mensajes con `created_at > max(created_at)` de los suyos.
 *   2. **20 en total** (`TOPE_TOTAL`). Mensajes del ALUMNO en ese hilo sin
 *      etiquetar con reserva (`booking_id is null`), desde siempre. Éste SÍ es
 *      un saldo y no se recupera: a los 20, o se reserva o se habla en otra
 *      parte (§21 de los Términos, desintermediación).
 *   3. **10 hilos nuevos al día** por alumno, en `open_conversation`. No se
 *      cuenta aquí porque no es del hilo: es del catálogo entero, y quien lo
 *      alcanza lo hace desde la ficha del tutor, no desde esta pantalla.
 *
 * ⚠️ **AL TUTOR NO SE LE CUENTA NADA.** El bloque de topes del SQL entra solo
 * `if v_uid = v_c.student_id`: el tutor contesta en su bandeja y ponerle tope
 * sería castigar al que atiende. O sea que no hay «5 de un lado y 5 del otro» —
 * de un lado hay dos topes y del otro ninguno. Es una divergencia con lo que
 * pidió el cliente el 28-ago y está anotada para llevarla a la reunión; mientras
 * tanto los textos describen lo que el código hace, no lo que el enunciado dice.
 *
 * ⚠️ Y **con la compra hecha desaparecen los dos**: el SQL solo los aplica
 * `if ... and not v_comprado`. Por eso todo lo de aquí se calcula únicamente en
 * un hilo `esConsulta`.
 */
export const TOPE_SEGUIDOS = 5;
export const TOPE_TOTAL = 20;

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

/** Lo que le queda al alumno en un hilo previo a la reserva. */
export type CupoConsulta = {
  /** Mensajes míos desde el último del otro (el que reinicia el tutor). */
  seguidos: number;
  /** Cuántos me quedan antes de tener que esperar respuesta. */
  quedanSeguidos: number;
  /** Mensajes míos que cuentan para el tope duro. */
  total: number;
  /** Cuántos me quedan antes de que la consulta se acabe. */
  quedanTotal: number;
  /** Gasté los seguidos: hay que esperar al tutor, pero queda cupo. */
  esperando: boolean;
  /** Gasté el tope duro: ya no hay consulta previa que valga, toca reservar. */
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
 * ⚠️ **Réplica exacta de las dos cuentas del SQL, con sus asimetrías.** Los
 * `seguidos` NO filtran por `booking_id` y el `total` SÍ; parece un descuido y
 * no lo es, así está escrito en `send_conversation_message` y copiarlo «mejor»
 * aquí es justo cómo la pantalla y el servidor empiezan a decir cosas distintas.
 *
 * ⚠️ Cuenta sobre una lista **ordenada por `created_at`**, que es como llegan
 * las tres cargas del hilo (`.order("created_at")`) y como las deja el append
 * de Realtime. Los «seguidos» son la racha final de mensajes míos: sobre una
 * lista ordenada eso es exactamente «los míos posteriores al último suyo».
 */
export function cupoConsulta(
  messages: ChatMessage[],
  currentUserId: string,
): CupoConsulta {
  let seguidos = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].senderId !== currentUserId) break;
    seguidos++;
  }

  // `!m.bookingId` y no `m.bookingId === null`: las tres pantallas que arman el
  // mensaje a mano (las dos fichas de reserva y la sala) no traen el campo, y
  // ahí `undefined` significa lo mismo que `null` — «no cuenta como reserva».
  // Da igual de todos modos: en esas tres el par ya compró y este cupo no se
  // pide nunca.
  const total = messages.filter(
    (m) => m.senderId === currentUserId && !m.bookingId,
  ).length;

  const quedanSeguidos = Math.max(0, TOPE_SEGUIDOS - seguidos);
  const quedanTotal = Math.max(0, TOPE_TOTAL - total);

  return {
    seguidos,
    quedanSeguidos,
    total,
    quedanTotal,
    agotado: quedanTotal === 0,
    // El orden importa: con el tope duro gastado da igual que el tutor
    // conteste, así que «agotado» gana y no se ofrece esperar para nada.
    esperando: quedanTotal > 0 && quedanSeguidos === 0,
  };
}
