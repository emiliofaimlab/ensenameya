import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

/**
 * RV-04b · lecturas de la cola de notificaciones (SCR-AD16).
 *
 * NO HACE FALTA MIGRACIÓN, y conviene decirlo antes de que a alguien le entren
 * ganas de escribir una: `notifications` ya trae desde `20260716170000` la
 * política `notifications_select_admin` (`using ( public.has_role('admin') )`)
 * y el `grant select on public.notifications to authenticated`. Con la sesión
 * del admin se ve la tabla entera; no hay ni una línea de SQL que añadir.
 *
 * Y NO se usa `service_role` para leerla. El admin ya la ve por RLS, así que la
 * clave que se salta la RLS no traería ni una fila de más: solo metería el
 * salto de la RLS en un camino que dispara una persona, que es exactamente lo
 * que `lib/supabase/admin.ts` dice que no se haga (regla de oro 3 → RISK-13).
 *
 * ⚠️ LO QUE ESTA PANTALLA NO PUEDE ENSEÑAR, Y POR QUÉ:
 *
 *  · **el correo del destinatario**. No está en esta tabla ni en `profiles`:
 *    vive en `auth.users`, que la Data API no expone a propósito. El único que
 *    lo resuelve es el job, y lo hace por `pending_email_notifications()`
 *    (SECURITY DEFINER, `grant execute` solo a `service_role`, ver
 *    `20260806150000`). Aquí se enseña el nombre del perfil. Si algún día hace
 *    falta la dirección para depurar un rebote, se pide por una RPC nueva y
 *    acotada, no abriendo `auth`.
 *
 *  · **el `payload`**. Es texto libre que escriben los triggers y a veces trae
 *    cosas que no pintan en un listado — `tutor_review_result` lleva dentro las
 *    `notes` con las que el admin rechazó a un tutor. La cola se supervisa con
 *    tipo, plantilla, canal y estado; el detalle está en la entidad de origen.
 */

export type NotificationStatus =
  Database["public"]["Enums"]["notification_status"];

/** Los tres estados reales del enum (`20260716170000`). */
const STATUSES: NotificationStatus[] = ["pending", "sent", "failed"];

/**
 * `channel` es `text` en la tabla, no un enum, así que no hay nada que Postgres
 * valide por nosotros: la lista sale de lo que escriben los triggers del Doc 7.
 */
export const CHANNELS = ["email", "in_app"] as const;
export type NotificationChannel = (typeof CHANNELS)[number];

/**
 * Los filtros llegan de la query string, o sea texto que escribe quien quiera
 * (`?status=loquesea`). Mismo criterio que `lib/admin/queries.ts`: lo que no
 * encaje **se ignora** en vez de romper la pantalla. Con el estado además sería
 * un `invalid input value for enum` de Postgres, no un listado vacío.
 */
function asStatus(v?: string): NotificationStatus | undefined {
  return STATUSES.find((s) => s === v);
}
function asChannel(v?: string): NotificationChannel | undefined {
  return CHANNELS.find((c) => c === v);
}

const PAGE_SIZE = 25;

export type NotificationListRow = {
  id: string;
  type: string;
  channel: string;
  template: string;
  status: NotificationStatus;
  createdAt: string;
  sentAt: string | null;
  recipientId: string;
  /** `profiles.full_name`. NUNCA el correo — ver la cabecera del módulo. */
  recipientName: string;
};

export type NotificationFilters = {
  status?: string;
  channel?: string;
  orden?: string;
  page?: number;
};

