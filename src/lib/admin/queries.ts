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
  /**
   * El cargo por servicio que pagó el ALUMNO, ya sumado DENTRO de `grossAmount`
   * (`20260916120000`). ⚠️ Desde el 16-sep-2026 el invariante es
   * `gross = platformFee + tutorNet + serviceFee`: Bruto, Comisión y Neto YA NO
   * SUMAN sin esta cuarta cifra. 0 en todo lo anterior.
   */
  serviceFeeAmount: number;
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
  /** Cargo por servicio cobrado al alumno, ya dentro de `gross`. */
  serviceFee: number;
  refunded: number;
  currencies: string[];
};

/** `select` compartido por lista y totales: una sola forma que mantener. */
const PAYMENT_COLS =
  "id, booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount, service_fee_amount, refunded_amount, provider, payee_country, created_at, bookings(products(title))";

type PaymentRow = {
  id: string;
  booking_id: string;
  status: PaymentStatus;
  currency: string;
  gross_amount: number;
  platform_fee_amount: number;
  tutor_net_amount: number;
  service_fee_amount: number;
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
    serviceFeeAmount: p.service_fee_amount,
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
    .select("currency, gross_amount, platform_fee_amount, tutor_net_amount, service_fee_amount, refunded_amount");
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
    serviceFee: all.reduce((s, r) => s + r.service_fee_amount, 0),
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
    /** Cargo por servicio del alumno, ya dentro de `grossAmount`. */
    serviceFeeAmount: number;
    /** El % con el que nació esta fila. 0 = anterior al cargo por servicio. */
    serviceFeePct: number;
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
      "id, booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount, service_fee_amount, service_fee_pct, tier_split_pct, refunded_amount, provider, provider_payment_id, payer_country, payee_country, created_at, paid_at, failed_at, updated_at, bookings(products(title))",
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
      serviceFeeAmount: p.service_fee_amount,
      serviceFeePct: Number(p.service_fee_pct),
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
    /** Motivo declarado en AL07 (decisión 23). Nulo si canceló el cron o el tutor. */
    cancelReason: string | null;
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
    status: Database["public"]["Enums"]["session_status"];
  }[];
};

export async function getBookingDetail(id: string): Promise<BookingDetail | null> {
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, status, currency, total_amount, tier_split_pct, num_sessions, session_duration_min, created_at, completed_at, cancelled_at, cancel_reason, updated_at, products(title), student:profiles!bookings_student_id_fkey(full_name), tutor:profiles!bookings_tutor_id_fkey(full_name), payments(id, status, gross_amount, refunded_amount, provider), sessions(id, sequence_no, start_at, end_at, status)",
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
      cancelReason: b.cancel_reason,
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
        status: s.status,
      }))
      .sort((a, z) => a.startAt.localeCompare(z.startAt)),
  };
}

/* ==========================================================================
 * MN-14a · Registro de clases impartidas (`tutor_teaching_record`)
 *
 * Sale de la minuta del 17-ago: la campaña de tutores «considerando el registro
 * de las últimas clases impartidas». El motor de promociones está bloqueado por
 * P-9 (quién absorbe el descuento); esto es la parte que se sostiene sola —
 * quién está activo, cuánto ha dado y desde cuándo.
 *
 * MÉTRICA INTERNA. No hay superficie pública que la enseñe y no debe haberla
 * sin decisión de producto: ver la cabecera de `20260820160000`. La barrera de
 * verdad está DENTRO de la función (`has_role('admin')`), no en este fichero.
 *
 * A diferencia del resto de este módulo —que lee tablas por RLS— aquí se llama
 * a una RPC: son agregados sobre todas las sesiones de la plataforma, y traerse
 * `sessions` entera al servidor de Next para contarla en JS sería el error que
 * `20260715190000` ya razonó para `admin_stats`.
 * ========================================================================== */

export type TutorTeachingRow = {
  tutorId: string;
  nombre: string;
  correo: string | null;
  /**
   * ⚠️ No significa lo mismo que en `StudentLearningRow`. Allí su ausencia
   * delata una cuenta nacida en el checkout de invitado; aquí no hay tal vía:
   * `/tutor/onboarding` también lo exige, así que a un tutor aprobado no
   * debería faltarle. Si falta, es una cuenta sembrada o anterior a RN-44.
   */
  telefono: string | null;
  aprobado: boolean;
  /** ⚠️ `impartidas` y `noShows` NO se suman: DP-08 sigue abierta. */
  impartidas: number;
  noShows: number;
  alumnosDistintos: number;
  primeraClase: string | null;
  ultimaClase: string | null;
};

