import { notFound } from "next/navigation";

import {
  getFormatoHora,
  getUserTimezone,
  requireUser,
} from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { listNotices } from "@/lib/notifications-server";
import { MESSAGE_COLUMNS, toChatMessage } from "@/lib/chat/messages";
import { grupalDe } from "@/components/chat/grupo";
import { SiteHeader } from "@/components/layout/site-header";
import { ACCESS_WINDOW_MIN, withMinutes } from "@/lib/room-window";
import { formatSessionTime } from "@/lib/booking";
import { Button } from "@/components/ui/button";
import { LiveRoom } from "./[sessionId]/live-room";

/**
 * G3 · la sala compartida de UNA fecha grupal (RG-12), para el tutor y para
 * cada inscrito. La pintan dos URLs: `/room/grupal/<fecha>` (la del tutor, que
 * no tiene sesión propia) y `/room/<sesión>` cuando la sesión del alumno es
 * grupal, que es el enlace de «Entrar a sala» de siempre.
 *
 * La autorización con dientes es `join_group_class`; aquí solo se lee lo que
 * la RLS deja ver para pintar.
 */
export async function SalaGrupal({ groupClassId }: { groupClassId: string }) {
  const { user, roles, fullName, avatarPath, onboardingComplete } =
    await requireUser();
  const supabase = await createClient();

  // P26 · la fecha y las sesiones, a la vez: la lectura de sesiones ya no
  // espera a saber si eres el tutor (eso se decide abajo, en JS). Antes eran
  // dos niveles de la cascada en serie.
  //
  // La sesión de la que cuelgan el «Entiendo» y el canal de cierre: la del
  // alumno, o —para el tutor, que no tiene— la primera viva de la fecha.
  // La RLS ya deja al alumno ver solo la suya, y al tutor las de su fecha.
  const [{ data: gc, error: gcError }, { data: sesiones, error: sesionesError }] = await Promise.all([
    supabase
      .from("group_classes")
      .select(
        "id, product_id, tutor_id, start_at, end_at, status, rescheduled_at, products!group_classes_product_id_fkey(title, capacity)",
      )
      .eq("id", groupClassId)
      .maybeSingle(),
    supabase
      .from("sessions")
      .select(
        "id, status, booking_id, session_ref, student_id, access_opens_at, access_closes_at, bookings!inner(status)",
      )
      .eq("group_class_id", groupClassId)
      .neq("status", "cancelled")
      .order("id"),
  ]);
  // Regla de oro 10: un fallo de lectura no puede pintarse como «no tienes un
  // cupo activo» (una mentira creíble). Que salga la pantalla de error.
  if (gcError || sesionesError) throw new Error("No pudimos abrir la sala. Inténtalo de nuevo.");
  if (!gc) notFound();
  const esTutor = gc.tutor_id === user.id;

  // M29 · la del tutor sale solo de una reserva VIVA: antes podía tocarle la
  // de un alumno con un simple apartado y leía «Esta reserva no está activa».
  // El `!inner` no cambia nada al alumno: su sesión siempre cuelga de su reserva.
  const s = (sesiones ?? []).find((x) =>
    esTutor
      ? ["confirmed", "in_progress", "completed"].includes(x.bookings?.status ?? "")
      : x.student_id === user.id,
  );

  if (!s) {
    // P42 · sin sesión: tutor sin inscritos todavía, alumno que se dio de
    // baja, o una fecha cancelada, terminada o movida. Antes era un «No tienes
    // un cupo activo» suelto, sin cabecera ni salida; ahora se dice cuál de
    // los casos es y se ofrece la vuelta.
    const [notices, tz, formato] = await Promise.all([
      listNotices(user.id),
      getUserTimezone(),
      getFormatoHora(),
    ]);
    const mensaje =
      gc.status === "cancelled"
        ? esTutor
          ? "Esta fecha se canceló."
          : "Esta fecha se canceló; te devolvimos su parte."
        : gc.status === "completed"
          ? "Esta fecha ya terminó, así que su sala está cerrada."
          : !esTutor && gc.rescheduled_at
            ? `Esta fecha se movió al ${formatSessionTime(gc.start_at, tz, formato)} y ya no tienes un cupo activo en ella.`
            : esTutor
              ? "La sala se abre cuando haya al menos un inscrito con el pago confirmado."
              : "No tienes un cupo activo en esta clase.";
    return (
      <>
        <SiteHeader
          user={toHeaderUser(user, roles, { fullName, avatarPath, onboardingComplete })}
          notices={notices}
          formato={formato}
        />
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-4 py-16 text-center">
          <h1 className="text-2xl font-bold">{gc.products?.title ?? "Clase grupal"}</h1>
          <p className="text-sm text-muted-foreground">{mensaje}</p>
          {/* Regla 13 · `<a>` y no `<Link>`: desde `(room)` a una ruta con
              guarda de `(app)`, una navegación de cliente puede dejar la
              pantalla en blanco. */}
          <Button asChild variant="outline">
            {esTutor ? (
              <a href={`/tutor/clases-grupales/${gc.product_id}`}>Volver a la clase</a>
            ) : (
              // eslint-disable-next-line @next/next/no-html-link-for-pages -- regla 13
              <a href="/reservas">Volver a mis reservas</a>
            )}
          </Button>
        </div>
      </>
    );
  }

  // P26 · el hilo y sus mensajes, a la vez: los mensajes se filtran por el
  // hilo del grupo con un embed (FK nombrada, regla 10) en vez de esperar a
  // tener su id. Tercer y último nivel: requireUser → [fecha ‖ sesiones] →
  // [todo esto].
  const [
    { data: conv, error: convError },
    { data: msgs, error: msgsError },
    inscritos,
    { data: consents },
    notices,
    tz,
    formato,
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id")
      .eq("kind", "group")
      .eq("group_product_id", gc.product_id)
      .maybeSingle(),
    supabase
      .from("messages")
      .select(
        `${MESSAGE_COLUMNS}, conversations!messages_conversation_id_fkey!inner(kind, group_product_id)` as const,
      )
      .eq("conversations.kind", "group")
      .eq("conversations.group_product_id", gc.product_id)
      .order("created_at"),
    supabase.rpc("inscritos_de_clase", { p_product: gc.product_id }),
    supabase
      .from("session_recording_consents")
      .select("user_id")
      .eq("session_id", s.id),
    listNotices(user.id),
    getUserTimezone(),
    getFormatoHora(),
  ]);

  // P45 · cualquiera de las tres lecturas que falle deja el chat «no
  // disponible», dicho en la sala; antes se quedaba en «Abriendo la
  // conversación…» para siempre. Sin hilo también: con un inscrito pagado
  // (si no, no habría sesión `s`) el hilo del grupo tiene que existir.
  const chatNoDisponible =
    Boolean(convError) || Boolean(inscritos.error) || Boolean(msgsError) || !conv;

  return (
    <LiveRoom
      header={
        <SiteHeader
          user={toHeaderUser(user, roles, { fullName, avatarPath, onboardingComplete })}
          notices={notices}
          formato={formato}
        />
      }
      timeZone={tz}
      formato={formato}
      sessionId={s.id}
      bookingId={s.booking_id}
      // M7 · `report_conversation` ya admite a cualquier miembro del grupo.
      conversationId={conv?.id ?? null}
      startAt={gc.start_at}
      endAt={gc.end_at}
      opensAt={s.access_opens_at ?? withMinutes(gc.start_at, -ACCESS_WINDOW_MIN)}
      closesAt={s.access_closes_at ?? withMinutes(gc.end_at, ACCESS_WINDOW_MIN)}
      // B9 · una grupal no se extiende (`extend_session` lo rechaza,
      // `20261016220000`, y el botón no se pinta), así que su contador nunca
      // está en fase «extendida». Antes iba `true` y pintaba «Clase extendida
      // · quedan 59:49» desde el minuto 0, tragándose el aviso de los 5 min.
      extendida={false}
      // M29 · al tutor el estado le sale de la FECHA, no de la sesión prestada
      // de un alumno: la baja o el cierre de ése no son los de la clase.
      sessionStatus={
        esTutor
          ? gc.status === "cancelled"
            ? "cancelled"
            : gc.status === "completed"
              ? "completed"
              : "scheduled"
          : s.status
      }
      bookingStatus={esTutor ? "confirmed" : (s.bookings?.status ?? "cancelled")}
      productTitle={gc.products?.title ?? "Clase grupal"}
      // El n.º es de la sesión de un ALUMNO: al tutor, que entra con una
      // cualquiera de la fecha, no se le enseña.
      sessionRef={esTutor ? null : s.session_ref}
      isTutor={esTutor}
      currentUserId={user.id}
      firstSessionAt={null}
      initialMessages={(msgs ?? []).map(toChatMessage)}
      entendido={(consents ?? []).some((c) => c.user_id === user.id)}
      grupal={{
        groupClassId: gc.id,
        capacity: gc.products?.capacity ?? 10,
        chatConversationId: conv?.id ?? null,
        chat: grupalDe(inscritos.data),
        chatNoDisponible,
        volverHref: esTutor
          ? `/tutor/clases-grupales/${gc.product_id}`
          : `/reservas/${s.booking_id}`,
      }}
    />
  );
}
