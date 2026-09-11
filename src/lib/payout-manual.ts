import "server-only";

/**
 * C2m · Los DOS LECTORES del riel de cobro manual, fuera de la carpeta de ruta.
 *
 * Vivían en `src/app/(app)/tutor/payouts/rpc.ts` y se mudaron aquí el
 * 11-sep-2026, cuando `src/lib/payouts.ts` empezó a necesitarlos para resolver
 * la moneda de cobro del tutor: un módulo de `lib` importando de una carpeta de
 * `app/` invierte la dependencia y ata una librería a una ruta que mañana se
 * puede mover. `rpc.ts` se queda con `rpcNueva`, que es lo que usa el formulario
 * desde el navegador.
 *
 * ⚠️ SIGUE SIENDO UNA PUERTA ESTRECHA, no una capa. Existe solo porque
 * `database.types.ts` todavía no conoce `payout_manual_channels` ni
 * `tutor_manual_payout_destinations` (`20260902110000`): son errores de TIPOS,
 * no de ejecución. El día que `npm run db:types` las conozca, esto se borra
 * entero y las consultas vuelven al sitio donde se usan — que es el motivo de
 * que sea un fichero aparte y no doce `as unknown as` repartidos por los TSX.
 *
 * Lleva `server-only` (a diferencia de `rpc.ts`, que no puede): los dos
 * lectores solo los llaman Server Components y `src/lib/payouts.ts`.
 */

type ErrorPostgrest = { message: string; code?: string };

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
    // `verified_account_id` NO es un secreto: es a dónde se paga, y el tutor
    // tiene que poder ver si su cuenta está conectada o solo tecleada.
    .select("channel, holder_name, handle_masked, updated_at, verified_account_id")
    .eq("tutor_id", tutorId);
  return { data: (data ?? []) as unknown[], error };
}
