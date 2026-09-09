/**
 * EL MAPEO PURO DEL PAYOUT DE STRIPE — separado del adaptador por lo mismo que
 * el de Wise y el de PayPal: `stripe-provider.ts` lleva `import "server-only"` y
 * con eso su lógica no se puede correr desde un script de node.
 *
 * Lo que vive aquí decide cuatro cosas, y las cuatro cuestan dinero si fallan:
 *   (a) qué cuerpo se le manda a cada una de las tres llamadas de la receta;
 *   (b) si una cuenta de destinatario está de verdad lista para recibir;
 *   (c) si la cuenta bancaria que el tutor tiene registrada YA está adjunta, para
 *       no adjuntarla dos veces;
 *   (d) qué significa cada error de Stripe en el vocabulario del puerto.
 * Su comprobación ejecutable está al lado: `stripe-payout-mapeo.check.ts`.
 *
 * ── 🔑 AQUÍ NO HAY, NI PUEDE HABER, UN MAPA POR PAÍS ────────────────────────
 *
 * Lo que Stripe pide NO es igual en todas partes (medido el 10-sep-2026 creando
 * una cuenta de verdad en cada sitio): España y México no piden nada más,
 * Colombia y Chile piden `individual.id_number`, Panamá pide `address.line1` y
 * `.city`, y seis países más piden `routing_number` en la cuenta bancaria. Quien
 * dice qué falta es Stripe, en `requirements.currently_due`, así que estas
 * funciones mandan TODO lo que la RPC devuelve y no deciden nada por país.
 *
 * Un mapa nuestro sería una segunda lista de países que mantener sincronizada
 * con la suya, que es exactamente el error que este proyecto ya pagó con
 * `wise_account_type`.
 *
 * ── LA MEDICIÓN QUE JUSTIFICA CADA REGLA DE ABAJO (10-sep-2026, *test mode*) ─
 *
 *   · Cuenta sin `email`: se crea igual. La RPC no devuelve correo y no hace
 *     falta pedírselo — `POST /v1/accounts` sin ese campo llega a
 *     `transfers: active` sin una sola queja.
 *   · `tos_acceptance[date]` en milisegundos o en el futuro → 400
 *     «Dates are expected to be integers, measured in seconds, not in the
 *     future, and after 2009», con `param: tos_acceptance[date]`.
 *   · `postal_code` se valida por país: un código español de seis cifras
 *     devuelve 400 «Invalid ES postal code». O sea que el dato del tutor puede
 *     estar mal y eso NO es un fallo del sistema.
 *   · US y BR → 400 con `param: tos_acceptance[service_agreement]` y el mensaje
 *     «The recipient ToS agreement is not supported for platforms in US creating
 *     accounts in US». Es esperado: ese tutor lo paga otro riel.
 *   · `balance_insufficient` es un `invalid_request_error` con ese `code`.
 *   · Un `destination` que no existe → `resource_missing` con
 *     `param: destination`.
 */
import type Stripe from "stripe";

import type { PayoutResult } from "./port";

/**
 * Lo que devuelve `payout_beneficiary_stripe`, tal cual.
 *
 * ⚠️ TODO NULLABLE MENOS EL PAÍS Y LA MONEDA, aunque la RPC ya levante excepción
 * si falta la fecha de nacimiento o la aceptación. Un tipo que promete lo que la
 * base garantiza hoy se convierte en una mentira el día que alguien relaje la
 * función, y el síntoma sería un `undefined` viajando a Stripe dentro del cuerpo
 * de una transferencia.
 */
export type BeneficiarioStripe = {
  country: string;
  /** La moneda de `payout_country_rules`, ya en minúsculas. */
  currency: string;
  first_name: string | null;
  last_name: string | null;
  dob: { day: number; month: number; year: number } | null;
  /** El documento. Lo piden Colombia y Chile; en los demás se ignora. */
  id_number: string | null;
  address: {
    country: string | null;
    line1: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
  } | null;
  /** El IBAN donde el formato es IBAN, y el número de cuenta donde no lo es. */
  account_number: string | null;
  /**
   * El tipo de cuenta (`CHECKING`, `SAVINGS`…). Lo devuelve la RPC desde el
   * 10-sep-2026 y **Colombia y Chile no se pueden pagar sin él**: Stripe
   * responde «Invalid bank account type». Null en los países que no lo usan.
   */
  account_type: string | null;
  /** El segundo número del banco (sort code, ruta ACH, código de banco…). */
  routing_number: string | null;
  account_holder_name: string | null;
  /** La aceptación de condiciones, en SEGUNDOS Unix. */
  tos_date: number | null;
  tos_ip: string | null;
};

