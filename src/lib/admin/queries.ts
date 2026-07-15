import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

/**
 * Consultas de supervisión del admin (US-1104, SCR-AD06..AD10).
 * Todo pasa por RLS con la sesión del admin (`*_select_admin`, EP-06 Fase 1);
 * el `service_role` no aparece. Son lecturas: el reembolso es US-704.
 */

export type PaymentStatus = Database["public"]["Enums"]["payment_status"];
export type BookingStatus = Database["public"]["Enums"]["booking_status"];

const PAGE_SIZE = 20;

/**
 * Los filtros llegan de la query string, o sea que son texto arbitrario que
 * escribe quien quiera (`?status=loquesea`). Si eso llegara al enum, Postgres
 * respondería `invalid input value for enum` y la pantalla se caería. Se
 * validan contra los valores reales y lo que no encaje **se ignora**: un filtro
 * inventado no rompe, simplemente no filtra.
 */
const PAYMENT_STATUSES: PaymentStatus[] = [
  "pending",
  "authorized",
  "paid",
  "failed",
  "partially_refunded",
  "refunded",
];
const BOOKING_STATUSES: BookingStatus[] = [
  "pending_payment",
  "pending_acceptance",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "refunded",
];

function asPaymentStatus(v?: string): PaymentStatus | undefined {
  return PAYMENT_STATUSES.find((s) => s === v);
}
function asBookingStatus(v?: string): BookingStatus | undefined {
  return BOOKING_STATUSES.find((s) => s === v);
}

export type PaymentFilters = {
  status?: string;
  provider?: string;
  country?: string;
  from?: string;
  to?: string;
  page?: number;
};

export type PaymentListRow = {
  id: string;
  bookingId: string;
  status: PaymentStatus;
  currency: string;
  grossAmount: number;
  platformFeeAmount: number;
  tutorNetAmount: number;
  refundedAmount: number;
  provider: string | null;
  payeeCountry: string | null;
  createdAt: string;
  productTitle: string;
};

export type PaymentTotals = {
  count: number;
  gross: number;
  fee: number;
  net: number;
  refunded: number;
  currencies: string[];
};

/** `select` compartido por lista y totales: una sola forma que mantener. */
const PAYMENT_COLS =
  "id, booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount, refunded_amount, provider, payee_country, created_at, bookings(products(title))";

type PaymentRow = {
  id: string;
  booking_id: string;
  status: PaymentStatus;
  currency: string;
  gross_amount: number;
  platform_fee_amount: number;
  tutor_net_amount: number;
  refunded_amount: number;
  provider: string | null;
  payee_country: string | null;
  created_at: string;
  bookings: { products: { title: string } | null } | null;
};

function toPaymentRow(p: PaymentRow): PaymentListRow {
  return {
    id: p.id,
    bookingId: p.booking_id,
    status: p.status,
    currency: p.currency,
    grossAmount: p.gross_amount,
    platformFeeAmount: p.platform_fee_amount,
    tutorNetAmount: p.tutor_net_amount,
    refundedAmount: p.refunded_amount,
    provider: p.provider,
    payeeCountry: p.payee_country,
    createdAt: p.created_at,
    productTitle: p.bookings?.products?.title ?? "—",
  };
}

/**
 * Rango de fechas → instantes UTC. El usuario elige DÍAS (`input type=date`),
 * así que `to` se compara contra el día siguiente en exclusiva: si no, los
 * registros de esa misma jornada se quedarían fuera del filtro.
 *
 * Igual que con los estados, el valor viene de la query string y puede ser
 * cualquier cosa. Una fecha inválida se **ignora**; sin esto, `?from=basura`
 * dejaba la lista en cero (la consulta fallaba y el `?? []` se lo tragaba),
 * que es peor que no filtrar: parece que no hay datos.
 */
function asDay(v?: string): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? undefined : v;
}

