import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { simulatedProvider } from "@/lib/payments/simulated-provider";
import { stripeProvider } from "@/lib/payments/stripe-provider";
import { dlocalProvider } from "@/lib/payments/dlocal-provider";
import { paypalProvider } from "@/lib/payments/paypal-provider";
import { wiseProvider } from "@/lib/payments/wise-provider";
import type { AnyProvider, LocalProvider, PspProvider } from "@/lib/payments/port";
import { rielSirveParaEsteTutor, type DatosDeCobro } from "@/lib/payments/riel-viable";
import {
  metodosDelPais,
  ordenaPorPreferencia,
  preferenciaVigente,
  type MetodoDisponible,
} from "@/lib/payments/metodo-preferido";
export { metodosDelPais, preferenciaVigente };
export type { MetodoDisponible };
export { rielSirveParaEsteTutor };
export type { DatosDeCobro };

/**
 * EL ENRUTADOR DE PAGOS — el `PaymentRouter` del Doc 6 §6.2, en la forma que el
 * proyecto usa de verdad: dos funciones, no una clase con estado.
 *
 * El puerto y los adaptadores viven en `src/lib/payments/`; aquí está lo que
 * ELIGE entre ellos. Que haya un `payments.ts` **y** una carpeta `payments/` es
 * a propósito: `@/lib/payments` sigue resolviendo a este archivo, así que las
 * pantallas que ya importaban `activeChargeProvider` no se han tocado.
 *
 * Por aquí pasa quien tiene que resolver el proveedor DESDE EL DATO: el
 * checkout, que lo saca de `payments.provider`, y el job de reembolsos, que lo
 * saca de `refund_requests.provider` (antes filtraba la cola por
 * `provider = 'stripe'` a mano, en cuatro sitios).
 *
 * Los webhooks NO pasan por aquí y no es una omisión: cada uno es de su
 * proveedor por definición —lo que los distingue es la FIRMA, y una firma solo
 * la sabe verificar quien la emitió— así que `/api/webhooks/stripe` y
 * `/api/webhooks/dlocalgo` importan su adaptador directamente. Son dos rutas
 * porque son dos secretos, no porque hagan cosas distintas.
 *
 * Del Doc 6 falta `resolvePayout(payee_country)`, y falta porque no hay a quién
 * resolver: no existe adaptador de payouts en el repo (ver `port.ts`).
 */

/**
 * `resolveCharge` en su forma de dato: qué proveedor va a cobrar, según
 * `payment_routing_rules`.
 *
 * Existe porque la pantalla de checkout tiene que DECIR la verdad antes de que
 * el alumno pulse: con el proveedor simulado enseña el aviso de entorno de
 * pruebas y el botón de simular fallo; con Stripe, ninguna de las dos cosas.
 * Sin esto la interfaz se queda contando lo que era, que es exactamente el bug
 * que apareció al encender Stripe en la preview.
 *
 * Va con `service_role` porque la tabla no está concedida a `authenticated`:
 * es configuración de plataforma, y el runtime la lee dentro de las RPC.
 *
 * ⚠️ DEVUELVE LA LISTA ENTERA Y NO FILTRA POR DISPONIBILIDAD, y eso es a
 * propósito. Quien abre el cobro necesita saber QUÉ SE INTENTÓ y por qué falló
 * cada candidato para poder decirlo en el 503; si esta función devolviera solo
 * «el primero que se puede», esa información se perdería aquí y el error final
 * sería «no se pudo cobrar» sin más.
 *
 * ⚠️ HAY QUE PASARLE EL PAÍS DEL TUTOR, y desde A0 (`20260901140000`) no es
 * opcional. Hasta esa migración la tabla tenía UNA fila y mirar «la activa» sin
 * filtrar daba siempre la respuesta correcta por accidente; ahora tiene diez —
 * ocho países de dLocal Go, Venezuela y la del tutor que aún no ha declarado
 * país— y un `order by priority limit 1` sin filtro devolvería la de cualquiera.
 * Se filtra exactamente igual que `create_booking_line`, que es lo que de verdad
 * congela `payments.provider`: si esta función y la RPC no coinciden, la
 * pantalla promete una pasarela y cobra otra.
 *
 * `payeeCountry` null NO es «da igual el país»: es el tutor que no lo ha
 * declarado, y tiene su propia fila (`payee_country` null). Por eso el filtro es
 * `.is(...)` y no «sin filtro».
 */
