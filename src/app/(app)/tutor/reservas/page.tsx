import { EyeIcon, VideoIcon } from "lucide-react";
import Link from "next/link";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { getUserTimezone } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import {
  aceptaAntesDe,
  formatSessionTime,
  BOOKING_STATUS_LABEL,
  porProximidad,
  sesionVigente,
} from "@/lib/booking";
import { salaDeLaReserva } from "@/lib/room-window";
import { cn } from "@/lib/utils";
import {
  AcceptCountdown,
  PanelCard,
  PanelCounter,
  PanelIconButton,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { AcceptRejectButtons } from "./booking-actions";
import { studentsOfTutor, type StudentIdentity } from "../students";
import { StudentLink } from "../student-link";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Reservas · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/** Lo que esta pantalla necesita de cada reserva. Sale del `select` de abajo. */
type Reserva = {
  id: string;
  status: BookingStatus;
  total_amount: number;
  currency: string;
  created_at: string;
  student_id: string;
  products: { title: string } | null;
  reviews: unknown;
  sessions:
    | {
        id: string;
        start_at: string;
        end_at: string;
        status: string;
        access_opens_at: string | null;
        access_closes_at: string | null;
      }[]
    | null;
};

/** ¿Espera respuesta del tutor? Es el único estado que pide acción (RN-38). */
const esPorAceptar = (b: Reserva) => b.status === "pending_acceptance";

/**
 * §4.2 · «Próximas» sustituye a «Confirmadas», y NO es lo mismo: además del
 * estado exige que quede una sesión sin terminar. Una reserva `confirmed` cuya
 * única clase fue el martes —el cron aún no la ha cerrado— salía en
 * «Confirmadas» y no es próxima: es pasada. `sesionVigente` es el mismo
 * criterio con el que se ordena y con el que se elige la fecha a pintar.
 */
const esProxima = (b: Reserva) =>
  (b.status === "confirmed" || b.status === "in_progress") &&
  sesionVigente(b.sessions) !== null;

/** Todo lo que no espera respuesta ni está por venir: el grupo PASADAS (§4.4). */
const esPasada = (b: Reserva) => !esPorAceptar(b) && !esProxima(b);

/**
 * §4.2 · Chips de filtro, con el estado en la URL (`?f=`).
 *
 * ⚠️ `pasadas` NO es un chip —el documento fija cinco— pero SÍ es un valor
 * válido de `?f=`: el subnivel «Pasadas» del menú (`TUTOR_ITEMS`) apunta ahí, y
 * un filtro que no existe caería al de por defecto y enseñaría la lista entera.
 * Cuando está activo no se enciende ningún chip a propósito: quien manda es el
 * rótulo del grupo, que ya dice PASADAS.
 *
 * Cada filtro se define por una FUNCIÓN y no por una lista de estados porque
 * «Próximas» no se puede expresar con estados (mira el reloj de la sesión), y
 * porque el mismo predicado sirve para contar el chip y para filtrar la lista:
 * dos definiciones acabarían discrepando.
 */
const FILTROS: {
  id: string;
  label: string;
  /** `false` = no se pinta como chip, pero `?f=` lo acepta. */
  chip?: boolean;
  match: (b: Reserva) => boolean;
}[] = [
  { id: "todas", label: "Todas", match: () => true },
  { id: "por-aceptar", label: "Por aceptar", match: esPorAceptar },
  { id: "proximas", label: "Próximas", match: esProxima },
  { id: "completadas", label: "Completadas", match: (b) => b.status === "completed" },
  {
    id: "canceladas",
    label: "Canceladas",
    match: (b) => b.status === "cancelled" || b.status === "refunded",
  },
  { id: "pasadas", label: "Pasadas", chip: false, match: esPasada },
];

const BOOKING_PILL: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  pending_acceptance: "blue",
  completed: "neutral",
  cancelled: "red",
  refunded: "red",
  pending_payment: "neutral",
};

/**
 * La valoración que dejó el alumno, o `null`.
 *
 * Va por función y tolera las dos formas —objeto y array— a propósito: el
 * embed de PostgREST devuelve objeto cuando la relación es 1:1 (lo es:
 * `reviews.booking_id` es `unique`), pero eso lo decide el servidor mirando el
 * índice, no nuestro tipo. Con `unknown` de entrada, si algún día llega array
 * la pantalla sigue pintando la estrella en vez de romperse.
 */
function valoracionDe(b: Reserva): number | null {
  const r = b.reviews;
  const fila = Array.isArray(r) ? r[0] : r;
  const rating = (fila as { rating?: number } | null | undefined)?.rating;
  return typeof rating === "number" ? rating : null;
}

