/**
 * LOS LOGOS DE CADA FORMA DE COBRO.
 *
 * ── POR QUÉ SON FICHEROS Y NO PATHS PEGADOS EN UN TSX ───────────────────────
 *
 * Los SVG viven en `public/img/payout/` y aquí solo está su color. Así, el día
 * que haya que añadir uno —o corregir el de una marca que cambió de imagen— es
 * dejar el fichero en su sitio y añadir una línea aquí, no editar un `path` de
 * 400 caracteres dentro de un componente.
 *
 * Son marcas de terceros: se pintan tal cual y en SU color, que es la única
 * forma correcta de usar un logo ajeno. El resto de la tarjeta sigue en la
 * paleta de Enséñame Ya — la marca es del logo, no de la interfaz.
 *
 * ⚠️ SE PINTAN CON `mask`, NO CON `<img>`, y eso es lo que permite darles
 * color: los SVG de simple-icons vienen sin `fill`, así que un `<img>` los
 * dejaría negros. Con máscara, el fichero decide la FORMA y esta tabla el
 * color, que es justo el reparto que hace falta.
 *
 * ⚠️ ZINLI NO ESTÁ, y no es un olvido: no existe en simple-icons (404 medido el
 * 8-sep-2026) y no se inventa un logo aproximado, que es peor que no ponerlo.
 * Sin entrada aquí la tarjeta cae al monograma, que es un respaldo con pinta de
 * intencionado. Para arreglarlo basta con dejar `zinli.svg` en la carpeta y
 * añadir su color abajo — sin tocar ningún componente.
 */
export const LOGOS: Record<string, { src: string; color: string }> = {
  // Los cuatro hex son los que publica simple-icons como color oficial de cada
  // marca. No se ajustan «para que peguen»: un logo con el color cambiado deja
  // de ser el logo.
  paypal: { src: "/img/payout/paypal.svg", color: "#002991" },
  stripe: { src: "/img/payout/stripe.svg", color: "#635BFF" },
  binance: { src: "/img/payout/binance.svg", color: "#F0B90B" },
  zelle: { src: "/img/payout/zelle.svg", color: "#6D1ED4" },
  // 'banco' NO lleva logo de marca a propósito: la tarjeta de transferencia
  // cubre a dLocal y a Wise a la vez y no dice cuál usamos, porque al tutor no
  // le cambia nada. Poner el de uno de los dos sería prometerle un corresponsal.
  // Su glifo es el icono de banco de lucide, que ya es dependencia.
};
