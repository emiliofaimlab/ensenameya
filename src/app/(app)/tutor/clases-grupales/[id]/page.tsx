import Link from "next/link";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { getFormatoHora, getUserTimezone } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatSessionTime } from "@/lib/booking";
import { formatMoney } from "@/lib/catalog/format";
import { TutorShell } from "@/components/layout/tutor-shell";
import { PanelCard, StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { studentsOfTutor } from "../../students";
import { StudentLink } from "../../student-link";
import { CancelarClase, FechaAcciones } from "./acciones";

export const metadata = { title: "Clase grupal · Enséñame Ya" };

/** Estado de la reserva de cada inscrito, dicho como lo vive el tutor. */
const INSCRITO: Record<string, { label: string; tone: PillTone }> = {
  pending_payment: { label: "Pagando", tone: "amber" },
  pending_acceptance: { label: "Pagando", tone: "amber" },
  confirmed: { label: "Pagado", tone: "green" },
  in_progress: { label: "Pagado", tone: "green" },
  completed: { label: "Terminó", tone: "gray" },
  cancelled: { label: "Se dio de baja", tone: "red" },
  refunded: { label: "Reembolsado", tone: "red" },
};

const FECHA: Record<string, { label: string; tone: PillTone }> = {
  scheduled: { label: "Programada", tone: "blue" },
  completed: { label: "Dada", tone: "gray" },
  cancelled: { label: "Cancelada", tone: "red" },
};

/**
 * G1 · la ficha de una clase grupal para su tutor
 * (`docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §11.1): sus fechas, cuántos cupos van
 * vendidos, quién está inscrito y las tres acciones que tiene el tutor —cancelar
 * la clase, cancelar una fecha de un ciclo y reagendar una fecha—. Las tres
 * son RPC que ya deciden el dinero (`20261008180000`, `20261008200000`): esta
 * pantalla solo las llama.
 *
 * `[id]` es el id del PRODUCTO, no de una fecha: la clase es el producto.
 */
export default async function ClaseGrupalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await requireTutorProfile();
  const [tz, formato] = await Promise.all([getUserTimezone(), getFormatoHora()]);
  const supabase = await createClient();

  const [productoRes, fechasRes, reservasRes, students, { data: chat }] = await Promise.all([
    supabase
      .from("products")
      .select("id, title, status, pricing_model, capacity, min_seats, price_amount, currency")
      .eq("id", id)
      .eq("tutor_id", userId)
      .maybeSingle(),
    supabase
      .from("group_classes")
      .select("id, sequence_no, start_at, status, rescheduled_at")
      .eq("product_id", id)
      .order("start_at"),
    supabase
      .from("bookings")
      .select("id, student_id, status, created_at, payments(status)")
      .eq("product_id", id)
      .order("created_at"),
    studentsOfTutor(supabase),
    // G3 · el hilo del grupo nace con el primer cupo confirmado.
    supabase
      .from("conversations")
      .select("id")
      .eq("kind", "group")
      .eq("group_product_id", id)
      .maybeSingle(),
  ]);

  // Un fallo de lectura no es una clase vacía: que se vea.
  if (productoRes.error) throw productoRes.error;
  if (fechasRes.error) throw fechasRes.error;
  if (reservasRes.error) throw reservasRes.error;

  const producto = productoRes.data;
  if (!producto || producto.pricing_model !== "group") notFound();

  const fechas = fechasRes.data ?? [];
  // Un pago abandonado (hold caducado o soltado) deja una reserva cancelada sin
  // cobro: esa persona nunca llegó a inscribirse y no se lista como «baja».
  const reservas = (reservasRes.data ?? []).filter(
    (r) =>
      r.status !== "cancelled" ||
      ["paid", "refunded", "partially_refunded"].includes(r.payments?.status ?? ""),
  );
  const vivas = reservas.filter((r) =>
    ["pending_payment", "pending_acceptance", "confirmed", "in_progress"].includes(r.status),
  );
  const pagadas = vivas.filter((r) => r.status === "confirmed" || r.status === "in_progress");
  const cupo = producto.capacity ?? 0;
  const pendientes = fechas.filter((f) => f.status === "scheduled");
  const empezada = fechas.some((f) => f.status !== "cancelled" && new Date(f.start_at) <= new Date());
  const ciclo = fechas.filter((f) => f.status !== "cancelled").length > 1;
  const ahora = new Date();
  const enUnDia = new Date(ahora.getTime() + 24 * 3_600_000);

  return (
    <TutorShell
      userId={userId}
      title={producto.title}
      description={`Clase grupal · ${formatMoney(producto.price_amount, producto.currency)} por cupo`}
      back={{ href: "/tutor/products", label: "Volver a mis mentorías" }}
    >
      <div className="flex flex-col gap-5">
        <PanelCard className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-[#6b6b6b]">Inscritos</p>
            <p className="text-2xl font-bold tabular-nums text-[#19191f]">
              {pagadas.length}
              <span className="text-base font-medium text-[#6b6b6b]">/{cupo}</span>
            </p>
            {vivas.length > pagadas.length ? (
              <p className="text-xs text-[#6b6b6b]">
                {vivas.length - pagadas.length} pagando ahora
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-xs text-[#6b6b6b]">Cupos libres</p>
            <p className="text-2xl font-bold tabular-nums text-[#19191f]">
              {Math.max(cupo - vivas.length, 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#6b6b6b]">Cupo mínimo</p>
            <p className="text-2xl font-bold tabular-nums text-[#19191f]">
              {producto.min_seats ?? "—"}
            </p>
            {producto.min_seats ? (
              <p className="text-xs text-[#6b6b6b]">
                Si no se llega 24 h antes de la primera fecha, se cancela sola.
              </p>
            ) : null}
          </div>
        </PanelCard>

        <PanelCard className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#19191f]">
              {ciclo ? "Fechas del ciclo" : "Fecha"}
            </h2>
            <p className="text-xs text-[#6b6b6b]">Horas en tu zona: {tz}</p>
          </div>
          {fechas.length === 0 ? (
            <p className="text-[13px] text-[#6b6b6b]">
              Esta clase todavía no tiene fechas: publícala desde «Editar».
            </p>
          ) : (
            <ul className="divide-y divide-[#e0e0e0]">
              {fechas.map((f) => {
                const estado = FECHA[f.status] ?? FECHA.scheduled;
                return (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#19191f] first-letter:uppercase">
                        {ciclo ? `${f.sequence_no}. ` : ""}
                        {formatSessionTime(f.start_at, tz, formato)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
                        {f.rescheduled_at ? <StatusPill tone="amber">Reagendada</StatusPill> : null}
                      </div>
                    </div>
                    {/* Los botones van juntos a la derecha: sueltos en el
                        `justify-between`, «Entrar a sala» caía a mitad de fila
                        y en un sitio distinto en cada fecha. */}
                    {f.status === "scheduled" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {pagadas.length > 0 ? (
                          // G3 · la sala de ESTA fecha (RG-12). Fuera de su ventana
                          // la propia sala dice cuándo abre.
                          <Button asChild size="sm" className="h-9 rounded-[8px] px-3.5 text-[13px]">
                            <Link href={`/room/grupal/${f.id}`}>Entrar a sala</Link>
                          </Button>
                        ) : null}
                        <FechaAcciones
                          groupClassId={f.id}
                          reagendable={new Date(f.start_at) >= enUnDia}
                          timezone={tz}
                          puedeCancelar={ciclo && pendientes.length > 1}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </PanelCard>

        {chat ? (
          <PanelCard className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-[#474747]">
              Chat del grupo con los inscritos que ya pagaron.
            </p>
            <Button asChild variant="outline" size="sm" className="h-9 rounded-[8px] px-3.5 text-[13px]">
              <Link href={`/chat/${chat.id}`}>Abrir chat</Link>
            </Button>
          </PanelCard>
        ) : null}

        <PanelCard className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-[#19191f]">Inscritos</h2>
          {reservas.length === 0 ? (
            <p className="text-[13px] text-[#6b6b6b]">Todavía no se inscribió nadie.</p>
          ) : (
            <ul className="divide-y divide-[#e0e0e0]">
              {reservas.map((r) => {
                const estado = INSCRITO[r.status] ?? INSCRITO.pending_payment;
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                    <StudentLink
                      student={students.get(r.student_id)}
                      className="min-w-0 truncate text-[13px] font-medium text-brand-foreground"
                    />
                    <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
                  </li>
                );
              })}
            </ul>
          )}
        </PanelCard>

        {pendientes.length > 0 && !empezada ? (
          <CancelarClase productId={producto.id} inscritos={pagadas.length} />
        ) : null}
      </div>
    </TutorShell>
  );
}
