import Link from "next/link";

import { getUserTimezone, requireRole } from "@/lib/auth/server";
import {
  listReports,
  listSuspendedUsers,
  reportParties,
} from "@/lib/admin/reports";
import { esperaDesde } from "../tiempo";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";
import { ReportActions } from "./report-actions";

export const metadata = { title: "Reportes · Enséñame Ya" };

/**
 * EY-189 · B5.6 — la bandeja de moderación.
 *
 * ⚠️ ESTA PANTALLA ES LO ÚNICO QUE FALTABA DE LA FICHA POR ESTE LADO. La tabla
 * `conversation_reports`, sus columnas de triaje, su índice de pendientes, su
 * RLS de admin, la RPC de escritura y la palanca `set_conversation_blocked`
 * existen desde M-12 (`20260817210000` §13) y llevaban desde entonces sin un
 * solo llamante: `grep -rn "conversation_reports" src/` solo acertaba en los
 * tipos generados. Los reportes se llevaban guardando bien y no los leía nadie.
 *
 * De dónde salen los datos: `lib/admin/reports.ts`, y por RPC en vez de por
 * `select` porque el admin NO puede leer `conversations` — decisión explícita
 * de M-12, no un descuido. El razonamiento largo vive en la migración.
 */
export default async function AdminReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ atendidos?: string }>;
}) {
  await requireRole("admin");
  const { atendidos } = await searchParams;
  const verTodos = atendidos === "1";

  // Los suspendidos se piden UNA vez para toda la pantalla, no por reporte:
  // la cola llega a 500 casos y consultarlo caso a caso serían mil viajes.
  const [tz, cola, suspendidos] = await Promise.all([
    getUserTimezone(),
    listReports(!verTodos),
    listSuspendedUsers(),
  ]);
  const { rows, error: errorCola } = cola;

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString("es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz, // regla de oro 4: UTC en la BD, hora local al mirarla
    });

  const pendientes = rows.filter((r) => !r.handledAt).length;

  return (
    <AdminShell
      title="Reportes de conducta"
      description="Lo que un alumno o un tutor ha denunciado de su propia conversación. Bloquear corta el envío para los dos; nunca borra el hilo."
    >
      {/* El aviso que evita la pregunta obvia («¿y por qué no veo el chat?»).
          No es una limitación técnica: es la decisión de M-12 de que el chat no
          se lee por soporte, y de que el reporte es lo que da acceso. */}
      <PanelCard>
        <p className="text-[13px] text-[#6b6b6b]">
          Solo se puede leer la conversación de un hilo <strong>reportado</strong>,
          y solo desde su ficha. Es a propósito: el acceso al chat no viene del
          rol de administrador, viene de que un participante haya pedido que se
          mire.
        </p>
      </PanelCard>

      {/* ⚠️ El fallo se dice, no se disfraza de cola vacía. Hasta hoy
          `listReports` se comía el error y esta pantalla contestaba «Nada
          pendiente de moderar 🎉» tanto si no había trabajo como si la RPC se
          había caído — y las dos cosas se ven idénticas (regla de oro 10). Un
          admin que lee el 🎉 cierra la pestaña; uno que lee esto, avisa. */}
      {errorCola ? (
        <PanelCard className="border-[#e8b4b4] bg-[#fdf2f2]">
          <p className="text-[13px] font-semibold text-[#bf3333]">
            No se pudo leer la cola de reportes.
          </p>
          <p className="mt-1 text-[13px] text-[#8a3a3a]">
            Lo que devolvió la base de datos: {errorCola}. Puede haber reportes
            esperando que esta pantalla no está enseñando, así que{" "}
            <strong>no la des por vacía</strong>.
          </p>
        </PanelCard>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-[#6b6b6b]">
          {errorCola ? (
            "La cola no se pudo leer (ver arriba)."
          ) : verTodos ? (
            <>
              Viendo la cola completa.{" "}
              <Link
                href="/admin/reportes"
                className="font-semibold text-brand hover:underline"
              >
                Ver solo los pendientes
              </Link>
            </>
          ) : (
            <>
              {pendientes === 0
                ? "Ningún reporte pendiente."
                : `${pendientes} ${pendientes === 1 ? "reporte pendiente" : "reportes pendientes"}.`}{" "}
              <Link
                href="/admin/reportes?atendidos=1"
                className="font-semibold text-brand hover:underline"
              >
                Ver también los atendidos
              </Link>
            </>
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        // El 🎉 solo se gana cuando la consulta ha ido bien. Con `errorCola`
        // puesto ya se ha dicho arriba lo que pasa y aquí no se añade nada:
        // felicitar por una cola que no se ha podido leer es el bug de antes.
        errorCola ? null : (
          <PanelCard>
            <p className="text-[13px] text-[#6b6b6b]">
              {verTodos
                ? "Todavía no hay ningún reporte."
                : "Nada pendiente de moderar. 🎉"}
            </p>
          </PanelCard>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            // Tutor y alumno por PAPEL, no por quién denunció: «desactivar
            // tutor» apunta al tutor lo levante la mano quien la levante.
            const partes = reportParties(r, suspendidos);
            const estado: { label: string; tone: PillTone } = r.blockedAt
              ? { label: "Bloqueado", tone: "red" }
              : r.handledAt
                ? { label: "Atendido", tone: "neutral" }
                : { label: "Pendiente", tone: "amber" };

            return (
              <PanelCard key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
                      <p className="text-[13.5px] font-semibold text-[#19191f]">
                        {r.reporterName ?? "Alguien"}{" "}
                        <span className="font-normal text-[#6b6b6b]">
                          ({r.reporterIsTutor ? "tutor" : "alumno"}) reporta a
                        </span>{" "}
                        {r.reportedName ?? "la otra parte"}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-[#6b6b6b]">
                      {/* La antigüedad es el dato que duele en una cola; la
                          fecha absoluta es la que sirve para conciliar. Las dos,
                          igual que en las otras dos colas del panel. */}
                      {esperaDesde(r.createdAt)} · {fecha(r.createdAt)} ·{" "}
                      {r.messageCount}{" "}
                      {r.messageCount === 1 ? "mensaje" : "mensajes"} ·{" "}
                      {r.pairBought ? "con compra" : "sin compra"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      asChild
                      variant="outline"
                      className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                    >
                      <Link href={`/admin/reportes/${r.id}`}>Ver el hilo</Link>
                    </Button>
                    <ReportActions
                      reportId={r.id}
                      conversationId={r.conversationId}
                      handled={Boolean(r.handledAt)}
                      blocked={Boolean(r.blockedAt)}
                      tutor={partes.tutor}
                      alumno={partes.alumno}
                    />
                  </div>
                </div>

                {/* El motivo, tal cual lo escribió quien reporta. Texto libre:
                    la taxonomía cerrada de la ficha sería columna nueva y
                    decisión de producto sin respuesta (ver la migración).

                    ⚠️ Y por eso mismo se recorta AQUÍ. `report_conversation`
                    guarda hasta 2000 caracteres, así que un solo desahogo largo
                    empujaba los demás casos fuera de la pantalla y convertía una
                    cola de trabajo en un muro de texto. Se enseñan cuatro líneas
                    —las que hacen falta para saber de qué va— y el texto entero
                    vive en la ficha, que es donde se lee para decidir. Recortar
                    es de pintado: el `reason` no se toca ni se puede tocar (el
                    grant de M-12 es por columnas). */}
                <p className="mt-3 line-clamp-4 rounded-md bg-[#f7f7f7] p-3 text-[13px] whitespace-pre-wrap text-[#333333]">
                  {r.reason}
                </p>
                {r.reason.length > 280 ? (
                  <p className="mt-1 text-xs text-[#6b6b6b]">
                    Motivo recortado ({r.reason.length} caracteres).{" "}
                    <Link
                      href={`/admin/reportes/${r.id}`}
                      className="font-semibold text-brand hover:underline"
                    >
                      Leerlo entero
                    </Link>
                  </p>
                ) : null}

                {r.handledAt ? (
                  <p className="mt-2 text-xs text-[#6b6b6b]">
                    Atendido {fecha(r.handledAt)}
                    {r.handledByName ? ` por ${r.handledByName}` : ""}.
                  </p>
                ) : null}
                {r.blockedAt ? (
                  <p className="mt-2 text-xs text-[#6b6b6b]">
                    Chat bloqueado {fecha(r.blockedAt)}
                    {r.blockedReason ? ` · ${r.blockedReason}` : ""}.
                  </p>
                ) : null}
              </PanelCard>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
