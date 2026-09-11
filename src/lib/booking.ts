import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
// ⚠️ Relativo y CON extensión, a diferencia del `@/` de arriba: aquél es un
// `import type` y `--experimental-strip-types` lo borra antes de resolverlo,
// pero esto son VALORES y node sí tiene que encontrarlos. Este módulo lo carga
// `node` a pelo vía `catalog/format.ts` (`npm run check:email`), y el alias no
// se resuelve ahí. Mismo motivo que documenta `catalog/format.ts`.
import {
  FORMATO_POR_DEFECTO,
  opcionesDeHora,
  type FormatoHora,
} from "./hora.ts";

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
export function formatSessionTime(
  iso: string,
  timeZone?: string,
  /**
   * 12 h o 24 h, de la cookie `ey-h12` (ver `lib/hora.ts`). Opcional y con
   * 24 h por defecto a propósito: así los sitios que NO tienen visitante
   * —los correos, los jobs, `check:email`— siguen llamando con dos argumentos
   * y pintando lo de siempre, sin fingir una preferencia que ahí no existe.
   */
  formato: FormatoHora = FORMATO_POR_DEFECTO,
): string {
  return new Date(iso).toLocaleString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...opcionesDeHora(formato),
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
 * La sesión que representa a la reserva HOY: la primera que todavía no ha
 * terminado. Su `start_at` es la clave de orden por proximidad — una clase en
 * curso lo tiene en el pasado, así que sale la primera ella sola y no se mueve
 * hasta que la sesión se cierra.
 *
 * ⚠️ «En curso» se deduce del RELOJ, no del estado `in_progress`: ese estado
 * solo se escribe si alguien pulsa «Entrar a sala» (`join_session`), así que
 * una mentoría que está ocurriendo ahora mismo y a la que nadie ha entrado
 * seguiría en `confirmed` y no subiría.
 *
 * MN-05 · mira `end_at` y NO la ventana de acceso, a propósito: una clase de
 * hace cuatro días cuya sala sigue abierta no es próxima.
 */
export function sesionVigente<
  T extends { status: string; start_at: string; end_at: string },
>(sesiones: readonly T[] | null | undefined): T | null {
  return (
    [...(sesiones ?? [])]
      .filter((s) => s.status === "scheduled" || s.status === "in_progress")
      .sort((x, y) => x.start_at.localeCompare(y.start_at))
      .find((s) => isUpcoming(s.end_at)) ?? null
  );
}

/** Mayor que cualquier ISO-8601 real: las reservas sin sesión viva, al final. */
const AL_FINAL = "9999";

type Sesionable = { status: string; start_at: string; end_at: string };

/**
 * Comparador de reservas por proximidad: la que está en curso primero, luego
 * las próximas por fecha y hora, y al final las que ya no tienen sesión viva.
 * Esas empatan entre sí y, como `Array.prototype.sort` es estable, conservan
 * el `created_at desc` que trae la consulta — por eso el `.order()` de las
 * consultas no se quita: pasa a ser el desempate.
 *
 * ISO-8601 UTC ordena bien como texto, así que no hace falta `new Date`.
 */
export function porProximidad(
  a: { sessions?: readonly Sesionable[] | null },
  b: { sessions?: readonly Sesionable[] | null },
): number {
  return (sesionVigente(a.sessions)?.start_at ?? AL_FINAL).localeCompare(
    sesionVigente(b.sessions)?.start_at ?? AL_FINAL,
  );
}

/**
 * B1.3 · CÓMO SE LLAMA UNA MENTORÍA DE UNA SOLA SESIÓN. En un sitio.
 *
 * El cliente contó que la misma cosa se llamaba de cinco maneras distintas por
 * la plataforma, y tenía razón. Estaba escrita a mano en seis pantallas:
 * «Sesión suelta» en cinco (filtro del catálogo, checkout, pago y los dos
 * detalles de reserva) y «Sesión única» en la portada, vía `modelLabel`.
 *
 * ⚠️ Cambiar los seis literales no arregla nada por sí solo: así es como
 * llegaron a ser seis. Lo que lo arregla es que solo haya un sitio donde
 * decidirlo, y que las pantallas lo pidan.
 *
 * Vive en `lib/booking.ts` y no en `catalog/format.ts` a propósito:
 * `format.ts` ya importa de aquí (`bookingTotal`), así que ponerlo allí y
 * pedirlo desde aquí sería un import circular.
 */
export const SESION_INDIVIDUAL = "Sesión individual";

/**
 * El FORMATO de una reserva: una sesión o un paquete.
 *
 * ⚠️ Y de paso cierra una divergencia que no estaba en la ficha: de las cuatro
 * pantallas que pintaban esto, dos decían «Paquete 4 sesiones» y dos «Paquete
 * DE 4 sesiones». Nadie lo había visto porque no se ven juntas.
 *
 * ⚠️ Lo que NO entra aquí es el precio. «25,00 US$ / sesión» y el selector
 * «Por sesión» del tutor hablan del MODELO DE COBRO, no del producto — un
 * paquete también se cobra por sesión. La ficha lo dice explícitamente y por
 * eso `priceLabel` no se toca.
 */
export function bookingFormatLabel(numSessions: number): string {
  return numSessions === 1
    ? SESION_INDIVIDUAL
    : `Paquete de ${numSessions} sesiones`;
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

/**
 * RN-38 · Lo que le queda al tutor para aceptar o rechazar una reserva, a
 * partir de `bookings.created_at` + 24 h.
 *
 * Vivía dentro de `tutor/reservas/page.tsx`, que era el único sitio que la
 * usaba; desde el paquete v2 del panel la necesitan también el Dashboard («Por
 * atender») y cualquier pantalla que enseñe una reserva por aceptar, así que
 * sube aquí para que la cuenta atrás sea la MISMA en todas — dos copias de una
 * resta con husos horarios divergen el día que alguien toque una.
 *
 * `null` = ya venció. No se finge una cuenta atrás en negativo: la reserva la
 * cancela el cron (`close_expired_sessions`), y hasta que pase el tutor no
 * tiene nada que decidir.
 *
 * El rótulo es solo el tiempo («3 h 10 m»); el reloj y la explicación los pone
 * `AcceptCountdown` (G-05 del paquete), porque son presentación.
 */
export function aceptaAntesDe(
  createdAt: string,
): { label: string; urgent: boolean } | null {
  const ms = new Date(createdAt).getTime() + 24 * 3_600_000 - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  // Sin `padStart` en las horas y con él en los minutos: «3 h 10 m» y
  // «21 h 40 m», que es como lo escribe el paquete aprobado.
  return { label: `${h} h ${String(m).padStart(2, "0")} m`, urgent: ms < 12 * 3_600_000 };
}
