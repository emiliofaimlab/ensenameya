import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { simulatedProvider } from "@/lib/payments/simulated-provider";
import { stripeProvider } from "@/lib/payments/stripe-provider";
import { dlocalProvider } from "@/lib/payments/dlocal-provider";
import type { AnyProvider, LocalProvider, PspProvider } from "@/lib/payments/port";

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
export type FamiliaDeDato = "banco" | "identificador";

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
 *   identific. │ paypal, airtm      │ manual
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
   * Los fondeados aparte (wise, paypal, airtm, manual, banco-manual) recargan su
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
 * ⚠️ 'paypal', 'wise' y 'airtm' ESTÁN DECLARADOS Y NO TIENEN ADAPTADOR, y eso es
 * deliberado. Es lo que permite distinguir «riel que existe pero aún no está
 * listo» de «typo en la tabla»: una `s` de más en 'dlocals' no encuentra riel y
 * el país deja de ser servible, mientras que 'wise' sí lo es y su fila se limita
 * a esperar. Sin esta distinción, las dos cosas darían el mismo silencio.
 *
 * NO se escriben sus adaptadores: sin cuenta no hay sandbox con el que probarlos,
 * y programar contra una API que nadie ha llamado es lo que costó tres meses con
 * Stripe y una premisa falsa con dLocal. Encender uno es añadir su `payout()` y
 * su credencial; el modelo no cambia.
 */
