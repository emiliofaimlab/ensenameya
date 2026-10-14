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
import { SiteHeader } from "@/components/layout/site-header";
import { ACCESS_WINDOW_MIN, withMinutes } from "@/lib/room-window";
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

  const { data: gc } = await supabase
    .from("group_classes")
    .select(
      "id, product_id, tutor_id, start_at, end_at, products!group_classes_product_id_fkey(title, capacity)",
    )
    .eq("id", groupClassId)
    .maybeSingle();
  if (!gc) notFound();
  const esTutor = gc.tutor_id === user.id;

  // La sesión de la que cuelgan el «Entiendo» y el canal de cierre: la del
  // alumno, o —para el tutor, que no tiene— la primera viva de la fecha.
  let q = supabase
    .from("sessions")
    .select("id, status, booking_id, session_ref, access_opens_at, access_closes_at, bookings(status)")
    .eq("group_class_id", gc.id)
    .neq("status", "cancelled");
  if (!esTutor) q = q.eq("student_id", user.id);
  const { data: sesiones } = await q.order("id").limit(1);
  const s = sesiones?.[0];

  if (!s) {
    // Tutor sin inscritos todavía, o alumno que se dio de baja.
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{gc.products?.title ?? "Clase grupal"}</h1>
        <p className="text-sm text-muted-foreground">
          {esTutor
            ? "La sala se abre cuando haya al menos un inscrito con el pago confirmado."
            : "No tienes un cupo activo en esta clase."}
        </p>
      </div>
    );
  }

  const [{ data: conv }, inscritos, { data: consents }, notices, tz, formato] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id")
        .eq("kind", "group")
        .eq("group_product_id", gc.product_id)
        .maybeSingle(),
      supabase.rpc("inscritos_de_clase", { p_product: gc.product_id }),
      supabase
        .from("session_recording_consents")
        .select("user_id")
        .eq("session_id", s.id),
      listNotices(user.id),
      getUserTimezone(),
      getFormatoHora(),
    ]);

  const { data: msgs } = conv
    ? await supabase
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conv.id)
        .order("created_at")
    : { data: null };

  const nombres = Object.fromEntries(
    (inscritos.data ?? []).map((i) => [i.user_id, i.nombre]),
  );

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
      // Reportar aún no admite hilos de grupo (`20261009110000`).
      conversationId={null}
      startAt={gc.start_at}
      endAt={gc.end_at}
      opensAt={s.access_opens_at ?? withMinutes(gc.start_at, -ACCESS_WINDOW_MIN)}
      closesAt={s.access_closes_at ?? withMinutes(gc.end_at, ACCESS_WINDOW_MIN)}
      sessionStatus={s.status}
      bookingStatus={s.bookings?.status ?? "cancelled"}
      productTitle={gc.products?.title ?? "Clase grupal"}
      sessionRef={s.session_ref}
      isTutor={esTutor}
      currentUserId={user.id}
      firstSessionAt={null}
      initialMessages={(msgs ?? []).map(toChatMessage)}
      entendido={(consents ?? []).some((c) => c.user_id === user.id)}
      grupal={{
        groupClassId: gc.id,
        capacity: gc.products?.capacity ?? 10,
        chatConversationId: conv?.id ?? null,
        nombres,
        volverHref: esTutor
          ? `/tutor/clases-grupales/${gc.product_id}`
          : `/reservas/${s.booking_id}`,
      }}
    />
  );
}
