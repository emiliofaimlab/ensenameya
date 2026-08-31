import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

/**
 * EY-189 · La cola de moderación del panel de admin (B5.6).
 *
 * Mismo criterio que `lib/admin/queries.ts`: todo pasa por RLS con la sesión
 * del admin y el `service_role` no aparece. La diferencia es que aquí la RLS no
 * basta y la barrera se llama distinto.
 *
 * ── POR QUÉ NO SE CONSULTAN LAS TABLAS DIRECTAMENTE ─────────────────────────
 * `conversation_reports` sí es legible por el admin (`conversation_reports_
 * select`, M-12), pero `conversations` NO lo es **a propósito**: M-12 decidió
 * que el chat no se lee «por soporte», y por eso no le puso política de admin.
 * Consecuencia práctica: un `select` sobre la tabla de reportes devuelve un
 * `conversation_id` y nada más — ni contra quién va el reporte, ni si el hilo
 * ya está bloqueado. Un caso sin la otra parte no se puede triar.
 *
 * De ahí las dos funciones SECURITY DEFINER de `20260826200000`, que exigen ser
 * admin **y** que el reporte exista. Ver la migración: el razonamiento largo
 * está allí, que es donde vive la barrera.
 *
 * Las dos RPC (`admin_conversation_reports` y `admin_report_thread`) son
 * SECURITY DEFINER y comprueban el rol admin por dentro, así que desde aquí se
 * llaman a secas: la barrera no es este fichero.
 *
 * ⚠️ Y no son un capricho: el admin NO puede leer `conversations` por política
 * —M-12 lo dejó así a propósito (`20260817210000:150-154`): el chat no se lee
 * «por soporte», para eso está el reporte, que trae el hilo con consentimiento
 * de quien lo levanta—. De ahí que `admin_report_thread` se pida con el id del
 * REPORTE y nunca con el de la conversación: sin denuncia no hay hilo que ver.
 */

/** Fila de `admin_conversation_reports()`. Espejo de su `returns table`. */
export type ReportRow = {
  id: string;
  conversationId: string;
  reason: string;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
  handledByName: string | null;
  reporterId: string;
  reporterName: string | null;
  reportedId: string;
  reportedName: string | null;
  reporterIsTutor: boolean;
  blockedAt: string | null;
  blockedReason: string | null;
  pairBought: boolean;
  messageCount: number;
  lastMessageAt: string | null;
};

/** Fila de `admin_report_thread()`. */
export type ReportMessage = {
  id: string;
  senderId: string;
  senderName: string | null;
  body: string;
  createdAt: string;
  attachmentName: string | null;
  fromReporter: boolean;
};

/** ⚠️ Puerta temporal: la forma que devuelve la RPC, en snake_case. */
type ReportRpcRow = {
  id: string;
  conversation_id: string;
  reason: string;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
  handled_by_name: string | null;
  reporter_id: string;
  reporter_name: string | null;
  reported_id: string;
  reported_name: string | null;
  reporter_is_tutor: boolean;
  blocked_at: string | null;
  blocked_reason: string | null;
  pair_bought: boolean;
  message_count: number;
  last_message_at: string | null;
};

/** ⚠️ Puerta temporal: ídem para el hilo. */
type ThreadRpcRow = {
  id: string;
  sender_id: string;
  sender_name: string | null;
  body: string;
  created_at: string;
  attachment_name: string | null;
  from_reporter: boolean;
};

/**
 * ⚠️ El tope de la cola, y no es un número decorativo.
 *
 * `admin_conversation_reports` acepta `p_limit` con **default 100** y lo recorta
 * a 500 como máximo. Aquí se pide el máximo a propósito porque la ficha de un
 * reporte (`/admin/reportes/[id]`) no tiene consulta por id: pide la cola entera
 * y busca dentro. Con el default de 100, el reporte 101 daba un 404 en una
 * pantalla que existe — un fallo que no aparece hasta que la cola crece, y que
 * entonces parece un reporte «borrado». El día que 500 se quede corto, la salida
 * no es subir esto (la función no deja): es una RPC de «un reporte».
 */
const TOPE_COLA = 500;

/**
 * La cola. `pendientes` en `true` (el default de la RPC) deja fuera lo ya
 * cerrado, que es la vista de trabajo; con `false` sale todo, ordenado con los
 * pendientes arriba, para revisar lo atendido sin cambiar de pantalla.
 *
 * ⚠️ DEVUELVE EL `error`, Y ESA ES LA PARTE IMPORTANTE. Antes hacía
 * `const { data } = …` y se comía el fallo: una RPC rota y una cola limpia se
 * veían EXACTAMENTE igual —«Nada pendiente de moderar 🎉»—, que es la mentira
 * más creíble que sabe contar esta pantalla. Es el mismo tropiezo que dejó los
 * tres chips del admin a «(0)» con once tutores esperando (regla de oro 10).
 * Quien pinta la cola decide qué hacer con el error, pero ya no puede ignorarlo
 * sin verlo.
 */
