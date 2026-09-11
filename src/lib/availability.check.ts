import assert from "node:assert/strict";

import { horasSemana, seSolapan, huecosDeFranja, type Rule } from "./availability.ts";

/**
 * Comprobación del contador de horas del tutor. Sin framework:
 * `npm run check:horario`.
 *
 * ── POR QUÉ ESTO MERECE UN FICHERO ──────────────────────────────────────────
 * Porque «Abres 19 h a la semana» es una frase que NADIE puede contrastar
 * mirando la pantalla: las filas y la cabecera salen de esta misma función, así
 * que si miente, miente igual en los tres sitios y además cuadran entre sí. El
 * error de origen —sumar en crudo— sobrevivió meses justamente por eso.
 *
 * Las dos reglas que vigila son las dos que tiene `get_available_slots`:
 *   · los huecos repetidos se ofrecen UNA vez (`union` de los inicios), así que
 *     dos franjas que se pisan no suman dos veces lo pisado;
 *   · una franja pausada no se ofrece, así que no abre horas.
 */

let n = 0;
const franja = (
  weekday: number,
  start_time: string,
  end_time: string,
  is_active = true,
): Rule => ({ id: `r${++n}`, weekday, start_time, end_time, is_active });

// ── 1 · Día vacío: cadena vacía, no «0 h» ───────────────────────────────────
// La cabecera del panel pone el «0 h» a mano (`|| "0 h"`) y la fila pone «—»:
// devolver texto aquí les quitaría a las dos la posibilidad de elegir.
assert.equal(horasSemana([]), "", "un día sin franjas no devuelve cadena vacía");

// ── 2 · Lo normal sigue sumando ─────────────────────────────────────────────
assert.equal(horasSemana([franja(1, "09:00:00", "13:00:00")]), "4 h");
assert.equal(
  horasSemana([franja(1, "09:00:00", "13:30:00")]),
  "4 h 30 min",
  "pierde los minutos sueltos",
);
// Dos franjas separadas del mismo día SÍ suman las dos: no se pisan.
assert.equal(
  horasSemana([franja(1, "09:00:00", "11:00:00"), franja(1, "15:00:00", "17:00:00")]),
  "4 h",
);
// Pegadas tampoco son un solape (08–12 y 12–16 son cuatro más cuatro).
assert.equal(
  horasSemana([franja(1, "08:00:00", "12:00:00"), franja(1, "12:00:00", "16:00:00")]),
  "8 h",
  "trata dos franjas seguidas como un solape",
);

// ── 3 · DOS FRANJAS IGUALES CUENTAN UNA VEZ ─────────────────────────────────
// 🔑 El caso que el cliente ve: duplicar una franja no duplica lo que abres.
assert.equal(
  horasSemana([franja(2, "09:00:00", "13:00:00"), franja(2, "09:00:00", "13:00:00")]),
  "4 h",
  "una franja duplicada suma dos veces",
);

// ── 4 · Solape parcial: se cuenta la unión, no la suma ──────────────────────
// 09–13 + 12–15 abre de 09 a 15 = 6 h, no 7.
assert.equal(
  horasSemana([franja(3, "09:00:00", "13:00:00"), franja(3, "12:00:00", "15:00:00")]),
  "6 h",
  "cuenta dos veces la hora solapada",
);
// Y una franja contenida entera dentro de otra no añade nada. Es el jueves de
// la base de dev: 07–22 con 07–11 encima anunciaba 19 h para 15 reales.
assert.equal(
  horasSemana([franja(4, "07:00:00", "22:00:00"), franja(4, "07:00:00", "11:00:00")]),
  "15 h",
  "una franja contenida en otra sigue sumando",
);

// ── 5 · Una franja PAUSADA no abre nada ─────────────────────────────────────
assert.equal(
  horasSemana([franja(5, "09:00:00", "13:00:00", false)]),
  "",
  "una franja pausada sigue contando horas",
);
assert.equal(
  horasSemana([franja(5, "09:00:00", "13:00:00"), franja(5, "15:00:00", "19:00:00", false)]),
  "4 h",
  "la pausada se suma junto a la activa",
);
// ⚠️ Y una pausada TAMPOCO tapa el solape de las activas: si contara para la
// fusión, dos activas pisadas por una pausada saldrían mal por el otro lado.
assert.equal(
  horasSemana([
    franja(5, "09:00:00", "11:00:00"),
    franja(5, "10:00:00", "12:00:00"),
    franja(5, "00:00:00", "23:00:00", false),
  ]),
  "3 h",
  "la pausada entra en la fusión",
);

// ── 6 · La semana se fusiona POR DÍA, no en una recta ───────────────────────
// 🔑 Sin agrupar por `weekday`, «lunes 09–13» y «martes 09–13» se pisarían entre
// ellos y la semana entera daría 4 h. La cabecera del panel llama a esto con las
// franjas de los siete días.
assert.equal(
  horasSemana([franja(1, "09:00:00", "13:00:00"), franja(2, "09:00:00", "13:00:00")]),
  "8 h",
  "fusiona franjas de días distintos",
);

// ── 7 · `seSolapan`, que es lo que dispara el aviso del chip ────────────────
const a = franja(1, "09:00:00", "13:00:00");
assert.equal(seSolapan(a, franja(1, "12:00:00", "15:00:00")), true);
assert.equal(seSolapan(a, franja(1, "13:00:00", "15:00:00")), false, "pegado no es solapado");
assert.equal(seSolapan(a, franja(1, "09:00:00", "13:00:00")), true, "no ve el duplicado exacto");
// Acepta 'HH:MM' a pelo: el formulario del gestor manda lo que teclea el tutor,
// sin los segundos que trae la columna `time`.
assert.equal(seSolapan({ start_time: "09:00", end_time: "10:00" }, a), true);

// ── 8 · Los huecos no se tocaron: siguen partiendo por duración y paso ──────
assert.equal(huecosDeFranja({ start_time: "08:00:00", end_time: "17:00:00" }, 60, null), 9);
assert.equal(huecosDeFranja({ start_time: "09:00:00", end_time: "10:00:00" }, 90, null), 0);

console.log(
  "✓ availability: día vacío, duplicado exacto, solape parcial, franja pausada, semana por día y solapes",
);
