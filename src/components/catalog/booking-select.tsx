"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * B3.4 · Una opción del selector, **ya resuelta por el servidor**.
 *
 * ⚠️ `href` viene calculado desde arriba a propósito: quien sabe montar la URL
 * es el `hrefFor` de cada página (`/tutors/[id]` y `/products/[id]`), y ese
 * `hrefFor` es una closure de un Server Component — **no se puede pasar como
 * prop a un componente de cliente**, no es serializable. Así que lo que cruza
 * la frontera son cadenas: valor, etiqueta y destino. Este componente no
 * construye rutas, solo navega a las que le dan.
 */
export type BookingOption = {
  /** Lo que identifica la opción: id de mentoría, o el ISO canónico de la hora. */
  value: string;
  label: string;
  /** Exactamente el mismo destino al que apuntaba el enlace que sustituye. */
  href: string;
};

/**
 * B3.4 · Selector de mentoría / de hora del panel de reserva.
 *
 * El cliente lo pidió con estas palabras: «El selector de mentoría son dos
 * tarjetas […] esto se migra a un selector de mentorías, un select normal. Lo
 * mismo con la hora: ahorita despliegas unos cuadritos con las horas, se va a
 * migrar a un selector y ya».
 *
 * ⚠️ POR QUÉ ESTE COMPONENTE ES TAN PEQUEÑO, Y POR QUÉ NO SE HIZO CLIENTE EL
 * PANEL ENTERO. `booking-panel.tsx` es 100 % servidor y su estado ES la query
 * string — está argumentado allí: «el estado es la query — se comparte, se
 * recarga y se vuelve atrás gratis». Un `<select>` necesita `onChange`, o sea
 * cliente, pero eso es lo ÚNICO que necesita cliente. Convertir el panel entero
 * tiraría por la ventana esa propiedad (enlaces que se comparten, recarga que
 * conserva la elección, botón atrás que la deshace) a cambio de nada. Aquí el
 * `<select>` sigue siendo un navegador de enlaces: cambiar de opción hace
 * exactamente lo que hacía pulsar el chip — ir a otra URL y dejar que el
 * servidor repinte. La verdad sigue estando en la query.
 *
 * ⚠️ LO QUE SÍ SE PIERDE, y se paga a sabiendas: los chips eran `<a>` y
 * funcionaban SIN JavaScript. Un `<select>` con `onChange` no. Es inseparable
 * de lo que se pidió («un selector y ya») y no hay forma de tener las dos
 * cosas; queda anotado por si algún día importa.
 *
 * Ventaja de propina, que es de donde salía la ficha: un `<select>` mide lo
 * mismo con 2 opciones que con 40. Los chips de hora ocupaban de una a cuatro
 * filas según el día, y las tarjetas de mentoría crecían y menguaban con las
 * clases que tuvieran hueco ESE día. Dos de las fuentes de salto de altura de
 * §23.4 mueren aquí sin hacer nada más.
 */
export function BookingSelect({
  id,
  label,
  hint,
  placeholder,
  options,
  value,
}: {
  id: string;
  label: string;
  /** Aclaración en gris junto a la etiqueta (p. ej. «· en tu hora local»). */
  hint?: string;
  /** Texto de la opción vacía, la que se ve cuando aún no se ha elegido. */
  placeholder: string;
  options: BookingOption[];
  /** Lo elegido HOY según el servidor, o "" si aún no hay nada elegido. */
  value: string;
}) {
  const router = useRouter();

  /*
   * ⚠️ SELECCIÓN OPTIMISTA. No es estado paralelo al de la URL: es el hueco de
   * los ~200 ms que tarda el servidor en confirmar, y nada más.
   *
   * Con un `<select>` controlado a secas (`value={value}`) la navegación se ve
   * mal: eliges las 10:00 y React revierte la caja al valor de la prop —que
   * sigue siendo el viejo hasta que conteste el servidor—, así que durante ese
   * instante enseña la hora ANTERIOR. En móvil eso se lee como «no me ha hecho
   * caso» y se vuelve a tocar.
   *
   * `previo` es el patrón de React para AJUSTAR estado cuando cambia una prop:
   * en cuanto el servidor manda un valor distinto al que mandó la última vez,
   * manda él y se descarta lo optimista. Sirve para las dos direcciones —
   * confirma la elección, y también la deshace si el visitante le da al botón
   * atrás o abre un enlace compartido.
   *
   * ⚠️ Se hizo así y NO remontando el `<select>` con una `key` (que era lo
   * primero que probé) porque el remonte se lleva por delante el FOCO: quien
   * elige con el teclado se quedaba sin él tras cada selección, y volver al
   * control exigía tabular desde el principio del panel.
   */
  const [elegido, setElegido] = useState(value);
  const [previo, setPrevio] = useState(value);
  if (value !== previo) {
    setPrevio(value);
    setElegido(value);
  }

  /*
   * ⚠️ La red de seguridad del caso raro pero real: el hueco se ocupa entre el
   * render y el clic. El servidor devuelve la lista SIN esa hora y sin darla
   * por elegida, así que lo optimista se queda huérfano — apuntando a una
   * opción que ya no está en la lista. Si eso pasa, la caja vuelve al
   * placeholder, que es la verdad: no hay nada elegido y el botón está
   * bloqueado. Sin esto enseñaría una hora inexistente junto a un CTA muerto.
   */
  const mostrado = options.some((o) => o.value === elegido) ? elegido : "";

  return (
    <>
      {/* Accesibilidad: antes esto era un `<p>` que hacía de encabezado visual
          de los chips y no estaba asociado a nada. Con un control de verdad
          hace falta una `<label>` de verdad, o el lector de pantalla anuncia
          «lista desplegable» a secas. */}
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-[#212121]"
      >
        {label}
        {hint ? (
          <span className="font-normal text-[#6b6b6b]"> {hint}</span>
        ) : null}
      </label>
      <select
        id={id}
        value={mostrado}
        onChange={(e) => {
          const opcion = options.find((o) => o.value === e.target.value);
          // ⚠️ Guarda para el placeholder: si por lo que sea llega el valor
          // vacío, no se navega a ningún sitio. Nunca se inventa un destino.
          if (!opcion) return;
          setElegido(opcion.value);
          router.push(opcion.href);
        }}
        className="mt-2 h-[45px] w-full rounded-[10px] border border-[#cccccc] bg-card px-3 text-[13.5px] text-[#212121] transition-colors hover:border-brand focus-visible:border-brand focus-visible:outline-none"
      >
        {/* `disabled` para que sea una salida de fábrica y no un destino: se
            puede ver «Elige una hora» al principio, pero no se puede VOLVER a
            «nada» una vez elegido — eso solo dejaría el botón bloqueado. */}
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}
