import Link from "next/link";

import { getUserTimezone, requireRole } from "@/lib/auth/server";
import { isEmailConfigured } from "@/lib/email";
import { cn } from "@/lib/utils";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Pager } from "@/components/catalog/pager";
import { AdminFilters } from "../payments/filters";
import { esperaDesde } from "../tiempo";
import {
  listNotifications,
  notificationsSummary,
  type NotificationStatus,
} from "./queries";

export const metadata = { title: "Cola de notificaciones · Enséñame Ya" };

const STATUS_BADGE: Record<
  NotificationStatus,
  { label: string; tone: PillTone }
> = {
  pending: { label: "Pendiente", tone: "amber" },
  sent: { label: "Enviada", tone: "green" },
  failed: { label: "Fallida", tone: "red" },
};

const CHANNEL_LABEL: Record<string, string> = {
  email: "Correo",
  in_app: "En la app",
};

/**
 * Nombre operativo de cada plantilla (Doc 7).
 *
 * Sí, `lib/notifications.ts` tiene un mapa parecido; ese está escrito para la
 * campana del usuario y habla en segunda persona ("Tu pago se registró"). Aquí
 * hace falta el nombre del evento, no el mensaje. Es la misma razón por la que
 * el proyecto ya mantiene dos mapas separados para correo y campana.
 */
const TEMPLATE_LABEL: Record<string, string> = {
  booking_confirmed_student: "Reserva confirmada (alumno)",
  booking_new_tutor: "Reserva nueva por aceptar (tutor)",
  cancellation: "Cancelación",
  review_request: "Petición de reseña",
  payment_receipt: "Recibo de pago",
  refund_processed: "Reembolso procesado",
  payment_failed: "Pago fallido",
  tutor_review_result: "Resultado de la solicitud de tutor",
  identity_in_review: "Documentos en revisión",
  payout_paid: "Liquidación pagada",
  payout_issue: "Incidencia en la liquidación",
  recording_ready: "Grabación disponible",
};

const STATUS_OPTIONS = [
  { value: "pending", label: "Pendientes" },
  { value: "sent", label: "Enviadas" },
  { value: "failed", label: "Fallidas" },
];

const CHANNEL_OPTIONS = [
  { value: "email", label: "Correo" },
  { value: "in_app", label: "En la app" },
];

/**
 * RV-04b · SCR-AD16 — la cola de notificaciones, visible desde la aplicación.
 *
 * POR QUÉ EXISTE ESTA PANTALLA. La cola solo se podía mirar por SQL, y es la
 * única señal de que el correo transaccional funciona: `process_notifications()`
 * dejó de enviar en `20260806150000` y quien envía ahora es
 * `/api/cron/notifications-send`, que dispara GitHub Actions cada 5 minutos y
 * que **falla cerrado (503) mientras le falten `APP_BASE_URL` y `CRON_SECRET`**.
 * El síntoma de eso no es un error en ningún sitio: es este número subiendo. El
 * día que se escribió esta pantalla había 126 correos esperando y nadie en la
 * plataforma tenía forma de verlo.
 *
 * Es SOLO LECTURA a propósito. Ver ⚠️ al final del archivo sobre "reintentar".
 */
