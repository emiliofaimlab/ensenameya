import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";

import {
  getFormatoHora,
  getUserTimezone,
  requireUser,
} from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Precio, PrecioEnLinea } from "@/components/precio/precio";
import { formatSessionTime, tutorNames } from "@/lib/booking";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { PanelShell } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { CancelForm } from "./cancel-form";
import type { Database } from "@/lib/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

const CANCELLABLE = new Set<BookingStatus>([
  "pending_payment",
  "pending_acceptance",
  "confirmed",
]);

/**
 * M26 · lo que devuelve `politica_de_baja` (`20261017120000`). En los tipos
 * generados es `Json`, así que se tipa aquí. Montos en unidades mínimas y EN
 * PRECIO (sobre `payments.gross_amount`), igual que `cancel_booking`.
 */
type PoliticaDeBaja =
  | { permitida: false; motivo: string }
  | {
      permitida: true;
      motivo: null;
      es_tutor: boolean;
      pct: number;
      reembolso_total: number;
      ya_devuelto: number;
      a_devolver: number;
      tramos: boolean;
      reagendada: boolean;
      proxima: string | null;
      moneda: string;
    };

export const metadata = { title: "Cancelar reserva · Enséñame Ya" };

/**
 * Días/horas/minutos hasta un instante, redondeado hacia abajo, nunca negativo.
 * P9 · por debajo de una hora, minutos: «Faltan 0 h» con 45 min por delante se
 * leía como «ya empezó».
 */
function timeUntil(iso: string): { ms: number; label: string } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { ms: 0, label: "Ya empezó" };
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return { ms, label: `Faltan ${days} día${days === 1 ? "" : "s"}` };
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return { ms, label: `Faltan ${hours} h` };
  const mins = Math.floor(ms / 60_000);
  if (mins >= 1) return { ms, label: `Faltan ${mins} min` };
  return { ms, label: "Falta menos de 1 min" };
}

