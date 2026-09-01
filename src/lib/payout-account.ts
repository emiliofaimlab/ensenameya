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
 * Los cinco estados no son decorativos, son cinco situaciones distintas que el
 * tutor tiene que poder distinguir — y la cuarta (país declarado cambiado
 * después de registrar la cuenta) es la única que nadie ve venir.
 */
export function estadoDeLaCuenta(args: {
  paisDeclarado: string | null;
  paisServible: boolean;
  cuenta: CuentaEnmascarada | null;
  nombreDelBanco: string | null;
  /** `nombrePais`, inyectado: este módulo no lo importa (ver la cabecera). */
  nombreDePais: (code: string) => string;
}): { tone: PillTone; pill: string; detalle: string | null } {
  const { paisDeclarado, paisServible, cuenta, nombreDelBanco, nombreDePais } =
    args;

  if (!paisDeclarado) {
    return { tone: "amber", pill: "Falta el país", detalle: null };
  }
  if (!paisServible) {
    return { tone: "amber", pill: "Pendiente", detalle: null };
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