/** §4.5 · «★★★★★ Valoración del alumno», sin el comentario (ese va al detalle). */
function Estrellas({ rating }: { rating: number }) {
  return (
    <>
      {/* Los glifos son decoración: quien no ve la pantalla necesita el número,
          no cinco caracteres seguidos. */}
      <span aria-hidden className="text-[12px] tracking-[0.5px] text-[#a67314]">
        {"★".repeat(rating)}
        <span className="text-[#d6d6d6]">{"☆".repeat(5 - rating)}</span>
      </span>
      <span className="sr-only">{rating} de 5 ·</span>
    </>
  );
}

/** Rótulo de grupo (§4.4). El primero no lleva línea: ya la pone la tarjeta. */
function RotuloDeGrupo({
  id,
  primero,
  children,
}: {
  id: string;
  primero: boolean;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className={cn(
        // `scroll-mt-24` por la cabecera sticky: sin él un salto de ancla deja
        // el rótulo justo debajo de la barra y parece que no ha pasado nada.
        "scroll-mt-24 pt-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-[#6b6b6b] uppercase",
        !primero && "mt-1.5 border-t border-[#e0e0e0]",
      )}
    >
      {children}
    </h2>
  );
}

/**
 * §4.4 · Fila de una línea: título · alumno · fecha · monto, y las acciones en
 * REJILLA FIJA `estado(104) · cámara(36) · ojo(36)`.
 *
 * ⚠️ La rejilla no es decoración. Con un flex normal, la fila sin sala se queda
 * sin el botón de cámara y su píldora de estado se corre 44 px a la derecha
 * respecto a la de la fila de arriba: en una lista de ocho reservas el ojo
 * baila y cuesta apuntarle. Por eso el hueco de la cámara se pinta VACÍO
 * (`<span />`) en vez de no pintarse.
 */
function FilaDeReserva({
  reserva,
  student,
  tz,
}: {
  reserva: Reserva;
  student: StudentIdentity | undefined;
  tz: string;
}) {
  const cuando = fechaDeReserva(reserva);
  // Mismo criterio que el panel del alumno y que `/reservas`: reserva
  // `confirmed`/`in_progress` y sesión dentro de su ventana de acceso. Aquí
  // importa más que en ninguna lista — el tutor llega tarde a su propia clase
  // si tiene que pasar por el detalle para encontrar la puerta.
  const sala = salaDeLaReserva(reserva.status, reserva.sessions);
  const rating = valoracionDe(reserva);

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
      {/* N-12 · `flex-1` **y** un mínimo: sin `flex-1` el bloque se dimensiona
          por su contenido y un título largo empuja las acciones fuera; sin el
          mínimo pasa lo contrario en móvil —la rejilla fija se queda sus 192 px
          y al texto le sobran 112, medido a 390—, así que por debajo de
          180+192 las acciones bajan de línea y el texto se lee entero. El
          Figma no tiene diseño móvil (decisión 24), así que esto es criterio
          nuestro, no una divergencia con el paquete. */}
      <div className="min-w-[180px] flex-1">
        <p className="truncate text-[13px] font-semibold text-[#19191f]">
          {reserva.products?.title ?? "Mentoría"}
        </p>
        <p className="truncate text-[12px] text-[#404040]">
          <StudentLink student={student} className="font-medium text-brand" />
          {" · "}
          <span className="first-letter:uppercase">
            {cuando ? formatSessionTime(cuando, tz) : "Por agendar"}
          </span>
          {" · "}
          {formatMoney(reserva.total_amount, reserva.currency)}
        </p>
        {rating !== null ? (
          <p className="mt-0.5 text-[11.5px] text-[#6b6b6b]">
            <Estrellas rating={rating} /> Valoración del alumno
          </p>
        ) : null}
      </div>

      <div className="ml-auto grid shrink-0 grid-cols-[104px_36px_36px] items-center justify-items-end gap-2">
        {/* N-15 · la píldora decide su altura: nada de `h-*` desde aquí. */}
        <StatusPill tone={BOOKING_PILL[reserva.status] ?? "neutral"}>
          {BOOKING_STATUS_LABEL[reserva.status]}
        </StatusPill>
        {sala ? (
          <PanelIconButton
            tone="primary"
            label="Entrar a la sala"
            href={`/room/${sala.id}`}
          >
            <VideoIcon aria-hidden className="size-4" />
          </PanelIconButton>
        ) : (
          <span />
        )}
        <PanelIconButton
          label="Ver reserva"
          href={`/tutor/reservas/${reserva.id}`}
        >
          <EyeIcon aria-hidden className="size-4" />
        </PanelIconButton>
      </div>
    </li>
  );
}

