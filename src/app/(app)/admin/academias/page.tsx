import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { formatMoney } from "@/lib/catalog/format";
import { leerAcademias } from "@/lib/admin/academias";
import { AdminShell } from "@/components/layout/admin-shell";
import { PanelCard, PanelCardTitle, StatusPill } from "@/components/layout/panel-shell";
import { ESTADO_ACADEMIA } from "./estado";
import { CambiosPendientes } from "./cambios-pendientes";

export const metadata = { title: "Academias · Admin · Enséñame Ya" };

const TREINTA_DIAS = 30 * 24 * 60 * 60 * 1000;

/**
 * A2 · `docs/REQUERIMIENTOS.md` §4 · listado, filtros y aprobaciones (RA-06).
 * Los filtros van por `?estado=&pais=&actividad=`: un `<form method="get">`
 * sin JavaScript. ponytail: filtra en memoria; son pocas academias.
 */
export default async function AdminAcademiasPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; pais?: string; actividad?: string }>;
}) {
  await requireRole("admin");
  const [filtro, todas] = await Promise.all([searchParams, leerAcademias()]);

  const hace30 = new Date().getTime() - TREINTA_DIAS;
  const activa = (u: string | null) => Boolean(u && new Date(u).getTime() >= hace30);
  const academias = todas.filter(
    (a) =>
      (!filtro.estado || a.status === filtro.estado) &&
      (!filtro.pais || a.payout_country === filtro.pais) &&
      (!filtro.actividad ||
        (filtro.actividad === "con") === activa(a.ultima_reserva)),
  );
  const paises = [...new Set(todas.map((a) => a.payout_country).filter(Boolean))].sort() as string[];
  const pendientes = todas.filter((a) => a.pending_changes);

  return (
    <AdminShell
      eyebrow="Academias"
      title="Academias"
      description="Las academias aliadas, su acuerdo y su actividad. Las reservas e ingresos son del mes en curso (UTC)."
      actions={
        <Link
          href="/admin/academias/nueva"
          className="inline-flex h-[38px] items-center rounded-[8px] bg-brand px-4 text-[13.5px] font-semibold hover:bg-brand/90"
        >
          Crear academia
        </Link>
      }
    >
      {pendientes.length > 0 ? (
        <PanelCard>
          <PanelCardTitle>Cambios de perfil por aprobar ({pendientes.length})</PanelCardTitle>
          <div className="mt-3 space-y-4">
            {pendientes.map((a) => (
              <CambiosPendientes key={a.id} academia={a} />
            ))}
          </div>
        </PanelCard>
      ) : null}

      <PanelCard>
        <form method="get" className="flex flex-wrap items-end gap-3 text-[13px]">
          <label className="flex flex-col gap-1">
            Estado
            <select name="estado" defaultValue={filtro.estado ?? ""} className="rounded-md border px-2 py-1.5">
              <option value="">Todos</option>
              {Object.entries(ESTADO_ACADEMIA).map(([v, e]) => (
                <option key={v} value={v}>{e.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            País de cobro
            <select name="pais" defaultValue={filtro.pais ?? ""} className="rounded-md border px-2 py-1.5">
              <option value="">Todos</option>
              {paises.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Actividad
            <select name="actividad" defaultValue={filtro.actividad ?? ""} className="rounded-md border px-2 py-1.5">
              <option value="">Toda</option>
              <option value="con">Con reservas en 30 días</option>
              <option value="sin">Sin reservas en 30 días</option>
            </select>
          </label>
          <button type="submit" className="rounded-md border px-3 py-1.5 font-medium">
            Filtrar
          </button>
        </form>
      </PanelCard>

      <PanelCard className="overflow-x-auto">
        {academias.length === 0 ? (
          <p className="text-[13px] text-[#6b6b6b]">
            {todas.length === 0 ? "Todavía no hay academias." : "Ninguna academia con estos filtros."}
          </p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-[#6b6b6b]">
              <tr>
                <th className="py-2 pr-3 font-medium">Academia</th>
                <th className="py-2 pr-3 font-medium">Administrador</th>
                <th className="py-2 pr-3 font-medium">Tutores</th>
                <th className="py-2 pr-3 font-medium">Alumnos</th>
                <th className="py-2 pr-3 font-medium">Reservas del mes</th>
                <th className="py-2 pr-3 font-medium">Ingresos del mes</th>
                <th className="py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e0e0e0]">
              {academias.map((a) => {
                const estado = ESTADO_ACADEMIA[a.status] ?? { label: a.status, tone: "neutral" as const };
                return (
                  <tr key={a.id}>
                    <td className="py-2.5 pr-3">
                      <Link href={`/admin/academias/${a.id}`} className="font-medium text-brand-foreground hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      {a.owner_name ?? a.owner_email ?? (a.invited_email ? `Invitado: ${a.invited_email}` : "—")}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">{a.tutores}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{a.alumnos}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{a.reservas_mes}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{formatMoney(a.ingresos_mes, "USD")}</td>
                    <td className="py-2.5">
                      <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </PanelCard>
    </AdminShell>
  );
}
