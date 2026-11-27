import { getUserTimezone, requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/layout/admin-shell";
import { PanelCard, PanelCardTitle, StatusPill } from "@/components/layout/panel-shell";
import { esperaDesde } from "../tiempo";
import { RetirarClasificado } from "./retirar";

export const metadata = { title: "Clasificados · Enséñame Ya" };

/**
 * Clasificados · lo que pidió Néstor: qué se busca, qué se cubre y qué tutor
 * falta reclutar. Arriba el resumen por categoría (`admin_clasificados_resumen`),
 * debajo los activos y los vencidos (con o sin postulaciones) y el botón de retirar.
 *
 * El admin lee `class_requests` entera por RLS (`class_requests_select_admin`).
 * Los embeds nombran su FK aunque hoy haya un solo camino (regla de oro 10), y
 * se mira el `error` de cada consulta: una cola que falla en silencio enseña
 * una lista vacía, que es una mentira creíble.
 */
export default async function AdminClasificadosPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [resumen, lista, tz] = await Promise.all([
    supabase.rpc("admin_clasificados_resumen"),
    supabase
      .from("class_requests")
      .select(
        "id, goal, status, created_at, expires_at, needed_by, profiles!class_requests_student_id_fkey(full_name), categories!class_requests_category_id_fkey(name), class_proposals!class_proposals_request_id_fkey(tutor_id, status)",
      )
      .in("status", ["active", "expired"])
      .order("created_at", { ascending: false })
      .limit(500),
    getUserTimezone(),
  ]);
  if (resumen.error) throw resumen.error;
  if (lista.error) throw lista.error;

  const ahora = new Date();
  const fmt = new Intl.DateTimeFormat("es", { timeZone: tz, dateStyle: "medium" });
  const filas = (lista.data ?? [])
    .map((r) => {
      const vencido = r.status === "expired" || new Date(r.expires_at) <= ahora;
      // Mismo criterio que `clasificados_publicos`: tutores distintos con la
      // propuesta viva (pendiente o pagada), no retiradas ni caducadas.
      const postulaciones = new Set(
        (r.class_proposals ?? [])
          .filter((p) => p.status === "pending" || p.status === "paid")
          .map((p) => p.tutor_id),
      ).size;
      return { ...r, vencido, postulaciones };
    })
    // Vencidos solo si nadie se postuló: son la señal de «falta tutor».
    .filter((r) => !r.vencido || r.postulaciones === 0);

  const totales = (resumen.data ?? []).reduce(
    (t, c) => ({
      activos: t.activos + c.activos,
      sinPostulacion: t.sinPostulacion + c.activos_sin_postulacion,
      reservados: t.reservados + c.reservados,
    }),
    { activos: 0, sinPostulacion: 0, reservados: 0 },
  );

  return (
    <AdminShell
      title="Clasificados"
      description="Qué buscan los alumnos, qué se cubre y en qué categorías falta reclutar tutores."
    >
      <PanelCard>
        <PanelCardTitle>Demanda por categoría</PanelCardTitle>
        <p className="mt-1 text-[13px] text-[#595959]">
          {totales.activos} activos · {totales.sinPostulacion} sin ninguna postulación ·{" "}
          {totales.reservados} reservados. Ordenado por activos sin postulación: arriba, donde
          falta tutor.
        </p>
        {(resumen.data ?? []).length === 0 ? (
          <p className="mt-4 text-[14px] text-[#525252]">Todavía no se ha publicado ningún clasificado.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="text-xs text-[#6b6b6b]">
                <tr className="border-b border-[#ebebeb]">
                  <th className="py-2 pr-3 font-medium">Categoría</th>
                  <th className="px-3 py-2 text-right font-medium">Publicados</th>
                  <th className="px-3 py-2 text-right font-medium">Activos</th>
                  <th className="px-3 py-2 text-right font-medium">Activos sin postulación</th>
                  <th className="px-3 py-2 text-right font-medium">Con postulación</th>
                  <th className="px-3 py-2 text-right font-medium">Reservados</th>
                  <th className="px-3 py-2 text-right font-medium">Vencidos sin postulación</th>
                  <th className="py-2 pl-3 text-right font-medium">1.ª postulación (media)</th>
                </tr>
              </thead>
              <tbody>
                {(resumen.data ?? []).map((c) => (
                  <tr key={c.category_id} className="border-b border-[#f0f0f0] last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-[#19191f]">{c.category_name}</td>
                    <td className="px-3 py-2.5 text-right">{c.publicados}</td>
                    <td className="px-3 py-2.5 text-right">{c.activos}</td>
                    <td className="px-3 py-2.5 text-right">
                      {c.activos_sin_postulacion > 0 ? (
                        <StatusPill tone="amber">{c.activos_sin_postulacion}</StatusPill>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">{c.con_postulacion}</td>
                    <td className="px-3 py-2.5 text-right">{c.reservados}</td>
                    <td className="px-3 py-2.5 text-right">
                      {c.vencidos_sin_postulacion > 0 ? (
                        <StatusPill tone="red">{c.vencidos_sin_postulacion}</StatusPill>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      {c.horas_hasta_primera == null ? "—" : `${c.horas_hasta_primera} h`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      <PanelCard className="mt-5">
        <PanelCardTitle>Activos y vencidos</PanelCardTitle>
        {filas.length === 0 ? (
          <p className="mt-4 text-[14px] text-[#525252]">No hay clasificados activos ahora mismo.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[#f0f0f0]">
            {filas.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={r.vencido ? "red" : "green"}>
                      {r.vencido ? "Vencido" : "Activo"}
                    </StatusPill>
                    <span className="text-xs font-semibold text-[#0063c4]">
                      {r.categories?.name ?? "—"}
                    </span>
                  </div>
                  <p className="mt-1.5 font-semibold text-pretty text-[#19191f]">{r.goal}</p>
                  <p className="mt-1 text-[13px] text-[#595959]">
                    {r.profiles?.full_name ?? "Alumno sin nombre"} · publicado{" "}
                    {fmt.format(new Date(r.created_at))} ({esperaDesde(r.created_at, ahora)}) ·{" "}
                    {r.postulaciones === 1 ? "1 postulación" : `${r.postulaciones} postulaciones`}
                    {r.needed_by ? ` · para el ${r.needed_by}` : ""}
                  </p>
                </div>
                <RetirarClasificado id={r.id} goal={r.goal} />
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    </AdminShell>
  );
}
