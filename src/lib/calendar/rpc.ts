import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * ⚠️ PUERTA TEMPORAL — EY-188. BORRAR ESTE ARCHIVO tras `npm run db:types`.
 *
 * `database.types.ts` no conoce todavía las funciones de
 * `20260826210000_ey188_feed_calendario.sql`, y el nombre de una RPC está
 * tipado contra la unión de funciones conocidas: `supabase.rpc("calendar_feed")`
 * NI COMPILA hasta que se regeneren los tipos (regla de oro 6: ese archivo no
 * se toca a mano). Mismo patrón y misma intención que `components/chat/rpc.ts`
 * — un solo archivo que borrar en vez de doce `as unknown as` repartidos.
 *
 * Se declara aparte del de chat a propósito: acoplar el calendario a las
 * interioridades del chat para ahorrarse quince líneas es peor negocio que
 * tener dos puertas con una fecha de caducidad cada una.
 *
 * Cuando se regeneren los tipos: quitar los `asCalendarRpc(...)` de
 * `src/app/api/calendario/[token]/route.ts`, del panel de cuenta y de
 * `src/components/calendar/calendar-feed-card.tsx`, y borrar este archivo.
 */
type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Sirve igual para el cliente del navegador y para el de servidor. */
export function asCalendarRpc(client: SupabaseClient<Database>): RpcCaller {
  return client as unknown as RpcCaller;
}

/**
 * Un evento del feed, tal y como lo devuelve `public.calendar_feed(text)`.
 * Las fechas llegan en ISO-8601 **UTC** (regla de oro 4).
 */
export type EventoFeed = {
  session_id: string;
  start_at: string;
  end_at: string;
  created_at: string;
  updated_at: string;
  /** `confirmada` · `tentativa` (pagada, esperando al tutor) · `cancelada`. */
  estado: "confirmada" | "tentativa" | "cancelada";
  /** El `SEQUENCE` del .ics, ya calculado en SQL. */
  secuencia: number;
  titulo: string;
  /** Nombre ENMASCARADO de la otra parte («María G.»), o `null`. */
  con: string | null;
  session_ref: string | null;
  sequence_no: number | null;
  num_sessions: number;
};

/** Lo que devuelve `calendar_feed`: `null` = token desconocido o revocado. */
export type RespuestaFeed = {
  ok: true;
  /** Zona horaria del dueño; solo se usa como pista de presentación. */
  timezone: string;
  eventos: EventoFeed[];
} | null;
