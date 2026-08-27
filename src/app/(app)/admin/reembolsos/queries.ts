import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

/**
 * Cola de reembolsos (`refund_requests`, migración `20260817170000` — X-01)
 * para el panel de operaciones.
 *
 * ESTA ES LA COLA QUE IMPORTA. La de correos, si se atasca, retrasa avisos;
 * esta es dinero que la plataforma YA le dijo al alumno que le había devuelto
 * —`payments.status = 'refunded'` y el correo NTF-10 salen al ACORDAR el
 * reembolso, no al ejecutarlo— y que sigue sin salir de la cuenta. Los Términos
 * publicados hoy, §13, prometen la devolución al método de pago original.
 * Hasta que `/api/cron/refunds-process` la vacíe, esa promesa está incumplida y
 * hasta hoy no había forma de verlo si no era por SQL.
 *
 * SIN MIGRACIÓN: la tabla ya nació (hoy mismo) con `refund_requests_select_admin`
 * (`using ( public.has_role('admin') )`) y `grant select ... to authenticated`.
 * El admin la ve entera con su propia sesión; no se usa `service_role` para
 * leerla, por lo mismo que en la cola de correos (regla de oro 3).
 *
 * ⚠️ NO CONFUNDIR CON `late_payment_refunds` (X-02, `20260817160000`). Aquella
 * anota cobros que NO DEBIERON OCURRIR y que el webhook devuelve enteros en el
 * acto. Esta es el reembolso DE LA POLÍTICA (RN-37 / RN-38 / US-704) sobre un
 * cobro legítimo: puede ser parcial y se ejecuta en diferido.
 */

export type RefundRequestStatus =
  Database["public"]["Enums"]["refund_request_status"];

const STATUSES: RefundRequestStatus[] = [
  "pending",
  "refunded",
  "skipped",
  "failed",
];

/** Texto de la query string → enum, o nada. Igual que en el resto del panel. */
function asStatus(v?: string): RefundRequestStatus | undefined {
  return STATUSES.find((s) => s === v);
}

const PAGE_SIZE = 25;

/**
 * Tope al leer importes para sumarlos. La cola vive vacía y solo se llena
 * cuando algo se rompe (por eso su índice de pendientes es parcial), así que
 * 500 filas es un techo que no se debería tocar nunca. Si se toca, el contador
 * —que es exacto, va por `count`— lo dice, y el total sale marcado como
 * incompleto en vez de mentir por lo bajo.
 */
const TOPE_SUMA = 500;

export type RefundRequestRow = {
  id: string;
  status: RefundRequestStatus;
  amount: number;
  currency: string;
  reason: string;
  provider: string;
  providerPaymentId: string | null;
  providerRefundId: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  processedAt: string | null;
  createdAt: string;
  paymentId: string;
  bookingId: string;
  bookingRef: string | null;
  productTitle: string;
};

export async function listRefundRequests(f: {
  status?: string;
  page?: number;
}): Promise<{ rows: RefundRequestRow[]; hasMore: boolean; count: number }> {
  const supabase = await createClient();
  const page = Math.max(1, f.page ?? 1);
  const fromIdx = (page - 1) * PAGE_SIZE;

  let q = supabase
    .from("refund_requests")
    .select(
      "id, status, amount, currency, reason, provider, provider_payment_id, provider_refund_id, last_error, last_attempt_at, processed_at, created_at, payment_id, booking_id, bookings(booking_ref, products(title))",
      { count: "exact" },
    );

  const status = asStatus(f.status);
  if (status) q = q.eq("status", status);

  const { data, count } = await q
    // Lo más viejo primero **cuando se miran las pendientes** es lo que quiere
    // quien concilia; pero por defecto manda el orden del resto del panel, y
    // el resumen ya destaca la más antigua. Aquí: recientes primero.
    .order("created_at", { ascending: false })
    .range(fromIdx, fromIdx + PAGE_SIZE); // uno de más → ¿hay página siguiente?

  const rows = data ?? [];

  return {
    rows: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: r.id,
      status: r.status,
      amount: r.amount,
      currency: r.currency,
      reason: r.reason,
      provider: r.provider,
      providerPaymentId: r.provider_payment_id,
      providerRefundId: r.provider_refund_id,
      lastError: r.last_error,
      lastAttemptAt: r.last_attempt_at,
      processedAt: r.processed_at,
      createdAt: r.created_at,
      paymentId: r.payment_id,
      bookingId: r.booking_id,
      bookingRef: r.bookings?.booking_ref ?? null,
      productTitle: r.bookings?.products?.title ?? "Mentoría",
    })),
    hasMore: rows.length > PAGE_SIZE,
    count: count ?? 0,
  };
}

/** Importe acumulado por moneda: sumar monedas distintas no significa nada (RN-13). */
export type PorMoneda = { currency: string; amount: number }[];

export type RefundsSummary = {
  pending: number;
  failed: number;
  refunded: number;
  skipped: number;
  pendingMoney: PorMoneda;
  failedMoney: PorMoneda;
  /** `true` si había más filas de las que se leyeron para sumar (`TOPE_SUMA`). */
  truncated: boolean;
  oldestPendingAt: string | null;
};

/**
 * Los mismos números que `select public.refunds_backlog();`, que es el
 * termómetro que dejó X-01 para mirar desde el SQL editor. Se recalculan aquí
 * en vez de llamar a la RPC porque esa función solo la puede ejecutar
 * `service_role` (tiene sus tres `revoke` y un único `grant`), y el admin ya ve
 * la tabla entera por política: llamarla obligaría a meter la clave que se
 * salta la RLS en el render de una pantalla, sin ganar ni una fila.
 *
 * Si `pendientes` no baja con el paso de las horas, el que no está corriendo es
 * `/api/cron/refunds-process`. Lo dispara GitHub Actions, y sin la variable
 * `APP_BASE_URL` y el secret `CRON_SECRET` el job falla cerrado (503) sin tocar
 * la cola — que es exactamente el fallo silencioso que esta pantalla existe
 * para hacer visible.
 */
export async function refundsSummary(): Promise<RefundsSummary> {
  const supabase = await createClient();

  const contar = (status: RefundRequestStatus) =>
    supabase
      .from("refund_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

  const importes = (status: RefundRequestStatus) =>
    supabase
      .from("refund_requests")
      .select("amount, currency, created_at")
      .eq("status", status)
      .order("created_at", { ascending: true })
      .limit(TOPE_SUMA);

  const [pending, failed, refunded, skipped, pendRows, failRows] =
    await Promise.all([
      contar("pending"),
      contar("failed"),
      contar("refunded"),
      contar("skipped"),
      importes("pending"),
      importes("failed"),
    ]);

  const sumar = (rows: { amount: number; currency: string }[] | null): PorMoneda => {
    const acc = new Map<string, number>();
    for (const r of rows ?? [])
      acc.set(r.currency, (acc.get(r.currency) ?? 0) + r.amount);
    return [...acc].map(([currency, amount]) => ({ currency, amount }));
  };

  return {
    pending: pending.count ?? 0,
    failed: failed.count ?? 0,
    refunded: refunded.count ?? 0,
    skipped: skipped.count ?? 0,
    pendingMoney: sumar(pendRows.data),
    failedMoney: sumar(failRows.data),
    truncated:
      (pendRows.data?.length ?? 0) >= TOPE_SUMA ||
      (failRows.data?.length ?? 0) >= TOPE_SUMA,
    // `importes('pending')` ya viene ordenado ascendente por fecha.
    oldestPendingAt: pendRows.data?.[0]?.created_at ?? null,
  };
}
