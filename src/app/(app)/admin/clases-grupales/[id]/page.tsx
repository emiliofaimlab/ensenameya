import Link from "next/link";
import { notFound } from "next/navigation";

import { getFormatoHora, getUserTimezone, requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { BOOKING_STATUS_LABEL, formatSessionTime } from "@/lib/booking";
import { formatMoney } from "@/lib/catalog/format";
import { PanelCard, PanelShell, StatusPill } from "@/components/layout/panel-shell";
import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import { CancelarClaseAdmin, CancelarFechaAdmin, SacarAlumno } from "./acciones";

export const metadata = { title: "Clase grupal · Admin · Enséñame Ya" };

const VIVAS = new Set(["pending_payment", "pending_acceptance", "confirmed", "in_progress"]);
// M1 · `in_progress` también: con el ciclo empezado se devuelven las fechas que faltan.
const SACABLE = new Set(["pending_acceptance", "confirmed", "in_progress"]);
const FECHA: Record<string, string> = {
  scheduled: "Programada",
  cancelled: "Cancelada",
  completed: "Dada",
};

/**
 * G4 · la ficha de UNA clase grupal para el admin (§11.4): fechas, inscritos
 * con su pago y su reembolso, y las acciones —cancelar la clase entera (100 %),
 * cancelar una fecha (lo que costaba esa fecha) o sacar a un alumno (100 %
 * antes de empezar; las fechas que faltan después, M1)—. Todo con el cliente del admin:
 * sus políticas `*_admin` le dejan leer productos, reservas y pagos.
 */
export default async function AdminClaseGrupalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  const { id } = await params;
  const [tz, formato] = await Promise.all([getUserTimezone(), getFormatoHora()]);
  const supabase = await createClient();

  const [productoRes, fechasRes, reservasRes] = await Promise.all([
    supabase
      .from("products")
      .select("id, title, status, capacity, min_seats, price_amount, currency, tutor_id, pricing_model, tutor:profiles!products_tutor_id_fkey(full_name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("group_classes")
      .select("id, sequence_no, start_at, status, rescheduled_at")
      .eq("product_id", id)
      .order("start_at"),
    supabase
      .from("bookings")
      .select("id, status, created_at, cancel_reason, student:profiles!bookings_student_id_fkey(full_name), payments(status, gross_amount, refunded_amount, currency, provider)")
      .eq("product_id", id)
      .order("created_at"),
  ]);
  // Regla de oro 10: una lectura caída no es una clase vacía.
  if (productoRes.error) throw productoRes.error;
  if (fechasRes.error) throw fechasRes.error;
  if (reservasRes.error) throw reservasRes.error;

  const p = productoRes.data;
  if (!p || p.pricing_model !== "group") notFound();
  const fechas = fechasRes.data ?? [];
  const reservas = reservasRes.data ?? [];
  const vivas = reservas.filter((r) => VIVAS.has(r.status));
  // Los que están pagando no recuperan nada al cancelar una fecha: nunca se cobró.
  const avisados = vivas.filter((r) => r.status !== "pending_payment").length;
  const empezada = fechas.some((f) => f.status !== "cancelled" && new Date(f.start_at) <= new Date());
  const pendientes = fechas.filter((f) => f.status === "scheduled").length;
  const ahora = new Date();

  return (
    <PanelShell
      items={ADMIN_ITEMS}
      back={{ href: `/admin/tutores/${p.tutor_id}`, label: "Volver al tutor" }}
      eyebrow="Clases grupales"
      title={p.title}
      description={`${p.tutor?.full_name ?? "Tutor"} · ${formatMoney(p.price_amount, p.currency)} por cupo · ${vivas.length}/${p.capacity ?? 0} cupos${p.min_seats ? ` · mínimo ${p.min_seats}` : ""}`}
    >
      <div className="flex flex-col gap-5">
        <PanelCard className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-[#19191f]">Fechas</h2>
          <ul className="divide-y divide-[#e0e0e0]">
            {fechas.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                <span className="first-letter:uppercase">
                  {fechas.length > 1 ? `${f.sequence_no}. ` : ""}
                  {formatSessionTime(f.start_at, tz, formato)}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {f.status === "scheduled" && new Date(f.start_at) > ahora ? (
                    <CancelarFechaAdmin groupClassId={f.id} inscritos={avisados} />
                  ) : null}
                  {f.rescheduled_at ? <StatusPill tone="amber">Reagendada</StatusPill> : null}
                  <StatusPill tone={f.status === "cancelled" ? "red" : f.status === "completed" ? "green" : "neutral"}>
                    {FECHA[f.status] ?? f.status}
                  </StatusPill>
                </span>
              </li>
            ))}
          </ul>
        </PanelCard>

        <PanelCard className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-[#19191f]">Inscritos, pagos y reembolsos</h2>
          {reservas.length === 0 ? (
            <p className="text-[13px] text-[#6b6b6b]">Nadie se inscribió todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="text-xs text-[#6b6b6b]">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Alumno</th>
                    <th className="py-2 pr-3 font-medium">Reserva</th>
                    <th className="py-2 pr-3 font-medium">Pago</th>
                    <th className="py-2 pr-3 font-medium">Reembolsado</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e0e0e0]">
                  {reservas.map((r) => {
                    const pago = r.payments;
                    const nombre = r.student?.full_name ?? "Alumno";
                    return (
                      <tr key={r.id}>
                        <td className="py-2.5 pr-3">
                          <Link href={`/admin/bookings/${r.id}`} className="font-medium text-brand-foreground hover:underline">
                            {nombre}
                          </Link>
                          {r.cancel_reason ? (
                            <p className="text-xs text-[#6b6b6b]">{r.cancel_reason}</p>
                          ) : null}
                        </td>
                        <td className="py-2.5 pr-3">{BOOKING_STATUS_LABEL[r.status]}</td>
                        <td className="py-2.5 pr-3">
                          {pago ? `${formatMoney(pago.gross_amount, pago.currency)} · ${pago.status} · ${pago.provider}` : "—"}
                        </td>
                        <td className="py-2.5 pr-3">
                          {pago?.refunded_amount ? formatMoney(pago.refunded_amount, pago.currency) : "—"}
                        </td>
                        <td className="py-2.5 text-right">
                          {SACABLE.has(r.status) ? <SacarAlumno bookingId={r.id} nombre={nombre} empezada={empezada} /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PanelCard>

        {pendientes > 0 && !empezada ? (
          <div>
            <CancelarClaseAdmin productId={p.id} inscritos={vivas.length} />
          </div>
        ) : null}
      </div>
    </PanelShell>
  );
}