export default async function AdminNotificacionesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    channel?: string;
    orden?: string;
    page?: string;
  }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [tz, { rows, hasMore, count }, resumen] = await Promise.all([
    getUserTimezone(),
    listNotifications({ ...sp, page }),
    notificationsSummary(),
  ]);

  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") p.set(k, v);
    if (n > 1) p.set("page", String(n));
    const q = p.toString();
    return q ? `/admin/notificaciones?${q}` : "/admin/notificaciones";
  };

  const ordenHref = (orden: "recientes" | "antiguas") => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp))
      if (v && k !== "page" && k !== "orden") p.set(k, v);
    if (orden === "antiguas") p.set("orden", "antiguas");
    const q = p.toString();
    return q ? `/admin/notificaciones?${q}` : "/admin/notificaciones";
  };
  const antiguasPrimero = sp.orden === "antiguas";

  const pendientes = resumen.pendingEmail + resumen.pendingInApp;
  const fecha = (iso: string) =>
    new Date(iso).toLocaleString("es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz, // regla de oro 4: UTC en la BD, hora local al mirarla
    });

  return (
    <AdminShell
      title="Cola de notificaciones"
      description="Lo que la plataforma tiene encolado para enviar, y lo que ya salió (EP-12 · Doc 7)."
    >
      {/* El diagnóstico que de verdad se busca al abrir esta pantalla: si la
          cola no baja, casi siempre es que el remitente no está enchufado. La
          clave no se enseña, solo si está puesta o no. */}
      {!isEmailConfigured() && resumen.pendingEmail > 0 ? (
        <PanelCard className="border-[#f0c987] bg-[#fdf6e7]">
          <p className="text-[13px] font-semibold text-[#8a5a12]">
            No hay proveedor de correo configurado en este entorno.
          </p>
          <p className="mt-1 text-[13px] text-[#8a5a12]">
            Sin <code className="font-mono text-xs">RESEND_API_KEY</code>, el job{" "}
            <code className="font-mono text-xs">/api/cron/notifications-send</code>{" "}
            no toca la cola: los {resumen.pendingEmail} correos siguen{" "}
            <strong>pendientes</strong>, nunca fallidos, y saldrán todos en la
            primera pasada en cuanto se ponga la clave. Nadie ha recibido nada
            todavía.
          </p>
        </PanelCard>
      ) : null}

      {/* Los cuatro números de `process_notifications()`, recalculados aquí
          (ver el porqué en queries.ts). */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Pendientes de correo"
          value={String(resumen.pendingEmail)}
          alerta={resumen.pendingEmail > 0}
        />
        <Stat
          label="Pendientes en la app"
          value={String(resumen.pendingInApp)}
        />
        <Stat
          label="Fallidas"
          value={String(resumen.failed)}
          alerta={resumen.failed > 0}
        />
        <Stat label="Enviadas" value={String(resumen.sent)} />
      </div>

      <p className="text-[13px] text-[#6b6b6b]">
        {resumen.oldestPendingAt ? (
          <>
            La más antigua en cola entró {esperaDesde(resumen.oldestPendingAt)} (
            {fecha(resumen.oldestPendingAt)}). Con el remitente en marcha, la
            cola se vacía cada 5 minutos: lo que lleve más tiempo ahí es un
            envío que no está ocurriendo.
          </>
        ) : (
          <>La cola está vacía: no hay nada esperando a salir. 🎉</>
        )}
      </p>

      <AdminFilters
        basePath="/admin/notificaciones"
        fields={[
          {
            name: "status",
            label: "Estado",
            type: "select",
            options: STATUS_OPTIONS,
          },
          {
            name: "channel",
            label: "Canal",
            type: "select",
            options: CHANNEL_OPTIONS,
          },
        ]}
      />

      {/* El orden va en chips y no en el desplegable de arriba porque
          `AdminFilters` pinta "Todos" como opción vacía, y en un orden eso no
          significa nada. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[#6b6b6b]">Orden:</span>
        <OrdenChip href={ordenHref("recientes")} on={!antiguasPrimero}>
          Más recientes primero
        </OrdenChip>
        <OrdenChip href={ordenHref("antiguas")} on={antiguasPrimero}>
          Más antiguas primero
        </OrdenChip>
        {antiguasPrimero ? (
          <span className="text-xs text-[#6b6b6b]">
            (el mismo orden en que el job las va sacando)
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            No hay notificaciones con estos filtros.
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <p className="pb-1 pt-2 text-xs text-[#6b6b6b]">
            {count} {count === 1 ? "notificación" : "notificaciones"} con estos
            filtros.
          </p>
          <ul className="divide-y divide-[#e0e0e0]">
            {rows.map((n) => {
              const badge = STATUS_BADGE[n.status];
              return (
                <li
                  key={n.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 sm:w-96">
                    <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                      {TEMPLATE_LABEL[n.template] ?? n.template}
                    </p>
                    <p className="truncate text-xs text-[#6b6b6b]">
                      {n.type} · {CHANNEL_LABEL[n.channel] ?? n.channel} ·
                      creada {esperaDesde(n.createdAt)}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[11.5px] text-[#6b6b6b]">Destinatario</p>
                    {/* Nombre del perfil, NUNCA el correo: vive en `auth.users`
                        y solo lo resuelve el job por RPC (ver queries.ts). */}
                    <p className="truncate text-[13px] font-medium text-[#404040]">
                      {n.recipientName}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[11.5px] text-[#6b6b6b]">
                      {n.sentAt ? "Enviada" : "Creada"}
                    </p>
                    <p className="text-[13px] font-medium text-[#404040] tabular-nums">
                      {fecha(n.sentAt ?? n.createdAt)}
                    </p>
                  </div>

                  <StatusPill tone={badge.tone}>
                    {badge.label}
                  </StatusPill>
                </li>
              );
            })}
          </ul>
        </PanelCard>
      )}

      <Pager page={page} hasMore={hasMore} hrefFor={pageHref} />

      {/*
        ⚠️ POR QUÉ NO HAY BOTÓN DE "REINTENTAR".
        `mark_notification(id, ok)` —la única forma de mover una fila de esta
        tabla— lleva un `and status = 'pending'` en su `update`: solo transiciona
        DESDE pendiente. De 'failed' no hay camino de vuelta, ni por RPC ni por
        RLS (`authenticated` solo tiene `grant update (read_at)`). Un botón que
        pareciera reintentar y no hiciera nada sería peor que no tenerlo.
        Reabrirlo pide una RPC nueva con su `revoke ... from public` y su grant
        —queda propuesto, no es de este carril—.
      */}
      {resumen.failed > 0 ? (
        <PanelCard className="border-dashed">
          <p className="text-[13px] text-[#6b6b6b]">
            Hay {resumen.failed} {resumen.failed === 1 ? "fallida" : "fallidas"}.
            Todavía <strong>no se pueden reintentar desde aquí</strong>: la única
            función que escribe en esta tabla solo mueve filas que están
            pendientes, así que de «fallida» no hay vuelta atrás sin una RPC
            nueva. Se marcan como fallidas solo por errores permanentes
            (dirección inválida, plantilla desconocida); un mal minuto del
            proveedor las deja pendientes y se reintentan solas.
          </p>
        </PanelCard>
      ) : null}

      {pendientes > 0 ? (
        <p className="text-xs text-[#6b6b6b]">
          Nota: «pendiente» significa <em>todavía no</em>, nunca «falló». Es
          deliberado — sin proveedor configurado la cola se conserva entera en
          vez de perderse.
        </p>
      ) : null}
    </AdminShell>
  );
}

function Stat({
  label,
  value,
  alerta,
}: {
  label: string;
  value: string;
  alerta?: boolean;
}) {
  return (
    <PanelCard className="p-5">
      <p className="text-xs text-[#6b6b6b]">{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate text-2xl font-bold tabular-nums",
          alerta ? "text-[#bf3333]" : "text-[#19191f]",
        )}
      >
        {value}
      </p>
    </PanelCard>
  );
}

function OrdenChip({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? "true" : undefined}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] transition-colors",
        on
          ? "border-brand bg-brand font-semibold text-white"
          : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
      )}
    >
      {children}
    </Link>
  );
}
