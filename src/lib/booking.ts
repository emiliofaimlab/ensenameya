import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];
type SessionStatus = Database["public"]["Enums"]["session_status"];

/** Estados de una SESIÓN dentro de la reserva. Estaba copiado en las tres
 *  pantallas de detalle (alumno, tutor, admin) y el admin discrepaba en
 *  `no_show`; tipar con el enum evita que se vuelvan a separar. */
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  scheduled: "Programada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No asistió",
};

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending_payment: "Pago pendiente",
  pending_acceptance: "Esperando al tutor",
  confirmed: "Confirmada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
  refunded: "Reembolsada",
};

/**
 * Instante UTC → fecha y hora local del usuario (RN-01/02).
 *
 * `timeZone` fuerza la zona horaria del render. Es OBLIGATORIO pasarlo en
 * componentes **server** (SSR corre en la tz del servidor —UTC en Vercel—, no
 * la del usuario: ese era el bug de "hora del servidor", R24-12). En componentes
 * cliente puede omitirse: `undefined` = tz del navegador, que ya es la correcta.
 */
export function formatSessionTime(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

/** Solo la fecha: para listas donde la hora no aporta (RN-01/02). Ver la nota
 *  de `formatSessionTime` sobre `timeZone` en server vs cliente. */
export function formatShortDate(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    timeZone,
  });
}

/**
 * ¿el instante `iso` aún no ha pasado? Vive aquí, a nivel de módulo, a
 * propósito: leer el reloj dentro de una closure de render dispara la regla de
 * pureza de react-hooks; en una función de módulo es legítimo.
 */
export function isUpcoming(iso: string): boolean {
  return new Date(iso).getTime() >= Date.now();
}

/**
 * Total de UNA reserva del producto. Es lo mismo que congela `create_booking`
 * en servidor; aquí solo se muestra (el servidor sigue mandando, S-15).
 */
export function bookingTotal(p: {
  pricingModel: string;
  priceAmount: number;
  sessionDurationMin: number | null;
}): number {
  return p.pricingModel === "per_hour"
    ? Math.round((p.priceAmount * (p.sessionDurationMin ?? 60)) / 60)
    : p.priceAmount;
}

/**
 * Nombres públicos de tutores por id (DD-01). Va en consulta aparte a
 * propósito: `products.tutor_id` apunta a `profiles`, que es privado —el alumno
 * solo ve su propia fila—, así que el nombre hay que leerlo de la copia pública
 * de `tutor_profiles`. El Figma firma con el tutor en AL02, AL03 y AL04.
 */
export async function tutorNames(
  supabase: SupabaseClient<Database>,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (unique.length === 0) return new Map();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("profile_id, display_name")
    .in("profile_id", unique);
  return new Map(
    (data ?? [])
      .filter((r) => r.display_name)
      .map((r) => [r.profile_id, r.display_name as string]),
  );
}
