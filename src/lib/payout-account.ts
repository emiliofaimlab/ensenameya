
/**
 * B1 · Los datos con los que se le paga al tutor — la mitad que vive en el
 * navegador.
 *
 * ⚠️ ESTE FICHERO NO ES LA VALIDACIÓN. La validación de verdad es
 * `payout_account_check` dentro de Postgres, y la única puerta de escritura es
 * la RPC `upsert_payout_account`: la tabla no tiene `grant insert` ni `update`
 * para ningún rol, así que no hay forma de guardar nada saltándose ese camino.
 * Lo de aquí es SOLO para que el tutor vea el error mientras teclea en vez de
 * después de pulsar Guardar.
 *
 * Y la parte importante: **las reglas no se escriben aquí**. Llegan en
 * `ReglaDePais`, que es una fila de `payout_country_rules` leída de la base de
 * datos — las mismas expresiones regulares que aplica el servidor. Copiarlas al
 * TSX habría sido garantizar que un día divergen y que el que se entera es el
 * tutor, con un payout rechazado tres semanas más tarde.
 *
 * ⚠️ Los nombres de país entran POR PARÁMETRO y no se resuelven aquí con
 * `nombrePais()`. No es ceremonia: ese helper vive en `src/lib/payouts.ts`, que
 * hoy solo se usa desde el servidor y arrastra el locale entero de
 * `react-phone-number-input`. Como este módulo lo importa un componente
 * `"use client"`, resolverlos aquí metería ese diccionario en el bundle del
 * navegador para escribir dos nombres de país.
 *
 * ⚠️ Vive en `src/lib/payout-account.ts` y no en `src/lib/payouts/`, que sería
 * lo natural, porque ya existe `src/lib/payouts.ts`: tener a la vez
 * `payouts.ts` y `payouts/index.ts` resuelve al primero y deja el segundo
 * invisible. Mover el existente habría tocado sus importadores mientras hay
 * trabajo en paralelo, y eso no es lo que arregla esta historia.
 */

/** Una fila de `payout_country_rules`, tal y como la sirve PostgREST. */
export type ReglaDePais = {
  country: string;
  /** `currency_to_pay` del POST. ⚠️ NO es la moneda del saldo, que es USD. */
  currency: string;
  account_label: string;
  account_help: string;
  /** Subconjunto del enum global; `[]` = el país no lo pide. */
  account_types: string[];
  /** `{tipo_de_cuenta | "*": regex}`. `{}` = dLocal no documenta el formato. */
  account_patterns: Record<string, string>;
  /** `{tipo_de_documento: regex}`, y a la vez la lista de tipos admitidos. */
  document_patterns: Record<string, string>;
  requires_branch: boolean;
  branch_pattern: string | null;
  /**
   * 🔑 CÓMO SE LLAMA EN ESTE PAÍS el segundo dato bancario. Con 9 países era
   * siempre «la sucursal»; con 55 es el sort code británico, la ruta ACH
   * estadounidense, el BSB australiano, el IFSC indio o el BIC. Vive en la
   * tabla y no en el componente por lo mismo que `account_label`: el texto que
   * lee el tutor y la regla que lo valida (`branch_pattern`) tienen que poder
   * cambiar juntos. `null` cuando el país no pide segundo dato.
   */
  branch_label: string | null;
  branch_help: string | null;
  /**
   * `null` = por este país no se puede pagar con transferencia internacional
   * (Wise), y no es un hueco pendiente: lo dice la columna homónima de
   * `payout_country_rules`, medida corredor a corredor dando de alta
   * destinatarios de verdad contra la API de Wise. ⚠️ Aquí ponía «Hoy solo CO,
   * AR, MX, CL y UY la tienen puesta»: desde el 10-sep-2026 son **51 de las 55
   * filas**. Los cuatro sin Wise son BR, EC, PE y PY, que cobran por dLocal.
   *
   * Aquí NO se usa para rutear nada —eso lo decide el servidor con
   * `wise_puede_pagar_a()`— sino para no prometerle a un tutor de Brasil una vía
   * que en Brasil no existe cuando rellena su dirección.
   */
  wise_account_type: string | null;
};

