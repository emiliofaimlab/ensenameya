/**
 * Puerta estrecha a las RPC de payouts que `database.types.ts` todavía no
 * conoce, y a las que cambiaron de firma.
 *
 * ⚠️ Los tipos generados se regeneran con `npm run db:types` DESPUÉS de aplicar
 * la migración, y ese fichero no se toca a mano (regla de oro 6). Hasta
 * entonces hay DOS cosas que ni compilan:
 *
 *   · `manual_destination` — función nueva (`20260902110000`). El nombre está
 *     tipado contra la unión de funciones conocidas, así que una función nueva
 *     es un error de TIPOS, no de ejecución.
 *   · `manage_payout` — existe en los tipos, pero con la firma VIEJA de dos
 *     argumentos. `20260902120000` tiró esa firma y dejó una sola de cuatro
 *     (`p_referencia`, `p_canal`), así que pasarle la referencia con los tipos
 *     de hoy es un error de compilación sobre una llamada que en runtime es la
 *     correcta — y sin referencia el `mark_paid` lo rechaza la propia BD.
 *
 * ⚠️ CORRECCIÓN DEL 3-SEP: LOS TIPOS YA SE REGENERARON, así que los dos motivos
 * de arriba están cumplidos a medias y este fichero NO se puede borrar todavía.
 * `database.types.ts` ya trae `manual_destination`, `payout_beneficiary` y el
 * `manage_payout` de cuatro argumentos. Lo que sigue sin encajar son dos cosas
 * concretas:
 *
 *   · Las tres RPC declaran `Returns: Json`, así que quien las llame tiene que
 *     afirmar la forma de todos modos — y es mejor afirmarla UNA vez aquí, con
 *     el tipo escrito y comentado, que con un `as` por sitio de llamada.
 *   · Los argumentos opcionales se generan como `p_referencia?: string`, o sea
 *     `string | undefined`. La pantalla manda `null` («no hay referencia»), que
 *     es lo que la función espera y lo que el tipo generado NO admite.
 *
 * Es la misma puerta que abrieron `src/components/chat/rpc.ts` (M-12) y
 * `src/app/api/cuenta/eliminar/rpc.ts`, y se declara en UN solo sitio por
 * carpeta por el mismo motivo: el día que se regeneren los tipos hay que borrar
 * un fichero, no doce `as unknown as` repartidos.
 *
 * Sirve igual para el cliente del navegador y para el de servidor: lo único que
 * se le pide al cliente es que tenga `.rpc`. Por eso este módulo NO lleva
 * `server-only` — lo importan la pantalla (servidor) y los botones (navegador).
 */

type LlamadorRpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

/** Envuelve cualquier cliente de Supabase para llamar a las RPC nuevas. */
export async function rpcNueva<T>(
  cliente: unknown,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string; code?: string } | null }> {
  const { data, error } = await (cliente as LlamadorRpc).rpc(fn, args);
  return { data: (data ?? null) as T | null, error };
}

/**
 * Un canal de cobro manual del tutor, tal y como lo devuelve
 * `manual_destination(uuid)`.
 *
 * ⚠️ `handle` viene EN CLARO. Es el único sitio del sistema donde se lee entero
 * un identificador de pago manual, y por eso el `execute` de esa función es
 * solo de `service_role`: no existe como endpoint de PostgREST, así que esto no
 * se puede pedir desde el navegador ni queriendo (regla de oro 3).
 *
 * `is_active` viene del catálogo y NO está filtrado a propósito: si Legal apagó
 * un canal ayer, el admin tiene que verlo —el tutor sigue esperando su dinero y
 * hay que decirle que elija otro—, no que el canal desaparezca de la lista sin
 * explicación.
 */
export type DestinoManual = {
  channel: string;
  label: string;
  holder_name: string;
  handle: string;
  handle_masked: string;
  is_active: boolean;
  updated_at: string;
};

/** Lo que devuelve `manual_destination(p_tutor_id)`. */
export type DestinosDeTutor = {
  tutor_id: string;
  destinations: DestinoManual[];
};

/**
 * Lo que la pantalla le pasa a los botones sobre a dónde pagar. `null` = no se
 * pudo preguntar (falta la clave de servicio); `[]` = se preguntó y el tutor no
 * tiene ningún destino registrado, que es un caso muy distinto y hay que
 * pintarlo distinto.
 */
export type DestinosParaPagar = DestinoManual[] | null;

/* ══════════════════════════════════════════════════════════════════════════
 * C2 · LA OTRA FAMILIA DE DESTINO: coordenadas BANCARIAS.
 *
 * Todo lo de arriba da por hecho que un pago a mano es «un canal y un
 * identificador» — Zelle, Zinli, Binance—, y eso es Venezuela. Desde
 * `20260903140000` hay un riel manual que pide lo contrario: Colombia va por
 * `banco-manual`, o sea que el tutor declara banco, documento y número de
 * cuenta, y una persona hace la transferencia.
 *
 * Son dos preguntas distintas a dos tablas distintas, y por eso no se resuelven
 * con la misma RPC:
 *
 *   `dato = 'identificador'` → `manual_destination(tutor_id)`  ← arriba
 *   `dato = 'banco'`         → `payout_beneficiary(payout_id)` ← esto
 *
 * ⚠️ Y NO ES INTERCAMBIABLE: hasta ahora la pantalla le preguntaba
 * `manual_destination` a TODO tutor con una orden a mano, así que a un tutor
 * colombiano —que tiene sus datos bancarios perfectamente guardados— le
 * devolvía `no_data_found` y la fila pintaba «este tutor no ha registrado
 * ningún destino de cobro manual». Era mentira, y de la peor clase: la que
 * culpa al tutor de un hueco de la pantalla.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * La familia de dato de un riel, o sea qué se le pide al tutor.
 *
 * ⚠️ Se repite a mano en vez de importar `FamiliaDeDato` de `@/lib/payments`, y
 * es el mismo motivo por el que lo repite `src/lib/payout-account.ts`: ese
 * módulo lleva `import "server-only"` y este lo consume también el componente
 * `"use client"` de al lado. La unión es de dos valores y la asignación se hace
 * en la pantalla (servidor), donde sí está el tipo de verdad: el día que el
 * enrutador añada una tercera familia, esa asignación deja de compilar.
 */
