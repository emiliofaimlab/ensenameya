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

const TYPE_MS = 90; // escribiendo
const ERASE_MS = 45; // borrando: se borra más rápido de lo que se escribe
const HOLD_MS = 1600; // palabra completa en pantalla

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
        {/* Cursor. Se esconde con "reducir movimiento" por CSS y no por estado:
            en ese modo la palabra no cambia, así que un palito parpadeando al
            lado sobraría. */}
        <span className="ml-0.5 inline-block w-0.5 animate-pulse bg-primary align-[-0.1em] not-italic motion-reduce:hidden">
          &nbsp;
        </span>
      </span>
    </em>
  );
}
