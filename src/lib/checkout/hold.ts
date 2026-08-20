import type { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";

/**
 * EL HORARIO RETENIDO: BUSCARLO, SOLTARLO Y ENTENDER SUS ERRORES.
 *
 * Desde D-2 (§20.14) la reserva se crea AL LLEGAR al checkout, no al pulsar
 * pagar. Eso convierte una fila de `sessions` en un candado sobre el horario
 * del tutor, y a partir de ahí hay tres preguntas que se hacen desde más de un
 * sitio —la pantalla de pago, el enlace de «Cambiar horario», la rama de error
 * del formulario— y que tienen que responderse IGUAL en todos:
 *
 *   1. ¿ya hay una reserva de este alumno para estos horarios, y en qué estado?
 *   2. ¿qué holds SUYOS estorban a lo que va a pedir ahora?
 *   3. ¿este error de `create_booking` es una carrera o un problema de verdad?
 *
 * ⚠️ EL PORQUÉ DE LA 2, QUE ES EL MENOS OBVIO: `get_available_slots` descuenta
 * TODA sesión no cancelada del tutor **sin mirar de quién es la reserva** (ver
 * el `not exists` sobre `sessions` en `20260817200000`). Y `create_booking`
 * revalida contra esa misma función. O sea que el hold que el propio alumno
 * acaba de crear al abrir el checkout le bloquea el horario A ÉL MISMO: al
 * volver al selector su hueco ha desaparecido, y al pedir otro conjunto de
 * horarios que solape, su reserva a medias le contesta que «algún horario ya no
 * está disponible». Soltar lo propio antes de pedir es lo que lo cierra.
 *
 * Todo esto corre en el NAVEGADOR y con la ANON key: la RLS es la que decide
 * qué reservas se ven (`bookings_select_own` filtra por `student_id`) y
 * `cancel_booking` es una SECURITY DEFINER concedida a `authenticated` que
 * vuelve a comprobar la propiedad. Aquí no hay ninguna autorización nuestra que
 * confiar — y no la hay a propósito.
 */

type Cliente = ReturnType<typeof createClient>;
type BookingStatus = Database["public"]["Enums"]["booking_status"];
type SessionStatus = Database["public"]["Enums"]["session_status"];

/** Motivo que queda en `bookings.cancel_reason` al soltar un hold. Se lee en el
 *  panel admin y en el detalle de la reserva: «cancelada» sin más parece un
 *  abandono, y esto no lo es. */
export const MOTIVO_CAMBIO_HORARIO =
  "Cambio de horario antes de pagar: el alumno volvió al selector";

/**
 * ¿esta sesión sigue reteniendo el horario del tutor?
 *
 * Los dos estados muertos son EXACTAMENTE los que `get_available_slots` ignora
 * (`status not in ('cancelled', 'no_show')`). Si algún día cambian allí, cambian
 * aquí: esta lista es un espejo de esa condición, no una opinión propia.
 */
const MUERTAS: SessionStatus[] = ["cancelled", "no_show"];
const retieneHorario = (s: { status: SessionStatus }) => !MUERTAS.includes(s.status);

/** Instantes de una lista de ISO, ordenados. `null` si alguno no es legible. */
function instantes(isos: string[]): number[] | null {
  const t = isos.map((s) => Date.parse(s));
  if (t.some((x) => !Number.isFinite(x))) return null;
  return t.sort((a, b) => a - b);
}

export type ReservaDelAlumno = { id: string; status: BookingStatus };

/**
 * ¿Hay ya una reserva VIVA de este alumno, para esta mentoría y con exactamente
 * estos horarios? Devuelve también su estado, porque de él depende todo:
 * `pending_payment` se reutiliza, cualquier otro estado significa que ya está
 * pagada y que llamar a `create_booking` sería pedir un horario que es suyo.
 *
 * ⚠️ NO SE FILTRA POR `pending_payment` EN LA CONSULTA, y ese era el fallo. Tras
 * pagar, el webhook mueve la reserva a `pending_acceptance` (o a `confirmed` si
 * la mentoría acepta sola) y una búsqueda acotada al pago pendiente deja de
 * encontrarla: un «atrás» del navegador desde la confirmación —gesto de lo más
 * normal— remontaba el formulario, volvía a llamar a `create_booking` con los
 * mismos horarios y el alumno leía que su horario ya no estaba disponible… por
 * culpa de la reserva que acababa de pagar.
 *
 * Se excluyen las `cancelled` (no retienen nada) y, dentro de las que quedan,
 * solo cuentan las sesiones vivas: una reserva `refunded` con sus sesiones ya
 * canceladas soltó el horario y no debe impedir volver a reservarlo.
 *
 * La comparación va por INSTANTE y no por cadena a propósito: los horarios
 * llegan de la URL como los escribió el calendario y de la base como los
 * serializa Postgres — `…T08:00:00.000Z` y `…T08:00:00+00:00` son el mismo
 * momento y dos cadenas distintas.
 */
export async function buscarReservaDelAlumno(
  supabase: Cliente,
  { studentId, productId, slots }: {
    studentId: string;
    productId: string;
    slots: string[];
  },
): Promise<ReservaDelAlumno | null> {
  const objetivo = instantes(slots);
  // Sin horarios legibles no hay nada que emparejar. Y la lista vacía se corta
  // aquí a propósito: si no, cualquier reserva sin sesiones vivas —una
  // reembolsada, por ejemplo— casaría por longitud 0 y se daría por «la suya».
  if (!objetivo || objetivo.length === 0) return null;

  const { data } = await supabase
    .from("bookings")
    .select("id, status, sessions(start_at, status)")
    .eq("student_id", studentId)
    .eq("product_id", productId)
    .neq("status", "cancelled");

  const encontrada = (data ?? []).find((b) => {
    const suyos = (b.sessions ?? [])
      .filter(retieneHorario)
      .map((s) => Date.parse(s.start_at))
      .sort((a, b2) => a - b2);
    return (
      suyos.length === objetivo.length &&
      suyos.every((t, i) => t === objetivo[i])
    );
  });

  return encontrada ? { id: encontrada.id, status: encontrada.status } : null;
}

/**
 * Las reservas a medias de ESTE alumno con ESTE tutor cuyos horarios solapan
 * los que está a punto de pedir. Son los holds que hay que soltar antes de
 * llamar a `create_booking`, o el alumno se bloquea a sí mismo (ver la cabecera).
 *
 * ⚠️ EL FILTRO ES POR TUTOR, NO POR MENTORÍA, y copia la condición del SQL a
 * propósito: `get_available_slots` descarta los huecos que solapan una sesión
 * **del tutor**, sea de la mentoría que sea, porque una persona no puede dar
 * dos clases a la vez. Filtrar por `product_id` dejaría fuera el caso real —
 * el alumno tanteando dos mentorías del mismo tutor a la misma hora— y volvería
 * a bloquearlo contra sí mismo.
 *
 * Y solo `pending_payment`: lo demás está pagado y no se toca ni de lejos.
 *
 * ⚠️ EL COSTE ACEPTADO, PARA QUE ESTÉ ESCRITO: si el alumno tuviera ese mismo
 * hold abierto en OTRA pestaña y estuviera pagándolo justo ahora, esto se lo
 * cancela. Es raro —exige dos pestañas suyas con horarios que se pisan— y no
 * hay forma de distinguir «hold olvidado» de «hold que se está pagando» desde
 * aquí: los dos son una reserva en `pending_payment`. Si llegara a pasar, el
 * dinero está cubierto: X-02 (`20260817160000`) hace que un cobro que llega
 * sobre una reserva ya cancelada se devuelva entero desde el webhook. Lo que se
 * gana a cambio es que el caso NORMAL —volver atrás y recomponer un paquete que
 * comparte horarios con el anterior— deje de ser un callejón sin salida.
 */
export async function holdsQueSolapan(
  supabase: Cliente,
  { studentId, tutorId, slots, durationMin }: {
    studentId: string;
    tutorId: string;
    slots: string[];
    /** `products.session_duration_min`, que es NULLABLE. Ver el `max(…, 1)`. */
    durationMin: number | null;
  },
): Promise<string[]> {
  const pedidos = slots
    .map((s) => Date.parse(s))
    .filter((t) => Number.isFinite(t))
    .map((ini) => ({
      ini,
      // Sin duración declarada no se puede medir el tramo, pero un minuto basta
      // para que «empiezan a la misma hora» siga contando como solape — que es
      // el caso que importa. Con 0 el intervalo sería vacío y no solaparía ni
      // consigo mismo.
      fin: ini + Math.max(durationMin ?? 0, 1) * 60_000,
    }));
  if (pedidos.length === 0) return [];

  const { data } = await supabase
    .from("bookings")
    .select("id, sessions(start_at, end_at, status)")
    .eq("student_id", studentId)
    .eq("tutor_id", tutorId)
    .eq("status", "pending_payment");

  return (data ?? [])
    .filter((b) =>
      (b.sessions ?? []).some((s) => {
        if (!retieneHorario(s)) return false;
        const ini = Date.parse(s.start_at);
        const fin = Date.parse(s.end_at);
        if (!Number.isFinite(ini) || !Number.isFinite(fin)) return false;
        // Solape de intervalos medio abiertos, igual que el `tstzrange && `
        // del SQL: pegado no es solapado (una sesión que acaba a las 9:00 no
        // estorba a otra que empieza a las 9:00).
        return pedidos.some((p) => ini < p.fin && p.ini < fin);
      }),
    )
    .map((b) => b.id);
}

/**
 * Soltar un hold: cancelar la reserva a medias para devolver el horario.
 *
 * ⚠️ AQUÍ NO SE DEVUELVE NINGÚN DINERO, y está comprobado contra la función, no
 * supuesto: `cancel_booking` (v3, `20260817170000`) admite `pending_payment`
 * entre sus estados cancelables y, cuando el pago está en `pending` —que es
 * siempre en este camino: nunca se cobró—, entra por la rama que lo marca
 * `failed` con reembolso 0 y sin encolar nada en `refund_requests`. La rama que
 * mueve dinero exige `paid`/`partially_refunded`.
 *
 * Los errores se tragan a propósito y la función no revienta: soltar el horario
 * es cortesía con el tutor, no un requisito para que el alumno pueda salir de
 * la pantalla. Si la RPC falla, lo peor que pasa es que el hueco espere a
 * `expire_stale_bookings` — exactamente lo que pasaba antes de este arreglo.
 */
export async function liberarHold(
  supabase: Cliente,
  bookingId: string,
  motivo: string = MOTIVO_CAMBIO_HORARIO,
): Promise<boolean> {
  const { error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
    p_reason: motivo,
  });
  return !error;
}

