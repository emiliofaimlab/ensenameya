import "server-only";

import { createClient } from "@/lib/supabase/server";
import { tutorNames } from "@/lib/booking";
import { parseRequirements } from "@/lib/product-requirements";
import type { Database } from "@/lib/database.types";
import type { OrderRow } from "@/lib/orders/tipos";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/** Una línea del pedido, ya resuelta para pintarla. */
export type LineaResuelta = {
  bookingId: string;
  status: BookingStatus;
  /** La mentoría. Se conserva para poder recomponer la clave del carrito. */
  productId: string | null;
  titulo: string;
  tutorId: string | null;
  tutorNombre: string | null;
  /** Horarios en ISO, ordenados. Se renderizan en la zona del alumno. */
  slotsIso: string[];
  durationMin: number | null;
  /**
   * El importe CONGELADO de esta línea (`payments.gross_amount`), no el precio
   * de catálogo de hoy. Es lo que se cobra y lo que se enseña: la pantalla de
   * pago no puede decir un número distinto del que va a la pasarela.
   */
  total: number;
  currency: string;
  /**
   * M-02 · `products.auto_accept_bookings` de ESTA línea. Va por línea porque
   * la aceptación automática vive en la mentoría, no en el pedido ni en el
   * tutor: un pedido de tres puede tener una que se confirma sola y dos que
   * esperan respuesta, cada una con su ventana de 24 h (RN-38) o sin ella.
   *
   * ⚠️ Sirve para lo que se PROMETE ANTES de pagar, cuando las tres líneas
   * están en `pending_payment` y el estado todavía no distingue nada. Después
   * del cobro manda `status`, que ya lo dice: `confirmed` vs
   * `pending_acceptance`.
   */
  aceptaSola: boolean;
  /**
   * Requerimientos de sesión de ESTA mentoría: lo que el alumno tiene que traer
   * a clase. Va por línea por el mismo motivo que `aceptaSola` — el dato vive
   * en `products`, y un pedido de tres mentorías puede pedir portátil para una
   * y nada para las otras dos. Vacío = el tutor no puso ninguno.
   */
  requerimientos: string[];
};

export type PedidoResuelto = {
  order: OrderRow;
  lineas: LineaResuelta[];
  /**
   * Suma de las líneas, en unidades menores.
   *
   * ⚠️ Sale de `payments.gross_amount`, igual que el importe que el Route
   * Handler manda a la pasarela, y por el mismo camino: no hay dos sitios
   * calculando el total de un pedido (regla de oro 2). Lo que se ve aquí es lo
   * que se cobra allí.
   */
  total: number;
  currency: string;
  /** ¿Siguen TODAS las líneas esperando el mismo cobro? (P-1, todo o nada.) */
  cobrable: boolean;
};

/**
 * EY-176 · un pedido, con sus líneas, listo para pintar.
 *
 * Con la ANON key y por tanto sujeto a RLS: `orders_select_student` filtra por
 * dueño y `bookings_select_student` hace lo propio con las líneas, así que un
 * pedido ajeno devuelve `null` sin que este fichero compruebe nada. La
 * autorización es la política, no un `if` nuestro.
 */
export async function resolveOrder(orderId: string): Promise<PedidoResuelto | null> {
  const base = await createClient();
  const supabase = base;

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, student_id, status, provider, currency, provider_payment_id, lines_fingerprint, created_at, updated_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;

  // Una sola consulta para las N líneas, con su producto, sus horarios y su
  // pago. `payments` entra por `payments_select_student`, que autoriza al
  // alumno de la reserva: el importe congelado es suyo y lo puede ver.
  const { data: lineas } = await supabase
    .from("bookings")
    .select(
      "id, status, product_id, session_duration_min, products(title, tutor_id, auto_accept_bookings, requirements), sessions(start_at, status), payments(gross_amount, currency)",
    )
    .eq("order_id", orderId);

  const filas = lineas ?? [];
  const nombres = await tutorNames(
    base,
    filas.map((b) => b.products?.tutor_id),
  );

  const resueltas: LineaResuelta[] = filas.map((b) => {
    // `payments.booking_id` es `unique`, así que PostgREST devuelve OBJETO y no
    // array —lo mismo que asume `src/lib/admin/queries.ts:385-386`— y los tipos
    // generados ya lo saben, así que aquí no hace falta ningún cast.
    //
    // ⚠️ Y es una de las cosas que el diseño descartado habría roto: si
    // `payments` fuese la cabecera del pedido, `booking_id` dejaría de ser
    // `unique`, esto pasaría a ser un array y el cambio de forma se propagaría
    // por todo el código que lo lee (Doc 23 §23.3.1).
    const pago = b.payments ?? null;
    const tutorId = b.products?.tutor_id ?? null;
    return {
      bookingId: b.id,
      status: b.status,
      productId: b.product_id,
      titulo: b.products?.title ?? "Mentoría",
      tutorId,
      tutorNombre: tutorId ? (nombres.get(tutorId) ?? null) : null,
      // Solo las sesiones vivas: una línea con su hueco ya liberado no debe
      // seguir anunciando una hora que ya no es de nadie.
      slotsIso: (b.sessions ?? [])
        .filter((s) => s.status !== "cancelled" && s.status !== "no_show")
        .map((s) => s.start_at)
        .sort(),
      durationMin: b.session_duration_min,
      total: pago?.gross_amount ?? 0,
      currency: pago?.currency ?? order.currency,
      // Sin producto legible se asume que NO acepta sola. Es el mismo respaldo
      // explícito que usa `confirm_payment` en SQL: sin dato, la reserva espera
      // a un humano. Aquí además es lo que hace que la pantalla prometa la
      // ventana de 24 h, que es lo que de verdad va a pasar en ese caso.
      aceptaSola: b.products?.auto_accept_bookings ?? false,
      requerimientos: parseRequirements(b.products?.requirements),
    };
  });

  // Orden estable: por la primera clase de cada línea. Sin esto, PostgREST
  // devuelve las filas en el orden que quiera y el resumen del pedido cambia de
  // orden entre recargas, que parece un error aunque no lo sea.
  resueltas.sort((a, b) => (a.slotsIso[0] ?? "").localeCompare(b.slotsIso[0] ?? ""));

  return {
    order,
    lineas: resueltas,
    total: resueltas.reduce((s, l) => s + l.total, 0),
    currency: order.currency,
    // P-1 · el pedido se cobra entero o no se cobra. Basta con que una línea
    // haya dejado de esperar el cobro —la venció el cron, la canceló otro
    // camino— para que ya no haya nada que abrir.
    cobrable:
      resueltas.length > 0 &&
      order.status === "pending_payment" &&
      resueltas.every((l) => l.status === "pending_payment"),
  };
}