export async function listNotifications(f: NotificationFilters): Promise<{
  rows: NotificationListRow[];
  hasMore: boolean;
  count: number;
}> {
  const supabase = await createClient();
  const page = Math.max(1, f.page ?? 1);
  const fromIdx = (page - 1) * PAGE_SIZE;

  // "Más antiguas primero" no es un capricho de orden: es el orden EXACTO en
  // que el job vacía la cola (`pending_email_notifications` ordena por
  // `created_at` "para que nadie se quede atrás"). Con ese orden, lo primero de
  // la lista es lo próximo que va a salir.
  const asc = f.orden === "antiguas";

  let q = supabase
    .from("notifications")
    .select(
      "id, type, channel, template, status, created_at, sent_at, recipient_id, profiles(full_name)",
      { count: "exact" },
    );

  const status = asStatus(f.status);
  const channel = asChannel(f.channel);
  if (status) q = q.eq("status", status);
  if (channel) q = q.eq("channel", channel);

  const { data, count } = await q
    .order("created_at", { ascending: asc })
    // Uno de más: así se sabe si hay página siguiente sin una segunda consulta.
    .range(fromIdx, fromIdx + PAGE_SIZE);

  const rows = data ?? [];

  return {
    rows: rows.slice(0, PAGE_SIZE).map((n) => ({
      id: n.id,
      type: n.type,
      channel: n.channel,
      template: n.template,
      status: n.status,
      createdAt: n.created_at,
      sentAt: n.sent_at,
      recipientId: n.recipient_id,
      recipientName: n.profiles?.full_name?.trim() || "Sin nombre",
    })),
    hasMore: rows.length > PAGE_SIZE,
    count: count ?? 0,
  };
}

export type NotificationsSummary = {
  pendingEmail: number;
  pendingInApp: number;
  failed: number;
  sent: number;
  /** `created_at` de la pendiente más vieja, o `null` si la cola está limpia. */
  oldestPendingAt: string | null;
};

/**
 * El mismo resumen que devuelve `process_notifications()` desde
 * `20260806150000`: pendientes de correo, pendientes in-app, fallidas y la más
 * antigua. Se recalcula aquí en vez de llamar a la RPC, por dos motivos:
 *
 *  1. esa función solo la puede ejecutar `service_role` (su `grant` es
 *     explícito y los `revoke` de `public`/`anon`/`authenticated` también), así
 *     que llamarla obligaría a meter la clave que se salta la RLS en el render
 *     de una pantalla. Estos cuatro números salen de la misma tabla que el
 *     admin ya ve por política;
 *
 *  2. ⚠️ y sobre todo por lo que esa función ERA. Hasta `20260806150000`,
 *     `process_notifications()` no informaba: marcaba TODA la cola como `sent`
 *     sin enviar nada. Una pantalla que la invocara en cada visita habría
 *     vaciado la cola de correos de la plataforma al abrirla, en silencio y
 *     sin dejar rastro. Hoy solo lee, pero es un `create or replace` de
 *     distancia volver atrás, y una pantalla de supervisión no debería tener
 *     dentro una llamada capaz de eso.
 *
 * Si algún día cambian los números de la RPC, hay que cambiarlos también aquí:
 * es el precio de no llamarla, y se paga a gusto.
 */
export async function notificationsSummary(): Promise<NotificationsSummary> {
  const supabase = await createClient();

  const contar = (status: NotificationStatus, channel?: NotificationChannel) => {
    let q = supabase
      .from("notifications")
      // `head: true` → solo la cabecera con el total, sin traer ni una fila.
      // Esta es la tabla que más crece del proyecto: una notificación por
      // evento y por persona, para siempre.
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (channel) q = q.eq("channel", channel);
    return q;
  };

  const [pendEmail, pendInApp, failed, sent, oldest] = await Promise.all([
    contar("pending", "email"),
    contar("pending", "in_app"),
    contar("failed"),
    contar("sent"),
    supabase
      .from("notifications")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1),
  ]);

  return {
    pendingEmail: pendEmail.count ?? 0,
    pendingInApp: pendInApp.count ?? 0,
    failed: failed.count ?? 0,
    sent: sent.count ?? 0,
    oldestPendingAt: oldest.data?.[0]?.created_at ?? null,
  };
}
