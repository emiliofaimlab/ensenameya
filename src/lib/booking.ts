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
 * Lo que el alumno puede saber de su tutor desde sus propias pantallas.
 *
 * V-6 · Es lo mismo que devolvía `tutorNames` con cuatro columnas más. El
 * cliente pidió poder llegar al tutor DESPUÉS de reservar —hasta hoy, comprado
 * el hilo, no había ni un enlace de vuelta a su ficha— y para eso hace falta
 * algo más que el nombre.
 */
export type TutorCardData = {
  id: string;
  displayName: string | null;
  avatarPath: string | null;
  headline: string | null;
  ratingAvg: number | null;
  ratingCount: number;
};

/**
 * Fichas públicas de tutores por id (DD-01). Va en consulta aparte a
 * propósito: `products.tutor_id` apunta a `profiles`, que es privado —el alumno
 * solo ve su propia fila—, así que esto hay que leerlo de la copia pública de
 * `tutor_profiles`. El Figma firma con el tutor en AL02, AL03 y AL04.
 *
 * ⚠️ **SIN MIGRACIÓN, Y ESO NO ES CASUALIDAD.** `tutor_profiles_select_public`
 * (`20260706120000`) abre estas columnas a cualquiera con
 * `approval_status = 'approved'`, así que las cuatro nuevas ya eran legibles;
 * lo único que faltaba era pedirlas.
 *
 * ⚠️ **Y ESE `approved` ES LA TRAMPA DE ESTA FICHA.** Si a un tutor le retiran
 * la aprobación, su fila deja de existir PARA EL ALUMNO: aquí no llega, y
 * `/tutors/<id>` le devolvería un 404 desde su propio panel — por una reserva
 * que sí pagó. Por eso esto devuelve un `Map` con huecos en vez de rellenar con
 * un nombre inventado: quien pinte tiene que poder distinguir «este tutor» de
 * «este tutor ya no está», y enseñar la ficha SIN enlace en el segundo caso.
 * Ver `TutorSummary`.
 *
 * Y no hay de dónde sacar el nombre en ese caso: `bookings` congela el dinero
 * (importe, moneda, reparto) pero no la identidad del tutor. Lo comprobado es
 * que no hay columna que valga, no que no se haya buscado.
 */
export async function tutorCards(
  supabase: SupabaseClient<Database>,
  ids: (string | null | undefined)[],
): Promise<Map<string, TutorCardData>> {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (unique.length === 0) return new Map();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("profile_id, display_name, avatar_path, headline, rating_avg, rating_count")
    .in("profile_id", unique);
  return new Map(
    (data ?? []).map((r) => [
      r.profile_id,
      {
        id: r.profile_id,
        displayName: r.display_name,
        avatarPath: r.avatar_path,
        headline: r.headline,
        ratingAvg: r.rating_avg,
        ratingCount: r.rating_count,
      },
    ]),
  );
}

/**
 * Solo los nombres, para las cuatro pantallas que no pintan ficha (reseña,
 * cancelar, confirmación y el paso de reserva). Sale de `tutorCards` en vez de
 * tener su propia consulta: una sola forma de leer al tutor, y la trampa del
 * `approved` documentada en un solo sitio.
 */
export async function tutorNames(
  supabase: SupabaseClient<Database>,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const fichas = await tutorCards(supabase, ids);
  return new Map(
    [...fichas]
      .filter(([, t]) => t.displayName)
      .map(([id, t]) => [id, t.displayName as string]),
  );
}