export async function chargeProvidersFor(
  payeeCountry: string | null,
): Promise<string[]> {
  // ⚠️ `ruta_de_pago()` y no un `select` sobre la tabla, y no es un detalle de
  // estilo: desde el 3-sep el desempate tiene DOS pasos —la fila del país, y si
  // no la hay, la fila POR DEFECTO que cubre a España, EE. UU. y al resto del
  // mundo— y ese desempate vive en la función. Replicarlo aquí es cómo las dos
  // copias se desincronizan y el ruteo pasa a depender de quién preguntó.
  const { data } = await createAdminClient()
    // ⚠️ El `as string` NO tapa un fallo: `ruta_de_pago(char(2))` acepta null y
    // tiene una rama para él (la fila del tutor que aún no ha declarado país).
    // Lo que no lo expresa es el tipo GENERADO, que marca todo argumento sin
    // defecto como no nulo. Sin `.maybeSingle()`: la función devuelve un
    // registro compuesto, no un conjunto de filas.
    .rpc("ruta_de_pago", { p_payee: payeeCountry as string });

  // Sin regla no se puede reservar (`create_booking` lanza RN-33). Se devuelve
  // el simulado a secas —el camino conservador de siempre: enseñar el aviso
  // antes que fingir un cobro— y NO una lista con respaldo, porque el respaldo
  // de una regla que no existe sería inventarse una.
  return data?.charge_providers ?? ["simulated"];
}

/**
 * C2 · LA CLASE DE RIEL POR EL QUE SALE EL DINERO — no el ejecutor, la CLASE.
 *
 * `payment_routing_rules.payout_provider` es texto libre y sin `check`
 * (`20260709160000:18`), así que la clave puede decir tres cosas distintas y
 * hasta hoy solo se distinguían dos:
 *
 *   · una clave de PSP ('dlocal', 'stripe') → **riel de banco**: hay un
 *     adaptador que sabe transferir y el job lo llama solo;
 *   · 'manual' → **riel manual**: NO hay adaptador y no va a haberlo (decisión
 *     de producto del 2-sep: no se escriben adaptadores para rieles sin cuenta),
 *     pero sí hay a dónde pagar — `tutor_manual_payout_destinations`
 *     (`20260902110000`) y una persona ejecutando desde el panel;
 *   · 'simulated', `null` o un error de tecleo → **nada**: ese destino no se
 *     puede pagar por ninguna vía.
 *
 * Las dos primeras son países que el tutor SÍ puede declarar. La tercera no.
 * Antes de esta distinción todo lo que no fuese 'simulated' era servible, así
 * que una `s` de más en 'dlocals' habría metido el país en el desplegable del
 * tutor y lo habría dejado atascado más tarde, en el formulario bancario.
 */
export type FamiliaDeDato = "banco" | "identificador" | "conectada";

/**
 * ⚠️ 'conectada' ES UNA TERCERA FAMILIA Y NO UN 'banco' RARO, aunque el dinero
 * acabe en un banco igual. La diferencia no es cosmética: en las otras dos el
 * tutor nos ENTREGA un dato que guardamos (un CBU, un correo de PayPal); en
 * esta no nos entrega nada — se da de alta en Stripe, le da sus coordenadas a
 * ELLOS y lo único que vuelve es un identificador de cuenta que escribimos
 * nosotros, no él.
 *
 * Meterla en 'banco' habría pintado el formulario bancario de dLocal a un tutor
 * cuyo payout no lo usa: campos rellenos, guardados, validados… y un payout que
 * no los mira. Es exactamente el fallo que `familiasQueSePiden` existe para
 * evitar, un piso más abajo.
 */

/** Quién mueve el dinero cuando llega el momento. */
export type QuienEjecuta = "proveedor" | "persona";

/**
 * 🔑 UN RIEL DE PAYOUT, Y POR QUÉ SON DOS EJES Y NO UNA LISTA DE CLASES.
 *
 * Hasta hoy esto era `"banco" | "manual"`, dos valores que mezclaban dos
 * preguntas distintas y que funcionaban por accidente porque solo había dos
 * rieles. Con los de la decisión del 3-sep ya no: **PayPal y Airtm son
 * AUTOMÁTICOS y piden un identificador, no coordenadas bancarias.** Con una
 * sola dimensión no hay dónde ponerlos sin mentir.
 *
 * Las dos preguntas son independientes y cada consumidor necesita UNA:
 *
 *   `dato`    qué se le pide al tutor, o sea qué formulario se le pinta.
 *             'banco'         → nombre, documento, banco, cuenta, tipo
 *                               (payout_country_rules + payout_banks + tutor_payout_accounts)
 *             'identificador' → un correo, un teléfono o un usuario
 *                               (payout_manual_channels + tutor_manual_payout_destinations)
 *
 *   `ejecuta` quién mueve el dinero.
 *             'proveedor' → lo llama el job
 *             'persona'   → lo cierra el admin con `manage_payout('mark_paid', …)`
 *
 * Las cuatro combinaciones existen de verdad, y por eso no se pueden colapsar:
 *
 *              │ proveedor          │ persona
 *   ───────────┼────────────────────┼──────────────────
 *   banco      │ dlocal, stripe,    │ banco-manual
 *              │ wise               │
 *   identific. │ paypal             │ manual
 */
