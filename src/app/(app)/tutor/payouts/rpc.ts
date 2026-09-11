/**
 * C2m · Puerta estrecha a lo que `database.types.ts` todavía no conoce del riel
 * de cobro manual.
 *
 * ⚠️ Los tipos generados se regeneran con `npm run db:types` DESPUÉS de aplicar
 * la migración, y ese fichero no se toca a mano (regla de oro 6). Hasta
 * entonces, `20260902110000` deja CUATRO cosas que ni compilan:
 *
 *   · `payout_manual_channels` y `tutor_manual_payout_destinations` — tablas
 *     nuevas. `supabase.from("payout_manual_channels")` está tipado contra la
 *     unión de tablas conocidas, así que es un error de TIPOS, no de ejecución.
 *   · `upsert_manual_destination` y `delete_manual_destination` — funciones
 *     nuevas, mismo problema con `.rpc()`.
 *
 * Es la misma puerta que abrieron `src/components/chat/rpc.ts` (M-12),
 * `src/app/api/cuenta/eliminar/rpc.ts` y, en este mismo lote,
 * `src/app/(app)/admin/payouts/rpc.ts`. Se declara UNA por carpeta por el mismo
 * motivo: el día que se regeneren los tipos hay un fichero que borrar, no doce
 * `as unknown as` repartidos por los TSX.
 *
 * Este módulo NO lleva `server-only`: lo importan la pantalla (servidor, para
 * leer) y el formulario (navegador, para escribir).
 *
 * ⚠️ Lo que NO está aquí, y es a propósito: `manual_destination(uuid)`, la
 * función que devuelve el identificador EN CLARO. Su `execute` es solo de
 * `service_role` y su sitio es el panel del admin. Que no exista un envoltorio
 * suyo en la carpeta del tutor es media garantía de que nadie la llame desde
 * aquí por costumbre.
 */

type ErrorPostgrest = { message: string; code?: string };

/** Lo mínimo que se le pide a un cliente de Supabase para llamar a una RPC. */
type LlamadorRpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: ErrorPostgrest | null }>;
};

/** Envuelve cualquier cliente de Supabase para llamar a las RPC nuevas. */
export async function rpcNueva<T>(
  cliente: unknown,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: T | null; error: ErrorPostgrest | null }> {
  const { data, error } = await (cliente as LlamadorRpc).rpc(fn, args);
  return { data: (data ?? null) as T | null, error };
}