/**
 * ⚠️ El generador de tipos de Supabase declara `primera_clase`, `ultima_clase`,
 * `tutor_nombre`, `correo` y `telefono` como `string` a secas, y todas **son
 * nulables**: un
 * `min()`/`max()` sobre cero filas devuelve NULL —el caso de todo tutor sin
 * clases en la ventana, o sea la mitad de las filas— y el nombre sale de un
 * `coalesce(full_name, display_name)` que puede quedarse sin ninguno de los
 * dos. El generador no puede saberlo: para él es el tipo de la columna del
 * `returns table`, y ahí no hay `not null` que declarar. Se corrige aquí, en la
 * frontera, para que ninguna pantalla se coma un `new Date(undefined)`. No
 * editar `database.types.ts` a mano (regla de oro 6).
 */
type RpcRow = Omit<
  Database["public"]["Functions"]["tutor_teaching_record"]["Returns"][number],
  "primera_clase" | "ultima_clase" | "tutor_nombre" | "correo" | "telefono"
> & {
  primera_clase: string | null;
  ultima_clase: string | null;
  tutor_nombre: string | null;
  correo: string | null;
  telefono: string | null;
};

/**
 * Registro de docencia de TODOS los tutores, ya ordenado por actividad.
 *
 * ⚠️ La ventana se aplica a la fila entera: con `from`/`to`, `ultimaClase` es la
 * última clase **dentro** de la ventana, no la última en absoluto. Es lo que se
 * quiere para segmentar («quién está activo ahora»), pero hay que decirlo en la
 * pantalla o el número engaña. Sin ventana, es el histórico completo.
 *
 * Las fechas se validan con el mismo `asDay` que el resto del panel: lo que
 * llegue roto por la query string se ignora en vez de tumbar la consulta.
 */
export async function tutorTeachingRecord(f: {
  from?: string;
  to?: string;
}): Promise<TutorTeachingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tutor_teaching_record", {
    p_from: asDay(f.from),
    p_to: asDay(f.to),
  });

  // Regla de oro 10, que a esta función le faltaba: `const { data } = …`
  // convertía un fallo de la RPC en una lista vacía, y «ningún tutor ha dado
  // clase» es una mentira perfectamente creíble en esa pantalla.
  if (error)
    throw new Error(`No se pudo leer el registro de docencia: ${error.message}`);

  return ((data ?? []) as RpcRow[]).map((r) => ({
    tutorId: r.tutor_id,
    nombre: r.tutor_nombre ?? "Tutor sin nombre",
    correo: r.correo,
    telefono: r.telefono,
    aprobado: r.aprobado,
    impartidas: r.impartidas,
    noShows: r.no_shows,
    alumnosDistintos: r.alumnos_distintos,
    primeraClase: r.primera_clase,
    ultimaClase: r.ultima_clase,
  }));
}

/* ==========================================================================
 * La ficha del alumno (`student_learning_record`)
 *
 * Empezó siendo el espejo de `tutor_teaching_record` y el cliente la convirtió
 * en otra cosa el mismo día: la lista se queda en nombre y correo, y el detalle
 * se abre aparte con «toda la información del estudiante». Así que esto ya no
 * es una fila de métricas, es un expediente.
 *
 * ⚠️ Se trae la ficha ENTERA de TODOS los alumnos en cada carga de la lista, y
 * es deliberado: así el modal se abre sin pedir nada y el CSV sale de lo mismo
 * que la pantalla, sin un segundo sitio donde se defina qué es «toda la
 * información». El techo está medido y escrito en `20260917170000`: ~1,5 KB por
 * alumno, o sea 30 KB con los 19 de dev y 1,5 MB con mil. Ese día se parte en
 * dos usando `p_resumen`/`p_student_id`, que ya están en la firma.
 *
 * Lo que NO trae, porque no se puede y está razonado en sus migraciones: el
 * chat (`conversations`/`messages` no tienen política de admin) y la navegación
 * (`tutor_views` tampoco). Por eso «tutores» aquí son clases dadas, no fichas
 * vistas.
 * ========================================================================== */

/** `[{currency, gastado, devuelto}]` — nunca una sola cifra: RN-13. */
export type DineroPorMoneda = {
  currency: string;
  gastado: number;
  devuelto: number;
};

