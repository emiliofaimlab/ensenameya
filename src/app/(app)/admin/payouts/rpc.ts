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