export type Riel = {
  clave: string;
  dato: FamiliaDeDato;
  ejecuta: QuienEjecuta;
  /**
   * 🔴 SOLO PUEDE PAGAR EL DINERO QUE ÉL COBRÓ.
   *
   * Un payout sale del balance del PSP que cobró esa reserva, así que un riel
   * atado a un balance solo sirve si `payouts.funding_provider` es él mismo. Es
   * lo que hace que el payout directo de Stripe no esté disponible en Colombia
   * cuando el cobro entró por dLocal — no es una regla de Colombia, es una
   * propiedad del riel, y por eso vive aquí y no en la tabla de ruteo.
   *
   * Los fondeados aparte (wise, paypal, manual, banco-manual) recargan su
   * saldo desde nuestro banco y no dependen de quién cobró.
   */
  ataduraDeBalance: boolean;
  /**
   * ¿Hay HOY con qué ejecutar por este riel? Un riel declarado sin adaptador
   * devuelve `false` y su sitio en la lista de candidatos no hace nada — solo
   * reserva el orden de preferencia para el día que exista.
   */
  puedePagar(): boolean;
};

export const RIEL_MANUAL = "manual";
export const RIEL_BANCO_MANUAL = "banco-manual";

/**
 * EL REGISTRO DE RIELES. Es la única tabla de verdad sobre qué significa cada
 * clave de `payment_routing_rules.payout_providers`.
 *
 * ⚠️ AQUÍ PONÍA que «'wise' ESTÁ DECLARADO Y NO TIENE ADAPTADOR, y eso es
 * deliberado», y que «NO se escriben sus adaptadores: sin cuenta no hay sandbox
 * con el que probarlos». Las dos frases caducaron: el token de Wise responde
 * desde el **4-sep-2026** —sin sandbox, contra la API real— y su adaptador está
 * escrito desde el **7-sep** (`payments/wise-provider.ts`). Desde entonces los
 * **cuatro** rieles con `ejecuta: 'proveedor'` —stripe, dlocal, wise y paypal—
 * tienen adaptador y **ninguno devuelve `false` a mano**. (Aquí puso «cinco»
 * durante unas horas: los otros dos de este mapa son `manual` y `banco-manual`,
 * que ejecuta una **persona**. Se cuentan con
 * `grep -c 'ejecuta: "proveedor"' src/lib/payments.ts`, y el resto del
 * repositorio ya decía cuatro — `admin/payouts/page.tsx:509`,
 * `payout-actions.tsx:113` y el propio `wise-provider.ts`, que se presenta como
 * «el cuarto riel de payout».)
 *
 * Lo que sigue siendo cierto de aquel párrafo, y por eso se conserva, es la
 * distinción que justificaba declarar un riel antes de escribirlo: un riel
 * declarado sin adaptador se distingue de un typo en la tabla. Una `s` de más en
 * 'dlocals' no encuentra riel y el país deja de ser servible; un riel declarado
 * que aún no puede pagar sí se encuentra y su fila se limita a esperar. Sin esa
 * distinción las dos cosas darían el mismo silencio. Hoy no la usa nadie —no
 * queda ningún riel esperando— pero el mecanismo sigue en pie para el siguiente.
 *
 * Y la lección que costó tres meses con Stripe y una premisa falsa con dLocal
 * tampoco cambia, solo su conclusión: no se programa contra una API que nadie ha
 * llamado. La de Wise se llamó entera antes de escribir esto. Encender un riel
 * nuevo sigue siendo añadir su `payout()` y su credencial; el modelo no cambia.
 */
