import Link from "next/link";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import {
  BOOKING_STATUS_LABEL,
  porProximidad,
  sesionVigente,
  tutorNames,
} from "@/lib/booking";
import { salaDeLaReserva } from "@/lib/room-window";
import { BookingRow } from "@/components/booking-row";
import { EmptyResults } from "@/components/catalog/empty-results";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { categoriesWithOffer } from "../app/sugerencias";
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
      // Las columnas de ventana viajan con la sesión: sin ellas esta lista no
      // puede saber si la sala está abierta, y el cliente pidió el botón
      // «Entrar a sala» aquí también — hasta hoy solo lo tenía el panel, así
      // que desde la lista había que entrar al detalle para llegar a la clase.
      // Ver `salaDeLaReserva`.
      "id, status, total_amount, currency, products(title, tutor_id), sessions(id, start_at, end_at, status, access_opens_at, access_closes_at)",
    )
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });

  const bookings = data ?? [];
  const names = await tutorNames(
    supabase,
    bookings.map((b) => b.products?.tutor_id),
  );

  /**
   * V-6 · El «con Fulanito» de cada fila lleva ahora a su ficha pública — hasta
   * hoy era texto muerto y, comprada la mentoría, no había forma de volver al
   * tutor.
   *
   * ⚠️ Solo si es legible, y `names` YA es esa comprobación: `tutorNames` sale
   * de `tutor_profiles`, que solo se lee con `approval_status = 'approved'`. A
   * un tutor desaprobado no se le enlaza — su ficha daría un 404 desde el panel
   * del propio alumno. Ver `tutorCards`.
   */
  const perfilDelTutor = (id: string | null | undefined) =>
    id && names.has(id) ? `/tutors/${id}` : undefined;

  // En curso primero, luego las próximas por fecha y hora. El «Historial» se
  // queda como está: sin sesión viva todas empatan y el sort estable conserva
  // el `created_at desc` de la consulta.
  const open = bookings.filter((b) => OPEN.has(b.status)).sort(porProximidad);
  const closed = bookings.filter((b) => !OPEN.has(b.status));

  // RV-11 · las burbujas del estado vacío. Se piden SOLO cuando no hay ninguna
  // reserva: son dos consultas más, y en la pantalla que sí tiene reservas
  // nadie las vería. Van con oferta filtrada porque mandar al alumno a una
  // categoría sin mentorías es el mismo callejón del que se le quiere sacar.
  const conOferta = bookings.length === 0 ? await categoriesWithOffer() : [];

  /** La sesión que representa a la reserva: la vigente, o la última que hubo.
   *  Es la MISMA que ordena la lista — antes filtraba por `start_at`, así que
   *  durante la clase la fila saltaba a mostrar la sesión siguiente y la fecha
   *  contradecía al orden. */
  const when = (b: (typeof bookings)[number]) => {
    const all = [...(b.sessions ?? [])].sort((x, y) =>
      x.start_at.localeCompare(y.start_at),
    );
    return sesionVigente(all)?.start_at ?? all.at(-1)?.start_at ?? null;
  };

  const row = (b: (typeof bookings)[number]) => {
    // El mismo criterio del panel del alumno, ahora en un solo sitio: reserva
    // en `confirmed`/`in_progress` **y** sesión dentro de su ventana de acceso.
    // Sin la segunda mitad el botón saldría para una clase de dentro de tres
    // semanas y el servidor la rechazaría.
    const sala = salaDeLaReserva(b.status, b.sessions);
    return (
      <BookingRow
        key={b.id}
        href={`/reservas/${b.id}`}
        tutor={names.get(b.products?.tutor_id ?? "")}
        tutorHref={perfilDelTutor(b.products?.tutor_id)}
        title={b.products?.title ?? "Mentoría"}
        when={when(b)}
        timeZone={tz}
        status={BOOKING_STATUS_LABEL[b.status]}
        note={formatMoney(b.total_amount, b.currency)}
        action={
          sala ? (
            <Button
              asChild
              className="h-[38px] rounded-[8px] px-4 text-[13px] font-semibold"
            >
              <Link href={`/room/${sala.id}`}>Entrar a sala</Link>
            </Button>
          ) : (
            <Button
              asChild
              variant="outline"
              className="h-[38px] rounded-[8px] px-4 text-[13px] text-[#4d4d4d]"
            >
              <Link href={`/reservas/${b.id}`}>Ver detalle</Link>
            </Button>
          )
        }
      />
    );
  };

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
        // RV-11 · el mismo estado vacío del catálogo, no otro inventado aquí:
        // frase + salida + categorías reales. Antes era un párrafo y un botón a
        // /tutors, o sea "busca tú" — que en una lista vacía es justo el hueco
        // que hay que evitar.
        <PanelCard>
          <PanelCardTitle className="text-[22px]">
            Aún no tienes reservas
          </PanelCardTitle>
          <EmptyResults
            className="mt-3"
            message="Cuando reserves una mentoría, aquí verás su estado, su horario y su total."
            action={{ href: "/classes", label: "Ver las mentorías disponibles" }}
            categories={conOferta}
          />
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
