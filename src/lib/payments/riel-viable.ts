/**
 * ¿PUEDE ESTE RIEL PAGARLE A ESTE TUTOR? — la pregunta que faltaba.
 *
 * Vive aquí y no en `lib/payments.ts` por el mismo motivo que `cadena.ts` y los
 * mapeos de PayPal y Connect: ese módulo lleva `import "server-only"` y no
 * puede ejecutarse en un `--experimental-strip-types`. Lo que decide a quién se
 * le paga tiene que poder probarse sin red ni credenciales.
 */

/**
 * Lo que un tutor tiene registrado, en la forma mínima que el ruteo necesita.
 * Sale de `datos_de_cobro_del_tutor` y no lleva ni un dato de cobro dentro.
 */
export type DatosDeCobro = {
  conectada: boolean;
  banco: boolean;
  /**
   * ⚠️ WISE PIDE MÁS QUE COORDENADAS BANCARIAS, y por eso esto va aparte de
   * `banco` en vez de estrecharlo. Un tutor puede tener su cuenta registrada
   * —y cobrar por dLocal con ella— y aun así no ser pagable por Wise: le falta
   * la dirección o el teléfono, su país no está cubierto (Venezuela y Panamá no
   * cotizan siquiera), o su banco no está entre los que Wise conoce. Lo calcula
   * `wise_puede_pagar_a()`, que es la única definición de esa pregunta.
   */
  banco_wise: boolean;
  canales: string[];
  /**
   * 🔑 POR DÓNDE PREFIERE COBRAR ÉL. `null` = no ha elegido, y entonces manda el
   * orden de `payment_routing_rules`, que es como funcionaba esto antes del
   * 8-sep-2026. Lo consume `ordenaPorPreferencia` (`metodo-preferido.ts`), que
   * REORDENA candidatos: los filtros de aquí abajo se aplican después igual, así
   * que preferir un método sin completar sus datos no atasca ninguna orden.
   */
  metodo_preferido: string | null;
};

/**
 * 🔴 ¿PUEDE ESTE RIEL PAGARLE A ESTE TUTOR CON LO QUE TIENE REGISTRADO?
 *
 * Existe por un fallo que estuvo vivo y mudo: un tutor venezolano con Zinli no
 * cobraba NUNCA. Venezuela rutea `{paypal, manual}`, PayPal puede pagar desde
 * que tiene adaptador, así que se elegía siempre; el adaptador pedía un destino
 * de PayPal que ese tutor no tiene, devolvía `sin-datos`, y la orden se quedaba
 * en 'scheduled' para siempre. Ni pagaba ni fallaba.
 *
 * Los tres canales manuales que decidió el cliente —Zinli, Binance, Zelle—
 * estaban muertos desde el día que PayPal empezó a funcionar, mientras la
 * pantalla se los seguía ofreciendo.
 *
 * ⚠️ QUE UN RIEL «PUEDA PAGAR» Y QUE PUEDA PAGARLE **A ESTE TUTOR** SON DOS
 * PREGUNTAS DISTINTAS, y confundirlas es lo que causó el fallo. `puedePagar()`
 * dice si el riel tiene adaptador y credenciales; esto dice si esa persona
 * concreta le ha dado lo que necesita.
 *
 * ⚠️ Y PARA EL RUTEO, LA DIFERENCIA ENTRE PAYPAL Y ZINLI ES SOLO EL CANAL. Los
 * dos son de familia 'identificador' y los dos viven en la misma tabla; lo
 * único que los separa es el valor de `channel`. Por eso el riel de PayPal pide
 * el suyo y el manual acepta cualquier otro.
 */
/** Lo mínimo de un riel que hace falta para responder. Encaja con `Riel`. */
export type RielMinimo = { clave: string; dato: "banco" | "identificador" | "conectada" };

export function rielSirveParaEsteTutor(riel: RielMinimo, datos: DatosDeCobro): boolean {
  switch (riel.dato) {
    case "conectada":
      return datos.conectada;
    case "banco":
      // Los dos rieles de banco automáticos leen la MISMA fila y no les vale lo
      // mismo: a dLocal le basta con que exista, y Wise necesita además
      // dirección, teléfono, país cubierto y un banco de su lista. Es la misma
      // asimetría que abajo separa a PayPal del resto de identificadores.
      return riel.clave === "wise" ? datos.banco_wise : datos.banco;
    case "identificador":
      // El riel de PayPal quiere SU canal. Cualquier otro riel de identificador
      // —hoy solo el manual— se conforma con uno que no sea el de PayPal: es
      // justo el tutor que eligió Zinli, Binance o Zelle.
      return riel.clave === "paypal"
        ? datos.canales.includes("paypal")
        : datos.canales.some((c) => c !== "paypal");
  }
}
