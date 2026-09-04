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
  canales: string[];
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
      return datos.banco;
    case "identificador":
      // El riel de PayPal quiere SU canal. Cualquier otro riel de identificador
      // —hoy solo el manual— se conforma con uno que no sea el de PayPal: es
      // justo el tutor que eligió Zinli, Binance o Zelle.
      return riel.clave === "paypal"
        ? datos.canales.includes("paypal")
        : datos.canales.some((c) => c !== "paypal");
  }
}