const RIELES: Record<string, Riel> = {
  [stripeProvider.key]: {
    clave: stripeProvider.key,
    // Connect: el tutor no nos da coordenadas, se da de alta en Stripe.
    dato: "conectada",
    ejecuta: "proveedor",
    ataduraDeBalance: true,
    // ⚠️ Desde el 4-sep-2026 esto puede devolver `true`: el adaptador de Connect
    // existe. Aquí ponía que «este riel nunca puede pagar» porque
    // `missingPayoutConfig()` devolvía siempre una frase sobre un KYC que ya no
    // bloquea nada.
    puedePagar: () => stripeProvider.missingPayoutConfig() === null,
  },
  [dlocalProvider.key]: {
    clave: dlocalProvider.key,
    dato: "banco",
    ejecuta: "proveedor",
    ataduraDeBalance: true,
    puedePagar: () => dlocalProvider.missingPayoutConfig() === null,
  },
  [wiseProvider.key]: {
    clave: wiseProvider.key,
    dato: "banco",
    ejecuta: "proveedor",
    ataduraDeBalance: false,
    // Ya no es un `false` a mano: tiene adaptador desde el 7-sep-2026, así que
    // la credencial es el interruptor, como en los otros tres. Aquí ponía
    // `() => false` y el comentario de arriba explicaba que era deliberado
    // «porque sin cuenta no hay sandbox con el que probarlo». Esa premisa murió
    // el 4-sep (token vivo) y la API se midió entera el 7.
    //
    // ⚠️ Que el riel pueda pagar NO significa que pueda pagarle a cualquiera:
    // Wise exige dirección, teléfono, un país que cubra y un banco que conozca.
    // Eso lo filtra `rielSirveParaEsteTutor` con `banco_wise`, y sin ese
    // segundo filtro este `true` sería el mismo fallo silencioso que dejó a un
    // tutor venezolano con Zinli sin cobrar nunca.
    puedePagar: () => wiseProvider.missingPayoutConfig() === null,
  },
  paypal: {
    clave: "paypal",
    dato: "identificador",
    ejecuta: "proveedor",
    ataduraDeBalance: false,
    // Ya no es un `false` a mano: tiene adaptador desde el 3-sep-2026, así que
    // la credencial es el interruptor, como en los otros dos.
    puedePagar: () => paypalProvider.missingPayoutConfig() === null,
  },
  [RIEL_MANUAL]: {
    clave: RIEL_MANUAL,
    dato: "identificador",
    ejecuta: "persona",
    ataduraDeBalance: false,
    // Una persona siempre puede. Es lo que lo convierte en el último recurso
    // que hace que ninguna orden se quede sin vía.
    puedePagar: () => true,
  },
  [RIEL_BANCO_MANUAL]: {
    clave: RIEL_BANCO_MANUAL,
    dato: "banco",
    ejecuta: "persona",
    ataduraDeBalance: false,
    puedePagar: () => true,
  },
};

/**
 * C2 · `resolvePayout(payee_country)` del Doc 6 §6.2 — QUIÉN SACA EL DINERO.
 *
 * El gemelo de `activeChargeProvider`, y su contrario en la misma fila:
 * `charge_provider` dice por dónde ENTRA el dinero y `payout_provider` por dónde
 * SALE. Hoy no coinciden en ninguna de las diez filas de la tabla
 * (`charge_provider='stripe'` con `payout_provider='dlocal'` en los ocho países
 * de dLocal Go), y esa discrepancia no es un descuido: es la que hace que
 * `payouts.funding_provider` tenga que existir aparte de `payouts.provider`.
 *
 * ⚠️ AQUÍ ESTUVO ESCRITO que la comprobación del balance «la hace el job, fila
 * a fila, y no se puede resolver aquí: aquí solo hay país». Era cierto mientras
 * la firma fuese solo el país. Desde C2r recibe también `fundingProvider`, así
 * que la atadura se resuelve DENTRO — y tiene que ser dentro, porque con listas
 * de candidatos el balance no es una comprobación posterior sino parte de
 * ELEGIR: descarta a un candidato y deja pasar al siguiente.
 *
 * Devolver `null` NO es un error: es «ningún candidato puede pagar esta orden
 * hoy». Quien lo reciba la cuenta y la deja `scheduled` — es dinero que se debe
 * y que saldrá cuando exista el riel, no una orden fallida.
 *
 * `payeeCountry` null es el tutor que no ha declarado país; tiene su propia fila
 * con `payout_provider='simulated'`, que es la ausencia de ejecutor.
 */
/**
 * Lo mismo que `datos_de_cobro_del_tutor` pero para varios tutores de una vez.
 * Existe para el panel de admin, que pinta una cola entera: preguntar fila a
 * fila sería una consulta por orden.
 *
 * Un tutor que no conteste queda con todo a false, que es el fallo seguro: se
 * pinta «sin ejecutor» en vez de prometer un riel que quizá no puede pagarle.
 */
export async function datosDeCobroDeVarios(
  tutorIds: string[],
): Promise<Map<string, DatosDeCobro>> {
  const unicos = [...new Set(tutorIds.filter(Boolean))];
  const admin = createAdminClient();
  const pares = await Promise.all(
    unicos.map(async (id) => {
      const { data, error } = await admin.rpc("datos_de_cobro_del_tutor", { p_tutor: id });
      if (error) throw new Error(`datos_de_cobro_del_tutor(${id}): ${error.message}`);
      return [id, data as unknown as DatosDeCobro] as const;
    }),
  );
  return new Map(pares);
}