export type StudentLearningRow = {
  studentId: string;
  nombre: string;
  correo: string | null;
  /**
   * ⚠️ Su AUSENCIA significa algo. El paso 3 de `/onboarding` lo exige para
   * marcar `onboarding_complete`, así que un alumno sin teléfono no terminó el
   * registro por la puerta normal — o entró por `/api/checkout/invitado`, que
   * da el onboarding por hecho para no romper el cobro.
   */
  telefono: string | null;
  zonaHoraria: string | null;
  alta: string;
  objetivo: string | null;
  onboardingCompleto: boolean;
  intereses: string[];
  suspendido: boolean;
  suspension: { desde: string; motivo: string | null } | null;
  baja: { estado: string; solicitada: string; completada: string | null } | null;
  /** Las que llegaron a pagarse (criterio de `pair_booking_stats`). */
  reservas: number;
  reservasDetalle: { estado: string; n: number }[];
  /** ⚠️ `tomadas` y `noShows` NO se suman: DP-08 sigue abierta. */
  tomadas: number;
  noShows: number;
  canceladas: number;
  tutoresDistintos: number;
  /** Con quién ha dado más clases — «favoritos» por lo que hizo, no por lo que miró. */
  tutores: { nombre: string; mentorias: number }[];
  primeraClase: string | null;
  ultimaClase: string | null;
  /** ⚠️ NO se acota al período: «qué tiene por delante» es de hoy. */
  proximaClase: string | null;
  /** `gastado` es de su bolsillo (bruto − crédito), no el GMV. */
  gastado: DineroPorMoneda[];
  pagos: number;
  mediosDePago: string[];
  creditoDisponible: { currency: string; saldo: number }[];
  resenas: number;
  notaMedia: number | null;
  codigoReferido: string | null;
  vinoReferido: boolean;
  terminos: { version: string; aceptados: string } | null;
};

/**
 * ⚠️ El agujero de siempre del generador de tipos, ahora en nueve columnas: un
 * `min()`/`max()` sobre cero filas devuelve NULL, `profiles.full_name` es
 * nulable de verdad y los `jsonb` llegan como `Json`, que no dice nada de su
 * forma. Se corrige aquí, en la frontera, y `database.types.ts` no se edita a
 * mano (regla de oro 6).
 */
type StudentRpcRow = Record<string, unknown>;

/** `Json` → array tipado. La función SQL garantiza el array; el tipo no. */
function lista<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * La ficha de TODOS los alumnos, ya ordenada por actividad.
 *
 * ⚠️ La ventana recorta casi toda la fila: con `from`/`to`, «gastado» es lo
 * gastado DENTRO de la ventana. Se salvan a propósito el alta, el saldo de
 * crédito y la próxima clase, que son estados de hoy y no del período.
 */
export async function studentLearningRecord(f: {
  from?: string;
  to?: string;
}): Promise<StudentLearningRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_learning_record", {
    p_from: asDay(f.from),
    p_to: asDay(f.to),
  });

  // Regla de oro 10: `const { data } = …` convertiría un fallo de la RPC en una
  // lista vacía, y «este sitio no tiene alumnos» es una mentira muy creíble.
  if (error)
    throw new Error(`No se pudo leer la ficha de los alumnos: ${error.message}`);

  return ((data ?? []) as StudentRpcRow[]).map((r) => ({
    studentId: r.student_id as string,
    nombre: (r.alumno_nombre as string | null) ?? "Alumno sin nombre",
    correo: r.correo as string | null,
    telefono: r.telefono as string | null,
    zonaHoraria: r.zona_horaria as string | null,
    alta: r.alta as string,
    objetivo: r.objetivo as string | null,
    onboardingCompleto: r.onboarding_completo as boolean,
    intereses: lista<string>(r.intereses),
    suspendido: r.suspendido as boolean,
    suspension: (r.suspension as StudentLearningRow["suspension"]) ?? null,
    baja: (r.baja as StudentLearningRow["baja"]) ?? null,
    reservas: r.reservas as number,
    reservasDetalle: lista<{ estado: string; n: number }>(r.reservas_detalle),
    tomadas: r.tomadas as number,
    noShows: r.no_shows as number,
    canceladas: r.canceladas as number,
    tutoresDistintos: r.tutores_distintos as number,
    tutores: lista<{ nombre: string; mentorias: number }>(r.tutores),
    primeraClase: r.primera_clase as string | null,
    ultimaClase: r.ultima_clase as string | null,
    proximaClase: r.proxima_clase as string | null,
    gastado: lista<DineroPorMoneda>(r.gastado),
    pagos: r.pagos as number,
    mediosDePago: lista<string>(r.medios_de_pago),
    creditoDisponible: lista<{ currency: string; saldo: number }>(r.credito_disponible),
    resenas: r.resenas as number,
    notaMedia: r.nota_media === null ? null : Number(r.nota_media),
    codigoReferido: r.codigo_referido as string | null,
    vinoReferido: r.vino_referido as boolean,
    terminos: (r.terminos as StudentLearningRow["terminos"]) ?? null,
  }));
}