export async function listReports(
  pendientes = true,
): Promise<{ rows: ReportRow[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_conversation_reports", {
    p_pendientes: pendientes,
    p_limit: TOPE_COLA,
  });

  if (error) return { rows: [], error: error.message };

  const rows = ((data ?? []) as ReportRpcRow[]).map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    reason: r.reason,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    handledBy: r.handled_by,
    handledByName: r.handled_by_name,
    reporterId: r.reporter_id,
    reporterName: r.reporter_name,
    reportedId: r.reported_id,
    reportedName: r.reported_name,
    reporterIsTutor: r.reporter_is_tutor,
    blockedAt: r.blocked_at,
    blockedReason: r.blocked_reason,
    pairBought: r.pair_bought,
    messageCount: r.message_count,
    lastMessageAt: r.last_message_at,
  }));

  return { rows, error: null };
}

/**
 * El hilo de UN reporte, en orden de conversación.
 *
 * La RPC devuelve los últimos primero (para que el `limit` recorte por el
 * principio, no por el final: lo que se denuncia acaba de pasar) y aquí se le
 * da la vuelta, que es como se lee un chat.
 *
 * ⚠️ También devuelve el `error`, y aquí duele todavía más que en la cola: un
 * hilo vacío es un caso REAL —purga de 30 días, conversación recién abierta— y
 * la ficha ya tiene un texto que lo explica. Sin el error, un fallo de la RPC
 * se disfrazaba de ese caso legítimo y el admin cerraba el reporte creyendo que
 * no había nada que leer.
 */
export async function readReportThread(
  reportId: string,
): Promise<{ mensajes: ReportMessage[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_report_thread", {
    p_report_id: reportId,
  });

  if (error) return { mensajes: [], error: error.message };

  const mensajes = ((data ?? []) as ThreadRpcRow[])
    .map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      body: m.body,
      createdAt: m.created_at,
      attachmentName: m.attachment_name,
      fromReporter: m.from_reporter,
    }))
    .reverse();

  return { mensajes, error: null };
}

/**
 * Las dos personas del reporte, repartidas por PAPEL y no por quién denunció.
 *
 * La RPC devuelve «quien reporta» y «reportado» más un `reporterIsTutor`, que
 * es lo que hace falta para leer el caso. Pero las acciones sobre las personas
 * no van de eso: «desactivar tutor» tiene que apuntar al tutor tanto si es el
 * que se queja como si es el señalado. Aquí se hace esa traducción, una sola
 * vez, para que ninguna pantalla la repita al revés.
 *
 * ⚠️ El tipo se deja INFERIR a propósito, sin importar `ReportParty` de
 * `report-actions.tsx`: ese fichero es `"use client"` y este es `server-only`.
 * Encajan por estructura, que es lo único que TypeScript necesita.
 */
export function reportParties(r: ReportRow, suspendidos: Set<string>) {
  const tutorId = r.reporterIsTutor ? r.reporterId : r.reportedId;
  const tutorName = r.reporterIsTutor ? r.reporterName : r.reportedName;
  const alumnoId = r.reporterIsTutor ? r.reportedId : r.reporterId;
  const alumnoName = r.reporterIsTutor ? r.reportedName : r.reporterName;

  return {
    tutor: {
      id: tutorId,
      name: tutorName,
      suspended: suspendidos.has(tutorId),
    },
    alumno: {
      id: alumnoId,
      name: alumnoName,
      suspended: suspendidos.has(alumnoId),
    },
  };
}

/**
 * Quién está DESACTIVADO ahora mismo (EY-189, 2ª tanda).
 *
 * Esta sí va por RLS pura y no por RPC, igual que el contador de abajo:
 * `account_suspensions_select_admin` deja al admin leer la tabla entera, y aquí
 * no hace falta ningún contexto que la política no dé. `lifted_at is null` es
 * el criterio de «suspendida ahora», el mismo del índice parcial.
 *
 * Se pide de una vez para TODA la pantalla y no reporte a reporte: la bandeja
 * lista hasta 500 casos y una consulta por parte serían mil viajes. La tabla
 * solo tiene una fila por cuenta sancionada alguna vez, así que traerla entera
 * es más barato que filtrar por ids.
 */
