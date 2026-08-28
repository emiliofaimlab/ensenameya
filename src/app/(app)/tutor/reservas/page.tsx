import Link from "next/link";
import { ClockIcon } from "lucide-react";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { getUserTimezone } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime, BOOKING_STATUS_LABEL } from "@/lib/booking";
import { salaDeLaReserva } from "@/lib/room-window";
import { cn } from "@/lib/utils";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { Button } from "@/components/ui/button";
import { AcceptRejectButtons } from "./booking-actions";
import { studentsOfTutor } from "../students";
import { StudentLink } from "../student-link";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Reservas · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/** Chips de filtro del Figma (197:43) → estados reales de la reserva. */
const FILTERS: { id: string; label: string; statuses: BookingStatus[] }[] = [
  { id: "todas", label: "Todas", statuses: [] },
  { id: "por-aceptar", label: "Por aceptar", statuses: ["pending_acceptance"] },
  { id: "confirmadas", label: "Confirmadas", statuses: ["confirmed", "in_progress"] },
  { id: "completadas", label: "Completadas", statuses: ["completed"] },
  { id: "canceladas", label: "Canceladas", statuses: ["cancelled", "refunded"] },
];

const BOOKING_PILL: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  pending_acceptance: "blue",
  completed: "neutral",
  cancelled: "red",
  refunded: "red",
  pending_payment: "neutral",
};

/** "Vence en 22 h 14 m" (200:50) sobre created_at + 24 h (RN-38). */
function deadline(createdAt: string): { label: string; urgent: boolean } | null {
  const ms = new Date(createdAt).getTime() + 24 * 3_600_000 - Date.now();
  if (ms <= 0) return null; // vencida: el cron la cancela, no se finge cuenta
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return {
    label: `Vence en ${h} h ${String(m).padStart(2, "0")} m`,
    urgent: ms < 12 * 3_600_000,
  };
}

/**
 * US-606 (SCR-TU07 + TU07b) — reservas del tutor. Las `pending_acceptance`
 * van arriba como tarjetas con cuenta atrás y Aceptar/Rechazar (TU07b); el
 * resto, como filas con su estado y "Ver" (TU07). Filtros por chip en la URL.
 */