export async function payoutProviderFor(
  payeeCountry: string | null,
  fundingProvider: string | null,
  tutorId: string | null,
): Promise<string | null> {
  // Mismo resolvedor que el cobro, y por el mismo motivo: el desempate entre la
  // fila del país y la de por defecto vive en `ruta_de_pago()` y en ningún otro
  // sitio. Ver `chargeProvidersFor`.
  const { data } = await createAdminClient()
    // ⚠️ El `as string` NO tapa un fallo: `ruta_de_pago(char(2))` acepta null y
    // tiene una rama para él (la fila del tutor que aún no ha declarado país).
    // Lo que no lo expresa es el tipo GENERADO, que marca todo argumento sin
    // defecto como no nulo. Sin `.maybeSingle()`: la función devuelve un
    // registro compuesto, no un conjunto de filas.
    .rpc("ruta_de_pago", { p_payee: payeeCountry as string });

  // Sin fila activa no hay a dónde pagar. `null`, igual que si ningún candidato
  // sirve: las dos cosas significan «esta orden espera», y el job las cuenta.
  const candidatos = data?.payout_providers ?? [];

  // 🔑 QUÉ TIENE REGISTRADO ESTE TUTOR. Sin esto el resolvedor elige el primer
  // riel que puede pagar EN GENERAL, que no es lo mismo que poder pagarle A ÉL
  // — ver `rielSirveParaEsteTutor`.
  //
  // Sin tutor no se puede preguntar, y entonces NO se filtra: quien llame así
  // obtiene el comportamiento de antes. Hoy no llama nadie.
  let datos: DatosDeCobro | null = null;
  if (tutorId) {
    const { data: crudo, error } = await createAdminClient()
      .rpc("datos_de_cobro_del_tutor", { p_tutor: tutorId });
    // Se mira el error (regla de oro 10): tratar un fallo como «no tiene nada»
    // dejaría la orden esperando por un motivo falso.
    if (error) throw new Error(`datos_de_cobro_del_tutor: ${error.message}`);
    datos = crudo as unknown as DatosDeCobro;
  }

  // 🔑 Y AHORA EL ORDEN: primero lo que el tutor QUIERE, después lo que la
  // tabla de ruteo prefiere. Solo reordena — no quita a nadie de la lista y no
  // se salta ni uno de los tres filtros de abajo. Un tutor que eligió PayPal y
  // no conectó la cuenta cae al siguiente candidato exactamente igual que
  // cualquier otro riel que hoy no pueda pagarle: por eso la pantalla promete
  // «intentamos esa primero» y no «solo esa».
  //
  // Las claves desconocidas (un typo en la tabla) y 'simulated' se caen aquí, y
  // no dentro del bucle como antes: `ordenaPorPreferencia` necesita el `dato` de
  // cada riel para saber a cuáles adelanta, así que la lista tiene que estar ya
  // resuelta a rieles. El comportamiento es el mismo — si no queda ninguno, la
  // orden se queda esperando, que es lo correcto: mandarla a «cualquiera» es lo
  // que este resolvedor existe para impedir.
  const rieles = candidatos
    .map((clave) => RIELES[clave])
    .filter((r): r is Riel => Boolean(r));

  for (const riel of ordenaPorPreferencia(rieles, datos?.metodo_preferido ?? null)) {
    if (!riel.puedePagar()) continue;
    // 🔴 LA ATADURA DEL BALANCE. Aquí, y no en el job: tenerlo en dos sitios es
    // cómo se desincronizan. Un riel atado solo sirve si el dinero está en SU
    // balance; uno fondeado aparte no depende de quién cobró.
    if (riel.ataduraDeBalance && riel.clave !== fundingProvider) continue;
    // Y lo último: que ESTE tutor le haya dado lo que necesita. Un riel que no
    // puede pagarle a él no es un candidato, es una orden atascada en silencio.
    if (datos && !rielSirveParaEsteTutor(riel, datos)) continue;
    return riel.clave;
  }

  return null;
}

/**
 * 🔑 QUÉ SE PUEDE HACER POR UN TUTOR DE ESTE PAÍS — los rieles que hoy pueden
 * pagarle ahí y las familias de dato que hay que pedirle, en el orden de
 * preferencia de la tabla de ruteo.
 *
 * Sustituye a `payoutCountries()`, que devolvía la LISTA de países servibles
 * para un desplegable. Ese desplegable ya no existe: el país sale de la zona
 * horaria del tutor (`20260908130000`), así que lo que hace falta no es
 * enumerar países sino contestar por uno.
 *
 * Lista vacía = hoy no podemos pagarle ahí por ninguna vía. Entonces no se le
 * pide ningún dato, porque no se iba a poder usar.
 */
