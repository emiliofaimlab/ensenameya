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

/**
 * Lo mínimo que se le pide para LEER una tabla que los tipos no conocen. Se
 * declaran solo los dos eslabones que se usan abajo (`eq` y `order`) en vez de
 * un `any`: una consulta que necesite algo más tiene que venir a añadirlo aquí,
 * que es exactamente el freno que se quiere.
 */
type Consulta = PromiseLike<{
  data: unknown;
  error: ErrorPostgrest | null;
}> & {
  eq(columna: string, valor: unknown): Consulta;
  order(columna: string, opciones?: { ascending?: boolean }): Consulta;
};

type LectorDeTablas = {
  from(tabla: string): { select(columnas: string): Consulta };
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

/**
 * El catálogo de canales de cobro manual, ENTERO — los apagados incluidos.
 *
 * No se filtra por `is_active` y no es un descuido: un canal apagado sigue
 * teniendo tutores colgando por FK, y sin su fila aquí la pantalla no sabría
 * cómo se llama el destino que ese tutor ya tiene registrado, así que le
 * enseñaría la clave cruda («zinli») o, peor, nada. Filtrar es cosa del
 * desplegable, no de la lectura. Es el mismo criterio con el que
 * `manual_destination()` devuelve `is_active` en vez de esconder la fila.
 *
 * `authenticated` tiene `grant select` sobre la tabla entera: es documentación
 * de producto, no PII.
 */
export async function leerCanalesManuales(
  cliente: unknown,
): Promise<{ data: unknown[]; error: ErrorPostgrest | null }> {
  const { data, error } = await (cliente as LectorDeTablas)
    .from("payout_manual_channels")
    .select(
      "channel, label, help, handle_label, handle_pattern, sort_order, is_active",
    )
    .order("sort_order");
  return { data: (data ?? []) as unknown[], error };
}

/**
 * Los destinos del propio tutor, ENMASCARADOS.
 *
 * ⚠️ Las columnas se nombran una a una y no por `*`, exactamente por el mismo
 * motivo que en `tutor_payout_accounts`: `handle` no tiene `grant select` para
 * `authenticated`, así que un `select=*` aquí devolvería 42501. Que la lista sea
 * explícita es lo que hace visible dónde está la frontera.
 *
 * El `eq` sobre `tutor_id` es redundante con la RLS —la política ya limita a la
 * fila propia— y se pone igual: si mañana alguien afloja la política, esta
 * consulta sigue pidiendo lo suyo y el fallo se ve en la política, no aquí.
 */
export async function leerDestinosManuales(
  cliente: unknown,
  tutorId: string,
): Promise<{ data: unknown[]; error: ErrorPostgrest | null }> {
  const { data, error } = await (cliente as LectorDeTablas)
    .from("tutor_manual_payout_destinations")
    .select("channel, holder_name, handle_masked, updated_at")
    .eq("tutor_id", tutorId);
  return { data: (data ?? []) as unknown[], error };
}