export default async function TutorReservasPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { userId } = await requireTutorProfile();
  const tz = await getUserTimezone();
  const { f } = await searchParams;
  const filter = FILTERS.find((x) => x.id === f) ?? FILTERS[0];

  const supabase = await createClient();
  // M-02 · aquí había una consulta a `tutor_profiles.auto_accept_bookings` para
  // pintar un interruptor global. Se fue con él: desde `20260817180000` esa
  // columna no la lee nadie —el auto-aceptar vive en cada mentoría— y el
  // interruptor escribía en el vacío. El ajuste está ahora en el formulario de
  // la mentoría (`/tutor/products/<id>/edit`), que es donde se decide.

  let query = supabase
    .from("bookings")
    .select(
      // Las columnas de ventana viajan con la sesión: el tutor pidió el mismo
      // «Entrar a sala» que tiene el alumno en su panel, y sin ellas esta lista
      // no puede saber si la sala está abierta ahora. Ver `salaDeLaReserva`.
      "id, status, total_amount, currency, created_at, student_id, products(title), sessions(id, start_at, end_at, status, access_opens_at, access_closes_at)",
    )
    .eq("tutor_id", userId)
    .order("created_at", { ascending: false });
  if (filter.statuses.length > 0) query = query.in("status", filter.statuses);

  // N-13 — el nombre del alumno no sale del `select` de arriba: `bookings` solo
  // guarda el `student_id` y `profiles` es own-only por RLS. Lo resuelve la RPC
  // `tutor_students`, en una sola llamada para toda la página y en paralelo con
  // el listado (no depende de él: devuelve todos los alumnos del tutor).
  const [{ data }, students] = await Promise.all([
    query,
    studentsOfTutor(supabase),
  ]);

  const bookings = data ?? [];
  const pending = bookings.filter((b) => b.status === "pending_acceptance");
  const rest = bookings.filter((b) => b.status !== "pending_acceptance");

  /** Fecha representativa: la primera sesión futura o la última que hubo. */
  const when = (b: (typeof bookings)[number]) => {
    const all = [...(b.sessions ?? [])].sort((x, y) =>
      x.start_at.localeCompare(y.start_at),
    );
    return (
      all.find((s) => s.status === "scheduled")?.start_at ??
      all.at(-1)?.start_at ??
      null
    );
  };

  return (
    <TutorShell
      title="Reservas"
      description={
        // M-02 · antes esta línea prometía las 24 h para TODAS las reservas
        // pagadas, y ya no es cierto: una mentoría que se confirma sola nunca
        // pasa por «Por aceptar», así que no hay plazo que se pueda vencer ni
        // reembolso automático detrás. Se cuenta lo que aplica a cada caso y se
        // dice dónde se decide, que es lo que perdió el tutor al retirarse el
        // interruptor global.
        <>
          Todas las reservas de tus mentorías. Las que salen como «Por aceptar»
          tienen 24 h: si se te pasa el plazo, se cancelan y se le reembolsan al
          alumno automáticamente. Las mentorías que se confirman solas no
          esperan respuesta y entran ya confirmadas — eso se ajusta en{" "}
          <Link
            href="/tutor/products"
            className="font-medium text-brand underline underline-offset-2"
          >
            cada mentoría
          </Link>
          .
        </>
      }
    >
      {/* Chips de filtro (197:43). Estado en la URL: server-render puro. */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((x) => {
          const on = x.id === filter.id;
          return (
            <Link
              key={x.id}
              href={
                x.id === "todas" ? "/tutor/reservas" : `/tutor/reservas?f=${x.id}`
              }
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
                on
                  ? "border-brand bg-brand font-semibold text-white"
                  : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
              )}
            >
              {x.label}
            </Link>
          );
        })}
      </div>

      {bookings.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            No hay reservas{" "}
            {filter.id === "todas" ? "por ahora" : "en este filtro"}.
          </p>
        </PanelCard>
      ) : null}

      {/* TU07b — tarjetas con cuenta atrás para las que esperan respuesta. */}
      {pending.map((b) => {
        const dl = deadline(b.created_at);
        const s = when(b);
        return (
          <PanelCard
            key={b.id}
            className={cn(dl?.urgent && "border-[1.5px] border-[#f0bfbf]")}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              {/* N-12 · `truncate` no basta por sí solo: sin `flex-1` este
                  bloque se dimensiona por su contenido (`min-w-0` solo le
                  permite encoger, no le da un ancho al que ajustarse), así que
                  un título largo seguía empujando la cuenta atrás fuera de la
                  tarjeta. Los dos, o no se ve nada. */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#19191f]">
                  {b.products?.title ?? "Mentoría"}
                </p>
                <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
                  Reserva pagada, esperando tu respuesta
                </p>
              </div>
              {dl ? (
                <span
                  className={cn(
                    "inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-white",
                    dl.urgent ? "bg-[#bf3333]" : "bg-[#19191f]",
                  )}
                >
                  <ClockIcon className="size-3.5" />
                  {dl.label}
                </span>
              ) : null}
            </div>

            <hr className="my-4 border-[#e0e0e0]" />

            <div className="flex flex-wrap gap-10">
              {/* Primero el alumno: es el dato con el que se decide aceptar o
                  rechazar, y hasta N-13 no estaba en ninguna parte. */}
              <div>
                <p className="text-xs text-[#6b6b6b]">Alumno</p>
                <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                  <StudentLink student={students.get(b.student_id)} />
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6b6b6b]">Fecha y hora</p>
                <p className="mt-0.5 text-[13px] font-medium text-[#404040] first-letter:uppercase">
                  {s ? formatSessionTime(s, tz) : "Por agendar"}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6b6b6b]">Monto pagado</p>
                <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                  {formatMoney(b.total_amount, b.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6b6b6b]">Estado</p>
                <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                  Pendiente de aceptación
                </p>
              </div>
            </div>

            <div className="mt-4">
              <AcceptRejectButtons bookingId={b.id} />
            </div>
          </PanelCard>
        );
      })}

      {/* TU07 — el resto, como filas con estado y "Ver". */}
      {rest.length > 0 ? (
        <PanelCard className="py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {rest.map((b) => {
              const s = when(b);
              // Mismo criterio que el panel del alumno y que `/reservas`:
              // reserva `confirmed`/`in_progress` y sesión dentro de su ventana
              // de acceso. Aquí importa más que en ninguna lista — el tutor
              // llega tarde a su propia clase si tiene que pasar por el detalle.
              const sala = salaDeLaReserva(b.status, b.sessions);
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 sm:w-64">
                    <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                      {b.products?.title ?? "Mentoría"}
                    </p>
                    <p className="text-xs text-[#6b6b6b]">
                      {formatMoney(b.total_amount, b.currency)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11.5px] text-[#6b6b6b]">Alumno</p>
                    <p className="truncate text-[13px] font-medium text-[#404040]">
                      <StudentLink student={students.get(b.student_id)} />
                    </p>
                  </div>
                  <div>
                    <p className="text-[11.5px] text-[#6b6b6b]">Fecha</p>
                    <p className="text-[13px] font-medium text-[#404040] first-letter:uppercase">
                      {s ? formatSessionTime(s, tz) : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill
                      tone={BOOKING_PILL[b.status] ?? "neutral"}
                      className="h-7"
                    >
                      {BOOKING_STATUS_LABEL[b.status]}
                    </StatusPill>
                    {/* «Entrar a sala» ANTES de «Ver» y en naranja: cuando la
                        sala está abierta es lo único que el tutor quiere de
                        esta fila. «Ver» se queda al lado —no se sustituye—
                        porque desde el detalle también se cancela y se marca
                        completada. */}
                    {sala ? (
                      <Button
                        asChild
                        className="h-9 rounded-[8px] px-3.5 text-[13px] font-semibold"
                      >
                        <Link href={`/room/${sala.id}`}>Entrar a sala</Link>
                      </Button>
                    ) : null}
                    <Button
                      asChild
                      variant="outline"
                      className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                    >
                      <Link href={`/tutor/reservas/${b.id}`}>Ver</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </PanelCard>
      ) : null}
    </TutorShell>
  );
}