/** Los motivos de la RPC llegan en minúscula («la clase ya empezó: …»). */
function capitalizar(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * SCR-AL07 — cancelar reserva, como página (antes era un `window.confirm()`).
 * Muestra la política, el reembolso y el motivo.
 *
 * M26 · si se puede y cuánto se devuelve NO lo calcula esta pantalla: lo dice
 * `politica_de_baja`, la misma función que usa `cancel_booking` para decidir.
 * Antes se estimaba aquí (total × %) y prometía de más con un reembolso parcial
 * previo (A8) o con la clase ya empezada (RG-16).
 */
export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  // Zona y formato juntos: las dos mitades de «qué hora es para quien mira»,
  // y las dos lecturas baratas — en paralelo, nunca encadenadas.
  const [tz, formato] = await Promise.all([
    getUserTimezone(),
    getFormatoHora(),
  ]);
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, status, num_sessions, products(title, tutor_id, pricing_model), sessions(status)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();
  // Ya no cancelable → al detalle (no tiene sentido esta pantalla).
  if (!CANCELLABLE.has(booking.status)) redirect(`/reservas/${id}`);

  // Nombre del tutor y regla de la baja no dependen la una de la otra.
  const [names, { data: politicaRaw, error: politicaError }, { data: pago }] = await Promise.all([
    tutorNames(supabase, [booking.products?.tutor_id]),
    supabase.rpc("politica_de_baja", { p_booking: booking.id }),
    // Lo pagado con saldo no vuelve a la tarjeta (`reembolsar_con_credito`).
    supabase.from("payments").select("credit_amount").eq("booking_id", booking.id).maybeSingle(),
  ]);
  const tutor = names.get(booking.products?.tutor_id ?? "");
  const grupal = booking.products?.pricing_model === "group";
  // Si la RPC falla no se ofrece la baja: mejor no pintar el botón que
  // prometer un monto que nadie ha calculado.
  const politica: PoliticaDeBaja =
    politicaError || !politicaRaw
      ? {
          permitida: false,
          motivo: "no pudimos revisar tu reserva. Inténtalo de nuevo en unos minutos",
        }
      : (politicaRaw as unknown as PoliticaDeBaja);

  if (!politica.permitida) {
    return (
      <PanelShell
        back={{ href: `/reservas/${id}`, label: "Volver al detalle" }}
        title={grupal ? "Darme de baja" : "Cancelar reserva"}
        description={tutor ? `${booking.products?.title} · con ${tutor}.` : undefined}
      >
        <section className="rounded-[16px] border border-[#e0e0e0] bg-card p-5">
          <h2 className="text-base font-semibold text-[#19191f]">
            No se puede cancelar
          </h2>
          <p className="mt-2 text-[13px] text-[#4d4d4d]">
            {capitalizar(politica.motivo)}.
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-3.5 h-10 rounded-[8px] px-4 text-[13.5px] text-[#262626]"
          >
            <Link href={`/reservas/${id}`}>Volver al detalle</Link>
          </Button>
        </section>
      </PanelShell>
    );
  }

  // RN-37 sobre la sesión agendada más próxima: la misma que mira la RPC.
  const until = politica.proxima ? timeUntil(politica.proxima) : null;
  const early = politica.pct >= 100;
  const remaining = (booking.sessions ?? []).filter(
    (s) => s.status === "scheduled",
  ).length;

  return (
    <PanelShell
      back={{ href: `/reservas/${id}`, label: "Volver al detalle" }}
      title={grupal ? "Darme de baja" : "Cancelar reserva"}
      description={`${tutor ? `${booking.products?.title} · con ${tutor}. ` : ""}Revisa la política antes de confirmar. El reembolso depende de cuánto falte para ${grupal ? "la primera fecha" : "tu próxima sesión"}.`}
    >

      <section className="rounded-[16px] border border-[#e0e0e0] bg-card p-5">
        <h2 className="text-base font-semibold text-[#19191f]">
          Política de cancelación
        </h2>
        <div className="mt-3.5 flex items-center justify-between gap-4">
          <p className="text-[13px] text-[#4d4d4d]">
            Cancelas con {P.cutoffHours} h o más de anticipación
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#333333]">
              Reembolso {P.refundPct.studentEarly} %
            </span>
            {early ? (
              <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-white">
                Tu caso
              </span>
            ) : null}
          </div>
        </div>
        <hr className="my-3.5 border-[#e0e0e0]" />
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-[#6b6b6b]">Cancelas con menos de {P.cutoffHours} h</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#6b6b6b]">
              Reembolso {P.refundPct.studentLate} %
            </span>
            {!early ? (
              <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-white">
                Tu caso
              </span>
            ) : null}
          </div>
        </div>
        {/* RG-16 y RG-11 · las dos reglas que solo existen en una grupal. */}
        {grupal ? (
          <>
            <hr className="my-3.5 border-[#e0e0e0]" />
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-[#6b6b6b]">
                Una vez empezada la clase
              </p>
              <span className="text-xs text-[#6b6b6b]">Sin baja</span>
            </div>
            <p className="mt-3.5 text-xs text-[#6b6b6b]">
              Los plazos se cuentan desde la primera fecha. Si el tutor cambia
              una fecha después de tu inscripción, te devolvemos el{" "}
              {P.refundPct.studentEarly} % aunque falten menos de{" "}
              {P.cutoffHours} h.
            </p>
          </>
        ) : null}
        {politica.reagendada ? (
          <p className="mt-3.5 rounded-[10px] bg-muted px-3.5 py-2.5 text-[13px] text-[#333333]">
            Como el tutor cambió una fecha después de tu inscripción, te
            devolvemos el {P.refundPct.studentEarly} %.
          </p>
        ) : null}
      </section>

      <section className="rounded-[16px] border border-[#e0e0e0] bg-card p-5">
        <h2 className="text-base font-semibold text-[#19191f]">
          Resultado
        </h2>
        <dl className="mt-3.5 flex flex-col gap-2.5 text-[13px]">
          {politica.proxima ? (
            <div className="flex justify-between gap-4">
              <dt className="text-[#6b6b6b]">
                {grupal ? "Primera fecha" : "Próxima sesión"}
              </dt>
              <dd className="font-medium text-[#333333] first-letter:uppercase">
                {formatSessionTime(politica.proxima, tz, formato)}
              </dd>
            </div>
          ) : null}
          {until ? (
            <div className="flex justify-between gap-4">
              <dt className="text-[#6b6b6b]">Tiempo restante</dt>
              <dd className="font-medium text-[#333333]">{until.label}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-[#6b6b6b]">
              {grupal ? "Fechas a cancelar" : "Sesiones a cancelar"}
            </dt>
            <dd className="font-medium text-[#333333]">
              {remaining} de {booking.num_sessions}
              {remaining === booking.num_sessions && booking.num_sessions > 1
                ? grupal
                  ? " (el ciclo completo)"
                  : " (paquete completo)"
                : ""}
            </dd>
          </div>
        </dl>
        <div className="mt-3.5 flex items-baseline justify-between border-t border-[#e0e0e0] pt-3.5">
          <span className="text-sm text-[#6b6b6b]">Total a reembolsar</span>
          {/* `a_devolver` lo calcula `politica_de_baja` —lo que se mueve
              AHORA, ya descontado lo devuelto antes (A8)—; aquí solo se PINTA
              en la moneda de quien mira. El reembolso llega en USD, y por eso
              el dólar sigue debajo. */}
          <span className="text-right">
            <Precio
              amountMinor={politica.a_devolver}
              currency={politica.moneda}
              className="text-lg font-bold text-brand"
            />
          </span>
        </div>
        {politica.ya_devuelto > 0 ? (
          <p className="mt-2 text-xs text-[#6b6b6b]">
            Ya te devolvimos{" "}
            <PrecioEnLinea
              amountMinor={politica.ya_devuelto}
              currency={politica.moneda}
            />
            ; ahora te devolvemos{" "}
            <PrecioEnLinea
              amountMinor={politica.a_devolver}
              currency={politica.moneda}
            />
            .
          </p>
        ) : politica.reembolso_total === 0 ? (
          <p className="mt-2 text-xs text-[#6b6b6b]">
            Esta reserva no tiene un pago cobrado: no hay nada que devolver.
          </p>
        ) : null}
        <p className="mt-2 text-xs text-[#6b6b6b]">
          {(pago?.credit_amount ?? 0) > 0
            ? "Pagaste una parte con saldo: esa parte vuelve a tu saldo, no a tu medio de pago, y una mentoría gratis solo se repone si se devuelve el 100 %."
            : "Es el mismo cálculo que se aplica al confirmar la cancelación."}
        </p>
      </section>

      <CancelForm bookingId={booking.id} grupal={grupal} />

      <p className="flex items-center gap-2 text-xs text-[#bf3333]">
        <TriangleAlertIcon className="size-3.5 shrink-0" />
        Esta acción no se puede deshacer.
      </p>
    </PanelShell>
  );
}