export async function listSuspendedUsers(): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("account_suspensions")
    .select("user_id")
    .is("lifted_at", null);
  return new Set((data ?? []).map((r) => r.user_id));
}

/**
 * Cuántos reportes esperan. Para la fila de «colas que piden acción» del
 * dashboard, que es donde se entera el admin de que hay trabajo.
 *
 * Esta sí va por RLS pura y no por la RPC: contar filas de
 * `conversation_reports` es exactamente lo que la política de M-12 permite
 * —`reporter_id = uid or has_role('admin')`— y para un admin son todas. No hace
 * falta el contexto de la conversación para contar, así que no se paga.
 *
 * ⚠️ Devuelve `null` —no `0`— cuando la consulta falla. El dashboard pinta «→»
 * con el `null` y el número con el número: un cero cantado es una promesa («no
 * hay trabajo») que esta función no está en condiciones de hacer si la consulta
 * se cayó. Regla de oro 10, en la superficie donde más se nota: el contador es
 * lo ÚNICO que le dice al admin que la bandeja tiene algo dentro.
 */
export async function countPendingReports(): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("conversation_reports")
    .select("id", { count: "exact", head: true })
    .is("handled_at", null);
  if (error) return null;
  return count ?? 0;
}

/** Una clase del par denunciado, tal como la ficha del reporte la enseña. */
export type ReportSession = {
  id: string;
  bookingId: string;
  status: Database["public"]["Enums"]["session_status"];
  startAt: string;
  endAt: string;
  /**
   * ¿Alguien llegó a abrir la sala? `daily_room_name` lo escribe `join_session`
   * en el primer join, así que `false` significa literalmente «nadie entró» —y
   * por tanto no hay ni llamada ni grabación que buscar—. Se devuelve como
   * booleano y no como el nombre: el id de sala de Daily no pinta nada en el
   * navegador y no hay razón para publicarlo.
   */
  hasRoom: boolean;
  /** RN-42: cuándo se borró la grabación en el proveedor. */
  recordingsPurgedAt: string | null;
};

/**
 * EY-189 · Las clases del par denunciado. Es lo que convierte un reporte de
 * conducta en algo que se puede comprobar.
 *
 * ── POR QUÉ SE PIDE POR PAR Y NO POR REPORTE ────────────────────────────────
 * Porque `conversation_reports` NO tiene `session_id` ni `booking_id`: se
 * reporta el HILO del par, no una clase (la migración de M-12 lo deja escrito, y
 * atarlo a una clase concreta es columna nueva y otra ficha). Lo que sí se sabe
 * del reporte son las dos personas, y con eso `sessions` ya responde: es la
 * misma pareja de columnas (`student_id`, `tutor_id`) que la conversación.
 *
 * ── Y POR QUÉ ESTA SÍ VA POR RLS, SIN RPC NUEVA ─────────────────────────────
 * Porque `sessions_select_admin` existe desde EP-06 (`20260709140000:153-155`)
 * y el grant a `authenticated` también. Es la diferencia exacta con
 * `conversations`, que NO tiene política de admin a propósito: el chat no se
 * lee «por soporte», pero la agenda del par sí es dato de administración —ya se
 * ve entera en /admin/bookings y en /admin/reservas—. O sea: esta pantalla no
 * abre nada nuevo, solo deja de obligar al admin a buscarlo a mano.
 *
 * ⚠️ Sin un solo embed de PostgREST, y es deliberado (regla de oro 10):
 * `sessions` cuelga de `bookings` y de `profiles` por varios caminos, y un
 * `.select("…, bookings(…)")` es justo la forma que se cae con `PGRST201` el día
 * que aparezca otra tabla puente. El título de la reserva se mira en su ficha,
 * que es a donde lleva el enlace.
 */
export async function listPairSessions(
  studentId: string,
  tutorId: string,
): Promise<{ sesiones: ReportSession[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("id, booking_id, status, start_at, end_at, daily_room_name, recordings_purged_at")
    .eq("student_id", studentId)
    .eq("tutor_id", tutorId)
    // Lo último primero: lo que se denuncia acaba de pasar, igual que en el hilo.
    .order("start_at", { ascending: false })
    .limit(50);

  if (error) return { sesiones: [], error: error.message };

  return {
    sesiones: (data ?? []).map((s) => ({
      id: s.id,
      bookingId: s.booking_id,
      status: s.status,
      startAt: s.start_at,
      endAt: s.end_at,
      hasRoom: Boolean(s.daily_room_name),
      recordingsPurgedAt: s.recordings_purged_at,
    })),
    error: null,
  };
}
