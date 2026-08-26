import Link from "next/link";
import { CompassIcon } from "lucide-react";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import {
  BOOKING_STATUS_LABEL,
  isUpcoming,
  tutorCards,
  type TutorCardData,
} from "@/lib/booking";
import { roomOpen } from "@/lib/room-window";
import { TutorSummary } from "@/components/tutor-summary";
import { BookingRow } from "@/components/booking-row";
import { ReferralCard } from "@/components/referral/referral-card";
import { SupportCard } from "@/components/support/support-card";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
  StatusPill,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { suggestedForStudent } from "./sugerencias";
import { SugerenciasCard } from "./sugerencias-card";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Mi panel · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/** Reservas vivas que el alumno ve arriba (el Figma las mezcla en una lista). */
const OPEN: BookingStatus[] = ["pending_acceptance", "confirmed", "in_progress"];

/** Solo con la reserva aceptada hay sala. `pending_acceptance` NO la tiene. */
const ROOM_READY = new Set<BookingStatus>(["confirmed", "in_progress"]);

/** Resumen del saludo. Se arma con lo que hay, para no prometer plurales falsos. */
function summary(upcoming: number, awaiting: number): string {
  const parts: string[] = [];
  if (upcoming > 0) {
    parts.push(
      `${upcoming} ${upcoming === 1 ? "mentoría próxima" : "mentorías próximas"}`,
    );
  }
  if (awaiting > 0) {
    parts.push(
      `${awaiting} ${awaiting === 1 ? "esperando aceptación del tutor" : "esperando aceptación de los tutores"}`,
    );
  }
  if (parts.length === 0) return "Aquí verás tus próximas mentorías y tus reservas.";
  return `Tienes ${parts.join(" y ")}.`;
}

/**
 * SCR-AL02 — Dashboard del alumno. Destino de `pickHome` tras entrar (Doc 3).
 *
 * La lista se arma desde `bookings`, no desde `sessions`: mirando solo sesiones
 * una reserva sin aceptar salía como "clase próxima" **con botón de sala**, y
 * encima repetida en la sección de pendientes. Ahora cada fila es una reserva.
 */