export async function rielesDelPais(pais: string | null): Promise<{
  rieles: Riel[];
  familias: FamiliaDeDato[];
}> {
  // 🔴 `ruta_de_pago()` Y NO UN `select` SOBRE LA TABLA. Aquí vivía
  // `payoutCountries()`, que leía `payment_routing_rules` a mano con
  // `.not("payee_country","is",null)` — y ese filtro se dejaba fuera **la fila
  // por defecto**, la que cubre a España, EE. UU. y a todo país sin regla
  // propia. Consecuencia medida el 8-sep-2026: la pantalla le decía a un tutor
  // español «todavía no podemos pagarte en tu país» mientras
  // `payoutProviderFor` —que sí usa esta función— le habría pagado por Stripe
  // sin problema. Dos lecturas de la misma tabla y una de las dos mentía.
  //
  // Aquella función tenía sentido para lo que se le pidió: llenar un
  // desplegable, y «el resto del mundo» no cabe en un desplegable. Desde que el
  // país sale de la zona horaria la pregunta cambió —ya no es «qué países
  // listo» sino «qué puedo hacer por ESTE»— y esa la contesta el enrutador.
  const { data } = await createAdminClient()
    // Mismo `as string` que en `chargeProvidersFor`, y por lo mismo: la función
    // acepta null (el tutor que no ha declarado país, que resuelve a la fila de
    // 'simulated' y por tanto a cero rieles) y el tipo generado no lo expresa.
    .rpc("ruta_de_pago", { p_payee: pais as string });

  const candidatos = data?.payout_providers ?? [];
  return {
    rieles: rielesQuePuedenPagar(candidatos),
    familias: familiasQueSePiden(candidatos),
  };
}

/**
 * Los rieles candidatos que HOY tienen con qué ejecutar, en el orden de la tabla
 * de ruteo. Una clave desconocida —un error de tecleo en la fila— no encuentra
 * riel y se cae de la lista, igual que en `payoutProviderFor`.
 *
 * ⚠️ Esto NO responde «¿puede pagarle a este tutor?». Eso es
 * `rielSirveParaEsteTutor`, que necesita saber qué tiene registrado él, y
 * confundir las dos preguntas es lo que dejó a un tutor venezolano con Zinli sin
 * cobrar nunca. Aquí solo se descartan los rieles que no pueden pagar a NADIE.
 */
function rielesQuePuedenPagar(candidatos: string[]): Riel[] {
  const vivos: Riel[] = [];
  for (const clave of candidatos) {
    const riel = RIELES[clave];
    if (riel?.puedePagar()) vivos.push(riel);
  }
  return vivos;
}

/**
 * 🔑 TODAS LAS FAMILIAS DE DATO QUE SE LE PUEDEN PEDIR AL TUTOR DE ESTE PAÍS.
 *
 * Las de los candidatos que pueden pagar hoy, en el orden de la tabla de ruteo y
 * sin repetir. Es la respuesta a la pregunta que la pantalla necesitaba hacer y
 * no podía: no «cuál le pido», sino «cuáles le sirven».
 *
 * Colombia es el caso que lo obligó: `{stripe, wise, paypal}` son
 * 'conectada' + 'banco' + 'identificador', y pedir solo la primera dejaba el
 * riel de Wise —que es de banco— sin manera de existir, porque el único sitio
 * desde el que se escriben coordenadas bancarias es el formulario que no se
 * pintaba. Con la lista entera, un país mixto ofrece las dos o tres vías y con
 * completar UNA el tutor ya cobra.
 *
 * Lista vacía = ningún candidato puede pagar. Ese país NO se le ofrece al tutor,
 * porque ofrecérselo es prometerle un cobro que no se puede ejecutar.
 */
export function familiasQueSePiden(candidatos: string[]): FamiliaDeDato[] {
  const familias: FamiliaDeDato[] = [];
  for (const riel of rielesQuePuedenPagar(candidatos)) {
    if (!familias.includes(riel.dato)) familias.push(riel.dato);
  }
  return familias;
}