function dayRange(from?: string, to?: string) {
  const f = asDay(from);
  const t = asDay(to);

  let toExclusive: string | undefined;
  if (t) {
    const next = new Date(`${t}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    toExclusive = next.toISOString();
  }
  return { fromInclusive: f ? `${f}T00:00:00Z` : undefined, toExclusive };
}

export async function listPayments(f: PaymentFilters): Promise<{
  payments: PaymentListRow[];
  hasMore: boolean;
  totals: PaymentTotals;
}> {
  const supabase = await createClient();
  const page = Math.max(1, f.page ?? 1);
  const fromIdx = (page - 1) * PAGE_SIZE;
  const { fromInclusive, toExclusive } = dayRange(f.from, f.to);

  // ponytail: los filtros se repiten en las dos consultas. Un helper genérico
  // sobre el query builder de Supabase obliga a castear a `any` y pierde el
  // tipado: seis líneas duplicadas salen más baratas que eso.
  const status = asPaymentStatus(f.status);

  let list = supabase.from("payments").select(PAYMENT_COLS);
  if (status) list = list.eq("status", status);
  if (f.provider) list = list.eq("provider", f.provider);
  if (f.country) list = list.eq("payee_country", f.country);
  if (fromInclusive) list = list.gte("created_at", fromInclusive);
  if (toExclusive) list = list.lt("created_at", toExclusive);

  const { data } = await list
    .order("created_at", { ascending: false })
    .range(fromIdx, fromIdx + PAGE_SIZE); // pide 1 de más → sabe si hay página siguiente

  const rows = (data ?? []) as unknown as PaymentRow[];
  const hasMore = rows.length > PAGE_SIZE;

  // ponytail: los totales se suman aquí sobre TODAS las filas filtradas (no
  // solo la página). Sirve al volumen del MVP; si crece, un RPC de agregación
  // — PostgREST no sabe sumar sin vista o función.
  let totalsQ = supabase
    .from("payments")
    .select("currency, gross_amount, platform_fee_amount, tutor_net_amount, refunded_amount");
  if (status) totalsQ = totalsQ.eq("status", status);
  if (f.provider) totalsQ = totalsQ.eq("provider", f.provider);
  if (f.country) totalsQ = totalsQ.eq("payee_country", f.country);
  if (fromInclusive) totalsQ = totalsQ.gte("created_at", fromInclusive);
  if (toExclusive) totalsQ = totalsQ.lt("created_at", toExclusive);

  const { data: allRows } = await totalsQ;
  const all = allRows ?? [];

  const totals: PaymentTotals = {
    count: all.length,
    gross: all.reduce((s, r) => s + r.gross_amount, 0),
    fee: all.reduce((s, r) => s + r.platform_fee_amount, 0),
    net: all.reduce((s, r) => s + r.tutor_net_amount, 0),
    refunded: all.reduce((s, r) => s + r.refunded_amount, 0),
    // Sumar monedas distintas daría un número sin sentido: se avisa en la UI.
    currencies: [...new Set(all.map((r) => r.currency))],
  };

  return { payments: rows.slice(0, PAGE_SIZE).map(toPaymentRow), hasMore, totals };
}

/** Proveedores presentes, para poblar el filtro sin hardcodear (S-16). */
export async function listPaymentProviders(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("payments").select("provider").not("provider", "is", null);
  return [...new Set((data ?? []).map((r) => r.provider as string))].sort();
}

export type PaymentDetail = {
  payment: {
    id: string;
    bookingId: string;
    status: PaymentStatus;
    currency: string;
    grossAmount: number;
    platformFeeAmount: number;
    tutorNetAmount: number;
    tierSplitPct: number;
    refundedAmount: number;
    provider: string | null;
    providerPaymentId: string | null;
    payerCountry: string | null;
    payeeCountry: string | null;
    createdAt: string;
    paidAt: string | null;
    failedAt: string | null;
    updatedAt: string;
  };
  productTitle: string;
  webhookEvents: { eventId: string; processedAt: string }[];
};

export async function getPaymentDetail(id: string): Promise<PaymentDetail | null> {
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("payments")
    .select(
      "id, booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount, tier_split_pct, refunded_amount, provider, provider_payment_id, payer_country, payee_country, created_at, paid_at, failed_at, updated_at, bookings(products(title))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!p) return null;

  // El log real del proveedor (US-703). Sin eventos y en `pending` → el webhook
  // no llegó: es la primera pista de soporte.
  const { data: events } = await supabase
    .from("payment_webhook_events")
    .select("event_id, processed_at")
    .eq("booking_id", p.booking_id)
    .order("processed_at");

  return {
    payment: {
      id: p.id,
      bookingId: p.booking_id,
      status: p.status,
      currency: p.currency,
      grossAmount: p.gross_amount,
      platformFeeAmount: p.platform_fee_amount,
      tutorNetAmount: p.tutor_net_amount,
      tierSplitPct: Number(p.tier_split_pct),
      refundedAmount: p.refunded_amount,
      provider: p.provider,
      providerPaymentId: p.provider_payment_id,
      payerCountry: p.payer_country,
      payeeCountry: p.payee_country,
      createdAt: p.created_at,
      paidAt: p.paid_at,
      failedAt: p.failed_at,
      updatedAt: p.updated_at,
    },
    productTitle: p.bookings?.products?.title ?? "—",
    webhookEvents: (events ?? []).map((e) => ({
      eventId: e.event_id,
      processedAt: e.processed_at,
    })),
  };
}

export type BookingListRow = {
  id: string;
  status: BookingStatus;
  currency: string;
  totalAmount: number;
  createdAt: string;
  productTitle: string;
  studentName: string;
  tutorName: string;
};

export async function listBookings(f: {
  status?: string;
  from?: string;
  to?: string;
  page?: number;
}): Promise<{ bookings: BookingListRow[]; hasMore: boolean; count: number }> {
  const supabase = await createClient();
  const page = Math.max(1, f.page ?? 1);
  const fromIdx = (page - 1) * PAGE_SIZE;

  const { fromInclusive, toExclusive } = dayRange(f.from, f.to);

  let q = supabase
    .from("bookings")
    .select(
      "id, status, currency, total_amount, created_at, products(title), student:profiles!bookings_student_id_fkey(full_name), tutor:profiles!bookings_tutor_id_fkey(full_name)",
      { count: "exact" },
    );

  const status = asBookingStatus(f.status);
  if (status) q = q.eq("status", status);
  if (fromInclusive) q = q.gte("created_at", fromInclusive);
  if (toExclusive) q = q.lt("created_at", toExclusive);

  const { data, count } = await q
    .order("created_at", { ascending: false })
    .range(fromIdx, fromIdx + PAGE_SIZE);

  const rows = data ?? [];
  return {
    bookings: rows.slice(0, PAGE_SIZE).map((b) => ({
      id: b.id,
      status: b.status,
      currency: b.currency,
      totalAmount: b.total_amount,
      createdAt: b.created_at,
      productTitle: b.products?.title ?? "—",
      studentName: b.student?.full_name ?? "—",
      tutorName: b.tutor?.full_name ?? "—",
    })),
    hasMore: rows.length > PAGE_SIZE,
    count: count ?? 0,
  };
}

export type BookingDetail = {
  booking: {
    id: string;
    status: BookingStatus;
    currency: string;
    totalAmount: number;
    tierSplitPct: number;
    numSessions: number;
    sessionDurationMin: number;
    createdAt: string;
    completedAt: string | null;
    cancelledAt: string | null;
    updatedAt: string;
  };
  productTitle: string;
  studentName: string;
  tutorName: string;
  payment: {
    id: string;
    status: PaymentStatus;
    grossAmount: number;
    refundedAmount: number;
    provider: string | null;
  } | null;
  sessions: {
    id: string;
    sequenceNo: number | null;
    startAt: string;
    endAt: string;
    status: string;
  }[];
};

export async function getBookingDetail(id: string): Promise<BookingDetail | null> {
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, status, currency, total_amount, tier_split_pct, num_sessions, session_duration_min, created_at, completed_at, cancelled_at, updated_at, products(title), student:profiles!bookings_student_id_fkey(full_name), tutor:profiles!bookings_tutor_id_fkey(full_name), payments(id, status, gross_amount, refunded_amount, provider), sessions(id, sequence_no, start_at, end_at, status)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!b) return null;

  // `payments.booking_id` es UNIQUE (1:1), así que Supabase lo devuelve como
  // objeto, no como array — al contrario que `sessions` (1:N).
  const pay = b.payments ?? null;
  return {
    booking: {
      id: b.id,
      status: b.status,
      currency: b.currency,
      totalAmount: b.total_amount,
      tierSplitPct: Number(b.tier_split_pct),
      numSessions: b.num_sessions,
      sessionDurationMin: b.session_duration_min,
      createdAt: b.created_at,
      completedAt: b.completed_at,
      cancelledAt: b.cancelled_at,
      updatedAt: b.updated_at,
    },
    productTitle: b.products?.title ?? "—",
    studentName: b.student?.full_name ?? "—",
    tutorName: b.tutor?.full_name ?? "—",
    payment: pay
      ? {
          id: pay.id,
          status: pay.status,
          grossAmount: pay.gross_amount,
          refundedAmount: pay.refunded_amount,
          provider: pay.provider,
        }
      : null,
    sessions: (b.sessions ?? [])
      .map((s) => ({
        id: s.id,
        sequenceNo: s.sequence_no,
        startAt: s.start_at,
        endAt: s.end_at,
        status: s.status as string,
      }))
      .sort((a, z) => a.startAt.localeCompare(z.startAt)),
  };
}
