/**
 * LOS LOGOS DE LOS CALENDARIOS.
 *
 * Mismo patrón que `src/app/(app)/tutor/payouts/logos.ts`, y a propósito: los
 * SVG viven en `public/img/calendar/` y aquí solo está su color, así que añadir
 * o corregir una marca es dejar el fichero en su sitio y tocar una línea, no
 * editar un `path` de 400 caracteres dentro de un componente.
 *
 * ⚠️ SE PINTAN CON `mask`, NO CON `<img>`. Los SVG de simple-icons vienen sin
 * `fill`, así que un `<img>` los dejaría NEGROS a los tres. Con máscara el
 * fichero pone la FORMA y esta tabla el color.
 *
 * Son marcas de terceros: van en SU color oficial —el que publica simple-icons,
 * sin «ajustarlo para que pegue», porque un logo recoloreado deja de ser el
 * logo—. El resto del control sigue en la paleta de Enséñame Ya.
 *
 * Aquí no hay el segundo modo de `payouts/logos.ts` (el `<img>` sin `color`,
 * para logos multicolor): los tres son siluetas de simple-icons.
 */
export const LOGOS_CALENDARIO = {
  google: { src: "/img/calendar/googlecalendar.svg", color: "#4285F4" },
  apple: { src: "/img/calendar/apple.svg", color: "#000000" },
  outlook: { src: "/img/calendar/microsoftoutlook.svg", color: "#0078D4" },
} satisfies Record<string, { src: string; color: string }>;
