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
  /**
   * ⚠️ Y STRIPE PIDE OTRAS DOS COSAS, por lo mismo que Wise tiene su clave: la
   * fecha de nacimiento y la aceptación de condiciones, que son los dos campos
   * OPCIONALES del formulario. Un tutor puede tener su cuenta registrada —y
   * cobrar por dLocal o por Wise con ella— y aun así no ser pagable por Stripe.
   *
   * El PAÍS no entra aquí: Stripe no admite cuentas de EE. UU. ni de Brasil
   * desde una plataforma estadounidense, pero quien sabe eso es Stripe. El
   * adaptador lo clasifica `sin-datos` y la orden baja al siguiente candidato.
   * Una lista de países en este módulo sería una segunda lista que mantener.
   */
  banco_stripe: boolean;
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
export type RielMinimo = { clave: string; dato: "banco" | "identificador" };

export function rielSirveParaEsteTutor(riel: RielMinimo, datos: DatosDeCobro): boolean {
  switch (riel.dato) {
    case "banco":
      // Los TRES rieles de banco leen la MISMA fila y no les vale lo mismo:
      //   · dLocal  → le basta con que exista;
      //   · Wise    → necesita además dirección, teléfono, país cubierto y un
      //               banco de su lista;
      //   · Stripe  → necesita la fecha de nacimiento y la aceptación de
      //               condiciones, que son opcionales en el formulario.
      // Es la misma asimetría que abajo separa a PayPal del resto de
      // identificadores, y existe para que no se elija un riel que va a
      // devolver `sin-datos` y dejar la orden quieta.
      if (riel.clave === "wise") return datos.banco_wise;
      if (riel.clave === "stripe") return datos.banco_stripe;
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

/**
 * Lo que hace falta de un riel para ELEGIRLO, no solo para saber si sirve.
 * Es `Riel` menos lo que aquí no se mira, y se declara aparte porque este
 * módulo no puede importar `lib/payments.ts` (lleva `server-only`).
 */
export type RielElegible = RielMinimo & {
  ataduraDeBalance: boolean;
  puedePagar: () => boolean;
};

/**
 * 🔴 QUIÉN EJECUTA ESTA ORDEN — la decisión entera, y pura.
 *
 * Vivía dentro de `payoutProviderFor`, mezclada con dos consultas. Sale aquí
 * porque decidir por dónde sale el dinero de alguien es exactamente el tipo de
 * lógica que tiene que poder comprobarse sin red ni credenciales
 * (`npm run check:riel`).
 *
 * `rieles` llega YA ordenado por preferencia del tutor: reordenar es cosa de
 * `ordenaPorPreferencia`, y mezclar las dos cosas es cómo se desincronizan.
 *
 * ⚠️ `excluir` ES LO QUE ARREGLA AUD-01. Antes no existía y un riel que
 * RECHAZABA dejaba la orden en `failed` sin probar a los de detrás: el 422 de
 * Wise mataba el cobro de un tutor al que Stripe sí podía pagar. Como el tutor
 * solo ve «Banco» y detrás compiten tres rieles, ese fallo le llegaba como «no
 * me han pagado» sin más explicación. Aquí entran los que ya rechazaron ESTA
 * orden, y por eso la lista solo puede crecer: es lo que garantiza que el
 * descenso termina.
 */
export function eligeRiel(
  rieles: readonly RielElegible[],
  datos: DatosDeCobro | null,
  fundingProvider: string | null,
  excluir: readonly string[] = [],
): string | null {
  for (const riel of rieles) {
    // Ya lo intentamos y el proveedor dijo que no. No se vuelve a preguntar.
    if (excluir.includes(riel.clave)) continue;
    // ¿Hay hoy con qué ejecutar por aquí? Un riel sin adaptador reserva sitio
    // en el orden de preferencia y nada más.
    if (!riel.puedePagar()) continue;
    // 🔴 LA ATADURA DEL BALANCE. Un riel atado solo sirve si el dinero está en
    // SU balance; uno fondeado aparte no depende de quién cobró.
    if (riel.ataduraDeBalance && riel.clave !== fundingProvider) continue;
    // Y lo último: que ESTE tutor le haya dado lo que necesita. Un riel que no
    // puede pagarle a él no es un candidato, es una orden atascada en silencio.
    if (datos && !rielSirveParaEsteTutor(riel, datos)) continue;
    return riel.clave;
  }
  return null;
}

/**
 * 🔴 ¿SE PUEDE BAJAR DE RIEL SIN RIESGO DE PAGAR DOS VECES?
 *
 * Bajar significa mandar el MISMO dinero por otro sitio, así que solo se hace
 * cuando está demostrado que el riel anterior no creó nada. Si alguna puerta se
 * cierra, la orden termina en 'failed' y la mira una persona: entre pagar dos
 * veces y que un humano revise, se revisa.
 *
 * Vive aquí, pura y comprobable, porque es la única parte del descenso donde un
 * error cuesta dinero de verdad. La primera versión de AUD-01 no la tenía y
 * bajaba siempre — incluido el caso en que el rechazo trae identificador, que
 * es justo cuando el proveedor SÍ creó la orden.
 */
export type SituacionDelRechazo = {
  /** ¿Venía ya en 'processing' de una pasada anterior? Entonces no se conoce su historia. */
  enVuelo: boolean;
  /** El identificador que trae el rechazo. Si lo trae, el proveedor creó la orden. */
  payoutIdDelRechazo: string | null | undefined;
  /** El que ya tenía la fila. Mismo argumento. */
  payoutIdEnLaFila: string | null | undefined;
  /** Cómo acabó la pasada ANTERIOR, leído antes del reclamo. */
  ultimoEstado: string | null | undefined;
};

export function sePuedeBajarDeRiel(s: SituacionDelRechazo): boolean {
  // 1 · Reclamada en esta pasada: su historia es conocida.
  if (s.enVuelo) return false;
  // 2 · El rechazo no trae identificador. Cuando lo trae, el proveedor creó la
  //     orden y luego la rechazó — y en su panel puede haber otra viva con la
  //     misma marca, porque dLocal no deduplica por `description`.
  if (s.payoutIdDelRechazo) return false;
  // 3 · Ni lo traía ya la fila.
  if (s.payoutIdEnLaFila) return false;
  // 4 · Y la pasada anterior no murió a mitad de envío. Un 'transitorio' es
  //     exactamente el caso en que el proveedor pudo aceptar sin que nosotros
  //     nos enteráramos: PayPal contesta después «batch already exists», y ese
  //     400 llega al job como un rechazo cualquiera.
  if (s.ultimoEstado === "transitorio") return false;
  return true;
}
