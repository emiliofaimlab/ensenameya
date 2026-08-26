import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * ⚠️ PUERTA TEMPORAL — BORRAR ESTE FICHERO ENTERO cuando se aplique la
 * migración `20260826230000_ey192_baja_de_cuenta.sql` y se regenere
 * `database.types.ts` con `npm run db:types`.
 *
 * Existe por la regla de oro 6: los tipos se generan DESPUÉS de aplicar la
 * migración y no se editan a mano, así que hasta entonces
 * `account_deletion_blockers` y `anonymize_account` son un error de
 * compilación, no de ejecución. Mismo patrón —y misma intención de que haya
 * UN archivo que borrar en vez de varios `as unknown as` repartidos— que
 * `src/components/chat/rpc.ts`.
 *
 * Cuando desaparezca, `admin.rpc("anonymize_account", { p_user_id })` pasa a
 * tipar solo y las dos llamadas de `route.ts` se quedan igual salvo el
 * `asRpc(...)` de alrededor.
 */
export type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export function asRpc(client: SupabaseClient<Database>): RpcCaller {
  return client as unknown as RpcCaller;
}

/**
 * Lo que devuelve `account_deletion_blockers`: un objeto con SOLO las claves
 * que aplican (la función usa `jsonb_strip_nulls`), así que `{}` significa
 * «vía libre». Los importes van en la moneda del pago; hoy siempre USD.
 */
export type DeletionBlockers = {
  clases_futuras_como_tutor?: number;
  clases_futuras_como_alumno?: number;
  saldo_sin_liquidar?: number;
  payouts_en_curso?: number;
  reembolsos_pendientes?: number;
};

/** Lo que devuelve `anonymize_account`. */
export type AnonymizeResult =
  | { status: "ok"; ficheros_borrados: number; roles: string[] }
  | { status: "ya_anonimizada"; deleted_at: string };