/** Un banco del catálogo, para el desplegable. */
export type BancoDePais = {
  bank_code: string;
  name: string;
  /** Brasil: los ocho códigos que solo aceptan CNPJ, nunca CPF. */
  rejects_cpf: boolean;
};

/**
 * Lo que el tutor puede leer de su propia fila. Es literalmente el column-grant
 * de la migración: `bank_account` y `beneficiary_document` NO están, y no es un
 * olvido — no tienen `grant select` para ningún rol, así que PostgREST devuelve
 * 42501 si alguien los pide.
 */
export type CuentaEnmascarada = {
  country: string;
  beneficiary_first_name: string;
  beneficiary_last_name: string;
  beneficiary_document_type: string;
  bank_code: string;
  bank_account_last4: string;
  bank_account_type: string | null;
  bank_branch: string | null;
  updated_at: string;
  /**
   * La dirección y el teléfono del BENEFICIARIO (`20260907120000`). Vuelven EN
   * CLARO y no enmascarados, y eso no es una grieta en la máscara de PII: los
   * cuatro entran en el `grant select` de `authenticated` a propósito, porque
   * son datos que el tutor tiene que poder releer y corregir. Los que siguen
   * fuera del grant son los dos de siempre —`bank_account` y
   * `beneficiary_document`—, que son los que valen para mover dinero.
   *
   * `null` = ese tutor todavía no lo ha rellenado. No es un error: las cuatro
   * columnas nacieron nullable para no romperle el guardado a los ocho países
   * que hoy cobran por dLocal sin necesitarlas.
   */
  beneficiary_address_line: string | null;
  beneficiary_city: string | null;
  /**
   * 🔑 EL ESTADO O PROVINCIA. Lo exigen Wise para Estados Unidos (`aba`) y
   * Australia (`australian`) —medido: `422 "Please enter a state."`, y 200 con
   * él— y no lo pide ningún otro corredor. Nullable como sus vecinos: los ocho
   * países de dLocal cobran sin él.
   */
  beneficiary_state: string | null;
  beneficiary_postcode: string | null;
  beneficiary_phone: string | null;
};

/** Los valores que teclea el tutor, antes de mandarlos a la RPC. */
export type ValoresDeCuenta = {
  nombre: string;
  apellidos: string;
  tipoDocumento: string;
  /** Vacío = «deja el que ya está guardado» (solo si ya hay fila del mismo país). */
  documento: string;
  bankCode: string;
  tipoCuenta: string;
  /** Vacío = «deja la que ya está guardada». */
  cuenta: string;
  sucursal: string;
  /**
   * Los cuatro que pide Wise en TODOS sus corredores y dLocal en Perú. Son
   * OPCIONALES —ni la tabla ni la RPC los exigen— y por eso `validarCuenta` solo
   * los mira cuando traen algo: exigirlos aquí dejaría sin poder guardar a todo
   * el que ya cobra por dLocal sin ellos, que es justo lo que la migración se
   * negó a hacer poniéndolos `not null`.
   *
   * Vacío = «deja el que ya está guardado», igual que `documento` y `cuenta`.
   * A diferencia de aquellos, estos SÍ se prerrellenan: vuelven en claro de la
   * base y no hay nada que enmascarar.
   */
  direccion: string;
  ciudad: string;
  codigoPostal: string;
  telefono: string;
};

/**
 * `····1234`. El número entero no sale nunca de la base de datos: lo que se
 * guarda para enseñar es la columna generada `bank_account_last4`, mismo
 * criterio que `payment_methods.last4` («solo display; NO es el PAN»).
 */
export function enmascarar(last4: string | null | undefined): string {
  return last4 ? `····${last4}` : "····";
}

/**
 * Normaliza el documento igual que lo hace `upsert_payout_account` antes de
 * validarlo: fuera puntos, guiones y espacios, y a mayúsculas. La doc de dLocal
 * da "450.539.758-09" y "45053975809" como el mismo CPF, así que si aquí no se
 * normaliza, el tutor ve un error de formato por haberlo escrito bonito.
 */