/** «No se puede construir esto con lo que el tutor tiene registrado». */
export type Negativa = { motivo: string };

/**
 * Cuánto se le perdona al reloj en la aceptación de condiciones.
 *
 * Stripe rechaza una fecha en el futuro y `stripe_tos_accepted_at` lo pone
 * nuestro servidor, así que un desfase de relojes de dos segundos tumbaría un
 * pago por nada. Dentro de este margen se recorta al instante actual; por encima
 * NO, porque entonces ya no es un reloj mal puesto: es un dato inventado, y
 * recortarlo sería falsificar una aceptación legal.
 */
export const MARGEN_DE_RELOJ_SEGUNDOS = 300;

/** Stripe no admite aceptaciones anteriores a 2009 (lo dice su propio error). */
const EPOCA_MINIMA = 1_230_768_000; // 2009-01-01T00:00:00Z

// ════════════════════════════════════════════════════════════════════════════
// 1 · CREAR LA CUENTA DE DESTINATARIO
// ════════════════════════════════════════════════════════════════════════════

/**
 * El cuerpo de `POST /v1/accounts`.
 *
 * 🔑 LOS CINCO CAMPOS DEL `controller` SON LO QUE HACE QUE EL TUTOR NO VEA
 * STRIPE, y no son decoración:
 *   · `requirement_collection: 'application'` — los requisitos los recogemos
 *     NOSOTROS con nuestro formulario. Con el valor por defecto (`stripe`) haría
 *     falta mandarle a un onboarding alojado, que es justo lo que el dictado del
 *     9-sep eliminó.
 *   · `stripe_dashboard.type: 'none'` — no hay panel de Stripe para él, así que
 *     no hay marca que ver ni contraseña que crear.
 *   · `losses.payments: 'application'` y `fees.payer: 'application'` — las
 *     pérdidas y las comisiones son nuestras. Es el precio que la decisión D-1
 *     dice en voz alta: «el fraude de esas cuentas pasa a ser nuestro».
 *   · `tos_acceptance.service_agreement: 'recipient'` — la cuenta solo RECIBE
 *     transferencias y se paga a sí misma al banco. No cobra, no es un comercio
 *     y por eso basta con la capability `transfers`, sin el KYC de un vendedor.
 *
 * ⚠️ SIN `email`, y es deliberado: la RPC no devuelve correo —no hace falta para
 * pagar— y medido el 10-sep la cuenta llega a `transfers: active` sin él. Pedirle
 * un campo más al formulario para rellenar un dato que nadie lee sería trabajo
 * para el tutor a cambio de nada.
 */
export function parametrosDeCuenta(
  b: BeneficiarioStripe,
  tutorId: string,
): Stripe.AccountCreateParams {
  return {
    country: b.country.toUpperCase(),
    controller: {
      losses: { payments: "application" },
      fees: { payer: "application" },
      requirement_collection: "application",
      stripe_dashboard: { type: "none" },
    },
    tos_acceptance: { service_agreement: "recipient" },
    capabilities: { transfers: { requested: true } },
    // Para poder cerrar el círculo desde el panel de Stripe hasta esta base sin
    // adivinar. No es PII: es un uuid.
    metadata: { tutor_id: tutorId },
  };
}

/**
 * La clave de idempotencia de la CREACIÓN DE LA CUENTA.
 *
 * ⚠️ NO evita pagar dos veces —eso lo hace la de la transferencia—, evita algo
 * más tonto y también real: crear dos cuentas conectadas para el mismo tutor
 * cuando la primera se creó y la escritura en `tutor_profiles` no llegó a
 * cuajar. Va por TUTOR y no por payout porque la cuenta es del tutor y se reusa
 * en todas sus liquidaciones.
 *
 * Su techo es la ventana de idempotencia de Stripe (24 h): pasado ese plazo, un
 * segundo intento crearía una cuenta nueva. Es aceptable porque no es dinero, y
 * el único rastro sería una cuenta vacía en el panel.
 */
