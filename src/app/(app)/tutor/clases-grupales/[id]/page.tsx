import Link from "next/link";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { getFormatoHora, getUserTimezone } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatSessionTime, parteDelTutor } from "@/lib/booking";
import { formatMoney } from "@/lib/catalog/format";
import { ACCESS_WINDOW_MIN, roomOpen, withMinutes } from "@/lib/room-window";
import { zonaLegible } from "@/lib/zona-legible";
import { TutorShell } from "@/components/layout/tutor-shell";
import { RecordingLink } from "@/components/room/recording-link";
import { PanelCard, StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { studentsOfTutor } from "../../students";
import { tutorTier } from "../../tier";
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

/**
 * Una reserva de la clase como la lee esta ficha. Tipada a mano por
 * `sacado_por_admin_at` (M32), que es del lote 9 y puede no estar aún en
 * `database.types.ts`; el resto coincide con el `select` de abajo.
 */
type ReservaDeLaClase = {
  id: string;
  student_id: string;
  status: string;
  created_at: string;
  num_sessions: number;
  sacado_por_admin_at: string | null;
  payments: {
    status: string;
    gross_amount: number;
    tutor_net_amount: number;
    refunded_amount: number | null;
    currency: string;
  } | null;
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
 *
 * RG-01 (24-oct) · desde que la hora la fija el primer alumno, ese producto es
 * la clase NACIDA (`group_template_id` = la grupal que publicó el tutor). La
 * plantilla no tiene fechas: si llega su id, se manda a «Mis mentorías», donde
 * cada plantilla lista sus clases.
 */
export default async function ClaseGrupalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await requireTutorProfile();
  const [tz, formato] = await Promise.all([getUserTimezone(), getFormatoHora()]);
  const supabase = await createClient();

  const [productoRes, fechasRes, reservasRes, students, { data: chat, error: chatError }, tier] = await Promise.all([
    supabase
      .from("products")
      .select("id, title, status, pricing_model, capacity, min_seats, price_amount, currency, package_num_sessions, group_template_id")
      .eq("id", id)
      .eq("tutor_id", userId)
      .maybeSingle(),
    supabase
      .from("group_classes")
      .select("id, sequence_no, start_at, end_at, status, rescheduled_at")
      .eq("product_id", id)
      .order("start_at"),
    supabase
      .from("bookings")
      // A4 · el pago trae lo que hace falta para «Tus ingresos» y para el monto
      // de «Cancelar fecha» (P21). `sacado_por_admin_at` es M32.
      .select(
        "id, student_id, status, created_at, num_sessions, sacado_por_admin_at, payments(status, gross_amount, tutor_net_amount, refunded_amount, currency)",
      )
      .eq("product_id", id)
      .order("created_at"),
    studentsOfTutor(supabase),
    // G3 · el hilo del grupo. Ojo: nace con la primera reserva, aunque no se
    // haya pagado (P29), por eso la tarjeta mira además si alguien pagó.
    supabase
      .from("conversations")
      .select("id")
      .eq("kind", "group")
      .eq("group_product_id", id)
      .maybeSingle(),
    // A4 · para «Si se llena»: sin tier no se inventa un split (ver `tier.ts`).
    tutorTier(supabase, userId),
  ]);

  // Un fallo de lectura no es una clase vacía: que se vea.
  if (productoRes.error) throw productoRes.error;
  if (fechasRes.error) throw fechasRes.error;
  if (reservasRes.error) throw reservasRes.error;

  const producto = productoRes.data;
  if (!producto || producto.pricing_model !== "group") notFound();

  const fechas = fechasRes.data ?? [];
  if (!producto.group_template_id && fechas.length === 0) {
    return (
      <TutorShell
        userId={userId}
        title={producto.title}
        description="Clase grupal"
        back={{ href: "/tutor/products", label: "Volver a mis mentorías" }}
      >
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            Esta clase todavía no tiene fechas: nacen cuando un alumno elige un
            horario de tu disponibilidad. Las clases ya programadas salen en
            «Mis mentorías», bajo esta clase.
          </p>
        </PanelCard>
      </TutorShell>
    );
  }
  // Un pago abandonado (hold caducado o soltado) deja una reserva cancelada sin
  // cobro: esa persona nunca llegó a inscribirse y no se lista como «baja».
  const reservas = ((reservasRes.data ?? []) as unknown as ReservaDeLaClase[]).filter(
    (r) =>
      r.status !== "cancelled" ||
      ["paid", "refunded", "partially_refunded"].includes(r.payments?.status ?? ""),
  );
  const vivas = reservas.filter((r) =>
    ["pending_payment", "pending_acceptance", "confirmed", "in_progress"].includes(r.status),
  );
  const pagadas = vivas.filter((r) => r.status === "confirmed" || r.status === "in_progress");
  // M15 · a quién avisa una reagenda: las reservas vivas menos las que siguen
  // pagando (esas todavía no son de la clase).
  const avisados = vivas.filter((r) => r.status !== "pending_payment").length;
  const cupo = producto.capacity ?? 0;
  const pendientes = fechas.filter((f) => f.status === "scheduled");
  const empezada = fechas.some((f) => f.status !== "cancelled" && new Date(f.start_at) <= new Date());
  const ciclo = fechas.filter((f) => f.status !== "cancelled").length > 1;
  // P29 · el hilo nace al publicar, no con el primer pago: sin nadie que haya
  // pagado, «Abrir chat» llevaba a un grupo vacío. `pagadas` no sirve aquí:
  // deja fuera `completed` y escondería el chat de una clase ya dada.
  const conPago = reservas.some((r) => ["confirmed", "in_progress", "completed"].includes(r.status));
  const ahora = new Date();
  const enUnDia = new Date(ahora.getTime() + 24 * 3_600_000);
  // P53 · la cabecera y la numeración miran las fechas que TUVO la clase: tras
  // cancelar una de dos, «Fechas del ciclo» pasaba a «Fecha» y perdía el «2.».
  // `ciclo` se queda para A10 (cancelar una fecha solo tiene sentido en ciclo).
  const variasFechas = fechas.length > 1;

  // A4 · «Tus ingresos». Lo que le queda al tutor de cada pago tras lo
  // devuelto; la cuenta que manda es `parte_del_tutor` (ver `parteDelTutor`).
  const conCobro = (rs: typeof reservas) =>
    rs
      .map((r) => r.payments)
      .filter(
        (p): p is NonNullable<typeof p> =>
          !!p && ["paid", "partially_refunded", "refunded"].includes(p.status),
      );
  // «Cobrado» es lo que el payout PAGARÁ: `build_payout_for_tutor` solo mira
  // reservas `completed` (las vivas lo serán). Una baja cancelada con el 50 %
  // devuelto deja dinero en `payments`, pero no llega nunca al tutor.
  const cobrado = conCobro(reservas.filter((r) => r.status !== "cancelled")).reduce(
    (t, p) => t + parteDelTutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount ?? 0),
    0,
  );
  const reembolsado = conCobro(reservas).reduce((t, p) => t + (p.refunded_amount ?? 0), 0);
  // Solo mientras quedan fechas por delante: con la clase dada o cancelada,
  // «si se llena» volvía a sumar el cupo entero.
  const ocupadas = reservas.filter((r) =>
    ["confirmed", "in_progress", "completed"].includes(r.status),
  ).length;
  // Los cupos que quedan se venden al precio VIGENTE: con fechas canceladas
  // del ciclo, prorrateado como `precio_vigente_grupal` (lote 1, M25).
  const vivasN = fechas.filter((f) => f.status !== "cancelled").length;
  const totalN = producto.package_num_sessions ?? 0;
  const precioCupo =
    totalN > vivasN && vivasN > 0
      ? Math.round((producto.price_amount * vivasN) / totalN)
      : producto.price_amount;
  const siSeLlena =
    tier === null || !pendientes.some((f) => new Date(f.start_at) > ahora)
      ? null
      : cobrado + Math.max(cupo - ocupadas, 0) * Math.round((precioCupo * tier.splitPct) / 100);
  const noCanceladas = fechas.filter((f) => f.status !== "cancelled");
  const ultimaFecha = noCanceladas[noCanceladas.length - 1] ?? null;

  // P21 · lo que mueve cancelar UNA fecha: el tramo de cada reserva pagada que
  // sigue viva (mismo reparto que `cancelar_fecha_grupal`, `20261008230100`).
  const tramoDeFecha = reservas
    .filter(
      (r) =>
        ["pending_acceptance", "confirmed", "in_progress"].includes(r.status) &&
        ["paid", "partially_refunded"].includes(r.payments?.status ?? ""),
    )
    .reduce(
      (t, r) => {
        const n = Math.max(r.num_sessions, 1);
        return {
          devolucion: t.devolucion + Math.round((r.payments?.gross_amount ?? 0) / n),
          dejasDeCobrar: t.dejasDeCobrar + Math.round((r.payments?.tutor_net_amount ?? 0) / n),
        };
      },
      { devolucion: 0, dejasDeCobrar: 0 },
    );

  return (
    <TutorShell
      userId={userId}
      title={producto.title}
      description={`Clase grupal · ${formatMoney(producto.price_amount, producto.currency)} por cupo`}
      back={{ href: "/tutor/products", label: "Volver a mis mentorías" }}
    >
      <div className="flex flex-col gap-5">
        {/* P51 · tres columnas también en móvil: apiladas, la tarjeta ocupaba
            media pantalla para tres cifras. */}
        <PanelCard className="grid grid-cols-3 gap-3 sm:gap-4">
          <div>
            <p className="text-xs text-[#6b6b6b]">Inscritos</p>
            <p className="text-xl font-bold tabular-nums text-[#19191f] sm:text-2xl">
              {pagadas.length}
              <span className="text-base font-medium text-[#6b6b6b]">/{cupo}</span>
            </p>
            {vivas.length > pagadas.length ? (
              <p className="text-[11px] text-[#6b6b6b] sm:text-xs">
                {vivas.length - pagadas.length} pagando ahora
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-xs text-[#6b6b6b]">Cupos libres</p>
            <p className="text-xl font-bold tabular-nums text-[#19191f] sm:text-2xl">
              {Math.max(cupo - vivas.length, 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#6b6b6b]">Cupo mínimo</p>
            <p className="text-xl font-bold tabular-nums text-[#19191f] sm:text-2xl">
              {producto.min_seats ?? "—"}
            </p>
            {producto.min_seats ? (
              <p className="text-[11px] text-[#6b6b6b] sm:text-xs">
                Si no se llega 24 h antes de la primera fecha, se cancela sola.
              </p>
            ) : null}
          </div>
        </PanelCard>

        {/* A4 · lo que va a ganar el tutor con esta clase. Sin esto tenía que
            echar la cuenta a mano con el precio, el cargo y su comisión. */}
        <PanelCard className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-[#19191f]">Tus ingresos</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <div>
              <dt className="text-xs text-[#6b6b6b]">Cobrado</dt>
              <dd className="text-xl font-bold tabular-nums text-[#19191f] sm:text-2xl">
                {formatMoney(cobrado, producto.currency)}
              </dd>
            </div>
            {siSeLlena !== null ? (
              <div>
                <dt className="text-xs text-[#6b6b6b]">Si se llena</dt>
                <dd className="text-xl font-bold tabular-nums text-[#19191f] sm:text-2xl">
                  {formatMoney(siSeLlena, producto.currency)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-[#6b6b6b]">Reembolsado a los alumnos</dt>
              <dd className="text-xl font-bold tabular-nums text-[#19191f] sm:text-2xl">
                {formatMoney(reembolsado, producto.currency)}
              </dd>
            </div>
          </dl>
          {ultimaFecha ? (
            <p className="text-[13px] text-[#474747]">
              {`Se libera 7 días después de la última fecha (${formatSessionTime(ultimaFecha.start_at, tz, formato)}) y se paga el lunes siguiente.`}
            </p>
          ) : null}
          <p className="text-xs text-[#6b6b6b]">
            Lo que te queda a ti, ya sin la comisión ni el cargo por servicio del alumno.
          </p>
        </PanelCard>

        <PanelCard className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#19191f]">
              {variasFechas ? "Fechas del ciclo" : "Fecha"}
            </h2>
            <p className="text-xs text-[#6b6b6b]">Horas en tu zona: {zonaLegible(tz)}</p>
          </div>
          {fechas.length === 0 ? (
            <p className="text-[13px] text-[#6b6b6b]">
              Esta clase todavía no tiene fechas: publícala desde «Editar».
            </p>
          ) : (
            <ul className="divide-y divide-[#e0e0e0]">
              {fechas.map((f) => {
                const estado = FECHA[f.status] ?? FECHA.scheduled;
                // P47 · la sala solo se ofrece dentro de su ventana (mismo
                // criterio que `join_session`); antes salía semanas antes.
                const salaAbierta = roomOpen({
                  status: "scheduled",
                  start_at: f.start_at,
                  end_at: f.end_at,
                  access_opens_at: null,
                  access_closes_at: null,
                });
                return (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#19191f] first-letter:uppercase">
                        {variasFechas ? `${f.sequence_no}. ` : ""}
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
                      // P53 · en móvil el bloque ocupa la fila entera: el
                      // reagendar en línea quedaba apretado junto a la sala.
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        {pagadas.length > 0 && salaAbierta ? (
                          // G3 · la sala de ESTA fecha (RG-12).
                          <Button asChild size="sm" className="h-9 rounded-[8px] px-3.5 text-[13px]">
                            <Link href={`/room/grupal/${f.id}`}>Entrar a sala</Link>
                          </Button>
                        ) : pagadas.length > 0 ? (
                          <p className="text-xs text-[#6b6b6b]">
                            La sala abre el{" "}
                            {formatSessionTime(withMinutes(f.start_at, -ACCESS_WINDOW_MIN), tz, formato)}
                          </p>
                        ) : null}
                        <FechaAcciones
                          groupClassId={f.id}
                          inicio={f.start_at}
                          reagendable={new Date(f.start_at) >= enUnDia}
                          timezone={tz}
                          inscritos={avisados}
                          devolucion={tramoDeFecha.devolucion}
                          dejasDeCobrar={tramoDeFecha.dejasDeCobrar}
                          currency={producto.currency}
                          // A10 · en un ciclo, cualquier fecha que aún no empezó,
                          // aunque sea la última que queda viva:
                          // `cancelar_fecha_grupal` ya lo permite.
                          puedeCancelar={ciclo && new Date(f.start_at) > ahora}
                        />
                      </div>
                    ) : f.status === "completed" ? (
                      // A6 · la tutora ve la grabación de cada fecha dada (antes
                      // no tenía dónde).
                      <div className="flex flex-wrap items-center gap-2">
                        <RecordingLink groupClassId={f.id} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </PanelCard>

        {/* P45 · un fallo al leer el hilo se dice; antes la tarjeta se
            esfumaba y el tutor no sabía que su grupo tenía chat. */}
        {chatError ? (
          <PanelCard>
            <p className="text-[13px] text-[#474747]">
              El chat no está disponible. Vuelve a intentarlo en unos minutos.
            </p>
          </PanelCard>
        ) : chat && conPago ? (
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
                // M32 · a quien sacó el equipo no se le llama «Se dio de baja».
                const estado = r.sacado_por_admin_at
                  ? { label: "Lo sacó el equipo", tone: "red" as PillTone }
                  : (INSCRITO[r.status] ?? INSCRITO.pending_payment);
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