export function normalizaDocumento(v: string): string {
  return v.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * La cuenta NO se normaliza igual: en Brasil y Uruguay el guion y los ceros de
 * delante son parte del formato del banco. Solo se le quitan los espacios.
 */
export function normalizaCuenta(v: string): string {
  return v.replace(/\s/g, "");
}

/**
 * El teléfono del beneficiario, normalizado EXACTAMENTE como lo hace
 * `upsert_payout_account`: fuera los puntos y fuera los bordes, y nada más
 * (`regexp_replace(…, '[.]', '', 'g')` seguido de `btrim`).
 *
 * Ni un carácter más: el `+`, los espacios, los paréntesis y los guiones son
 * parte de lo que el `check` de la columna acepta —y de lo que acepta Wise, cuyo
 * propio ejemplo es "21 5555 5555" y no un E.164—, así que quitarlos aquí sería
 * inventarse una regla más estricta que la del destinatario. Los puntos sí se
 * van porque el `check` no los admite y la gente los escribe sin pensar; si no
 * se limpiasen aquí, «+57 300.123.4567» daría error de formato después de
 * pulsar Guardar y no mientras se teclea.
 */
export function normalizaTelefono(v: string): string {
  return v.replace(/\./g, "").trim();
}

/**
 * El espejo del `check` de `tutor_payout_accounts.beneficiary_phone`, copiado
 * carácter a carácter de `20260907120000`: empieza por dígito o `+`, y de 7 a 20
 * caracteres en total. Se escribe aquí y no se deriva de nada porque esta regla
 * NO viaja en `payout_country_rules` —es de la columna, igual para los ocho
 * países—, así que no hay fila de la que leerla.
 */
const TELEFONO_BENEFICIARIO = /^[0-9+][0-9 ()-]{6,19}$/;

/**
 * Los tres largos que declaran los `check` de las columnas de dirección. Mismo
 * motivo que arriba: son de la columna y no del país.
 */
const MAX_DIRECCION = 255;
const MAX_CIUDAD = 255;
const MAX_CODIGO_POSTAL = 32;

/**
 * El espejo de `payout_account_check`, con las regex que vienen de la BD.
 * Devuelve `null` si cuadra, o el primer mensaje de error.
 *
 * No cubre dos cosas que solo el servidor puede saber, y es a propósito: que el
 * banco siga activo en el catálogo, y que los datos guardados (los que el tutor
 * deja en blanco para no cambiarlos) sigan siendo válidos. Las dos las
 * comprueba la RPC, y su mensaje se enseña tal cual.
 */
export function validarCuenta(
  regla: ReglaDePais,
  bancos: BancoDePais[],
  valores: ValoresDeCuenta,
  /** ¿Hay ya una fila guardada DE ESTE MISMO PAÍS? Si no, nada es opcional. */
  hayFilaDelMismoPais: boolean,
  /** El nombre del país ya resuelto, para los mensajes. Ver la cabecera. */
  nombreDelPais: string,
): string | null {
  if (!valores.nombre.trim() || !valores.apellidos.trim()) {
    return "El nombre y los apellidos son obligatorios: tienen que ser los del titular de la cuenta.";
  }

  const tiposDoc = Object.keys(regla.document_patterns);
  if (!valores.tipoDocumento || !tiposDoc.includes(valores.tipoDocumento)) {
    return `Elige el tipo de documento. En ${nombreDelPais} puede ser: ${tiposDoc.join(", ")}.`;
  }

  const doc = normalizaDocumento(valores.documento);
  if (doc) {
    if (!new RegExp(regla.document_patterns[valores.tipoDocumento]).test(doc)) {
      return `El ${valores.tipoDocumento} no tiene el formato que pide ${nombreDelPais}.`;
    }
  } else if (!hayFilaDelMismoPais) {
    return "Falta el número de documento.";
  }

  const banco = bancos.find((b) => b.bank_code === valores.bankCode);
  if (!banco) return "Elige tu banco.";
  // Brasil, y es de los errores que más caros salen: ocho códigos rechazan el
  // payout si el documento es un CPF. Mejor decirlo aquí que en un REJECTED.
  if (banco.rejects_cpf && valores.tipoDocumento === "CPF") {
    return `${banco.name} no acepta pagos a un CPF, solo a un CNPJ. Elige otro banco o registra el CNPJ.`;
  }

  if (regla.account_types.length > 0) {
    if (!valores.tipoCuenta) {
      return `Falta el tipo de cuenta: ${regla.account_types.join(", ")}.`;
    }
    if (!regla.account_types.includes(valores.tipoCuenta)) {
      return `«${valores.tipoCuenta}» no es un tipo de cuenta válido aquí.`;
    }
  }

  const cuenta = normalizaCuenta(valores.cuenta);
  if (cuenta) {
    const patron =
      regla.account_patterns[valores.tipoCuenta] ?? regla.account_patterns["*"];
    if (patron && !new RegExp(patron).test(cuenta)) {
      return `${regla.account_label}: ${regla.account_help}`;
    }
  } else if (!hayFilaDelMismoPais) {
    return `Falta el número de cuenta (${regla.account_label}).`;
  }

  if (regla.requires_branch) {
    const suc = valores.sucursal.trim();
    // ⚠️ EL MENSAJE NOMBRA EL CAMPO QUE EL TUTOR TIENE DELANTE. Aquí ponía
    // «Falta la sucursal, que en este país es obligatoria» para los 55 países, y
    // desde que la tabla se abrió al mundo eso era falso en la mayoría: a un
    // tutor británico no le falta una sucursal, le falta su sort code. Un error
    // que nombra un campo que no está en pantalla es un tutor que no sabe qué
    // corregir, y por tanto un tutor que no cobra.
    const rotulo = regla.branch_label ?? "sucursal";
    if (!suc) return `Falta el dato «${rotulo}», que en tu país es obligatorio.`;
    if (regla.branch_pattern && !new RegExp(regla.branch_pattern).test(suc)) {
      return `El dato «${rotulo}» no tiene el formato correcto.`;
    }
  }

  // ── Dirección y teléfono ────────────────────────────────────────────────
  //
  // ⚠️ AQUÍ NO HAY UN SOLO `return "Falta…"`, Y ESO ES LA REGLA, NO UN OLVIDO.
  // Las cuatro columnas nacieron nullable (`20260907120000`) y la RPC se niega
  // expresamente a exigirlas: «exigirla rompería el guardado a los ocho países
  // que hoy cobran por dLocal sin necesitarla, y a los tutores que ya tienen su
  // fila». Un `if (!direccion) return …` aquí volvería a cerrar esa puerta desde
  // el navegador, con el agravante de que el fallo se vería en el formulario y
  // la causa estaría en un fichero que nadie relaciona con dLocal.
  //
  // Lo que sí se hace es comprobar lo que el tutor SÍ escribe, para que un largo
  // o un formato malo se vean mientras teclea. Sin esto el mensaje que le llega
  // es el genérico del bloque `exception` de la RPC («los datos de cobro no
  // tienen el formato que pide CO»), que existe para no publicar la fila entera
  // en el log y por eso no puede decirle qué campo mirar.
  if (valores.direccion.trim().length > MAX_DIRECCION) {
    return `La dirección no puede pasar de ${MAX_DIRECCION} caracteres.`;
  }
  if (valores.ciudad.trim().length > MAX_CIUDAD) {
    return `La ciudad no puede pasar de ${MAX_CIUDAD} caracteres.`;
  }
  if (valores.codigoPostal.trim().length > MAX_CODIGO_POSTAL) {
    return `El código postal no puede pasar de ${MAX_CODIGO_POSTAL} caracteres.`;
  }
  const telefono = normalizaTelefono(valores.telefono);
  if (telefono && !TELEFONO_BENEFICIARIO.test(telefono)) {
    return "El teléfono tiene que empezar por un número o por «+» y medir entre 7 y 20 caracteres. Se admiten espacios, paréntesis y guiones.";
  }

  return null;
}

/*
 * ⚠️ AQUÍ VIVÍA `avisoDeDireccion()`, y se fue el 11-sep-2026 con la pantalla.
 * Explicaba en un párrafo por qué la dirección y el teléfono eran OPCIONALES y
 * qué se ganaba rellenándolos. Ya no hay nada que explicar: el formulario pide
 * los mismos campos a todo el mundo, los use el riel de ese país o no, así que
 * el párrafo describía una distinción que la pantalla dejó de hacer. Con él se
 * fue `enumera()`, que no tenía otro llamador.
 */

/*
 * ⚠️ AQUÍ VIVÍA `estadoDeLaCuenta()`, Y SE BORRÓ POR DOS MOTIVOS A LA VEZ.
 *
 * Era código muerto desde antes del dictado —su única aparición en un `grep`
 * era su propia declaración— y además su rama principal era la del riel
 * 'conectada', o sea el alta de Stripe Connect que el dictado del 9-sep-2026
 * elimina de la pantalla del tutor. Resucitarla obligaría a reescribirla
 * entera, así que no se conserva «por si acaso».
 *
 * Lo que de verdad pinta el estado de cada tarjeta vive en
 * `src/app/(app)/tutor/payouts/metodos-de-cobro.tsx`.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * C2m · LA OTRA MITAD: el destino de cobro que NO es una cuenta bancaria.
 *
 * Todo lo de arriba da por hecho que al tutor se le paga por transferencia, y
 * eso vale para los ocho países de dLocal. Venezuela no tiene riel bancario —
 * ningún proveedor internacional llega (`docs/PAGOS-Y-PAYOUTS.md` §4)— y lo que
 * hay es una persona mandando dinero a un correo de PayPal o a un Zelle. Sus
 * datos viven en `tutor_manual_payout_destinations` (`20260902110000`), tabla
 * aparte, porque meterlos en `tutor_payout_accounts` habría exigido aflojar
 * justo los cuatro `check` que la hacen estricta para los ocho que sí la usan.
 *
 * Este bloque es a la rama manual lo que `validarCuenta` es a la bancaria: el
 * espejo en el navegador, para que el error salga mientras el tutor teclea. Y
 * repite el mismo compromiso — **las reglas no se escriben aquí**: la etiqueta
 * del campo, la ayuda y la expresión regular llegan en `CanalManual`, que es una
 * fila de `payout_manual_channels`. Cero canales codificados en el TSX, igual
 * que no hay un solo `if (pais === 'MX')` en el formulario bancario.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * La CLASE de riel del país, tal y como la devuelve `payoutCountries()`.
 *
 * ⚠️ No se importa `RielDePayout` de `@/lib/payments`: ese módulo lleva
 * `import "server-only"` y este lo consume un componente `"use client"`. La
 * unión se repite a mano, y que se repita es lo que la hace segura — el día que
 * el enrutador añada un tercer riel, la asignación en `page.tsx` deja de
 * compilar y alguien tiene que venir a decidir qué formulario le toca. Un
 * `string` suelto habría dejado pasar ese día en silencio.
 */
/**
 * ⚠️ C2r · Son las dos FAMILIAS DE DATO que un tutor puede tener que declarar, y
 * ya no coinciden con «automático o a mano»: PayPal y Airtm son automáticos y
 * piden un identificador, igual que el riel manual. Lo que esta pantalla
 * necesita saber es qué campos pintar, no quién ejecuta — así que es el mismo
 * par que `FamiliaDeDato` en `@/lib/payments`, del que sale por `payoutCountries()`.
 */
export type RielDeCobro = "banco" | "identificador";

/** Una fila de `payout_manual_channels`, tal y como la sirve PostgREST. */
export type CanalManual = {
  channel: string;
  /** Lo que el tutor lee: «PayPal», «Zelle». */
  label: string;
  help: string;
  /** Cómo se llama el identificador EN ESTE CANAL («Teléfono o correo de tu Zelle»). */
  handle_label: string;
  /** Regex POSIX contra la que valida `upsert_manual_destination`. Es dato. */
  handle_pattern: string;
  sort_order: number;
  /**
   * Un canal apagado NO desaparece: sigue haciendo falta para poder nombrar el
   * destino que un tutor ya tenía en él. Lo que desaparece es del desplegable.
   */
  is_active: boolean;
};

/**
 * Lo que el tutor puede leer de sus propios destinos. Es literalmente el
 * column-grant de la migración: `handle` NO está, y no es un olvido — no tiene
 * `grant select` para `authenticated`, así que un `select=*` aquí devolvería
 * 42501. Lo que vuelve es `handle_masked`, columna generada.
 */
export type DestinoManualEnmascarado = {
  channel: string;
  holder_name: string;
  /** `jo····@gmail.com` o `····1234`. Nunca el identificador entero. */
  handle_masked: string;
  updated_at: string;
  /**
   * El id de la cuenta CONECTADA por OAuth, si la hay. `null` = el tutor
   * escribió el dato a mano. No se enmascara porque no es un secreto: es a
   * dónde se paga, y la pantalla lo usa solo para saber si está conectada.
   */
  verified_account_id?: string | null;
};

/** Los valores que teclea el tutor, antes de mandarlos a la RPC. */
export type ValoresDeDestino = {
  canal: string;
  titular: string;
  identificador: string;
};

/**
 * El resumen ENMASCARADO que devuelve `upsert_manual_destination`. Existe para
 * que el formulario repinte sin volver a consultar: es el mismo motivo por el
 * que `upsert_payout_account` devuelve el suyo, y el que aquel formulario tiró a
 * la basura durante tres semanas.
 */
export type ResumenDeDestino = {
  channel: string;
  label: string;
  holder_name: string;
  handle_masked: string;
  updated_at: string;
};

/**
 * Normaliza el identificador igual que `upsert_manual_destination` antes de
 * validarlo. Son dos tipos de dato disfrazados de columna única:
 *
 *   · con `@` es un correo → minúsculas,
 *   · sin `@` es un teléfono o un Pay ID → fuera espacios, paréntesis, puntos y
 *     guiones, que son los adornos con los que la gente escribe los números.
 *
 * Si aquí no se normaliza, el tutor que escribe «+1 (305) 555-1234» ve un error
 * de formato por haberlo escrito como lo escribe todo el mundo.
 */
export function normalizaIdentificador(v: string): string {
  const t = v.trim();
  return t.includes("@") ? t.toLowerCase() : t.replace(/[\s().-]/g, "");
}

/**
 * El titular pierde el espacio interior de sobra («Ana  Pérez» → «Ana Pérez»),
 * igual que en la RPC. NO se toca el uso de mayúsculas: un apellido no es
 * nuestro para reescribirlo.
 */
export function normalizaTitular(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

/**
 * El espejo de `upsert_manual_destination`, con la regex que viene de la BD.
 * Devuelve `null` si cuadra, o el primer mensaje de error.
 *
 * ⚠️ El mensaje NUNCA lleva el identificador dentro. Es la lección de
 * `20260901170000` aplicada también en el navegador: nombra el campo y el canal,
 * que es lo que el tutor necesita para corregirlo, y nada más.
 *
 * Cubre además el hueco que la RPC solo puede tapar con un mensaje genérico: el
 * `check` de tabla exige entre 5 y 120 caracteres sin espacios, y si se llega
 * ahí con algo que la regex del canal dejó pasar, lo que el tutor recibe es «ese
 * dato no tiene el formato que espera PayPal» sin decirle qué mirar.
 */
export function validarDestinoManual(
  canal: CanalManual | null,
  valores: ValoresDeDestino,
): string | null {
  if (!canal) return "Elige por dónde quieres cobrar.";
  if (!canal.is_active) {
    return `${canal.label} ya no está disponible. Elige otra forma de cobrar.`;
  }

  const titular = normalizaTitular(valores.titular);
  if (!titular) {
    return "Falta el nombre del titular: tiene que ser el tuyo, el de la cuenta a la que cobras.";
  }
  if (titular.length > 120) {
    return "El nombre del titular no puede pasar de 120 caracteres.";
  }

  const handle = normalizaIdentificador(valores.identificador);
  if (!handle) return `Falta el dato de «${canal.handle_label}».`;
  if (handle.length < 5 || handle.length > 120) {
    return `«${canal.handle_label}» tiene que medir entre 5 y 120 caracteres.`;
  }

  // ponytail: la regex es dato de la BD y llega como texto POSIX. Casi todo el
  // POSIX que se usa es también JavaScript válido —las cinco sembradas lo son—,
  // pero una clase como `[[:alpha:]]` haría reventar el `RegExp` aquí. En ese
  // caso NO se inventa un veredicto: se deja pasar y decide el servidor, que es
  // quien tiene el motor bueno. El techo es que ese canal pierde el aviso
  // mientras se teclea, no que acepte basura.
  let patron: RegExp;
  try {
    patron = new RegExp(canal.handle_pattern);
  } catch {
    return null;
  }
  if (!patron.test(handle)) {
    return `«${canal.handle_label}» no tiene el formato que espera ${canal.label}.`;
  }

  return null;
}