export function claveDeCuenta(tutorId: string): string {
  return `EY-acct-${tutorId}`;
}

// ════════════════════════════════════════════════════════════════════════════
// 2 · LOS DATOS DEL TITULAR Y LA ACEPTACIÓN
// ════════════════════════════════════════════════════════════════════════════

/**
 * ¿Qué fecha de aceptación se le manda a Stripe?
 *
 * Devuelve los segundos que hay que mandar, o una negativa. Las tres reglas son
 * las de su propio mensaje de error, medidas: entero, en segundos, no en el
 * futuro y posterior a 2009.
 */
export function fechaDeAceptacion(
  tosDate: number | null,
  ahoraSegundos: number,
): { fecha: number } | Negativa {
  if (tosDate === null || !Number.isFinite(tosDate)) {
    return { motivo: "el tutor no ha aceptado las condiciones de la cuenta de cobro" };
  }
  const fecha = Math.trunc(tosDate);
  if (fecha < EPOCA_MINIMA) {
    // Un valor en milisegundos NO cae aquí (sería enorme), cae en el margen de
    // abajo. Aquí caen los ceros y las fechas imposibles.
    return { motivo: `la aceptación de condiciones tiene una fecha imposible (${fecha})` };
  }
  if (fecha > ahoraSegundos + MARGEN_DE_RELOJ_SEGUNDOS) {
    // Aquí caen las dos formas de estar mal: los milisegundos y el futuro de
    // verdad. Las dos las rechaza Stripe con el mismo 400, y recortarlas sería
    // inventarse cuándo aceptó una persona.
    return {
      motivo:
        "la aceptación de condiciones está en el futuro (¿milisegundos en vez de segundos?) y Stripe la rechaza",
    };
  }
  // Dentro del margen: se recorta al instante actual. Es un reloj con desfase,
  // no un dato falso, y tumbar un pago por dos segundos sería absurdo.
  return { fecha: Math.min(fecha, ahoraSegundos) };
}

/**
 * El cuerpo de `POST /v1/accounts/{id}`: quién es el titular y cuándo aceptó.
 *
 * 🔑 MANDA TODO LO QUE HAY Y NO EXIGE MÁS QUE LO IMPRESCINDIBLE. El nombre, la
 * fecha de nacimiento y la aceptación son obligatorios en todas partes, así que
 * sin ellos se devuelve una negativa con nombre propio. El documento, la
 * dirección, la ciudad, la provincia y el código postal se mandan **si los hay**
 * y no se exigen: quién los necesita depende del país y eso lo dice Stripe, no
 * este fichero. Lo que falte volverá en `requirements.currently_due` y el
 * adaptador lo contará como `sin-datos`, que deja la orden esperando.
 */