/**
 * 🔑 QUÉ CANALES MANUALES TIENE SENTIDO OFRECER EN ESTE PAÍS.
 *
 * `payout_manual_channels` no tiene columna de país —son cinco filas de
 * catálogo global— así que hasta ahora la pantalla ofrecía los cinco a quien
 * viese el formulario de identificador. Mientras el único país de esa familia
 * fue Venezuela daba igual: su fila rutea `{paypal, manual}` y el riel manual
 * acepta cualquier canal que no sea PayPal. Deja de dar igual en cuanto un país
 * mixto pinta ese formulario: Colombia rutea `{stripe, wise, paypal}` y ahí
 * **el único riel de identificador es PayPal**, así que ofrecerle Zinli sería
 * dejarle registrar un destino que ningún riel de su país sabe usar — la orden
 * se quedaría en 'scheduled' para siempre, sin pagar y sin fallar. Es
 * literalmente el fallo del tutor venezolano con Zinli, un país más tarde.
 *
 * Quién contesta es `rielSirveParaEsteTutor`, la MISMA función que decide el
 * ruteo, preguntándole por un tutor hipotético que solo tiene ese canal. Que sea
 * la misma es el punto: la asimetría entre PayPal y el resto se define en un
 * solo sitio, y el día que cambie, cambia aquí también.
 *
 * `rieles` son las claves de los rieles que YA pueden pagar en ese país
 * (`rielesDelPais().rieles`); las de otras familias se ignoran solas.
 */
export function canalesServibles(rieles: string[], canales: string[]): string[] {
  const identificadores = rielesQuePuedenPagar(rieles).filter(
    (r) => r.dato === "identificador",
  );
  return canales.filter((canal) =>
    identificadores.some((riel) =>
      rielSirveParaEsteTutor(riel, {
        conectada: false,
        banco: false,
        banco_wise: false,
        canales: [canal],
        // No interviene: `rielSirveParaEsteTutor` no mira la preferencia. Aquí
        // se pregunta si el riel PODRÍA usar ese canal, no si alguien lo quiere.
        metodo_preferido: null,
      }),
    ),
  );
}

/**
 * Los PSP que saben mover dinero, por su clave. Es el registro que `adapterFor`
 * consulta, y es también la respuesta a «¿qué proveedores existen de verdad?»
 * para el job de reembolsos, que antes lo tenía escrito a mano como
 * `.eq('provider', 'stripe')` en cuatro sitios.
 *
 * ⚠️ ESTAR AQUÍ NO ES ESTAR ENCENDIDO. Que dLocal figure en este mapa significa
 * que su adaptador existe y sabe qué hacer si le llega trabajo — no que nadie
 * le vaya a rutear un cobro. Eso lo decide `payment_routing_rules`, que sigue
 * en 'simulated' y que se cambia con un `UPDATE`, no con un despliegue (regla
 * de oro 8: las decisiones se consumen como configuración). Y si la fila
 * cambiara sin que estén las credenciales, el checkout devuelve 503 diciendo
 * cuál falta en vez de caer al simulado — que es lo que hace que encender esto
 * sea reversible.
 */
const PSPS: Record<string, PspProvider> = {
  [stripeProvider.key]: stripeProvider,
  [dlocalProvider.key]: dlocalProvider,
  // Solo paga. No cobra ni reembolsa: ninguna fila de ruteo lo nombra en
  // `charge_providers`, y sus métodos de cobro lo dicen en vez de fingir.
  [paypalProvider.key]: paypalProvider,
  // Idem: solo paga. Y estar aquí es el cable que no se ve — sin él,
  // `adapterFor('wise')` cae al simulado, `pspDe()` devuelve null y cada orden
  // muere en el contador `sinEjecutor` sin un solo error.
  [wiseProvider.key]: wiseProvider,
};

/** Las claves de los PSP reales. La usa el job de reembolsos para filtrar. */
export const PSP_KEYS: string[] = Object.keys(PSPS);

/**
 * EL RIEL MANUAL, COMO IDENTIDAD Y NADA MÁS.
 *
 * Es un `LocalProvider` porque es literalmente lo que dice la interfaz: un
 * proveedor que **no sale de casa**. No implementa `payout()` y no lo hará, así
 * que el compilador impide llamarlo igual que impide llamar a `charge()` sobre
 * el simulado.
 *
 * ⚠️ EL EJEMPLO QUE HABÍA AQUÍ CADUCÓ. Este párrafo justificaba lo anterior con
 * «escribir un adaptador de PayPal o Wise antes de haber llamado a su API es
 * exactamente lo que costó tres meses con Stripe». La regla es buena y sigue
 * viva; los dos ejemplos ya no la ilustran, porque los dos adaptadores existen:
 * PayPal desde el 3-sep-2026 y Wise desde el 7-sep, y **en los dos casos se
 * llamó a la API primero**, que es justo lo que la regla pedía.
 *
 * ponytail: son dos campos y no va a crecer. El techo es a propósito, y el día
 * que se escribió PayPal se cumplió: lo que se escribió fue un `PspProvider`
 * con su clave ('paypal'), NO un `payout()` colgado de esta constante — y lo
 * mismo con 'wise'. 'manual' seguirá significando «lo paga una persona», que es
 * un estado permanente del sistema y no un escalón hacia la automatización.
 */
