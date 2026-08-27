import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * ⚠️⚠️ PUERTA TEMPORAL DE TIPOS — EY-176. **ESTE FICHERO SE BORRA.**
 *
 * Las migraciones `20260827150000`, `20260827160000` y `20260827170000` no se
 * han aplicado todavía, así que `src/lib/database.types.ts` no conoce ni la
 * tabla `orders`, ni la columna `bookings.order_id`, ni las cuatro funciones
 * nuevas. Y eso NO es un problema de ejecución sino de compilación: los nombres
 * de tabla y de RPC están tipados contra una unión cerrada, así que
 * `.from("orders")` o `.rpc("create_order")` **ni compilan**.
 *
 * Los tipos generados no se editan a mano (regla de oro 6). Se declara aquí lo
 * que falta, EN UN SOLO SITIO, siguiendo el precedente de
 * `src/components/chat/rpc.ts` (M-12) y `unread.ts` (N-23): el día que se
 * apliquen las migraciones y se corra `npm run db:types`, esto es un fichero
 * que se borra y unos cuantos `clienteDePedidos(...)` que se quitan, no doce
 * `as unknown as` repartidos por el código.
 *
 * ⚠️ Y MIENTRAS TANTO ES UNA PROMESA SIN VERIFICAR: si la forma de aquí abajo
 * no coincide con la de la migración, el compilador dirá que todo está bien y
 * el fallo saldrá en ejecución. Cada campo de este fichero está copiado a mano
 * del DDL; al regenerar los tipos, lo primero es comprobar que no hay sorpresas.
 */

/** Espejo de `public.order_status` (20260827150000). */
export type OrderStatus = "pending_payment" | "paid" | "cancelled";

/** Espejo de `public.orders` (20260827150000). */
export type OrderRow = {
  id: string;
  student_id: string;
  status: OrderStatus;
  provider: string;
  currency: string;
  provider_payment_id: string | null;
  lines_fingerprint: string;
  created_at: string;
  updated_at: string;
};

type OrdersTable = {
  Row: OrderRow;
  Insert: Omit<OrderRow, "id" | "created_at" | "updated_at" | "status"> & {
    id?: string;
    status?: OrderStatus;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<OrderRow>;
  Relationships: [];
};

type PublicBase = Database["public"];
type TablasBase = PublicBase["Tables"];
type BookingsBase = TablasBase["bookings"];

/**
 * `bookings` con la columna nueva. Se añade a las tres caras (Row/Insert/Update)
 * porque el cliente la lee en el `select` y la filtra en el `.eq`, y PostgREST
 * valida los nombres contra `Row` en un sitio y contra `Insert` en otro.
 */
type BookingsConPedido = Omit<BookingsBase, "Row" | "Insert" | "Update"> & {
  Row: BookingsBase["Row"] & { order_id: string | null };
  Insert: BookingsBase["Insert"] & { order_id?: string | null };
  Update: BookingsBase["Update"] & { order_id?: string | null };
};

/**
 * `late_payment_refunds` con lo que le añade `20260827170000`: `booking_id` y
 * `booking_status` pasan a nullable y entran `order_id` y `order_status`.
 */
type RefundsBase = TablasBase["late_payment_refunds"];
type RefundsConPedido = Omit<RefundsBase, "Row" | "Insert" | "Update"> & {
  Row: Omit<RefundsBase["Row"], "booking_id" | "booking_status"> & {
    booking_id: string | null;
    booking_status: Database["public"]["Enums"]["booking_status"] | null;
    order_id: string | null;
    order_status: OrderStatus | null;
  };
  Insert: Omit<RefundsBase["Insert"], "booking_id" | "booking_status"> & {
    booking_id?: string | null;
    booking_status?: Database["public"]["Enums"]["booking_status"] | null;
    order_id?: string | null;
    order_status?: OrderStatus | null;
  };
  Update: RefundsBase["Update"] & {
    order_id?: string | null;
    order_status?: OrderStatus | null;
  };
};

/** El esquema `public` tal y como queda tras las tres migraciones de EY-176. */
export type DatabaseConPedidos = Omit<Database, "public"> & {
  public: Omit<PublicBase, "Tables" | "Enums"> & {
    Tables: Omit<TablasBase, "bookings" | "late_payment_refunds"> & {
      bookings: BookingsConPedido;
      late_payment_refunds: RefundsConPedido;
      orders: OrdersTable;
    };
    Enums: PublicBase["Enums"] & { order_status: OrderStatus };
  };
};

/**
 * El mismo cliente de siempre, visto a través del esquema con pedidos.
 *
 * No cambia nada en ejecución —es un cast— y por eso vale igual para el cliente
 * del navegador, el de servidor y el de `service_role`: lo que decide qué se
 * puede leer sigue siendo la RLS y los grants, no este tipo.
 */
export function clienteDePedidos<T>(client: T): SupabaseClient<DatabaseConPedidos> {
  return client as unknown as SupabaseClient<DatabaseConPedidos>;
}

/**
 * Puerta a las RPC nuevas, con la misma forma que la de M-12
 * (`src/components/chat/rpc.ts`). Se tipan los argumentos y el retorno a mano
 * para que quien llame no pueda equivocarse de nombre de parámetro — que es el
 * error que un `Record<string, unknown>` deja pasar sin decir nada.
 */
export type RpcDePedidos = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string; details?: string; hint?: string } | null;
  }>;
};

export function rpcDePedidos<T>(client: T): RpcDePedidos {
  return client as unknown as RpcDePedidos;
}

/** Una línea del carrito tal y como la come `create_order(p_lines jsonb)`. */
export type LineaDePedido = {
  product_id: string;
  /** ISO canónico UTC (`toISOString()`). Postgres los compara por instante. */
  slots: string[];
};
