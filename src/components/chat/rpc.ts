import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * M-12 · Puerta estrecha a las RPC que `database.types.ts` todavía no conoce.
 *
 * ⚠️ Los tipos generados se regeneran con `npm run db:types` DESPUÉS de aplicar
 * la migración, y el archivo no se toca a mano (regla de oro 6). Hasta
 * entonces `supabase.rpc("open_conversation")` NI COMPILA: el nombre está
 * tipado contra la unión de funciones conocidas, así que una función nueva es
 * un error de tipos, no un error de ejecución.
 *
 * Se declara a mano y EN UN SOLO SITIO —esta es la misma puerta que abrió N-23
 * en `unread.ts`— para que el día que se regeneren los tipos haya un archivo
 * que borrar y no doce `as unknown as` repartidos.
 *
 * Sirve igual para el cliente del navegador y para el de servidor: lo único que
 * se pide es que tenga `.rpc`.
 */
export type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Envuelve cualquier cliente de Supabase para llamar a las RPC nuevas. */
export function asRpc(client: SupabaseClient<Database>): RpcCaller {
  return client as unknown as RpcCaller;
}

/** Fila de `my_conversations()`. */
export type ConversationRow = {
  id: string;
  other_id: string;
  other_name: string | null;
  other_avatar_path: string | null;
  other_is_tutor: boolean;
  last_message_at: string | null;
  has_booking: boolean;
  /**
   * MN-06 · ¿se puede escribir en este hilo? Es la MISMA función que rechaza en
   * el servidor (`pair_can_chat`), así que la pantalla y la RPC no pueden
   * discrepar. Difiere de `has_booking` solo mientras el checkout está en curso
   * —la reserva vive en `pending_payment` unos 7 minutos—, que es exactamente
   * el caso que la UI no podía distinguir del hilo legado de solo lectura.
   */
  can_chat: boolean;
  /**
   * MN-08 · Las DOS lecturas de «cuántas mentorías» que devuelve la función.
   * Se piden las dos a la base de datos aunque hoy solo se pinte una: la
   * pregunta P-7 (¿«3 mentorías» son tres títulos, tres compras o tres
   * clases?) sigue sin respuesta del cliente, y así elegir es cambiar una
   * línea de pintado y no otra migración. Ver `20260820130000`.
   */
  product_count: number;
  session_count: number;
  blocked_at: string | null;
  last_booking_id: string | null;
  last_product_title: string | null;
};

/** Fila de `unread_conversation_counts()`. */
export type UnreadRow = {
  conversation_id: string;
  unread: number;
  last_message_at: string | null;
};
