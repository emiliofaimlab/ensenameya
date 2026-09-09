/**
 * EL MAPEO PURO DE WISE — separado del adaptador por lo mismo que el de PayPal.
 *
 * `wise-provider.ts` lleva `import "server-only"` y con eso su lógica no se
 * puede correr desde un script de node. Lo que vive aquí decide (a) si dos
 * llamadas son el mismo pago o dos pagos, (b) qué cuerpo se le manda a Wise para
 * cada país, y (c) si un tutor tiene el dinero o solo se lo han prometido. Las
 * tres merecen una comprobación ejecutable: `wise-mapeo.check.ts`.
 */
import { createHash } from "node:crypto";

import type { PayoutResult } from "./port";

export class WiseError extends Error {
  // Campos explícitos y no propiedades de parámetro: `node --experimental-strip-types`
  // borra tipos, no transforma sintaxis, y `readonly x: T` en el constructor lo
  // hace fallar. Lo que corre la comprobación de este fichero es ese node.
  status: number;
  cuerpo: unknown;
  constructor(status: number, cuerpo: unknown, mensaje: string) {
    super(mensaje);
    this.status = status;
    this.cuerpo = cuerpo;
  }
}

/**
 * 🔴 LA CLAVE DE IDEMPOTENCIA, Y POR QUÉ NO ES `marcaDe()`.
 *
 * `port.ts` da una marca `EY-<payoutId>-<intento>` que dLocal lleva en su
 * `description` y PayPal en su `sender_batch_id`. Wise NO la admite: su
 * `customerTransactionId` exige un UUID canónico 8-4-4-4-12, y medido el
 * 7-sep-2026 con seis variantes contra la API real, cualquier prefijo, sufijo o
 * forma sin guiones devuelve 422 `illegal.argument.exception`. Tampoco cabe en
 * `details.reference`, que en Argentina tiene un máximo de DOCE caracteres.
 *
 * Así que la marca del proyecto se convierte en un UUID, y se convierte de forma
 * DETERMINISTA: mismo (payout, intento) → mismo UUID, siempre, sin guardar nada.
 * Eso es lo que permite que un reintento tras un timeout mande el mismo
 * identificador y Wise reconozca la petición en vez de crear un segundo pago.
 *
 * ⚠️ SI ESTO FUESE `randomUUID()` HABRÍA QUE PERSISTIRLO ANTES DEL POST, y el
 * hueco entre escribir la fila y llamar a la API sería exactamente la ventana en
 * la que se paga dos veces. Derivarlo cierra esa ventana sin columna nueva.
 *
 * Es un UUIDv5 de manual: SHA-1 del espacio de nombres concatenado con el
 * nombre, y los bits de versión y variante forzados. El espacio de nombres es
 * una constante del proyecto — cambiarla es cambiar TODOS los identificadores y
 * dejar huérfanas las transferencias en vuelo, así que no se toca.
 */
const NAMESPACE_EY = "6f7c1a52-3e4b-5d8a-9c02-1b7e5a4d3f60";

