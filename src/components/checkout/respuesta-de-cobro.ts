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
  modo?: "embebido" | "redireccion" | "simulado";
  clientSecret?: string;
  publishableKey?: string;
  /** dLocal Go: a dónde mandar a la persona a pagar. */
  redirectUrl?: string;
  /** Se conserva por compatibilidad; `modo: 'simulado'` dice lo mismo. */
  simulated?: boolean;
  retencionHasta?: string | null;
  error?: string;
};

/** Lo que la pantalla tiene que hacer con esa respuesta, ya decidido. */
export type Apertura =
  | { tipo: "embebido"; embed: Embed }
  | { tipo: "redireccion"; url: string }
  | { tipo: "simulado" }
  | { tipo: "error"; mensaje: string };

/**
 * Traduce la respuesta a una acción.
 *
 * ⚠️ EL ORDEN DE LAS COMPROBACIONES IMPORTA. Se mira `modo` primero y la forma
 * después: la forma es la compatibilidad con una respuesta vieja (un despliegue
 * a medias, una pestaña abierta desde antes), no el criterio. Al revés, un
 * `modo: 'redireccion'` que por lo que sea trajera también un `clientSecret` se
 * montaría embebido.
 *
 * Y el caso por defecto NO es «simulado»: es error. Solo se cae al camino
 * simulado cuando el servidor lo dice.
 */
export function interpretar(salida: RespuestaDeCobro): Apertura {
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
