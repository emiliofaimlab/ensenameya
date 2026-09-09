import type { Embed } from "@/components/checkout/stripe-embed";

/**
 * A2 · LO QUE DEVUELVE `/api/pagos/checkout`, EN UN SOLO SITIO.
 *
 * Existe porque hay TRES pantallas que abren un cobro —el checkout de una
 * reserva nueva, el «Pagar ahora» de una a medias y el de un pedido— y las tres
 * interpretaban la respuesta por su cuenta, con la misma línea copiada:
 *
 *     if (salida.clientSecret && salida.publishableKey) { …montar… }
 *     else { …camino simulado… }
 *
 * Eso funcionaba con UN proveedor. Con dos ya no: dLocal Go no devuelve
 * `clientSecret` sino una URL a la que hay que ir, así que ese `else` habría
 * pintado **el botón de «simular pago» de un entorno de pruebas encima de un
 * cobro real**. No es un fallo hipotético: es exactamente la forma de fallo que
 * este proyecto ya conoce —`adapterFor` mandando 'dlocal' al simulado sin hacer
 * ruido, avisado en `simulated-provider.ts`— y la que hace que un cobro roto
 * parezca un cobro de mentira en vez de un error.
 *
 * Así que la decisión pasa a ser un discriminante explícito (`modo`) y vive
 * aquí, una vez. Lo desconocido es un ERROR VISIBLE, no un checkout simulado.
 */
export type RespuestaDeCobro = {
  modo?: "embebido" | "transparente" | "redireccion" | "simulado";
  clientSecret?: string;
  publishableKey?: string;
  /**
   * dLocal Go: a dónde mandar a la persona a pagar.
   *
   * ⚠️ VIENE TAMBIÉN CON `modo: 'transparente'`, y ahí NO es el destino: es la
   * salida de respaldo si el formulario no arranca. De ahí la regla del orden de
   * abajo.
   */
  redirectUrl?: string;
  /** dLocal Go, transparente: la clave pública de SU tokenizador (no es nuestra). */
  publicKey?: string;
  /** Se conserva por compatibilidad; `modo: 'simulado'` dice lo mismo. */
  simulated?: boolean;
  retencionHasta?: string | null;
  error?: string;
};

/** Lo que la pantalla tiene que hacer con esa respuesta, ya decidido. */
export type Apertura =
  | { tipo: "embebido"; embed: Embed }
  /** dLocal transparente: sus campos de tarjeta, dentro de nuestra pantalla. */
  | { tipo: "transparente"; transparente: DlocalTransparente }
  | { tipo: "redireccion"; url: string }
  | { tipo: "simulado" }
  | { tipo: "error"; mensaje: string };

/** Lo que `DlocalEmbed` necesita para montarse. */
export type DlocalTransparente = {
  /** La clave de plataforma de dLocal Go, no la nuestra. */
  publicKey: string;
  /** El checkout alojado del MISMO cobro. Salida de respaldo, nunca el destino. */
  redirectUrl: string;
};

/**
 * Traduce la respuesta a una acción.
 *
 * 🔴 EL ORDEN DE LAS COMPROBACIONES IMPORTA, Y CON EL TRANSPARENTE PASA A SER
 * CRÍTICO: **primero el MODO, luego la forma.** La forma es la compatibilidad
 * con una respuesta vieja (un despliegue a medias, una pestaña abierta desde
 * antes), no el criterio.
 *
 * Al revés, con la comprobación de `redirectUrl` por delante, un
 * `modo: 'transparente'` —que trae `redirectUrl` a propósito, como salida de
 * respaldo— se iría por la redirección y el dictado §2 no se cumpliría nunca: el
 * alumno saldría del sitio pudiendo pagar dentro, y el síntoma sería «el
 * transparente no funciona» en vez de «lo estamos ignorando».
 *
 * Y el caso por defecto NO es «simulado»: es error. Solo se cae al camino
 * simulado cuando el servidor lo dice.
 */
export function interpretar(salida: RespuestaDeCobro): Apertura {
  // El transparente PRIMERO, porque es el único que trae dos formas a la vez.
  if (salida.modo === "transparente") {
    return salida.publicKey && salida.redirectUrl
      ? {
          tipo: "transparente",
          transparente: { publicKey: salida.publicKey, redirectUrl: salida.redirectUrl },
        }
      : // Sin una de las dos no se monta nada: sin clave no hay tokenizador y sin
        // la URL de respaldo no habría salida si el tokenizador fallara.
        { tipo: "error", mensaje: "No se pudo abrir el formulario de pago." };
  }
  if (salida.modo === "redireccion") {
    return salida.redirectUrl
      ? { tipo: "redireccion", url: salida.redirectUrl }
      : { tipo: "error", mensaje: "La pasarela no devolvió a dónde ir a pagar." };
  }
  if (salida.modo === "simulado" || salida.simulated === true) {
    return { tipo: "simulado" };
  }
  if (salida.clientSecret && salida.publishableKey) {
    return {
      tipo: "embebido",
      embed: { clientSecret: salida.clientSecret, publishableKey: salida.publishableKey },
    };
  }
  return { tipo: "error", mensaje: "No se pudo abrir el pago." };
}

/**
 * Sale del sitio hacia la pasarela.
 *
 * `location.replace` y no `assign`: así el checkout no queda en el historial y
 * el «atrás» del navegador desde la pasarela no devuelve a una pantalla que
 * intentaría abrir el cobro otra vez. `router.push` de Next no vale — es una
 * URL externa.
 */
export function irAPagar(url: string): void {
  window.location.replace(url);
}