const RIELES: Record<string, Riel> = {
  [stripeProvider.key]: {
    clave: stripeProvider.key,
    dato: "banco",
    ejecuta: "proveedor",
    ataduraDeBalance: true,
    // Hoy devuelve siempre una frase («exige Connect, y Connect exige el KYC
    // bloqueado»), así que este riel nunca puede pagar. Se pregunta igual, para
    // que el día que se autorice no haya que tocar esto.
    puedePagar: () => stripeProvider.missingPayoutConfig() === null,
  },
  [dlocalProvider.key]: {
    clave: dlocalProvider.key,
    dato: "banco",
    ejecuta: "proveedor",
    ataduraDeBalance: true,
    puedePagar: () => dlocalProvider.missingPayoutConfig() === null,
  },
  wise: {
    clave: "wise",
    dato: "banco",
    ejecuta: "proveedor",
    ataduraDeBalance: false,
    puedePagar: () => false,
  },
  paypal: {
    clave: "paypal",
    dato: "identificador",
    ejecuta: "proveedor",
    ataduraDeBalance: false,
    puedePagar: () => false,
  },
  airtm: {
    clave: "airtm",
    dato: "identificador",
    ejecuta: "proveedor",
    ataduraDeBalance: false,
    puedePagar: () => false,
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

/** Un país que se puede servir, con el DATO que hay que pedirle a su tutor. */
export type PaisDePayout = { code: string; dato: FamiliaDeDato };

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
export async function payoutProviderFor(
  payeeCountry: string | null,
  fundingProvider: string | null,
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

  for (const clave of candidatos) {
    const riel = RIELES[clave];
    // Clave desconocida (un typo) o 'simulated': no es un riel. Se salta, y si
    // era el único la orden se queda esperando — que es lo correcto, porque
    // mandarla a «cualquiera» es lo que este resolvedor existe para impedir.
    if (!riel) continue;
    if (!riel.puedePagar()) continue;
    // 🔴 LA ATADURA DEL BALANCE. Aquí, y no en el job: tenerlo en dos sitios es
    // cómo se desincronizan. Un riel atado solo sirve si el dinero está en SU
    // balance; uno fondeado aparte no depende de quién cobró.
    if (riel.ataduraDeBalance && riel.clave !== fundingProvider) continue;
    return riel.clave;
  }

  return null;
}

/**
 * A0 · LOS PAÍSES A LOS QUE DE VERDAD PODEMOS TRANSFERIR.
 *
 * Es la lista que se le ofrece al tutor para declarar su país de cobro, y sale
 * de la tabla de ruteo en vez de estar escrita en el formulario por un motivo
 * concreto: declarar un país sin regla activa deja sus mentorías sin vender
 * (RN-33, «sin ruta de pago disponible para el destino»). Una lista a mano en el
 * TSX se desincroniza el día que alguien active o desactive una fila, y lo que
 * se rompe entonces no es un desplegable: es el checkout de ese tutor.
 *
 * ⚠️ AQUÍ ESTUVO ESCRITO «se excluye `payout_provider = 'simulated'`», Y ESO
 * SOLO ERA SUFICIENTE MIENTRAS HUBO UN ÚNICO RIEL. Hoy hay dos —banco y manual—
 * y la lista ya no puede ser de códigos pelados: **el riel decide qué formulario
 * se le pinta al tutor**, y son incompatibles. Un país de banco pide CBU/CLABE y
 * los valida contra `payout_country_rules` + `payout_banks`; Venezuela pide un
 * correo de PayPal o un teléfono de Zelle, que no caben en esa tabla y que
 * `20260902110000` guarda en otra. Devolver `['AR','VE']` obligaría a la
 * pantalla a adivinar cuál es cuál, y adivinar aquí significa enseñarle al tutor
 * venezolano un desplegable de bancos vacío y un guardado que revienta contra
 * una FK que no tiene fila para su país.
 *
 * ⚠️ Y SE FILTRA POR RIEL CONOCIDO, NO POR «distinto de simulated». Un valor que
 * no sea ni un PSP del registro ni `RIEL_MANUAL` —un error de tecleo en la
 * tabla— deja de ser servible en vez de colarse: antes entraba en la lista, el
 * tutor lo declaraba y el fallo aparecía mucho después, en el job, como una
 * orden sin ejecutor.
 *
 * También se excluye la fila con `payee_country` null: es la regla del tutor que
 * NO ha declarado país, no un país que se pueda elegir.
 */
export async function payoutCountries(): Promise<PaisDePayout[]> {
  const { data } = await createAdminClient()
    .from("payment_routing_rules")
    .select("payee_country, payout_providers")
    .eq("is_active", true)
    .is("payer_country", null)
    .not("payee_country", "is", null)
    // Los dos `order` son deliberados y el segundo no es cosmético: un país
    // puede tener varias filas activas y la que manda es la de menor
    // `priority`, exactamente como en `payoutProviderFor`. Sin él, el desempate
    // sería el que decidiera Postgres y la pantalla podría anunciar un riel
    // distinto del que va a ejecutar.
    .order("payee_country")
    .order("priority");

  // Se queda la PRIMERA fila de cada país —la que ganaría el ruteo—. Que una
  // fila con la clave rota tape a la siguiente es lo correcto: si el ruteo va a
  // elegir la rota, el país no es servible por mucho que exista una buena detrás.
  const gana = new Map<string, string[]>();
  for (const r of data ?? []) {
    if (!r.payee_country || gana.has(r.payee_country)) continue;
    gana.set(r.payee_country, r.payout_providers ?? []);
  }

  const paises: PaisDePayout[] = [];
  for (const [code, candidatos] of gana) {
    const dato = datoQueSePide(candidatos);
    if (dato !== null) paises.push({ code, dato });
  }
  return paises;
}

/**
 * 🔑 QUÉ DATO SE LE PIDE AL TUTOR CUANDO SUS CANDIDATOS NO PIDEN LO MISMO.
 *
 * Colombia es el caso: `{wise, paypal, stripe, banco-manual}` mezcla tres rieles
 * de coordenadas bancarias con uno de identificador. Solo se le puede pedir UNA
 * cosa, así que hay que elegir, y elegir mal tiene un coste concreto:
 * anunciarle un riel y pedirle los datos de otro lo deja con un formulario
 * relleno que su payout no puede usar.
 *
 * Gana la familia del PRIMER candidato que de verdad pueda pagar hoy. No la del
 * primero de la lista: si Wise aún no tiene adaptador, pedirle coordenadas
 * bancarias «porque Wise es el preferido» sería pedirle datos para un riel que
 * no existe. Y como el riel manual va siempre al final y siempre puede, hay
 * garantía de que alguno contesta.
 *
 * `null` = ningún candidato puede pagar. Ese país NO se le ofrece al tutor,
 * porque ofrecérselo es prometerle un cobro que no se puede ejecutar.
 *
 * ponytail: el techo es que un país mixto le pide los datos del riel de HOY, y
 * el día que Wise se encienda un tutor colombiano que había registrado datos
 * bancarios ya los tiene bien (Wise también es 'banco'). Si algún día el riel
 * que se enciende pide otra familia, ese tutor tendrá que volver a declararlos y
 * habrá que avisarle. No se escribe hoy una migración de datos para un caso que
 * quizá no ocurra.
 */
function datoQueSePide(candidatos: string[]): FamiliaDeDato | null {
  for (const clave of candidatos) {
    const riel = RIELES[clave];
    if (riel?.puedePagar()) return riel.dato;
  }
  return null;
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
};

/** Las claves de los PSP reales. La usa el job de reembolsos para filtrar. */
export const PSP_KEYS: string[] = Object.keys(PSPS);

/**
 * EL RIEL MANUAL, COMO IDENTIDAD Y NADA MÁS.
 *
 * Es un `LocalProvider` porque es literalmente lo que dice la interfaz: un
 * proveedor que **no sale de casa**. No implementa `payout()` y no lo hará —
 * escribir un adaptador de PayPal, Airtm o Wise sin cuenta con la que probarlo
 * es exactamente lo que la decisión del 2-sep prohíbe—, así que el compilador
 * impide llamarlo igual que impide llamar a `charge()` sobre el simulado.
 *
 * ponytail: son dos campos y no va a crecer. El techo es a propósito: el día
 * que Airtm tenga cuenta, lo que se escribe es un `PspProvider` con su clave
 * ('airtm'), NO un `payout()` colgado de esta constante. 'manual' seguirá
 * significando «lo paga una persona», que es un estado permanente del sistema y
 * no un escalón hacia la automatización.
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