export type FamiliaDeDato = "banco" | "identificador";

/**
 * El beneficiario de UN payout, tal y como lo devuelve
 * `payout_beneficiary(uuid)` (`20260901160000` §8).
 *
 * ⚠️ `beneficiary_document` y `bank_account` vienen EN CLARO, y es el único
 * sitio del sistema donde se lee un número de cuenta entero: la tabla
 * `tutor_payout_accounts` no tiene `grant select` de esas dos columnas para
 * NINGÚN rol, así que PostgREST no las puede devolver por ninguna otra puerta.
 * El `execute` de la función es solo de `service_role` → se llama desde el
 * servidor y viaja ya resuelta (regla de oro 3).
 *
 * `transfer_amount` NO está, y no es un olvido de este tipo: la función no lo
 * devuelve porque el saldo está en USD y `currency_to_pay` es la moneda del
 * país. Convertir es una decisión con tipo de cambio y redondeo, y desde luego
 * no se hace en una pantalla (regla de oro 2). El importe que se paga es
 * `payouts.amount`, que la fila ya tiene delante.
 */
export type Beneficiario = {
  transfer_country: string;
  /** Moneda del PAÍS (`payout_country_rules.currency`), no la de la orden. */
  currency_to_pay: string | null;
  beneficiary_first_name: string;
  beneficiary_last_name: string;
  beneficiary_document: string;
  beneficiary_document_type: string;
  /** Código del catálogo. El NOMBRE se resuelve aparte, contra `payout_banks`. */
  bank_code: string;
  bank_account: string;
  bank_account_type: string | null;
  bank_branch: string | null;
};

/**
 * Lo que la fila necesita saber sobre a dónde transferir. Cuatro desenlaces y
 * no dos, porque `payout_beneficiary` levanta excepción por cuatro motivos
 * distintos y **tres de ellos son información accionable**, no fallos:
 *
 *   · `ok`            → hay a dónde pagar.
 *   · `sin-datos`     → el tutor no ha registrado sus datos de cobro. Hay que
 *                       escribirle: no es un error de la pantalla.
 *   · `no-ejecutable` → la orden no está en un estado del que se pueda
 *                       construir un beneficiario, o sus datos ya no validan, o
 *                       son de otro país que el de la orden. Todos ellos con el
 *                       mensaje de la BD, que está escrito para leerse tal cual.
 *   · `error`         → cualquier otra cosa. La única que es un problema NUESTRO.
 *
 * Ausente del mapa que las guarda = no se preguntó (el tope de la pantalla),
 * que es un quinto caso y se pinta distinto. Aplastarlos a «hay datos / no hay»
 * es exactamente el fallo que ya se corrigió una vez en `Destinos`.
 */
export type DestinoBancario =
  | { estado: "ok"; datos: Beneficiario }
  | { estado: "sin-datos"; mensaje: string }
  | { estado: "no-ejecutable"; mensaje: string }
  | { estado: "error"; mensaje: string };

/**
 * Pregunta a dónde transferir el payout `payoutId`, y traduce el fallo.
 *
 * ⚠️ Va POR PAYOUT y no por tutor a propósito, aunque eso repita la llamada
 * cuando un tutor tiene dos órdenes: la función valida cosas de LA ORDEN —que
 * su estado sea ejecutable, que tenga país, que el país de los datos coincida
 * con `payouts.payee_country`— así que dos órdenes del mismo tutor pueden
 * perfectamente dar respuestas distintas. Deduplicar por tutor sería enseñar la
 * respuesta de una orden en la fila de otra.
 */
export async function leerBeneficiario(
  cliente: unknown,
  payoutId: string,
): Promise<DestinoBancario> {
  const { data, error } = await rpcNueva<Beneficiario>(cliente, "payout_beneficiary", {
    p_payout_id: payoutId,
  });

  if (error) {
    // ⚠️ REGLA DE ORO 9 DISFRAZADA DE PROBLEMA DEL TUTOR, la misma trampa que
    // ya documenta `dlocal-provider.ts`: un 42501 aquí no es «este tutor no
    // tiene datos», es que a `service_role` le falta el `execute` y NINGUNA
    // orden va a enseñar destino. Confundirlo con `sin-datos` pondría el
    // mensaje que culpa al tutor en todas las filas a la vez.
    if (error.code === "42501" || /permission denied|not allowed/i.test(error.message)) {
      return { estado: "error", mensaje: error.message };
    }
    // `no_data_found`: el tutor no ha registrado nada (o el payout no existe,
    // que aquí no puede pasar — la fila se acaba de leer de la cola).
    if (error.code === "P0002") return { estado: "sin-datos", mensaje: error.message };
    // `check_violation`: estado no ejecutable, sin país, país que no coincide o
    // datos que ya no validan. Los cuatro mensajes dicen qué pasa y ninguno
    // lleva el número de cuenta dentro (`20260901170000`).
    if (error.code === "23514") return { estado: "no-ejecutable", mensaje: error.message };
    return { estado: "error", mensaje: error.message };
  }

  if (!data || !data.bank_account) {
    return {
      estado: "error",
      mensaje: "payout_beneficiary no devolvió beneficiario",
    };
  }
  return { estado: "ok", datos: data };
}
