/**
 * Las formas que devuelve `public.calendar_feed(text)`.
 *
 * ⚠️ Los tipos generados dan `Returns: Json` para esa función, así que la
 * forma concreta vive aquí y no en `database.types.ts`: si la migración cambia
 * el `jsonb_build_object` que construye la respuesta, ESTE archivo es el que
 * hay que actualizar a mano — el typecheck no se va a enterar.
 */
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