export function uuidDePago(payoutId: string, intento: number): string {
  const ns = Buffer.from(NAMESPACE_EY.replace(/-/g, ""), "hex");
  const h = createHash("sha1")
    .update(ns)
    .update(`${payoutId}:${intento}`, "utf8")
    .digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // versión 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/**
 * Lo que el tutor verá en su extracto. NO es un identificador: cotejar por aquí
 * está prohibido, porque el campo se recorta.
 *
 * ⚠️ `details.reference` cambia de límite EN CADA CORREDOR: medido con
 * POST /v1/transfer-requirements, Argentina admite 12 caracteres, Estados Unidos
 * 30, Colombia/Brasil/Chile/Uruguay/Costa Rica 35, México 40 y Europa 140. Y el
 * regex `^[a-zA-Z0-9- ]*$` prohíbe el guion bajo y el punto en ocho de los
 * nueve. Por eso la referencia es corta por diseño y aun así se recorta contra
 * el máximo que devuelva el corredor de hoy: un texto fijo que quepa hoy en
 * Argentina puede no caber mañana en otro sitio.
 */
export function referenciaSegura(payoutId: string, maxLength: number): string {
  const limpio = `EY ${payoutId.replace(/-/g, "").slice(0, 8)}`.toUpperCase();
  return limpio.replace(/[^a-zA-Z0-9- ]/g, "").slice(0, Math.max(0, maxLength));
}

/** Lo que devuelve `payout_beneficiary_wise`, tal cual. */
export type BeneficiarioWise = {
  wise_account_type: string;
  transfer_country: string;
  currency_to_pay: string;
  account_holder_name: string;
  legal_type: string;
  /**
   * El banco con el nombre que le da Wise, traducido desde nuestro catálogo
   * (`payout_banks.wise_bank_code`). Solo lo usan los cuatro países que tienen
   * catálogo: Colombia, Chile, Uruguay y —el día que se verifique— Brasil.
   */
  wise_bank_code: string | null;
  /**
   * 🔑 EL OTRO NÚMERO DEL BANCO, EL QUE TECLEA EL TUTOR. Es `bank_branch` en la
   * base, y según el tipo de cuenta significa cosas distintas: el sort code
   * británico, el número de ruta ACH estadounidense, el BSB australiano, el IFSC
   * indio o el BIC/SWIFT de los países que Wise solo alcanza por SWIFT.
   *
   * ⚠️ NO es un sustituto de `wise_bank_code` ni al revés: aquel es una
   * TRADUCCIÓN de nuestro catálogo (existe donde hay lista de bancos y sabemos
   * cómo los llama Wise), este es un DATO DEL TUTOR (existe donde no hay lista
   * posible). Medido el 9-sep-2026: el número de ruta de un mismo banco
   * estadounidense cambia por estado —021000021 y 322271627 son los dos de
   * Chase— y el de *wire* lo rechaza Wise, así que un catálogo «un banco = un
   * número» habría dado por bueno el equivocado. Y del BIC no hay lista pública:
   * Wise valida contra su directorio y devuelve 422 al que no conoce, que es la
   * red que hace seguro pedírselo al tutor.
   */
  bank_branch: string | null;
  bank_account: string;
  bank_account_type: string | null;
  document_type: string;
  document: string;
  phone: string | null;
  address: {
    country: string;
    city: string;
    firstLine: string;
    postCode: string;
    /**
     * Estado o provincia, en el código corto. Solo DOS corredores lo exigen y
     * ninguno lo documenta: medido, `aba` (Estados Unidos) y `australian`
     * devuelven `422 address.state = "Please enter a state."` sin él y 200 con
     * él. Null en los demás países, y entonces no se manda.
     */
    state?: string | null;
  };
};

/** El cuerpo del POST /v1/accounts, ya montado. */
export type CuentaWise = {
  currency: string;
  type: string;
  profile: number;
  accountHolderName: string;
  legalType: string;
  details: Record<string, unknown>;
};

/**
 * Los tipos de cuenta que este proyecto sabe describir. Es más estrecho que el
 * `check` de `payout_country_rules.wise_account_type`, y a propósito: aquel
 * existe para cazar erratas, este para no mandarle a Wise un `details` a medias.
 */
const TIPOS = new Set([
  "colombia", "argentina", "mexican", "chile", "uruguay",
  "brazil", "iban", "aba", "swift_code",
  // Los siete del 10-sep-2026, cada uno con un 200 de POST /v1/accounts detrás.
  "sort_code", "costa_rica", "australian", "indian",
  "emirates", "israeli_local", "turkish_earthport",
]);

/**
 * Los tipos cuyo banco se identifica con el SEGUNDO NÚMERO que teclea el tutor
 * (`bank_branch`), y no con una traducción de nuestro catálogo.
 *
 * Sin él no se construye la cuenta, igual que sin `wise_bank_code` donde sí hay
 * catálogo: mandar un `details` al que le falta el identificador del banco es un
 * 422, pero uno con el identificador MAL es dinero a otra parte.
 */
const NECESITA_SEGUNDO_NUMERO = new Set([
  "sort_code", "aba", "australian", "indian", "swift_code",
]);

/** Los dos corredores que exigen `address.state`. Medido, no documentado. */
const NECESITA_ESTADO = new Set(["aba", "australian"]);

/**
 * El vocabulario de documentos de cada corredor. El nuestro sale de
 * `payout_country_rules.document_patterns` y es el de dLocal; el de Wise es
 * otro, y en Uruguay ni siquiera es del mismo tamaño (nosotros admitimos
 * pasaporte y documento extranjero, Wise solo cédula o RUT).
 *
 * Un tipo sin entrada aquí NO se traduce a un valor parecido: se devuelve null y
 * el llamador se niega a construir la cuenta. Adivinar un tipo de documento es
 * mandar el pago al limbo de compliance semanas después.
 */
const DOCUMENTOS: Record<string, Record<string, string>> = {
  // CC/CE son los dos que sembramos; Wise admite además TI y PAS.
  colombia: { CC: "CC", CE: "CE", TI: "TI", PASS: "PAS" },
  uruguay: { CI: "NATIONAL_ID", RUT: "BUSINESS_ID" },
  // Costa Rica es el ÚNICO de los países nuevos cuyo corredor manda el documento
  // del tutor. Sus tres valores son NATIONAL_ID_CARD, FOREIGN_ID y BUSINESS_ID;
  // el tercero (cédula jurídica) no se ofrece porque el legalType que admite el
  // corredor es PRIVATE y los tutores son personas físicas.
  costa_rica: { CI: "NATIONAL_ID_CARD", DIMEX: "FOREIGN_ID" },
};

/** CHECKING/SAVINGS/VISTA nuestros → los literales que espera cada corredor. */
const TIPOS_DE_CUENTA: Record<string, Record<string, string>> = {
  // ⚠️ Colombia llama CURRENT a lo que nosotros (y dLocal) llamamos CHECKING.
  colombia: { CHECKING: "CURRENT", SAVINGS: "SAVINGS" },
  chile: { CHECKING: "CHECKING", SAVINGS: "SAVINGS", VISTA: "CUENTA_VISTA" },
  uruguay: { CHECKING: "CHECKING", SAVINGS: "SAVINGS" },
  brazil: { CHECKING: "CHECKING", SAVINGS: "SAVINGS" },
  aba: { CHECKING: "CHECKING", SAVINGS: "SAVINGS" },
};

function traducir(mapa: Record<string, string> | undefined, valor: string | null): string | null {
  if (!valor) return null;
  return mapa?.[valor] ?? null;
}

/**
 * 🔴 EL CUERPO DEL RECIPIENT, POR PAÍS.
 *
 * Devuelve la cuenta lista para `POST /v1/accounts`, o un `motivo` si con lo que
 * el tutor tiene registrado no se puede construir. Nunca lanza y nunca rellena
 * un hueco con un valor plausible: un `details` incompleto lo rechaza Wise con
 * un 422, pero uno completo y MAL manda el dinero a otra parte.
 *
 * ⚠️ `address` VA ANIDADO. Medido por diferencia el 7-sep-2026: mandar
 * `{"address.country": "CO"}` en plano deja los cuatro errores de dirección en
 * pie, mientras que `{"address": {"country": "CO", …}}` los quita. La clave
 * `address.country` que devuelve `account-requirements` es una RUTA de
 * formulario, no el nombre del campo JSON. Leerla al pie de la letra es un fallo
 * que la API no explica.
 */
export function cuentaDeWise(
  b: BeneficiarioWise,
  profileId: number,
): { cuenta: CuentaWise } | { motivo: string } {
  const tipo = b.wise_account_type;
  if (!TIPOS.has(tipo)) {
    return { motivo: `wise no tiene mapeo para el tipo de cuenta '${tipo}'` };
  }

  const address: Record<string, string> = {
    country: b.address.country,
    city: b.address.city,
    firstLine: b.address.firstLine,
    postCode: b.address.postCode,
  };
  if (!address.country || !address.city || !address.firstLine || !address.postCode) {
    return { motivo: "faltan campos de la dirección del beneficiario" };
  }
  // ⚠️ El estado se añade SOLO donde hace falta y solo si lo hay. Mandarlo donde
  // el corredor no lo pide es un campo desconocido en `details`; no mandarlo
  // donde sí lo pide es el 422 que tuvo cerrado a Estados Unidos.
  if (NECESITA_ESTADO.has(tipo)) {
    if (!b.address.state) {
      return { motivo: `falta el estado de la dirección, que '${tipo}' exige` };
    }
    address.state = b.address.state;
  }

  const base = {
    currency: b.currency_to_pay,
    type: tipo,
    profile: profileId,
    accountHolderName: b.account_holder_name,
    legalType: b.legal_type,
  };
  const tipoCuenta = traducir(TIPOS_DE_CUENTA[tipo], b.bank_account_type);

  // Dos formas de identificar al banco y dos negativas distintas, porque el
  // arreglo es distinto: la primera se arregla mapeando un banco en nuestro
  // catálogo, la segunda la arregla el tutor tecleando su número.
  //
  // 'brazil' no está en la primera lista aunque también identifique el banco por
  // código: tiene su propia negativa más abajo, con el motivo de verdad.
  const necesitaBanco = ["colombia", "chile", "uruguay"];
  if (necesitaBanco.includes(tipo) && !b.wise_bank_code) {
    return { motivo: `el banco del tutor no tiene código de wise para '${tipo}'` };
  }
  if (NECESITA_SEGUNDO_NUMERO.has(tipo) && !b.bank_branch) {
    return { motivo: `falta el código de banco que '${tipo}' pide junto a la cuenta` };
  }

  switch (tipo) {
    case "colombia": {
      const doc = traducir(DOCUMENTOS.colombia, b.document_type);
      if (!doc) return { motivo: `wise no admite el documento '${b.document_type}' en Colombia` };
      if (!tipoCuenta) return { motivo: "falta el tipo de cuenta, que Colombia exige" };
      if (!b.phone) return { motivo: "falta el teléfono, que Colombia exige" };
      return {
        cuenta: {
          ...base,
          details: {
            bankCode: b.wise_bank_code,
            accountNumber: b.bank_account,
            accountType: tipoCuenta,
            phoneNumber: b.phone,
            idDocumentType: doc,
            idDocumentNumber: b.document,
            address,
          },
        },
      };
    }
    case "argentina":
      // Sin banco y sin tipo de cuenta: el CBU los lleva dentro. El `taxId` es
      // el CUIL/CUIT, que es justo lo que guardamos como documento en AR.
      return {
        cuenta: { ...base, details: { accountNumber: b.bank_account, taxId: b.document, address } },
      };
    case "mexican":
      // La CLABE es lo único que identifica cuenta y banco a la vez.
      return { cuenta: { ...base, details: { clabe: b.bank_account, address } } };
    case "chile": {
      if (!tipoCuenta) return { motivo: "falta el tipo de cuenta, que Chile exige" };
      return {
        cuenta: {
          ...base,
          details: {
            bankCode: b.wise_bank_code,
            accountNumber: b.bank_account,
            rut: b.document,
            accountType: tipoCuenta,
            address,
          },
        },
      };
    }
    case "uruguay": {
      const doc = traducir(DOCUMENTOS.uruguay, b.document_type);
      if (!doc) return { motivo: `wise no admite el documento '${b.document_type}' en Uruguay` };
      if (!tipoCuenta) return { motivo: "falta el tipo de cuenta, que Uruguay exige" };
      return {
        cuenta: {
          ...base,
          details: {
            bankCode: b.wise_bank_code,
            accountNumber: b.bank_account,
            accountType: tipoCuenta,
            idDocumentType: doc,
            idDocumentNumber: b.document,
            address,
          },
        },
      };
    }
    case "brazil":
      // 🔴 SIN ESCRIBIR, Y DICHO EN VOZ ALTA. Brasil necesita `branchCode`, que
      // sale de `bank_branch` y que `payout_beneficiary_wise` no devuelve — no
      // se le añadió porque el país está apagado por otra razón más gorda: sus
      // 803 códigos de banco en Wise son de ocho dígitos y los nuestros los 146
      // COMPE de tres, así que no hay `wise_bank_code` que darle. Encender
      // Brasil es una sola tarea: verificar el emparejamiento de códigos, añadir
      // la sucursal a la RPC y escribir este `case`. Adivinar la mitad ahora
      // dejaría un mapeo que parece listo y paga al banco equivocado.
      return { motivo: "el riel de wise para Brasil no está escrito (ver 20260907120000)" };
    // ── Los cuatro tipos en los que la cuenta ES un IBAN ────────────────────
    //
    // Cuatro `case` y no uno con cuatro alias porque el `type` que viaja a Wise
    // es distinto en cada uno —y `base.type` ya lo lleva—, pero el `details` es
    // literalmente el mismo: el IBAN identifica banco y cuenta, así que no hay
    // código de banco, ni tipo de cuenta, ni sucursal que mandar. El BIC es
    // opcional para Wise y no se pide.
    case "iban":
    case "emirates":
    case "israeli_local":
    case "turkish_earthport":
      return { cuenta: { ...base, details: { IBAN: b.bank_account, address } } };

    case "costa_rica": {
      // El único de los nuevos que manda el documento del tutor, con el mismo
      // patrón que Uruguay: si Wise no conoce ese tipo, NO se traduce a uno
      // parecido.
      const doc = traducir(DOCUMENTOS.costa_rica, b.document_type);
      if (!doc) {
        return { motivo: `wise no admite el documento '${b.document_type}' en Costa Rica` };
      }
      return {
        cuenta: {
          ...base,
          details: {
            IBAN: b.bank_account,
            idDocumentType: doc,
            idDocumentNumber: b.document,
            address,
          },
        },
      };
    }

    // ── Los cinco tipos con DOS números: la cuenta y el código del banco ────
    case "sort_code":
      return {
        cuenta: {
          ...base,
          details: { sortCode: b.bank_branch, accountNumber: b.bank_account, address },
        },
      };

    case "aba": {
      // ⚠️ `abartn` sale de `bank_branch` y NO de `wise_bank_code`, que es de
      // donde lo leía este `case` cuando se escribió sin poderlo probar. El
      // número de ruta de un mismo banco cambia por estado y el de *wire* lo
      // rechaza Wise: no es un dato de catálogo, es un dato del tutor.
      if (!tipoCuenta) return { motivo: "falta el tipo de cuenta, que la ACH exige" };
      return {
        cuenta: {
          ...base,
          details: {
            abartn: b.bank_branch,
            accountNumber: b.bank_account,
            accountType: tipoCuenta,
            address,
          },
        },
      };
    }

    case "australian":
      return {
        cuenta: {
          ...base,
          details: { bsbCode: b.bank_branch, accountNumber: b.bank_account, address },
        },
      };

    case "indian":
      return {
        cuenta: {
          ...base,
          details: { ifscCode: b.bank_branch, accountNumber: b.bank_account, address },
        },
      };

    case "swift_code":
      // El comodín internacional: cuenta, BIC y dirección. El BIC lo teclea el
      // tutor —no hay catálogo público y Wise valida contra el suyo—, así que
      // sale de `bank_branch`.
      return {
        cuenta: {
          ...base,
          details: {
            accountNumber: b.bank_account,
            swiftCode: b.bank_branch,
            address,
          },
        },
      };

    default:
      // Inalcanzable: `TIPOS` ya filtró arriba. Está aquí para que añadir un tipo
      // a `TIPOS` sin escribir su `case` sea una negativa y no un `details` vacío.
      return { motivo: `wise no tiene mapeo escrito para el tipo '${tipo}'` };
  }
}

/**
 * Los diez estados de una transferencia de Wise, y qué significan para la fila.
 *
 * 🔴 SOLO `outgoing_payment_sent` ES DINERO FUERA, y por eso es lo único que
 * devuelve 'pagado' — el único desenlace que escribe `payouts.status = 'paid'`
 * y dispara NTF-12 «Se pagó tu liquidación» a una persona. Una transferencia
 * creada y sin fondear vive en `incoming_payment_waiting`, que es el equivalente
 * exacto del `UNCLAIMED` de PayPal: parece un pago y no lo es.
 *
 * ⚠️ Y HAY UN MATIZ QUE NO SE PUEDE ARREGLAR AQUÍ: Wise dice literalmente que
 * `outgoing_payment_sent` «no garantiza que el banco del destinatario haya
 * abonado la cuenta», que los rebotes llegan «hasta varias semanas después», y
 * que `charged_back` «puede venir desde cualquier otro estado». Ningún estado de
 * Wise es irreversible. Marcar 'paid' y dejar de mirar pierde devoluciones; lo
 * que falta para cerrar ese hueco es el webhook de cambio de estado, y está
 * anotado como tal, no resuelto en silencio.
 */
export function desenlaceDeTransfer(
  status: string,
  transferId: string,
  adoptado: boolean,
): PayoutResult {
  switch (status) {
    case "outgoing_payment_sent":
      return { estado: "pagado", payoutId: transferId, detalle: status, adoptado };

    // Muerta de verdad: `cancelled` es la que nunca se fondeó (Wise las mata a
    // los 10 días hábiles) y `funds_refunded` la que se fondeó y volvió. Las dos
    // son 'difunto' y NO 'rechazado': la orden puede volver a la cola con un
    // intento nuevo, que es lo que hace que `manage_payout('retry')` sirva.
    case "cancelled":
    case "funds_refunded":
      return {
        estado: "difunto",
        payoutId: transferId,
        detalle: status,
        mensaje: `wise dio la transferencia por ${status}`,
      };

    // Todo lo demás sigue en vuelo, `bounced_back` incluido: Wise dice que «o se
    // entrega con retraso o pasa a funds_refunded», así que no es un desenlace.
    default:
      return { estado: "enviado", payoutId: transferId, detalle: status, adoptado };
  }
}

/** 401/403 sin reto de SCA: la credencial, no la orden. */
export function esCredencialInvalida(e: unknown): boolean {
  return e instanceof WiseError && (e.status === 401 || e.status === 403);
}

/**
 * ¿Es esto un reto de SCA?
 *
 * ⚠️ HACEN FALTA LAS DOS COSAS: un 403 **y** la cabecera `x-2fa-approval`. Un
 * 403 pelado no lo es — medido: `GET /v1/transfers/999999999` devuelve 403
 * `forbidden.error` sin ninguna cabecera de 2FA. Confundirlos haría firmar y
 * reintentar en bucle un error de permisos.
 *
 * 🟢 Y hoy no reta a este token: el perfil es una LLC de EE. UU. y la SCA es una
 * obligación PSD2 (Reino Unido y EEE). Medido el 7-sep-2026, los dos endpoints
 * protegidos responden `x-2fa-approval-result: APPROVED` sin 403. Esto está
 * escrito igualmente porque son diez líneas y porque el día que Wise cambie de
 * criterio el fallo sería que los payouts dejan de salir sin decir por qué.
 */
export function retoDeSca(status: number, headers: Headers): string | null {
  if (status !== 403) return null;
  return headers.get("x-2fa-approval");
}
