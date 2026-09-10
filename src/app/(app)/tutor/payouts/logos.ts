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
 * ── DOS MODOS, Y LOS DECIDE `color` ────────────────────────────────────────
 *
 *   CON color  → el SVG es una silueta monocroma (las de simple-icons vienen
 *                sin `fill`) y se pinta con `mask`: el fichero da la FORMA y
 *                esta tabla el color.
 *   SIN color  → el SVG ya trae sus colores dentro y se pinta con `<img>`, tal
 *                cual. Es lo que hace falta para un logo de más de un color,
 *                que con máscara saldría plano.
 *
 * ⚠️ ZINLI llegó por el segundo camino: no existe en simple-icons (404 medido
 * el 8-sep-2026), así que su SVG es el que entregó el cliente —cuadrado morado
 * con la Z verde— y por eso va sin `color`. Antes de tenerlo, su tarjeta caía
 * al monograma en vez de a un logo aproximado, que habría sido peor.
 */
export const LOGOS: Record<string, { src: string; color?: string }> = {
  // Los cuatro hex son los que publica simple-icons como color oficial de cada
  // marca. No se ajustan «para que peguen»: un logo con el color cambiado deja
  // de ser el logo.
  paypal: { src: "/img/payout/paypal.svg", color: "#002991" },
  binance: { src: "/img/payout/binance.svg", color: "#F0B90B" },
  zelle: { src: "/img/payout/zelle.svg", color: "#6D1ED4" },
  // Sin `color`: su SVG ya trae los dos (morado #5333B5 y verde #33CC99).
  zinli: { src: "/img/payout/zinli.svg" },
  // 'banco' NO lleva logo de marca a propósito: la tarjeta de transferencia
  // cubre a dLocal, Wise y Stripe a la vez y no dice cuál usamos, porque al
  // tutor no le cambia nada. Poner el de uno de los tres sería prometerle un
  // corresponsal concreto. Por eso tampoco hay ya entrada de `stripe` aquí:
  // era inalcanzable, porque ningún método del tutor se llama así.
  // Su glifo es el icono de banco de lucide, que ya es dependencia.
};