/** Suelta varios holds a la vez. En serie no: son independientes y cada uno es
 *  una ida y vuelta a la base delante de alguien que está esperando. */
export async function liberarHolds(
  supabase: Cliente,
  bookingIds: string[],
  motivo: string = MOTIVO_CAMBIO_HORARIO,
): Promise<void> {
  await Promise.all(bookingIds.map((id) => liberarHold(supabase, id, motivo)));
}

/** Lo que devuelve supabase-js cuando la RPC falla. Se tipa a mano porque solo
 *  se miran dos campos y no hace falta arrastrar `PostgrestError` entero. */
type ErrorDeRpc = { code?: string; message?: string } | null;

/**
 * ¿este error significa «alguien se te adelantó» y no «algo va mal»?
 *
 * Pasa de verdad con dos pestañas o un doble clic: las dos peticiones llaman a
 * `create_booking` y la perdedora choca contra `sessions_no_double_booking_idx`
 * (`20260709160000`). Cuando la ganadora es el propio alumno —que es justo lo
 * que ocurre con dos pestañas suyas—, la reserva buena YA EXISTE y es
 * reutilizable: hay que volver a buscarla antes de dar nada por perdido.
 *
 * ⚠️ SE MIRAN LOS DOS DISFRACES DEL MISMO CHOQUE, y el segundo es el habitual.
 * `create_booking` tiene un `exception when unique_violation` que reescribe el
 * 23505 como «ese horario acaba de ser tomado» con errcode `check_violation`,
 * así que el código crudo casi nunca llega. Y si la ganadora alcanzó a
 * confirmar antes de que la perdedora revalidara, ni siquiera hay choque de
 * índice: la validación previa contesta «algún horario ya no está disponible».
 * Los tres son la misma carrera. El 23505 se conserva por si algún día alguien
 * quita ese `exception` de la función.
 */
export function esCarreraDeHorario(error: ErrorDeRpc): boolean {
  if (!error) return false;
  if (error.code === "23505") return true; // unique_violation crudo
  const m = (error.message ?? "").toLowerCase();
  return (
    m.includes("acaba de ser tomado") || m.includes("ya no está disponible")
  );
}

/**
 * Qué se le enseña al alumno cuando no hay reserva que abrir.
 *
 * ⚠️ NUNCA `error.message` TAL CUAL. Del otro lado hay una función de Postgres
 * y sus mensajes van de lo casi presentable («ese horario acaba de ser tomado»)
 * a lo que no debe salir jamás de nuestros registros: el nombre de un índice
 * único, o «el tutor no tiene tier asignado y no hay tier por defecto», que es
 * un fallo de configuración NUESTRO contado como si fuera culpa de quien iba a
 * pagar. Se traduce a dos frases y punto.
 */
export function mensajeDeApertura(error: ErrorDeRpc): string {
  if (esCarreraDeHorario(error)) {
    return "Ese horario acaba de ocuparse. Elige otro y seguimos con el pago.";
  }
  return "No se pudo reservar el horario. Vuelve a intentarlo en un momento.";
}
