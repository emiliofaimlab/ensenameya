"use client";

import { useEffect, useState } from "react";

/**
 * Palabra rotativa del hero (documento de contenido, §01.1). El diseño la pinta
 * en cursiva naranja y en minúscula, así que van en minúscula aunque el doc las
 * liste en mayúsculas: los corchetes y las versales de ahí son notación, no
 * estilo (regla: el diseño manda sobre el contenido).
 */
const WORDS = [
  "talento",
  "profesión",
  "pasión",
  "lenguaje",
  "negocio",
  "emprendimiento",
  "empresa",
  "perfil",
];

/**
 * La más larga de las ocho, que es la que rompe el titular en una línea más
 * (MN-15): el hero pinta un fantasma con ella para reservar el alto del peor
 * caso. Se elige por número de letras y no midiendo píxeles porque no hay
 * empate posible — «emprendimiento» mide 413px a 48px y la segunda, 231px.
 * Al salir de `WORDS`, cambiar la lista recalcula la reserva sola.
 */
const LONGEST_WORD = WORDS.reduce((a, b) => (b.length > a.length ? b : a));

const TYPE_MS = 90; // escribiendo
const ERASE_MS = 45; // borrando: se borra más rápido de lo que se escribe
const HOLD_MS = 1600; // palabra completa en pantalla

/**
 * Cursor del efecto. Sus 4px (`ml-0.5` + `w-0.5`) **cuentan** para el corte de
 * línea del titular, así que el fantasma tiene que llevarlos también o
 * reservaría de menos.
 *
 * Con "reducir movimiento" se esconde por CSS y no por estado: en ese modo la
 * palabra no cambia, así que un palito parpadeando al lado sobraría. `still` es
 * para el fantasma: no se ve, y animar lo invisible solo gasta batería.
 */
function Cursor({ still = false }: { still?: boolean }) {
  return (
    <span
      className={`ml-0.5 inline-block w-0.5 align-[-0.1em] not-italic${
        still ? "" : " animate-pulse bg-primary motion-reduce:hidden"
      }`}
    >
      &nbsp;
    </span>
  );
}

/**
 * Efecto máquina de escribir. Un solo `setTimeout` encadenado en vez de un
 * `setInterval` con ritmo fijo: cada fase tiene su propia velocidad y así no
 * hace falta llevar un contador de ticks.
 */
export function RotatingWord() {
  const [i, setI] = useState(0);
  const [len, setLen] = useState(WORDS[0].length);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    // Sin JS o con "reducir movimiento" se queda "talento" fijo, que es lo que
    // pinta el servidor. Se consulta aquí y no en un estado aparte: matchMedia
    // no existe en el servidor y guardarlo obligaba a un setState en efecto.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const word = WORDS[i];
    let delay: number;

    if (!erasing && len === word.length) delay = HOLD_MS;
    else delay = erasing ? ERASE_MS : TYPE_MS;

    const t = setTimeout(() => {
      if (erasing) {
        if (len === 0) {
          setErasing(false);
          setI((n) => (n + 1) % WORDS.length);
        } else setLen((n) => n - 1);
      } else if (len === word.length) setErasing(true);
      else setLen((n) => n + 1);
    }, delay);

    return () => clearTimeout(t);
  }, [i, len, erasing]);

  return (
    <em className="text-primary">
      {/* El lector de pantalla lee una frase estable; la animación es decorativa. */}
      <span className="sr-only">{WORDS[0]}</span>
      <span aria-hidden>
        {WORDS[i].slice(0, len)}
        <Cursor />
      </span>
    </em>
  );
}

/**
 * Copia quieta con la palabra más larga, para que el hero reserve el alto de su
 * peor caso (MN-15). Vive aquí y no en el hero para que comparta palabra y
 * cursor con lo de arriba: en cuanto divergen, la reserva deja de valer.
 * Quien la pinta la esconde — aquí no se decide eso.
 */
export function RotatingWordGhost() {
  return (
    <em className="text-primary">
      {LONGEST_WORD}
      <Cursor still />
    </em>
  );
}