export function parametrosDelTitular(
  b: BeneficiarioStripe,
  ahoraSegundos: number,
): { params: Stripe.AccountUpdateParams } | Negativa {
  const nombre = b.first_name?.trim();
  const apellido = b.last_name?.trim();
  if (!nombre || !apellido) {
    return { motivo: "faltan el nombre o los apellidos del titular de la cuenta" };
  }

  const dob = b.dob;
  if (
    !dob ||
    !Number.isInteger(dob.day) ||
    !Number.isInteger(dob.month) ||
    !Number.isInteger(dob.year) ||
    dob.day < 1 ||
    dob.day > 31 ||
    dob.month < 1 ||
    dob.month > 12 ||
    dob.year < 1900
  ) {
    return { motivo: "falta la fecha de nacimiento del titular, que Stripe exige siempre" };
  }

  const aceptacion = fechaDeAceptacion(b.tos_date, ahoraSegundos);
  if ("motivo" in aceptacion) return aceptacion;
  const ip = b.tos_ip?.trim();
  if (!ip) {
    return { motivo: "falta la IP con la que el tutor aceptó las condiciones" };
  }

  // La dirección: solo las claves que tienen valor. Mandar `line1: null` no es
  // lo mismo que no mandarla — Stripe lo trata como borrarla.
  // El tipo va escrito a mano y no como `Stripe.AddressParam`: los cinco campos
  // son los que devuelve la RPC, así que un sexto que Stripe añada mañana no
  // debería colarse aquí sin que nadie lo decida.
  const dir = b.address;
  const address: {
    country?: string;
    line1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
  } = {};
  if (dir?.country?.trim()) address.country = dir.country.trim().toUpperCase();
  if (dir?.line1?.trim()) address.line1 = dir.line1.trim();
  if (dir?.city?.trim()) address.city = dir.city.trim();
  if (dir?.state?.trim()) address.state = dir.state.trim();
  if (dir?.postal_code?.trim()) address.postal_code = dir.postal_code.trim();

  const individual: Stripe.AccountUpdateParams.Individual = {
    first_name: nombre,
    last_name: apellido,
    dob: { day: dob.day, month: dob.month, year: dob.year },
    ...(Object.keys(address).length > 0 ? { address } : {}),
    ...(b.id_number?.trim() ? { id_number: b.id_number.trim() } : {}),
  };

  return {
    params: {
      business_type: "individual",
      individual,
      tos_acceptance: { date: aceptacion.fecha, ip },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 3 · LA CUENTA BANCARIA
// ════════════════════════════════════════════════════════════════════════════

/**
 * El cuerpo de `POST /v1/accounts/{id}/external_accounts`.
 *
 * `routing_number` se manda SOLO si lo hay, que es la mitad de la regla de «no
 * hay mapa por país»: de los catorce países medidos el 10-sep, SEIS lo exigieron
 * con un `parameter_missing` explícito —EC, PA, GT, DO, BO y PY—, Colombia y
 * Chile lo aceptan y piden además el tipo de cuenta, y en los del IBAN sobra. Si
 * el tutor de un país que lo pide no lo ha tecleado, Stripe responde
 * `parameter_missing` y eso se traduce en `sin-datos` — el tutor completa el
 * formulario y la orden sale en la pasada siguiente.
 *
 * 🔴 Y AHÍ ESTÁ EL HUECO QUE ESTE RIEL TIENE HOY: **Colombia y Chile piden
 * `account_type` en la cuenta bancaria** («Invalid bank account type: the account
 * type is required», medido) y `payout_beneficiary_stripe` NO devuelve el tipo de
 * cuenta, aunque la columna exista (`tutor_payout_accounts.bank_account_type`).
 * Hasta que la RPC lo devuelva, esos dos países se quedan en `sin-datos` — que es
 * el desenlace correcto (la orden espera y no muere), pero es una espera que solo
 * arregla una migración. A los dos los cubre Wise, que va delante.
 *
 * ⚠️ `default_for_currency` va FUERA de `external_account`, donde lo pone la
 * API. Es lo que hace que la cuenta recién adjuntada sea la que reciba el
 * dinero, y sin él un tutor que cambia de banco seguiría cobrando en el viejo.
 */
export function parametrosDeCuentaBancaria(
  b: BeneficiarioStripe,
): { params: Stripe.AccountCreateExternalAccountParams } | Negativa {
  const cuenta = b.account_number?.trim();
  if (!cuenta) return { motivo: "el tutor no tiene número de cuenta registrado" };
  const titular = b.account_holder_name?.trim();
  if (!titular) return { motivo: "la cuenta bancaria no tiene titular" };
  if (!b.currency?.trim()) {
    return { motivo: `no hay moneda de pago para ${b.country}` };
  }

  const ruta = b.routing_number?.trim();
  const tipo = b.account_type?.trim();
  return {
    params: {
      external_account: {
        object: "bank_account",
        country: b.country.toUpperCase(),
        currency: b.currency.trim().toLowerCase(),
        account_number: cuenta,
        account_holder_name: titular,
        account_holder_type: "individual",
        ...(ruta ? { routing_number: ruta } : {}),
        // 🔑 SIN ESTO, COLOMBIA Y CHILE NO SE PUEDEN PAGAR. Medido el 10-sep:
        // «Invalid bank account type: the account type is required». Los países
        // que no lo usan lo reciben ausente y Stripe lo ignora.
        //
        // ⚠️ El cast es por el TIPADO del SDK, no por el dato:
        // `AccountCreateExternalAccountParams.BankAccount` no declara
        // `account_type` aunque su API lo acepte y lo exija. Quitarlo rompe la
        // compilación; quitar el campo rompe dos países.
        ...(tipo ? ({ account_type: tipo.toLowerCase() } as { account_type: string }) : {}),
      },
      default_for_currency: true,
    },
  };
}

/**
 * ¿La cuenta bancaria que el tutor tiene registrada HOY ya está adjunta?
 *
 * 🔴 EXISTE PARA NO ADJUNTARLA DOS VECES. `POST …/external_accounts` no es
 * idempotente: llamarlo otra vez crea una segunda cuenta bancaria, y una cuenta
 * conectada con tres copias del mismo IBAN es un panel ilegible y un
 * `default_for_currency` que baila.
 *
 * Se cotejan los cuatro últimos caracteres porque es lo único que Stripe
 * devuelve del número (medido: el IBAN `ES91…51332` vuelve como `last4: 1332`).
 * Y la moneda, porque una cuenta en otra moneda es otro destino aunque el número
 * acabe igual.
 *
 * ⚠️ Si el tutor CAMBIA de banco, esto devuelve `false` y se adjunta la nueva
 * como predeterminada. La vieja se queda ahí: borrarla sería tocar un destino que
 * puede tener un pago en vuelo. (ponytail: el techo es que se acumulan; la
 * mejora, si algún día estorba, es borrar la que ya no es predeterminada, no
 * dejar de adjuntar la nueva.)
 */
export function yaTieneEstaCuenta(cuenta: Stripe.Account, b: BeneficiarioStripe): boolean {
  const numero = b.account_number?.trim();
  if (!numero) return false;
  const cola = numero.slice(-4);
  const moneda = b.currency?.trim().toLowerCase();
  const externas = cuenta.external_accounts?.data ?? [];
  return externas.some(
    (e) =>
      e.object === "bank_account" &&
      e.last4 === cola &&
      (!moneda || e.currency?.toLowerCase() === moneda),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4 · ¿ESTÁ LISTA PARA RECIBIR?
// ════════════════════════════════════════════════════════════════════════════

export type EstadoDeCuenta =
  | { lista: true }
  /**
   * `falta` son los `requirements.currently_due` de Stripe, literales. Cuando
   * está vacío y aun así la cuenta no está lista, es que Stripe está revisando:
   * `enRevision` distingue las dos cosas porque el desenlace es distinto —una la
   * arregla el tutor (`sin-datos`) y la otra el tiempo (`transitorio`)—.
   */
  | { lista: false; falta: string[]; enRevision: boolean; motivo: string };

/**
 * 🔴 LAS DOS CONDICIONES, Y POR QUÉ NO BASTA CON LA PRIMERA.
 *
 *   · `capabilities.transfers === 'active'` — la cuenta puede RECIBIR nuestra
 *     transferencia.
 *   · `payouts_enabled === true` — la cuenta puede sacar ese dinero a su banco.
 *
 * Medido el 10-sep: una cuenta con los datos del titular y SIN cuenta bancaria
 * adjunta llega a `transfers: active` con `payouts_enabled: false`. Transferir
 * ahí funcionaría —y el job escribiría `paid` y mandaría NTF-12 «Se pagó tu
 * liquidación»— dejando el dinero atrapado en un saldo de Stripe que el tutor no
 * ve y del que no puede sacarlo. Es peor que no pagar, porque nadie lo reporta.
 */
export function estadoDeLaCuenta(cuenta: Stripe.Account): EstadoDeCuenta {
  const transfers = cuenta.capabilities?.transfers;
  const puedeSacar = cuenta.payouts_enabled === true;
  if (transfers === "active" && puedeSacar) return { lista: true };

  const falta = cuenta.requirements?.currently_due ?? [];
  const enRevision = falta.length === 0;
  return {
    lista: false,
    falta,
    enRevision,
    motivo: enRevision
      ? `Stripe sigue revisando la cuenta del tutor (transfers: ${transfers ?? "sin capability"}, payouts_enabled: ${puedeSacar})`
      : `Stripe pide todavía: ${falta.join(", ")}`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 5 · LA TRANSFERENCIA
// ════════════════════════════════════════════════════════════════════════════

export type CuerpoDeTransferencia = {
  /** Lo que va en la cabecera `Idempotency-Key`. */
  idempotencyKey: string;
  params: {
    amount: number;
    currency: string;
    destination: string;
    transfer_group: string;
    description: string;
    metadata: { marca: string };
  };
};

/**
 * 🔴 LO QUE IMPIDE PAGAR DOS VECES, Y ES UNA SOLA IDEA REPETIDA EN TRES SITIOS.
 *
 * La marca —`EY-<payout>-<intento>`, la de `port.marcaDe`— viaja:
 *   1. como `Idempotency-Key`: repetir esta llamada devuelve LA MISMA
 *      transferencia, no una segunda (medido el 10-sep: mismo `tr_…`);
 *   2. como `transfer_group`: la clave de idempotencia caduca a las 24 h y el
 *      grupo no, así que una orden que se reanuda dos días después todavía se
 *      encuentra con un filtro exacto —`GET /v1/transfers?transfer_group=…`—;
 *   3. como `metadata.marca`: para que una persona la reconozca en el panel.
 *
 * Los tres son la misma cadena a propósito, y el `check` lo fija: si dejaran de
 * coincidir, el barrido del punto 2 no encontraría lo que el punto 1 creó y la
 * orden se mandaría otra vez.
 *
 * ⚠️ LA MONEDA ES LA DEL SALDO (`payouts.currency`, hoy USD) y NO la del tutor.
 * Una transferencia mueve dinero dentro de Stripe; convertir a la moneda local
 * es cosa del payout que la cuenta conectada hace a su banco, y ahí el tipo lo
 * pone Stripe. Mandar aquí la moneda del beneficiario sería pedirle a Stripe que
 * saque de un saldo que no existe.
 */
export function cuerpoDeTransferencia(opts: {
  marca: string;
  amountMinor: number;
  currency: string;
  destino: string;
}): CuerpoDeTransferencia {
  return {
    idempotencyKey: opts.marca,
    params: {
      amount: opts.amountMinor,
      currency: opts.currency.toLowerCase(),
      destination: opts.destino,
      transfer_group: opts.marca,
      description: `Liquidación Enséñame Ya ${opts.marca}`,
      metadata: { marca: opts.marca },
    },
  };
}

/**
 * De una transferencia de Stripe a un desenlace del puerto.
 *
 * 🔑 UNA TRANSFERENCIA CREADA ES `pagado`, y es el mismo criterio que ya se fijó
 * para PayPal (`SUCCESS`) y para el Stripe de antes: en cuanto existe, el dinero
 * ha salido de nuestro saldo y está en el del tutor. Lo que le queda —llegar a su
 * banco— lo hace la cuenta conectada por su cuenta, con su propio calendario, y
 * no depende de nosotros. Por eso `estadoDeLaCuenta` exige `payouts_enabled`
 * ANTES de crearla: es ahí y no aquí donde se comprueba que ese último tramo
 * existe.
 *
 * ⚠️ `reversed` SÍ cambia el desenlace: una transferencia revertida no pagó y no
 * va a pagar, así que es `difunto` —la orden vuelve a la cola con un intento
 * nuevo— y no `rechazado`, que la enterraría en 'failed'. Es el mismo trato que
 * `cancelled` en Wise y `RETURNED` en PayPal.
 */
export function desenlaceDeTransferencia(
  tr: Pick<Stripe.Transfer, "id" | "reversed" | "amount_reversed" | "amount">,
  adoptado: boolean,
): PayoutResult {
  if (tr.reversed) {
    return {
      estado: "difunto",
      payoutId: tr.id,
      detalle: "reversed",
      mensaje: `Stripe revirtió la transferencia ${tr.id} entera`,
    };
  }
  const parcial = (tr.amount_reversed ?? 0) > 0;
  return {
    estado: "pagado",
    payoutId: tr.id,
    // El detalle acaba en `provider_metadata.c2.proveedor_detalle`, así que una
    // reversión parcial queda escrita donde alguien la va a leer.
    detalle: parcial ? `transferencia con ${tr.amount_reversed} revertidos` : "transferencia creada",
    adoptado,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 6 · DE UN ERROR DE STRIPE A UN VEREDICTO DEL PUERTO
// ════════════════════════════════════════════════════════════════════════════

export type Veredicto =
  /** 401/403: la credencial, no la orden. Para el lote entero. */
  | "sin-credencial"
  /** 429, 5xx, red: el momento. Vuelve a la cola. */
  | "transitorio"
  /** No hay saldo en el balance de Stripe. Dinero que se debe, no un fallo. */
  | "sin-fondos"
  /**
   * Con lo que el tutor tiene registrado no se puede pagar por aquí — o su país
   * no admite cuenta de destinatario. La orden ESPERA, no muere.
   */
  | "sin-datos"
  /** El `acct_…`/`tr_…` que arrastramos no existe en Stripe. */
  | "no-existe"
  /** Fue la orden: repetirla dará el mismo error mañana. Va a 'failed'. */
  | "rechazado";

/**
 * Los campos que rellenamos con datos del TUTOR. Un 400 sobre cualquiera de
 * ellos no es un fallo del sistema: es que ese tutor no puede cobrar por este
 * riel todavía.
 *
 * `tos_acceptance` está en la lista por dos motivos distintos y los dos acaban
 * igual: la fecha/IP salen del formulario, y el `service_agreement` es el que
 * falla en US y BR («recipient ToS not supported for platforms in US creating
 * accounts in US/BR»). En los dos casos la orden baja al siguiente candidato en
 * vez de contarse como avería.
 */
const CAMPOS_DEL_TUTOR = new Set([
  "individual",
  "business_type",
  "tos_acceptance",
  "external_account",
  "bank_account",
  "country",
]);

/** El primer segmento de un `param` de Stripe: `individual[dob][day]` → `individual`. */
function raizDelParam(param: string | undefined): string | null {
  if (!param) return null;
  const corte = param.indexOf("[");
  return (corte === -1 ? param : param.slice(0, corte)).trim() || null;
}

export function veredictoDeFallo(e: unknown): Veredicto {
  const err = e as {
    type?: string;
    code?: string;
    param?: string;
    message?: string;
  };

  switch (err?.type) {
    case "StripeAuthenticationError":
    case "StripePermissionError":
      return "sin-credencial";
    case "StripeConnectionError":
    case "StripeAPIError":
    case "StripeRateLimitError":
      return "transitorio";
    default:
      break;
  }

  // Saldo: se comprueba ANTES que el campo, porque `balance_insufficient` llega
  // como `invalid_request_error` y sin esta rama se contaría como rechazo.
  if (err?.code === "balance_insufficient") return "sin-fondos";

  // Un identificador que ya no existe: el `acct_…` guardado (sandbox borrado,
  // cuenta eliminada a mano) o el `tr_…` anotado. Quien llama decide qué hacer;
  // aquí solo se distingue de un rechazo, que sería no volver a intentarlo nunca.
  if (err?.code === "resource_missing") return "no-existe";

  const raiz = raizDelParam(err?.param);
  if (raiz && CAMPOS_DEL_TUTOR.has(raiz)) return "sin-datos";

  // La red de seguridad del caso de US/BR por si Stripe deja de poner el `param`:
  // el mensaje es explícito y lo único que hay entonces.
  if (/not supported for platforms in/i.test(err?.message ?? "")) return "sin-datos";

  // ⚠️ `StripeIdempotencyError` NO es transitorio y cae aquí a propósito:
  // significa que se reusó la marca con parámetros distintos, o sea que algo
  // cambió el importe de una orden ya intentada. Reintentar eso a ciegas es lo
  // que no se debe hacer con dinero. Mismo criterio que el reembolso.
  return "rechazado";
}
