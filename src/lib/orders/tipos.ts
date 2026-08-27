import type { Database } from "@/lib/database.types";

/**
 * EY-176 · las formas del pedido que el código necesita nombrar.
 *
 * ⚠️ Este fichero nació como PUERTA TEMPORAL: mientras las migraciones
 * `20260827150000`-`170000` no estaban aplicadas, `orders`, `order_status` y
 * las tres RPC del pedido no existían para TypeScript y había que declararlas
 * a mano. Ya están aplicadas y `npm run db:types` las conoce, así que la puerta
 * —`DatabaseConPedidos`, `clienteDePedidos`, `rpcDePedidos`— se ha retirado.
 *
 * Se contrastó campo a campo contra el DDL generado antes de borrarla, que es
 * lo que hay que hacer siempre con un espejo escrito a mano: el compilador no
 * puede comprobar una promesa, solo creérsela. Coincidía.
 *
 * Lo que se queda son alias legibles sobre los tipos generados, más la forma
 * que come `create_order(p_lines jsonb)`, que sí es nuestra: los tipos dan
 * `Args: { p_lines: Json }` y `Json` no dice nada de la forma de cada línea.
 */

/** Espejo de `public.order_status` (20260827150000). */
export type OrderStatus = Database["public"]["Enums"]["order_status"];

/** Espejo de `public.orders` (20260827150000). */
export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

/** Una línea del carrito tal y como la come `create_order(p_lines jsonb)`. */
export type LineaDePedido = {
  product_id: string;
  /** ISO canónico UTC (`toISOString()`). Postgres los compara por instante. */
  slots: string[];
};