export default async function AppHome() {
  const { user } = await requireUser();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  const [{ data: profile }, { data: openRows }, { data: pastRows }, sugerencias] =
    await Promise.all([
      // El nombre sale del PERFIL, no de `user_metadata`: el metadata es un
      // espejo que se queda viejo si el perfil cambia después.
      supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      supabase
        .from("bookings")
        .select(
          // B-2 · las columnas de ventana viajan con la sesión: sin ellas
          // este panel no puede saber si la sala está abierta, y ofrecía
          // "Entrar a sala" para clases de dentro de semanas.
          "id, status, created_at, products(title, tutor_id), sessions(id, start_at, end_at, status, access_opens_at, access_closes_at)",
        )
        .eq("student_id", user.id)
        .in("status", OPEN)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("bookings")
        .select(
          // B1.10 · `created_at` entra aquí para poder ORDENAR los tutores
          // recientes mezclando esta lista con la de arriba: sin él, «último»
          // solo podría significar «de las abiertas», que no es lo mismo.
          "id, status, created_at, products(title, tutor_id), sessions(id, start_at, status), reviews(rating)",
        )
        .eq("student_id", user.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(3),
      // N-30 · va DENTRO del mismo `Promise.all` a propósito: resuelve sus
      // propias consultas (intereses, oferta y catálogo) y encadenarla después
      // de las reservas sumaría su latencia a la de la pantalla para nada.
      suggestedForStudent(user.id),
    ]);

  const open = openRows ?? [];
  const completed = pastRows ?? [];
  // B1.10 · `tutorCards` en vez de `tutorNames`: es la MISMA consulta con
  // cuatro columnas más (avatar, titular, valoración), así que el bloque de
  // tutores recientes no añade ni un viaje. El nombre se saca de aquí.
  const fichas = await tutorCards(
    supabase,
    [...open, ...completed].map((b) => b.products?.tutor_id),
  );
  const nombreDelTutor = (id: string | null | undefined) =>
    (id ? fichas.get(id)?.displayName : null) ?? undefined;

  /**
   * B1.10 · LOS ÚLTIMOS TUTORES DEL ALUMNO.
   *
   * Petición del cliente (D2): en el panel quiere ver primero sus sesiones y
   * sus tutores. El orden de las sesiones ya estaba (N-30); esto es la otra
   * mitad.
   *
   * Sale de las reservas que la pantalla YA cargó — de ahí que el Doc 22 lo
   * diera por barato— pero mezclando las dos listas y ordenando por
   * `created_at`: «último» tiene que significar el último de verdad, no el
   * último de los abiertos. Por eso el `select` de arriba gana esa columna.
   *
   * Se deduplica por tutor y se corta a cuatro: es un recordatorio de con quién
   * has dado clase, no un directorio. Y solo entran los legibles — un tutor al
   * que le retiraron la aprobación no tiene ficha pública a la que enlazar (ver
   * `tutorCards`), así que aquí sencillamente no aparece: en las pantallas de
   * la reserva sí hay que explicarlo, porque el alumno pagó; en un bloque de
   * descubrimiento, no.
   */
  const ultimosTutores = [...open, ...completed]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((b) => b.products?.tutor_id)
    .filter((id, i, todos): id is string => Boolean(id) && todos.indexOf(id) === i)
    .map((id) => fichas.get(id))
    // Predicado tipado y no un `filter` a secas: sin él TypeScript deja
    // `TutorCardData | undefined` y el `.map` de abajo se queja con razón.
    .filter((t): t is TutorCardData => Boolean(t?.displayName))
    .slice(0, 4);

  /**
   * V-6 · El «con Fulanito» de cada fila lleva ahora a su ficha pública — hasta
   * hoy era texto muerto y, comprada la mentoría, no había forma de volver al
   * tutor.
   *
   * ⚠️ Solo si es legible, y `fichas` YA es esa comprobación: `tutorCards` sale
   * de `tutor_profiles`, que solo se lee con `approval_status = 'approved'`. A
   * un tutor desaprobado no se le enlaza — su ficha daría un 404 desde el panel
   * del propio alumno. Ver `tutorCards`.
   */
  const perfilDelTutor = (id: string | null | undefined) =>
    id && fichas.get(id)?.displayName ? `/tutors/${id}` : undefined;

  /**
   * Sesión relevante de la reserva: la primera que aún no ha terminado.
   *
   * MN-05 · Sigue mirando `end_at` y NO la ventana de acceso, a propósito. Esto
   * es "Próximas sesiones": una clase de hace cuatro días cuya sala sigue
   * abierta no es próxima, y meterla aquí llenaría el panel de pasado. A su
   * sala se llega igual desde el detalle de la reserva, que es donde vive la
   * lista completa.
   */
  const nextSession = (b: (typeof open)[number]) =>
    [...(b.sessions ?? [])]
      .filter((s) => s.status === "scheduled" || s.status === "in_progress")
      .sort((x, y) => x.start_at.localeCompare(y.start_at))
      .find((s) => isUpcoming(s.end_at)) ?? null;

  const upcomingCount = open.filter((b) => ROOM_READY.has(b.status)).length;
  const awaitingCount = open.length - upcomingCount;
  const hasActivity = open.length + completed.length > 0;

  return (
    <PanelShell>
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          {profile?.full_name?.split(" ")[0]
            ? `Hola, ${profile.full_name.split(" ")[0]}`
            : "Tu panel"}
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          {summary(upcomingCount, awaitingCount)}
        </p>
      </div>

      {!hasActivity ? (
        <PanelCard>
          <PanelCardTitle className="text-[22px]">
            Aún no tienes mentorías reservadas
          </PanelCardTitle>
          <p className="mt-2 text-[13px] text-[#6b6b6b]">
            Descubre tutores y reserva tu primera mentoría 1 a 1 en vivo.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild className="h-10">
              <Link href="/tutors">Explorar tutores</Link>
            </Button>
            <Button asChild variant="outline" className="h-10">
              <Link href="/classes">Ver mentorías</Link>
            </Button>
          </div>
        </PanelCard>
      ) : (
        <>
          <PanelCard>
            <PanelCardTitle className="text-[22px]">
              Próximas sesiones
            </PanelCardTitle>
            {open.length === 0 ? (
              // RV-11 · aquí solo se llega con reservas ya terminadas: sin una
              // salida, el alumno que acabó su mentoría se queda mirando una
              // frase gris en la pantalla que debería reengancharlo.
              <p className="mt-4 text-[13px] text-[#6b6b6b]">
                No tienes mentorías agendadas.{" "}
                <Link
                  href="/classes"
                  className="font-medium text-brand hover:underline"
                >
                  Reserva la siguiente
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-[#e0e0e0]">
                {open.map((b) => {
                  const s = nextSession(b);
                  const ready = ROOM_READY.has(b.status);
                  return (
                    <BookingRow
                      key={b.id}
                      href={`/reservas/${b.id}`}
                      tutor={nombreDelTutor(b.products?.tutor_id)}
                      tutorHref={perfilDelTutor(b.products?.tutor_id)}
                      title={b.products?.title ?? "Mentoría"}
                      when={s?.start_at ?? null}
                      timeZone={tz}
                      status={BOOKING_STATUS_LABEL[b.status]}
                      note={
                        // El botón de sala y este texto tienen que decir lo
                        // mismo. B-2 devolvió la ventana a 10 min (V-1).
                        ready
                          ? "La sala abre 10 min antes"
                          : "Reembolso 100 % si no acepta en 24 h"
                      }
                      action={
                        // ⚠️ B-2 · `roomOpen(s)` ADEMÁS del estado. Antes solo
                        // se miraba `ROOM_READY.has(b.status)`, o sea el estado
                        // de la RESERVA — que dice «esta reserva puede tener
                        // sala algún día», no «ahora». Resultado: el botón
                        // aparecía para una clase de dentro de tres semanas y
                        // el servidor la rechazaba. Es, con diferencia, la
                        // explicación más probable del «la sala está abierta
                        // desde que compro» que reportó el cliente.
                        //
                        // Con la ventana en 7 días casi no se notaba; con 10
                        // minutos sería un botón muerto casi siempre.
                        ready && s && roomOpen(s) ? (
                          <Button
                            asChild
                            className="h-[38px] rounded-[8px] px-4 text-[13px] font-semibold"
                          >
                            <Link href={`/room/${s.id}`}>Entrar a sala</Link>
                          </Button>
                        ) : (
                          <Button
                            asChild
                            variant="outline"
                            className="h-[38px] rounded-[8px] px-4 text-[13px] text-[#4d4d4d]"
                          >
                            <Link href={`/reservas/${b.id}`}>Ver detalle</Link>
                          </Button>
                        )
                      }
                    />
                  );
                })}
              </ul>
            )}
          </PanelCard>

          {completed.length > 0 ? (
            <PanelCard>
              <PanelCardTitle className="text-[22px]">
                Sesiones pasadas
              </PanelCardTitle>
              <ul className="mt-4 divide-y divide-[#e0e0e0]">
                {completed.map((b) => {
                  const last = [...(b.sessions ?? [])].sort((x, y) =>
                    y.start_at.localeCompare(x.start_at),
                  )[0];
                  return (
                    <BookingRow
                      key={b.id}
                      href={`/reservas/${b.id}`}
                      tutor={nombreDelTutor(b.products?.tutor_id)}
                      tutorHref={perfilDelTutor(b.products?.tutor_id)}
                      title={b.products?.title ?? "Mentoría"}
                      when={last?.start_at ?? null}
                      timeZone={tz}
                      status={BOOKING_STATUS_LABEL[b.status]}
                      // "Ver grabación · 30 días" del Figma es US-1602 (S4).
                      action={
                        b.reviews ? (
                          <StatusPill>Reseñada</StatusPill>
                        ) : (
                          <Button
                            asChild
                            variant="outline"
                            className="h-[38px] rounded-[8px] px-4 text-[13px] text-[#4d4d4d]"
                          >
                            <Link href={`/reservas/${b.id}/resena`}>
                              Dejar reseña
                            </Link>
                          </Button>
                        )
                      }
                    />
                  );
                })}
              </ul>
            </PanelCard>
          ) : null}
        </>
      )}

      {/* B1.10 · Con quién has dado clase, encima de las sugerencias.
          El cliente pidió (D2) ver primero sus sesiones y sus tutores; el orden
          de las sesiones ya estaba (N-30) y esto lo completa. Va ANTES de las
          sugerencias a propósito: volver con un tutor conocido es un camino más
          corto que descubrir uno nuevo, y esta pantalla ordena por lo que el
          alumno hará antes.

          Se reutiliza `TutorSummary` en su variante compacta —la misma que
          A-6 puso en el checkout y en el pago— para no estrenar una cuarta
          forma de pintar un tutor. */}
      {ultimosTutores.length > 0 ? (
        <PanelCard>
          <PanelCardTitle className="text-[22px]">
            Tus últimos tutores
          </PanelCardTitle>
          <p className="mt-1.5 text-[13px] text-[#6b6b6b]">
            Vuelve a reservar con quien ya conoces.
          </p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {ultimosTutores.map((t) => (
              <li key={t.id}>
                <TutorSummary tutor={t} variant="inline" />
              </li>
            ))}
          </ul>
        </PanelCard>
      ) : null}

      {/* N-30 · mentorías sugeridas por sus categorías de interés. Va justo
          debajo de las reservas —lo que el alumno vino a mirar— y encima de las
          tarjetas fijas del Figma. `null` = no hay nada honesto que sugerir
          (catálogo vacío), y entonces no se monta: un carrusel vacío es peor
          que no ponerlo. */}
      {sugerencias ? <SugerenciasCard data={sugerencias} /> : null}

      {/* Las dos tarjetas del Figma. "Invita y gana" (US-1301) solo aparece con
          campaña configurada: el programa vive entero en Referral Factory. */}
      {/* B1.11 · esta pantalla es el panel del ALUMNO, así que su programa es
          el de alumnos siempre. Un tutor que además compra ve el suyo desde
          `/account`, que sí mira el rol. */}
      <ReferralCard />

      <PanelCard>
        <span className="grid size-10 place-items-center rounded-full bg-brand-muted text-brand">
          <CompassIcon className="size-5" />
        </span>
        <PanelCardTitle className="mt-4 text-xl">
          ¿Buscas algo nuevo?
        </PanelCardTitle>
        <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
          Explora tutores y resultados por lo que quieres lograr.
        </p>
        <Button asChild className="mt-4 h-10">
          <Link href="/tutors">Explorar tutores</Link>
        </Button>
      </PanelCard>

      {/* SUP-01 · la salida a soporte, al final y no arriba: quien entra al
          panel viene a mirar sus mentorías, no a reportar un problema. Lleva a
          `/contacto`, que es el único buzón que existe — ver `SupportCard`. */}
      <SupportCard />
    </PanelShell>
  );
}
