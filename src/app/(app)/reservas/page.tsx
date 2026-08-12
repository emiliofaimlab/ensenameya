import Link from "next/link";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { BOOKING_STATUS_LABEL, isUpcoming, tutorNames } from "@/lib/booking";
import { BookingRow } from "@/components/booking-row";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Mis reservas · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

const OPEN = new Set<BookingStatus>([
  "pending_payment",
  "pending_acceptance",
  "confirmed",
  "in_progress",
]);

/**
 * US-603 — el alumno ve sus reservas: estado, horario y total. No tiene frame
 * propio en el Figma; hereda el armazón y la fila de AL02, y cada fila enlaza
 * al detalle (AL03) — antes la lista no tenía ni un solo enlace.
 */
export default async function ReservasPage() {
  const { user } = await requireUser();
  const tz = await getUserTimezone();

  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(
      "id, status, total_amount, currency, products(title, tutor_id), sessions(id, start_at, status)",
    )
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });

  const bookings = data ?? [];
  const names = await tutorNames(
    supabase,
    bookings.map((b) => b.products?.tutor_id),
  );

  const open = bookings.filter((b) => OPEN.has(b.status));
  const closed = bookings.filter((b) => !OPEN.has(b.status));

  /** La sesión que representa a la reserva: la próxima viva, o la última. */
  const when = (b: (typeof bookings)[number]) => {
    const all = [...(b.sessions ?? [])].sort((x, y) =>
      x.start_at.localeCompare(y.start_at),
    );
    return (
      all.find((s) => s.status === "scheduled" && isUpcoming(s.start_at))
        ?.start_at ??
      all.at(-1)?.start_at ??
      null
    );
  };

  const row = (b: (typeof bookings)[number]) => (
    <BookingRow
      key={b.id}
      href={`/reservas/${b.id}`}
      tutor={names.get(b.products?.tutor_id ?? "")}
      title={b.products?.title ?? "Mentoría"}
      when={when(b)}
      timeZone={tz}
      status={BOOKING_STATUS_LABEL[b.status]}
      note={formatMoney(b.total_amount, b.currency)}
      action={
        <Button
          asChild
          variant="outline"
          className="h-[38px] rounded-[8px] px-4 text-[13px] text-[#4d4d4d]"
        >
          <Link href={`/reservas/${b.id}`}>Ver detalle</Link>
        </Button>
      }
    />
  );

  return (
    <PanelShell>
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          Mis reservas
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          El estado de tus mentorías y sus horarios.
        </p>
      </div>

      {bookings.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            Aún no tienes reservas. Explora tutores y reserva tu primera mentoría.
          </p>
          <Button asChild className="mt-4 h-10">
            <Link href="/tutors">Explorar tutores</Link>
          </Button>
        </PanelCard>
      ) : null}

      {open.length > 0 ? (
        <PanelCard>
          <PanelCardTitle className="text-[22px]">Activas</PanelCardTitle>
          <ul className="mt-4 divide-y divide-[#e0e0e0]">{open.map(row)}</ul>
        </PanelCard>
      ) : null}

      {closed.length > 0 ? (
        <PanelCard>
          <PanelCardTitle className="text-[22px]">Historial</PanelCardTitle>
          <ul className="mt-4 divide-y divide-[#e0e0e0]">{closed.map(row)}</ul>
        </PanelCard>
      ) : null}
    </PanelShell>
  );
}
