import type { PillTone } from "@/components/layout/panel-shell";

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
    if (!suc) return "Falta la sucursal, que en este país es obligatoria.";
    if (regla.branch_pattern && !new RegExp(regla.branch_pattern).test(suc)) {
      return "La sucursal no tiene el formato correcto.";
    }
  }

  return null;
}

/**
 * El estado que se pinta en «Cuenta de cobro», arriba, junto a «País de cobro»
 * y «Retención». R29-03b: se dice en qué estado está el cobro sin pintar un
 * "Banco BBVA ····1234" que no existe.
 *
 * Los estados no son decorativos: son situaciones distintas que el tutor tiene
 * que poder distinguir — y la de «país declarado cambiado después de registrar
 * la cuenta» es la única que nadie ve venir.
 *
 * ⚠️ AQUÍ SE DECIDÍA POR `paisServible: boolean`, Y ESO SOLO VALÍA MIENTRAS HUBO
 * UN ÚNICO RIEL. Un booleano contesta «¿podemos pagar allí?»; lo que esta
 * función necesita saber desde el 2-sep es **cómo** se paga allí, porque son dos
 * datos guardados en dos tablas distintas y con dos formas de nombrarlos
 * («Banco Provincial ····1234» frente a «Zelle ····1234»). Por eso entra
 * `riel`, que se deriva del dato (`payment_routing_rules.payout_provider`) y no
 * de una lista de países en este fichero.
 */
export function estadoDeLaCuenta(args: {
  paisDeclarado: string | null;
  /** `null` = hoy no podemos pagar en ese país por ninguna vía. */
  riel: RielDeCobro | null;
  /** Riel bancario: lo guardado en `tutor_payout_accounts`. */
  cuenta: CuentaEnmascarada | null;
  nombreDelBanco: string | null;
  /** Riel manual: lo guardado en `tutor_manual_payout_destinations`. */
  destinos: DestinoManualEnmascarado[];
  /** `channel` → `label` del catálogo. Un canal desconocido se cae a su clave. */
  etiquetaDeCanal: (channel: string) => string;
  /** `nombrePais`, inyectado: este módulo no lo importa (ver la cabecera). */
  nombreDePais: (code: string) => string;
}): { tone: PillTone; pill: string; detalle: string | null } {
  const {
    paisDeclarado,
    riel,
    cuenta,
    nombreDelBanco,
    destinos,
    etiquetaDeCanal,
    nombreDePais,
  } = args;

  if (!paisDeclarado) {
    return { tone: "amber", pill: "Falta el país", detalle: null };
  }
  if (!riel) {
    return { tone: "amber", pill: "Pendiente", detalle: null };
  }

  // Connect: no hay nada guardado de nuestro lado que enseñar. Lo que decide si
  // el tutor está listo vive EN STRIPE, así que esta función no puede
  // responderlo sin una llamada — y no la hace: la pantalla pinta la tarjeta de
  // alta, que sí pregunta.
  if (riel === "conectada") {
    return { tone: "amber", pill: "Alta en Stripe", detalle: null };
  }

  if (riel === "identificador") {
    if (destinos.length === 0) {
      return { tone: "amber", pill: "Sin datos", detalle: null };
    }
    // Se listan TODOS, no solo el primero: el tutor puede tener varios y quien
    // paga elige mirando la lista, así que enseñarle uno sería enseñarle una
    // decisión que no se ha tomado. `handle_masked` ya viene enmascarado de la
    // BD; aquí no se recorta nada más.
    return {
      tone: "green",
      pill: "Registrado",
      detalle: destinos
        .map((d) => `${etiquetaDeCanal(d.channel)} ${d.handle_masked}`)
        .join(" · "),
    };
  }

  if (!cuenta) {
    return { tone: "amber", pill: "Sin datos", detalle: null };
  }
  if (cuenta.country !== paisDeclarado) {
    return {
      tone: "red",
      pill: "Revisar",
      detalle: `Tus datos son de ${nombreDePais(cuenta.country)} y ahora cobras en ${nombreDePais(paisDeclarado)}.`,
    };
  }
  return {
    tone: "green",
    pill: "Registrada",
    detalle: `${nombreDelBanco ?? cuenta.bank_code} · ${enmascarar(cuenta.bank_account_last4)}`,
  };
}

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
export type RielDeCobro = "banco" | "identificador" | "conectada";

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
