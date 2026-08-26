import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asRpc } from "@/components/chat/rpc";

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
 * ⚠️ PUERTA TEMPORAL DE TIPOS. `admin_conversation_reports` y
 * `admin_report_thread` no están en `database.types.ts` porque la migración
 * `20260826200000` todavía no se ha aplicado; hasta que se aplique y se corra
 * `npm run db:types`, `supabase.rpc("admin_conversation_reports")` NI COMPILA
 * (el nombre está tipado contra la unión de funciones conocidas). Se entra por
 * `asRpc`, que es la MISMA puerta única que abrió M-12 en `components/chat/
 * rpc.ts` y que su propia nota dice que sirve igual para el cliente de servidor.
 * Cuando se regeneren los tipos: quitar los dos `asRpc(...)` de este archivo y
 * las dos aserciones de forma de abajo, y llamar a `supabase.rpc(...)` a secas.
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
 * La cola. `pendientes` en `true` (el default de la RPC) deja fuera lo ya
 * cerrado, que es la vista de trabajo; con `false` sale todo, ordenado con los
 * pendientes arriba, para revisar lo atendido sin cambiar de pantalla.
 *
 * Un error NO revienta la pantalla: se devuelve lista vacía y la página dice
 * que la cola está limpia. ⚠️ Es el compromiso a mirar el día que la migración
 * esté aplicada — mientras NO lo esté, la RPC no existe y esto es exactamente
 * lo que hace que `/admin/reportes` se vea vacía en vez de en rojo.
 */
export async function listReports(pendientes = true): Promise<ReportRow[]> {
  const supabase = await createClient();
  const { data } = await asRpc(supabase).rpc("admin_conversation_reports", {
    p_pendientes: pendientes,
  });

  return ((data ?? []) as ReportRpcRow[]).map((r) => ({
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
}

/**
 * El hilo de UN reporte, en orden de conversación.
 *
 * La RPC devuelve los últimos primero (para que el `limit` recorte por el
 * principio, no por el final: lo que se denuncia acaba de pasar) y aquí se le
 * da la vuelta, que es como se lee un chat.
 */
export async function readReportThread(
  reportId: string,
): Promise<ReportMessage[]> {
  const supabase = await createClient();
  const { data } = await asRpc(supabase).rpc("admin_report_thread", {
    p_report_id: reportId,
  });

  return ((data ?? []) as ThreadRpcRow[])
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
}

/**
 * Cuántos reportes esperan. Para la fila de «colas que piden acción» del
 * dashboard, que es donde se entera el admin de que hay trabajo.
 *
 * Esta sí va por RLS pura y no por la RPC: contar filas de
 * `conversation_reports` es exactamente lo que la política de M-12 permite
 * —`reporter_id = uid or has_role('admin')`— y para un admin son todas. No hace
 * falta el contexto de la conversación para contar, así que no se paga.
 */
export async function countPendingReports(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("conversation_reports")
    .select("id", { count: "exact", head: true })
    .is("handled_at", null);
  return count ?? 0;
}