const manualProvider: LocalProvider = {
  key: RIEL_MANUAL,
  opensRemoteCheckout: false,
};

/**
 * Los que NO salen de casa, por su clave. Existe para que 'manual' se pueda
 * distinguir de un error de tecleo: los dos caen fuera de `PSPS`, pero solo uno
 * de los dos significa algo.
 */
/**
 * El riel manual con COORDENADAS BANCARIAS. Mismo motivo de existir que
 * `manualProvider` —ser una identidad reconocible y no un typo— y misma
 * ausencia de `payout()`: lo ejecuta una persona haciendo una transferencia.
 *
 * Es un riel aparte y no una variante de 'manual' porque le pide al tutor un
 * dato DISTINTO (ver el registro `RIELES`), y esa diferencia es la que decide
 * qué formulario se le pinta y qué destino tiene que leer el admin para pagar.
 */
const bancoManualProvider: LocalProvider = {
  key: RIEL_BANCO_MANUAL,
  opensRemoteCheckout: false,
};

const LOCALES: Record<string, LocalProvider> = {
  [simulatedProvider.key]: simulatedProvider,
  [manualProvider.key]: manualProvider,
  [bancoManualProvider.key]: bancoManualProvider,
};

/**
 * De una clave de `payment_routing_rules.payout_provider`, la CLASE de riel —
 * o `null` si esa clave no nombra ninguno.
 *
 * Es la pregunta que hay que hacerse antes de tocar una orden de pago, y no es
 * la misma que `adapterFor`: el adaptador contesta «quién ejecuta» y aquí `null`
 * y 'manual' contestarían lo mismo (nadie). Lo que decide qué se hace con la
 * fila es esto:
 *
 *   · `'banco'`  → hay adaptador; el job puede llamarlo.
 *   · `'manual'` → NO hay adaptador y la orden **no es un problema**: espera a
 *     una persona. El job tiene que contarla aparte y dejarla como está, no
 *     mezclarla con las que no tienen a dónde ir.
 *   · `null`     → 'simulated', `null` o una clave que nadie reconoce. Ese
 *     destino no se puede pagar por ninguna vía.
 *
 * ⚠️ Lee `PSPS`, que se declara arriba y se evalúa al cargar el módulo: aquí no
 * hay ciclo, solo orden de lectura.
 */
export function rielDePayout(clave: string | null): Riel | null {
  if (!clave) return null;
  return RIELES[clave] ?? null;
}

/**
 * `adapterFor` del Doc 6 §6.3: de una clave de proveedor, su adaptador.
 *
 * La clave que se le pasa en el cobro es `payments.provider` —el snapshot que
 * `create_booking` congeló— y NO la regla activa de hoy: si alguien cambia la
 * tabla mientras hay reservas a medias, esas reservas terminan por donde
 * empezaron.
 *
 * ⚠️ YA NO ES UN TERNARIO, Y ESO CIERRA UN AGUJERO REAL. Hasta hoy todo lo que
 * no fuese 'stripe' caía al simulado, así que poner 'dlocal' en
 * `payment_routing_rules` producía un checkout que no se podía terminar y **sin
 * un solo error visible** (lo avisaba `simulated-provider.ts`). Con el registro,
 * una clave conocida encuentra su adaptador y una desconocida sigue cayendo al
 * simulado — que es lo correcto para 'simulated' y para `null`, porque ninguno
 * de los dos es un proveedor: son la ausencia de uno.
 *
 * Acepta `null` porque `payments.provider` es nullable en el esquema: una fila
 * sin proveedor tampoco es un PSP, y el `!== "stripe"` de antes ya la trataba
 * así.
 *
 * ⚠️ 'manual' YA NO CAE AL SIMULADO, aunque el desenlace se le parezca. Los dos
 * devuelven un proveedor que no sale de casa y con los dos el job se queda sin
 * ejecutar nada, pero la clave que vuelve es distinta ('manual' vs 'simulated')
 * y esa diferencia es la que separa «esta orden la paga una persona» de «esta
 * orden no tiene a dónde ir». Quien necesite decidir con eso NO debe mirar el
 * adaptador, que es una identidad: debe preguntar a `rielDePayout()`.
 */
export function adapterFor(key: string | null): AnyProvider {
  return (key && (PSPS[key] ?? LOCALES[key])) || simulatedProvider;
}

export type { AnyProvider, PaymentProvider, PspProvider } from "@/lib/payments/port";
