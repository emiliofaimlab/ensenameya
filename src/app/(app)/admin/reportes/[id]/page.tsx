import { notFound } from "next/navigation";

import { getUserTimezone, requireRole } from "@/lib/auth/server";
import {
  listReports,
  listSuspendedUsers,
  readReportThread,
  reportParties,
} from "@/lib/admin/reports";
import { esperaDesde } from "../../tiempo";
import { cn } from "@/lib/utils";
import {
  PanelCard,
  PanelCardTitle,
  PanelRow,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { ReportActions } from "../report-actions";

export const metadata = { title: "Reporte · Enséñame Ya" };

/**
 * EY-189 · La ficha de un reporte: el caso entero, con el hilo delante.
 *
 * ⚠️ ES LA ÚNICA PANTALLA DE TODA LA APLICACIÓN QUE ENSEÑA UNA CONVERSACIÓN
 * AJENA, y el permiso no lo da el rol: lo da el reporte. `admin_report_thread`
 * se llama con el id del REPORTE, nunca con el de la conversación, así que no
 * existe forma —ni a mano, ni por descuido, ni cambiando la URL— de pedir un
 * hilo sobre el que nadie ha levantado la mano. Es el «el reporte trae el hilo
 * con consentimiento del que lo levanta» que M-12 dejó escrito el día que
 * decidió NO darle al admin política de lectura sobre `conversations`.
 *
 * Y hace falta: bloquear a alguien habiendo leído solo la versión del que
 * denuncia es sancionar sin ver el caso. La desintermediación del §21 —«págame
 * por fuera»— no se puede verificar de ninguna otra forma.
 */
export default async function AdminReporteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;

  // ⚠️ Se pide la cola COMPLETA (`false`) y se busca aquí, en vez de una RPC de
  // «un reporte». Dos razones: un reporte ya atendido tiene que poder abrirse
  // —si no, «Reabrir» sería un botón sin pantalla—, y la cola está acotada por
  // la propia función (tope de 500). El día que 500 se quede corto, esto es lo
  // primero que hay que convertir en una consulta por id.
  const [tz, rows, suspendidos] = await Promise.all([
    getUserTimezone(),
    listReports(false),
    listSuspendedUsers(),
  ]);
  const r = rows.find((x) => x.id === id);
  if (!r) notFound();

  const mensajes = await readReportThread(r.id);
  // Tutor y alumno por PAPEL, no por quién denunció (ver `reportParties`).
  const partes = reportParties(r, suspendidos);

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString("es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz, // regla de oro 4
    });

  const estado: { label: string; tone: PillTone } = r.blockedAt
    ? { label: "Bloqueado", tone: "red" }
    : r.handledAt
      ? { label: "Atendido", tone: "neutral" }
      : { label: "Pendiente", tone: "amber" };

  return (
    <AdminShell
      back={{ href: "/admin/reportes", label: "Volver a los reportes" }}
      eyebrow="Reportes / Detalle"
      title={`${r.reporterName ?? "Alguien"} reporta a ${r.reportedName ?? "la otra parte"}`}
      description={`${esperaDesde(r.createdAt)} · ${fecha(r.createdAt)}`}
      actions={
        <ReportActions
          reportId={r.id}
          conversationId={r.conversationId}
          handled={Boolean(r.handledAt)}
          blocked={Boolean(r.blockedAt)}
          tutor={partes.tutor}
          alumno={partes.alumno}
        />
      }
    >
      <PanelCard>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
          <PanelCardTitle>Motivo</PanelCardTitle>
        </div>
        <p className="mt-3 rounded-md bg-[#f7f7f7] p-3 text-[13px] whitespace-pre-wrap text-[#333333]">
          {r.reason}
        </p>
        <dl className="mt-4 flex flex-col gap-2">
          <PanelRow
            label="Quien reporta"
            value={`${r.reporterName ?? "—"} (${r.reporterIsTutor ? "tutor" : "alumno"})`}
          />
          <PanelRow
            label="Sobre"
            value={`${r.reportedName ?? "—"} (${r.reporterIsTutor ? "alumno" : "tutor"})`}
          />
          <PanelRow
            label="El par llegó a comprar"
            value={r.pairBought ? "Sí" : "No"}
          />
          {/* El estado de cuenta de cada parte. Solo se pinta cuando hay algo
              que decir: una fila que repite «activa / activa» en todos los
              reportes es ruido, y lo que importa saber de un vistazo al reabrir
              un caso es a quién ya se sancionó. */}
          {partes.tutor.suspended || partes.alumno.suspended ? (
            <PanelRow
              label="Cuentas desactivadas"
              value={[
                partes.tutor.suspended
                  ? `${partes.tutor.name ?? "el tutor"} (tutor)`
                  : null,
                partes.alumno.suspended
                  ? `${partes.alumno.name ?? "el estudiante"} (estudiante)`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ) : null}
          <PanelRow
            label="Último mensaje"
            value={r.lastMessageAt ? fecha(r.lastMessageAt) : "—"}
          />
          {r.handledAt ? (
            <PanelRow
              label="Atendido"
              value={`${fecha(r.handledAt)}${r.handledByName ? ` · ${r.handledByName}` : ""}`}
            />
          ) : null}
          {r.blockedAt ? (
            <PanelRow
              label="Chat bloqueado"
              value={`${fecha(r.blockedAt)}${r.blockedReason ? ` · ${r.blockedReason}` : ""}`}
            />
          ) : null}
        </dl>

        {/* ⚠️ El aviso de la purga, y no es decorativo. `purge_expired_messages`
            borra a los 30 días la conversación ENTERA de un par que nunca
            compró, y el `cascade` se llevaría el reporte con ella. Desde
            `20260826200000` un reporte SIN ATENDER frena esa purga — pero al
            cerrarlo, el reloj de los 30 días vuelve a correr. O sea: cerrar
            esto es también decidir que el hilo puede caducar. */}
        {!r.pairBought ? (
          <p className="mt-4 rounded-md border border-[#f0c987] bg-[#fdf6e7] p-3 text-[13px] text-[#8a5a12]">
            Este par no llegó a comprar, así que su conversación caduca a los 30
            días sin actividad. Mientras el reporte siga pendiente, la purga la
            respeta; en cuanto se marque como atendido, el hilo vuelve a poder
            borrarse.
          </p>
        ) : null}
      </PanelCard>

      <PanelCard>
        <PanelCardTitle>La conversación</PanelCardTitle>
        <p className="mt-1 text-xs text-[#6b6b6b]">
          Últimos {mensajes.length}{" "}
          {mensajes.length === 1 ? "mensaje" : "mensajes"} del hilo, en orden.
          Los adjuntos se nombran pero no se abren: el fichero vive en Storage
          con su propia RLS.
        </p>

        {mensajes.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#6b6b6b]">
            El hilo no tiene mensajes. Puede ser un reporte sobre una
            conversación recién abierta, o los mensajes ya caducaron por la
            purga de 30 días.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {mensajes.map((m) => (
              <li
                key={m.id}
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2",
                  // Quien denuncia a un lado y el denunciado al otro. Con los
                  // nombres solos no se sigue: se repiten, y el uuid no se lee.
                  m.fromReporter
                    ? "self-start bg-[#f0f0f0]"
                    : "self-end bg-[#dbedff]",
                )}
              >
                <p className="text-[11px] text-[#6b6b6b]">
                  {m.senderName ?? "—"}{" "}
                  {m.fromReporter ? "(quien reporta)" : "(reportado)"} ·{" "}
                  {fecha(m.createdAt)}
                </p>
                <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-[#19191f]">
                  {m.body}
                </p>
                {m.attachmentName ? (
                  <p className="mt-1 text-[11px] text-[#6b6b6b]">
                    📎 {m.attachmentName}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    </AdminShell>
  );
}
