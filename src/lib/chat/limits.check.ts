import assert from "node:assert/strict";

import { cupoConsulta, quedanLabel, TOPE_POR_LADO } from "./limits.ts";
import type { ChatMessage } from "./messages.ts";

/**
 * Comprobación del contador de la consulta previa. Sin framework: se corre con
 * `npm run check:chat` y falla con exit code, igual que `check:ics`.
 *
 * ── POR QUÉ ESTO MERECE UN FICHERO ──────────────────────────────────────────
 * Porque esta función es una COPIA en TypeScript de un `count(*)` que vive en
 * PL/pgSQL (`send_conversation_message`, migración `20260828150000`), y una
 * copia que se desvía no falla: sigue pintando un número, solo que uno que no
 * es. El usuario se entera cuando la pantalla le dice «te quedan 3» y el
 * servidor le contesta que no. Un número equivocado es peor que el texto vago
 * que había antes, porque un número se cree.
 *
 * Los casos de abajo son los del SQL, uno a uno, y cubren en particular lo que
 * el tope de hoy tiene de DISTINTO al de M-12 que sustituyó: es un saldo que no
 * se recupera, y cuenta igual para los dos lados.
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
assert.equal(vacio.usados, 0, "un hilo vacío no ha gastado nada");
assert.equal(vacio.quedan, TOPE_POR_LADO, "un hilo vacío da el cupo entero");
assert.equal(vacio.agotado, false, "un hilo vacío no puede estar agotado");

// ── El saldo NO se recupera cuando el otro contesta ─────────────────────────
// ⚠️ EL CASO QUE IMPORTA, y el que separa este tope del de M-12: allí «5» eran
// mensajes SEGUIDOS y la respuesta del tutor reiniciaba la racha. Aquí son 5 y
// se acabaron, conteste quien conteste.
const tres = [msg(ALUMNO), msg(ALUMNO), msg(ALUMNO)];
assert.equal(cupoConsulta(tres, ALUMNO).usados, 3);
assert.equal(cupoConsulta(tres, ALUMNO).quedan, TOPE_POR_LADO - 3);

const conRespuesta = [...tres, msg(TUTOR), msg(ALUMNO)];
const tras = cupoConsulta(conRespuesta, ALUMNO);
assert.equal(tras.usados, 4, "la respuesta del otro NO reinicia el saldo");
assert.equal(tras.quedan, TOPE_POR_LADO - 4);

// ── Agotar el cupo ──────────────────────────────────────────────────────────
const cinco = Array.from({ length: TOPE_POR_LADO }, () => msg(ALUMNO));
const fin = cupoConsulta(cinco, ALUMNO);
assert.equal(fin.quedan, 0);
assert.equal(fin.agotado, true, `${TOPE_POR_LADO} mensajes tienen que agotar el cupo`);

// Y sigue agotado por más que el otro escriba: no hay forma de recuperarlo sin
// reservar. Es justo lo que el texto de la pantalla promete.
assert.equal(
  cupoConsulta([...cinco, msg(TUTOR), msg(TUTOR)], ALUMNO).agotado,
  true,
  "el cupo gastado no se recupera con mensajes del otro",
);

// ── SIMETRÍA: al tutor se le cuenta lo mismo (decisión del 28-ago) ──────────
// Antes el SQL entraba solo `if v_uid = v_c.student_id` y el tutor no gastaba
// nada. Este caso es el que fallaría si alguien restaurase aquella asimetría.
const tutorHabla = Array.from({ length: TOPE_POR_LADO }, () => msg(TUTOR));
const cupoTutor = cupoConsulta(tutorHabla, TUTOR);
assert.equal(cupoTutor.usados, TOPE_POR_LADO, "al tutor se le cuenta igual");
assert.equal(cupoTutor.agotado, true, "el tutor también se queda sin cupo");

// Y los dos saldos son INDEPENDIENTES: que el tutor gaste el suyo no toca el
// del alumno. Es lo que hace que el caso incómodo de la decisión sea posible —
// el tutor sin turno para contestar la última pregunta — y hay que poder verlo.
const mezclado = [...tutorHabla, msg(ALUMNO)];
assert.equal(cupoConsulta(mezclado, ALUMNO).usados, 1, "los saldos no se mezclan");
assert.equal(cupoConsulta(mezclado, ALUMNO).agotado, false);
assert.equal(cupoConsulta(mezclado, TUTOR).agotado, true);

// ── Solo cuenta lo que no lleva reserva (`booking_id is null`) ──────────────
// Si un día el par compró y la reserva se canceló, sus mensajes de entonces
// siguen ahí y NO gastan la consulta previa. Es el predicado exacto del SQL.
const conReserva = [msg(ALUMNO, "bk-1"), msg(ALUMNO, "bk-1"), msg(ALUMNO)];
assert.equal(
  cupoConsulta(conReserva, ALUMNO).usados,
  1,
  "los mensajes etiquetados con una reserva no gastan cupo",
);

// ── Los mensajes del otro no gastan nada mío ────────────────────────────────
assert.equal(cupoConsulta([msg(TUTOR), msg(TUTOR)], ALUMNO).usados, 0);

// ── La concordancia del contador, que es lo que se lee ──────────────────────
assert.equal(quedanLabel(1, TOPE_POR_LADO), "te queda 1 de 5", "el singular no concuerda");
assert.equal(quedanLabel(4, TOPE_POR_LADO), "te quedan 4 de 5");
assert.equal(quedanLabel(0, TOPE_POR_LADO), "te quedan 0 de 5");

console.log(
  `OK · saldo de ${TOPE_POR_LADO} por lado que no se recupera, simétrico, y mensajes con reserva fuera de la cuenta`,
);
