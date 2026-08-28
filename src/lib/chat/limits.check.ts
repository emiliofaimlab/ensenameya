import assert from "node:assert/strict";

import { cupoConsulta, quedanLabel, TOPE_SEGUIDOS, TOPE_TOTAL } from "./limits.ts";
import type { ChatMessage } from "./messages.ts";

/**
 * Comprobación del contador de la consulta previa. Sin framework: se corre con
 * `npm run check:chat` y falla con exit code, igual que `check:ics`.
 *
 * ── POR QUÉ ESTO MERECE UN FICHERO ──────────────────────────────────────────
 * Porque esta función es una COPIA en TypeScript de dos `count(*)` que viven en
 * PL/pgSQL (`send_conversation_message`, migración `20260820180000`), y una
 * copia que se desvía no falla: sigue pintando un número, solo que uno que no
 * es. El usuario se entera cuando la pantalla le dice «te quedan 3» y el
 * servidor le contesta que no. Un número equivocado es peor que el texto vago
 * que había antes, porque un número se cree.
 *
 * Los casos de abajo son los del SQL, uno a uno, con el comportamiento que hace
 * raro a cada tope: que los «seguidos» se REINICIAN y el total NO.
 */

const ALUMNO = "11111111-1111-1111-1111-111111111111";
const TUTOR = "22222222-2222-2222-2222-222222222222";

let n = 0;
/** Un mensaje del hilo. `booking` = la reserva que lo etiqueta, si la hay. */
function msg(sender: string, booking: string | null = null): ChatMessage {
  n += 1;
  return {
    id: `m${n}`,
    senderId: sender,
    body: "…",
    // El orden de la lista es lo que se cuenta, así que las horas solo tienen
    // que ser crecientes.
    createdAt: new Date(Date.UTC(2026, 7, 28, 0, n)).toISOString(),
    attachment: null,
    bookingId: booking,
  };
}

// ── Hilo vacío: el cupo entero, y nada agotado ──────────────────────────────
const vacio = cupoConsulta([], ALUMNO);
assert.equal(vacio.quedanSeguidos, TOPE_SEGUIDOS, "un hilo vacío da el cupo entero");
assert.equal(vacio.quedanTotal, TOPE_TOTAL, "un hilo vacío da el total entero");
assert.equal(vacio.esperando, false, "un hilo vacío no puede estar esperando");
assert.equal(vacio.agotado, false, "un hilo vacío no puede estar agotado");

// ── Los «seguidos» son la racha final, no todos mis mensajes ────────────────
const tresSeguidos = [msg(ALUMNO), msg(ALUMNO), msg(ALUMNO)];
assert.equal(cupoConsulta(tresSeguidos, ALUMNO).seguidos, 3);
assert.equal(cupoConsulta(tresSeguidos, ALUMNO).quedanSeguidos, TOPE_SEGUIDOS - 3);

// ⚠️ EL CASO QUE IMPORTA: **la respuesta del tutor reinicia la racha**. Es la
// diferencia entre «5 mensajes y se acabó» (lo que suena) y «5 sin que te
// contesten» (lo que el SQL hace: `created_at > max(created_at)` de los suyos).
const conRespuesta = [...tresSeguidos, msg(TUTOR), msg(ALUMNO)];
const tras = cupoConsulta(conRespuesta, ALUMNO);
assert.equal(tras.seguidos, 1, "la respuesta del tutor tiene que reiniciar la racha");
assert.equal(tras.quedanSeguidos, TOPE_SEGUIDOS - 1);
// …pero el total NO se reinicia: son 4 míos.
assert.equal(tras.total, 4, "el tope duro no se reinicia con la respuesta");
assert.equal(tras.quedanTotal, TOPE_TOTAL - 4);

// ── `esperando`: gastados los seguidos, pero queda consulta ─────────────────
const cinco = Array.from({ length: TOPE_SEGUIDOS }, () => msg(ALUMNO));
const parado = cupoConsulta(cinco, ALUMNO);
assert.equal(parado.esperando, true, `${TOPE_SEGUIDOS} seguidos tienen que parar el envío`);
assert.equal(parado.agotado, false, "con 5 de 20 todavía no se ha agotado nada");

// Y en cuanto el tutor contesta, se puede volver a escribir. Es lo que hace que
// el recuadro de «espera a que responda» se quite solo por Realtime.
assert.equal(
  cupoConsulta([...cinco, msg(TUTOR)], ALUMNO).esperando,
  false,
  "tras la respuesta del tutor no se puede seguir esperando",
);

// ── `agotado`: el tope duro, que no se recupera ─────────────────────────────
// Se intercalan respuestas del tutor a propósito: así los «seguidos» están a
// cero y lo único que puede parar el envío es el tope de 20.
const veinte: ChatMessage[] = [];
for (let i = 0; i < TOPE_TOTAL; i++) {
  veinte.push(msg(ALUMNO), msg(TUTOR));
}
const fin = cupoConsulta(veinte, ALUMNO);
assert.equal(fin.total, TOPE_TOTAL);
assert.equal(fin.agotado, true, `${TOPE_TOTAL} mensajes tienen que agotar la consulta`);
assert.equal(
  fin.esperando,
  false,
  "con el tope duro gastado no se ofrece esperar: `agotado` gana",
);

// ── El total SOLO cuenta lo que no lleva reserva (`booking_id is null`) ─────
// Es la asimetría del SQL: si un día el par compró y la reserva se canceló, sus
// mensajes de entonces siguen ahí y NO gastan la consulta previa.
const conReserva = [msg(ALUMNO, "bk-1"), msg(ALUMNO, "bk-1"), msg(ALUMNO)];
assert.equal(
  cupoConsulta(conReserva, ALUMNO).total,
  1,
  "los mensajes etiquetados con una reserva no cuentan para el tope de 20",
);
// …pero para la racha SÍ cuentan: el SQL de los «seguidos» no filtra por
// `booking_id`, y copiarlo «mejor» aquí es exactamente cómo empiezan a
// divergir la pantalla y el servidor.
assert.equal(
  cupoConsulta(conReserva, ALUMNO).seguidos,
  3,
  "la racha no filtra por reserva, igual que en el SQL",
);

// ── Los mensajes del otro no gastan nada mío ────────────────────────────────
const soloTutor = [msg(TUTOR), msg(TUTOR)];
assert.equal(cupoConsulta(soloTutor, ALUMNO).total, 0);
assert.equal(cupoConsulta(soloTutor, ALUMNO).seguidos, 0);

// ── La concordancia del contador, que es lo que se lee ──────────────────────
assert.equal(quedanLabel(1, TOPE_SEGUIDOS), "te queda 1 de 5", "el singular no concuerda");
assert.equal(quedanLabel(4, TOPE_SEGUIDOS), "te quedan 4 de 5");
assert.equal(quedanLabel(0, TOPE_TOTAL), "te quedan 0 de 20");

console.log(
  `OK · racha que reinicia (${TOPE_SEGUIDOS}), tope duro que no (${TOPE_TOTAL}) y mensajes con reserva fuera de la cuenta`,
);
