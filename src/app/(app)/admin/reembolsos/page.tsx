import Link from "next/link";

import { getUserTimezone, requireRole } from "@/lib/auth/server";
import { isStripeConfigured } from "@/lib/stripe";
import { formatMoney } from "@/lib/catalog/format";
import { cn } from "@/lib/utils";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/catalog/pager";
import { AdminFilters } from "../payments/filters";
import { esperaDesde } from "../tiempo";
import {
  listRefundRequests,
  refundsSummary,
  type PorMoneda,
  type RefundRequestStatus,
} from "./queries";

export const metadata = { title: "Cola de reembolsos · Enséñame Ya" };

/**
 * ⚠️ `skipped` NO ES UN FALLO, y esa es la distinción que esta pantalla tiene
 * que dejar clarísima. Son los pagos que se rutearon a `'simulated'`: nunca
 * hubo cargo en ningún PSP, así que no hay nada que devolver y el job los cierra
 * a propósito. Pintarlos como error haría creer que hay dinero atascado donde
 * no lo hay — y al revés, acostumbrarse a ver "errores" que no lo son es la
 * mejor forma de no ver el que sí. Por eso van en gris y con su propio texto,
 * no en rojo junto a los fallidos.
 */
const STATUS_BADGE: Record<
  RefundRequestStatus,
  { label: string; tone: PillTone; nota: string }
> = {
  pending: {
    label: "Pendiente",
    tone: "amber",
    nota: "Encolado. Todavía no se ha hablado con el PSP; se reintenta solo.",
  },
  refunded: {
    label: "Devuelto",
    tone: "green",
    nota: "El PSP aceptó la devolución (o confirmó que ya estaba hecha).",
  },
  skipped: {
    label: "Simulado",
    tone: "neutral",
    nota: "El cobro fue simulado: no había nada que mandar al PSP. No es un error.",
  },
  failed: {
    label: "Fallido",
    tone: "red",
    nota: "Error permanente del PSP. Necesita una persona, no un reintento.",
  },
};

const STATUS_OPTIONS = [
  { value: "pending", label: "Pendientes" },
  { value: "failed", label: "Fallidos" },
  { value: "refunded", label: "Devueltos" },
  { value: "skipped", label: "Simulados" },
];

/**
 * SCR-AD17 — la cola de reembolsos de política (X-01, `refund_requests`).
 *
 * QUÉ SE ESTÁ MIRANDO AQUÍ. Cuando se cancela una reserva, la base de datos
 * decide cuánto se devuelve (RN-37 al cancelar, RN-38 si el tutor no responde
 * en 24 h, US-704 si lo corrige el admin), lo escribe en `payments` y **encola**
 * la orden en esta tabla. Quien mueve el dinero de verdad es
 * `/api/cron/refunds-process` contra Stripe. Entre una cosa y otra, el alumno
 * ya ha recibido el correo diciendo que su reembolso está procesado (NTF-10
 * sale al acordarlo, no al ejecutarlo): cada fila `pending` que se quede aquí
 * es una promesa hecha y no cumplida.
 *
 * Solo lectura. Reintentar a mano una fila sería escribir en la cola desde el
 * navegador, y la escritura de esta tabla es del job y solo del job (regla de
 * oro 2): ni siquiera él puede tocar `amount`, que tiene el `grant update`
 * acotado por columnas.
 */