/** Fecha representativa: la sesión vigente, o la última que hubo. Es la MISMA
 *  que ordena la lista — antes valía cualquier `scheduled`, sin filtro
 *  temporal, así que un paquete cuya primera sesión ya pasó (y el cron aún no
 *  había cerrado) enseñaba la fecha de una clase que ya ocurrió. */
function fechaDeReserva(b: Reserva): string | null {
  const todas = [...(b.sessions ?? [])].sort((x, y) =>
    x.start_at.localeCompare(y.start_at),
  );
  return sesionVigente(todas)?.start_at ?? todas.at(-1)?.start_at ?? null;
}

/**
 * US-606 (SCR-TU07) — reservas del tutor, en la forma que aprobó el cliente el
 * 8-sep-2026 (paquete «Panel del tutor v2», §4).
 *
 * Lo que cambió respecto a TU07/TU07b: las `pending_acceptance` ya no son
 * tarjetas de cuatro columnas —repetían el estado tres veces— sino filas dentro
 * de un solo bloque «Por aceptar (N)» con borde azul; el resto se agrupa en
 * PRÓXIMAS y PASADAS; y el identificador de reserva sale de la lista (§4.5): en
 * una fila de una línea ocupaba el sitio del dato con el que se decide.
 */
export default async function TutorReservasPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { userId } = await requireTutorProfile();
  const tz = await getUserTimezone();
  const { f } = await searchParams;
  const filtro = FILTROS.find((x) => x.id === f) ?? FILTROS[0];

  const supabase = await createClient();
  // M-02 · aquí había una consulta a `tutor_profiles.auto_accept_bookings` para
  // pintar un interruptor global. Se fue con él: desde `20260817180000` esa
  // columna no la lee nadie —el auto-aceptar vive en cada mentoría— y el
  // interruptor escribía en el vacío. El ajuste está en el formulario de la
  // mentoría (`/tutor/products/<id>/edit`), que es donde se decide.

  // ⚠️ SIN `.in("status", …)`, y no es un olvido: los chips ahora llevan
  // contador (G-03) y un contador solo puede salir de las reservas que el
  // filtro esconde. Se traen todas una vez y se reparten en memoria — un tutor
  // del MVP tiene decenas, no miles, y así el filtro no cuesta un viaje más.
  const query = supabase
    .from("bookings")
    .select(
      // Las columnas de ventana viajan con la sesión: sin ellas esta lista no
      // puede saber si la sala está abierta ahora. Ver `salaDeLaReserva`.
      // La reseña es §4.5, y la FK va NOMBRADA por la regla de oro 10: en el
      // día que alguien cree una tabla puente entre `bookings` y `reviews`, un
      // embed sin nombrar se cae entero con PGRST201 en vez de degradarse.
      "id, status, total_amount, currency, created_at, student_id, products(title), reviews!reviews_booking_id_fkey(rating), sessions(id, start_at, end_at, status, access_opens_at, access_closes_at)",
    )
    .eq("tutor_id", userId)
    .order("created_at", { ascending: false });

  // N-13 — el nombre del alumno no sale del `select` de arriba: `bookings` solo
  // guarda el `student_id` y `profiles` es own-only por RLS. Lo resuelve la RPC
  // `tutor_students`, en una sola llamada para toda la página y en paralelo con
  // el listado (no depende de él: devuelve todos los alumnos del tutor).
  const [{ data, error }, students] = await Promise.all([
    query,
    studentsOfTutor(supabase),
  ]);

  // Regla de oro 10 · si la consulta falla, `data` es `null` y una lista vacía
  // sería una mentira creíble: el tutor leería «no hay reservas» teniendo 30.
  const reservas = (data ?? []) as unknown as Reserva[];
  const visibles = reservas.filter(filtro.match);

  const porAceptar = visibles.filter(esPorAceptar);
  const proximas = visibles.filter(esProxima).sort(porProximidad);
  // §4.4 · las pasadas, la más reciente primero. Las que no tienen sesión
  // quedan al final (cadena vacía) conservando el `created_at desc` del orden.
  const pasadas = visibles
    .filter(esPasada)
    .sort((a, b) =>
      (fechaDeReserva(b) ?? "").localeCompare(fechaDeReserva(a) ?? ""),
    );

  return (
    <TutorShell
      userId={userId}
      title="Reservas"
      // §4.1 · una línea. Las 24 h ya no se explican aquí: viven donde ocurren,
      // dentro del bloque «Por aceptar», que es la única lista a la que aplican
      // (una mentoría que se confirma sola nunca pasa por ahí, así que la
      // cabecera prometía un plazo que a la mayoría de reservas no le toca).
      description="Todas las reservas de tus mentorías, en tu zona horaria."
    >
      {/* G-03 · chips con contador. Estado en la URL: server-render puro. */}
      <div className="flex flex-wrap gap-2">
        {FILTROS.filter((x) => x.chip !== false).map((x) => {
          const on = x.id === filtro.id;
          const total = reservas.filter(x.match).length;
          return (
            <Link
              key={x.id}
              href={
                x.id === "todas" ? "/tutor/reservas" : `/tutor/reservas?f=${x.id}`
              }
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] transition-colors",
                on
                  ? "border-brand bg-brand font-semibold text-white"
                  : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
              )}
            >
              {x.label}
              {/* Solo «Por aceptar» va en naranja (G-03): es el único chip que
                  pide algo del tutor; el resto informan. */}
              <PanelCounter
                value={total}
                tone={on ? "activo" : x.id === "por-aceptar" ? "naranja" : "gris"}
              />
            </Link>
          );
        })}
      </div>

      {error ? (
        <PanelCard className="border-[#f0bfbf] bg-[#fdf5f5]">
          <p className="text-[13px] text-[#bf3333]">
            No pudimos cargar tus reservas. Vuelve a intentarlo en un momento.
          </p>
        </PanelCard>
      ) : null}

      {!error && visibles.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            No hay reservas{" "}
            {filtro.id === "todas" ? "por ahora" : "en este filtro"}.
          </p>
        </PanelCard>
      ) : null}

      {/* §4.3 · un solo bloque con borde azul para lo que espera respuesta. */}
      {porAceptar.length > 0 ? (
        <PanelCard
          id="por-aceptar"
          className="scroll-mt-24 border-[1.5px] border-[#0080ff]/40"
        >
          <h2 className="text-[15px] font-semibold text-[#19191f]">
            Por aceptar{" "}
            <span className="font-normal text-[#6b6b6b]">
              ({porAceptar.length})
            </span>
          </h2>
          {/* Aviso FIJO, no una píldora por fila: la regla es la misma para
              todas y repetirla en cada una era el ruido de las tarjetas TU07b. */}
          <p className="mt-0.5 text-[11.5px] text-[#6b6b6b]">
            Si no respondes en 24 h, la reserva se cancela y el alumno recibe el
            100 %.
          </p>
          <ul className="mt-1.5 divide-y divide-[#e0e0e0]">
            {porAceptar.map((b) => {
              // G-05 · la cuenta atrás compartida (RN-38). `null` = ya venció:
              // no se finge un plazo, el cron es quien la cancela.
              const plazo = aceptaAntesDe(b.created_at);
              const cuando = fechaDeReserva(b);
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3"
                >
                  {/* Mismo mínimo que en `FilaDeReserva` y por lo mismo: aquí
                      las acciones ocupan aún más (cuenta atrás + dos botones). */}
                  <div className="min-w-[180px] flex-1">
                    <p className="truncate text-[13px] font-semibold text-[#19191f]">
                      {b.products?.title ?? "Mentoría"}
                    </p>
                    <p className="truncate text-[12px] text-[#404040]">
                      <StudentLink
                        student={students.get(b.student_id)}
                        className="font-medium text-brand"
                      />
                      {" · "}
                      <span className="first-letter:uppercase">
                        {cuando ? formatSessionTime(cuando, tz) : "Por agendar"}
                      </span>
                      {" · "}
                      {formatMoney(b.total_amount, b.currency)}
                    </p>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {plazo ? <AcceptCountdown {...plazo} /> : null}
                    <AcceptRejectButtons bookingId={b.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        </PanelCard>
      ) : null}

      {/* §4.4 · PRÓXIMAS y PASADAS comparten tarjeta: son la misma lista con un
          corte temporal, y dos tarjetas separadas doblaban el aire por nada. */}
      {proximas.length > 0 || pasadas.length > 0 ? (
        <PanelCard className="px-5 py-2">
          {proximas.length > 0 ? (
            <>
              <RotuloDeGrupo id="proximas" primero>
                Próximas
              </RotuloDeGrupo>
              <ul className="divide-y divide-[#e0e0e0]">
                {proximas.map((b) => (
                  <FilaDeReserva
                    key={b.id}
                    reserva={b}
                    student={students.get(b.student_id)}
                    tz={tz}
                  />
                ))}
              </ul>
            </>
          ) : null}
          {pasadas.length > 0 ? (
            <>
              <RotuloDeGrupo id="pasadas" primero={proximas.length === 0}>
                Pasadas
              </RotuloDeGrupo>
              <ul className="divide-y divide-[#e0e0e0]">
                {pasadas.map((b) => (
                  <FilaDeReserva
                    key={b.id}
                    reserva={b}
                    student={students.get(b.student_id)}
                    tz={tz}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </PanelCard>
      ) : null}
    </TutorShell>
  );
}