export default async function AdminReembolsosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [tz, { rows, hasMore, count }, resumen] = await Promise.all([
    getUserTimezone(),
    listRefundRequests({ ...sp, page }),
    refundsSummary(),
  ]);

  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") p.set(k, v);
    if (n > 1) p.set("page", String(n));
    const q = p.toString();
    return q ? `/admin/reembolsos?${q}` : "/admin/reembolsos";
  };

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString("es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz, // regla de oro 4
    });

  return (
    <AdminShell
      title="Cola de reembolsos"
      description="Dinero que la plataforma ya dio por devuelto y que todavía no ha salido (X-01 · RN-37 / RN-38 / US-704)."
    >
      {/* Lo primero: ¿hay alguien capaz de ejecutar esto? */}
      {!isStripeConfigured() && resumen.pending > 0 ? (
        <PanelCard className="border-[#f0c987] bg-[#fdf6e7]">
          <p className="text-[13px] font-semibold text-[#8a5a12]">
            No hay PSP configurado en este entorno.
          </p>
          <p className="mt-1 text-[13px] text-[#8a5a12]">
            Sin <code className="font-mono text-xs">STRIPE_API_KEY</code>, el job{" "}
            <code className="font-mono text-xs">/api/cron/refunds-process</code>{" "}
            no toca la cola: las órdenes se quedan{" "}
            <strong>pendientes</strong>, nunca fallidas, y se ejecutarán en la
            primera pasada en cuanto haya credencial.
          </p>
        </PanelCard>
      ) : null}

      {resumen.pending > 0 ? (
        <PanelCard className="border-[#e8b4b4] bg-[#fdf0f0]">
          <p className="text-[13px] font-semibold text-[#8f2b2b]">
            {resumen.pending}{" "}
            {resumen.pending === 1
              ? "reembolso acordado sin ejecutar"
              : "reembolsos acordados sin ejecutar"}
            {resumen.pendingMoney.length > 0
              ? `: ${dinero(resumen.pendingMoney, resumen.truncated)}`
              : ""}
            .
          </p>
          <p className="mt-1 text-[13px] text-[#8f2b2b]">
            El alumno ya recibió el aviso de que su reembolso está procesado. Si
            este número no baja con las horas, quien no está corriendo es{" "}
            <code className="font-mono text-xs">
              /api/cron/refunds-process
            </code>
            : sin su <code className="font-mono text-xs">CRON_SECRET</code> en
            GitHub, el job responde 503 y no toca la cola.
          </p>
        </PanelCard>
      ) : null}

      {/* Los números de `refunds_backlog()`, recalculados aquí (ver queries.ts). */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Pendientes"
          value={String(resumen.pending)}
          sub={dinero(resumen.pendingMoney, resumen.truncated)}
          alerta={resumen.pending > 0}
        />
        <Stat
          label="Fallidos"
          value={String(resumen.failed)}
          sub={dinero(resumen.failedMoney, resumen.truncated)}
          alerta={resumen.failed > 0}
        />
        <Stat label="Devueltos" value={String(resumen.refunded)} />
        <Stat
          label="Simulados"
          value={String(resumen.skipped)}
          sub="pagos sin PSP: nada que devolver"
        />
      </div>

      <p className="text-[13px] text-[#6b6b6b]">
        {resumen.oldestPendingAt ? (
          <>
            El más antiguo sin ejecutar se encoló{" "}
            {esperaDesde(resumen.oldestPendingAt)} (
            {fecha(resumen.oldestPendingAt)}).
          </>
        ) : (
          <>Nada pendiente: no hay dinero acordado sin salir. 🎉</>
        )}{" "}
        ¿Quieres provocar un reembolso del 100 % para comprobar este camino de
        punta a punta?{" "}
        <Link
          href="/admin/operaciones"
          className="font-semibold text-brand hover:underline"
        >
          Vencer reservas caducadas
        </Link>
        .
      </p>

      <AdminFilters
        basePath="/admin/reembolsos"
        fields={[
          {
            name: "status",
            label: "Estado",
            type: "select",
            options: STATUS_OPTIONS,
          },
        ]}
      />

      {rows.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            No hay reembolsos con estos filtros.
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <p className="pb-1 pt-2 text-xs text-[#6b6b6b]">
            {count} {count === 1 ? "solicitud" : "solicitudes"} con estos
            filtros.
          </p>
          <ul className="divide-y divide-[#e0e0e0]">
            {rows.map((r) => {
              const badge = STATUS_BADGE[r.status];
              const simulado = r.status === "skipped";
              return (
                <li key={r.id} className="flex flex-col gap-2.5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 sm:w-96">
                      <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                        {formatMoney(r.amount, r.currency)} ·{" "}
                        {r.bookingRef ?? `#${r.bookingId.slice(0, 8)}`}
                      </p>
                      {/* El motivo lo escribe quien decidió el importe
                          (RN-37/RN-38/US-704). Es lo primero que mira quien
                          concilia, así que va entero, sin recortar. */}
                      <p className="text-xs text-[#6b6b6b]">{r.reason}</p>
                    </div>

                    <div className="min-w-0">
                      <p className="text-[11.5px] text-[#6b6b6b]">Mentoría</p>
                      <p className="max-w-[220px] truncate text-[13px] font-medium text-[#404040]">
                        {r.productTitle}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <p className="text-[11.5px] text-[#6b6b6b]">
                        {r.processedAt
                          ? "Resuelto"
                          : r.lastAttemptAt
                            ? "Último intento"
                            : "Encolado"}
                      </p>
                      <p className="text-[13px] font-medium text-[#404040] tabular-nums">
                        {fecha(r.processedAt ?? r.lastAttemptAt ?? r.createdAt)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <StatusPill tone={badge.tone}>
                        {badge.label}
                      </StatusPill>
                      <Button
                        asChild
                        variant="outline"
                        className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                      >
                        <Link href={`/admin/bookings/${r.bookingId}`}>
                          Reserva
                        </Link>
                      </Button>
                      <Button
                        asChild
                        variant="outline"
                        className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                      >
                        <Link href={`/admin/payments/${r.paymentId}`}>Pago</Link>
                      </Button>
                    </div>
                  </div>

                  {/* Segunda línea: el detalle técnico, en gris y sin gritar
                      cuando es un simulado. */}
                  <p
                    className={cn(
                      "text-xs",
                      simulado ? "text-[#8c8c8c]" : "text-[#6b6b6b]",
                    )}
                  >
                    {badge.nota} · Proveedor {r.provider}
                    {r.providerPaymentId ? ` · ${r.providerPaymentId}` : ""}
                    {r.providerRefundId ? ` → ${r.providerRefundId}` : ""} ·
                    encolado {esperaDesde(r.createdAt)}
                  </p>

                  {/* `last_error` se conserva aunque después se resuelva: un
                      reembolso que costó tres intentos es información. */}
                  {r.lastError ? (
                    <p className="rounded-[8px] bg-[#f7dede] px-3 py-2 font-mono text-[11.5px] break-words text-[#8f2b2b]">
                      {r.lastError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </PanelCard>
      )}

      <Pager page={page} hasMore={hasMore} hrefFor={pageHref} />

      {/*
        ⚠️ "INTENTOS" NO EXISTE COMO NÚMERO. La tabla guarda `last_attempt_at` y
        `last_error`, no un contador: por el diseño de la cola, una fila se
        reintenta indefinidamente mientras el fallo sea transitorio y solo pasa
        a 'failed' cuando es permanente, así que nunca hizo falta contarlos para
        decidir nada. Se enseña la fecha del último intento, que es el dato que
        sí está. Añadir `attempts int` es una migración, y no es de este carril.
      */}
      <p className="text-xs text-[#6b6b6b]">
        La cola no lleva un contador de intentos: se enseña la fecha del último.
        Una solicitud se reintenta sola mientras el error sea transitorio; pasa a
        «fallido» solo cuando el PSP responde algo definitivo.
      </p>
    </AdminShell>
  );
}

/** "18,00 US$" o "18,00 US$ + 12,00 €" — nunca una suma de monedas (RN-13). */
function dinero(porMoneda: PorMoneda, truncado: boolean): string {
  if (porMoneda.length === 0) return "";
  const texto = porMoneda
    .map((m) => formatMoney(m.amount, m.currency))
    .join(" + ");
  return truncado ? `≥ ${texto}` : texto;
}

function Stat({
  label,
  value,
  sub,
  alerta,
}: {
  label: string;
  value: string;
  sub?: string;
  alerta?: boolean;
}) {
  return (
    <PanelCard className="p-5">
      <p className="text-xs text-[#6b6b6b]">{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate text-2xl font-bold tabular-nums",
          alerta ? "text-[#bf3333]" : "text-[#19191f]",
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 truncate text-xs text-[#6b6b6b]">{sub}</p>
      ) : null}
    </PanelCard>
  );
}
