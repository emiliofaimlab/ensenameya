import Link from "next/link";
import { EyeIcon, VideoIcon } from "lucide-react";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { getUserTimezone } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { aceptaAntesDe, formatSessionTime } from "@/lib/booking";
import type { TutorBalance } from "@/lib/payouts";
import { roomOpen } from "@/lib/room-window";
import { cn } from "@/lib/utils";
import { studentsOfTutor } from "./students";
import { ChatDeReservaButton } from "./chat-button";
import { StudentLink } from "./student-link";
import { formatPct, tutorTier } from "./tier";
import { AcceptRejectButtons } from "./reservas/booking-actions";
import { SupportCard } from "@/components/support/support-card";
import {
  AcceptCountdown,
  PanelCard,
  PanelIconButton,
  PanelRow,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Panel del tutor · Enséñame Ya" };

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  SCR-TU06 · hub del tutor — paquete «Panel del tutor v2» (§1 del documento
 *  aprobado por Emilio Faim el 8-sep-2026).
 *
 *  ── QUÉ SALIÓ DE ESTA PANTALLA, Y POR QUÉ ─────────────────────────────────
 *  · Los 4 tiles: tres eran la cabecera de /tutor/payouts calcada («Ya pagado»
 *    además es histórico, no acción) y el cuarto era un número sin destino.
 *  · «Reservas recientes»: duplicaba /tutor/reservas sin poder hacer nada.
 *  · «Accesos rápidos» (N-08): es el menú lateral escrito otra vez.
 *  · El párrafo del nivel (N-16): pedía una etiqueta y se entregó prosa.
 *  · El banner «¡Bienvenido!… hasta 5 sesiones» **y su consulta**: ocupaba el
 *    mejor sitio de la pantalla para no pedir nada. Lo sustituye el checklist,
 *    que sí dice qué falta y desaparece solo al completarse.
 *
 *  Lo que queda está ordenado por lo que el tutor viene a hacer: qué espera su
 *  respuesta, qué clase tiene ahora y cuánto va a cobrar.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Solo los estados que hay que AVISAR: `approved` ya no pinta nada (§1.2). */
const APPROVAL_PILL: Record<string, { label: string; tone: PillTone }> = {
  pending: { label: "En revisión", tone: "blue" },
  rejected: { label: "Rechazado", tone: "red" },
  suspended: { label: "Suspendido", tone: "red" },
};

function moneyLine(list: { currency: string; amount: number }[]): string {
  return list.length === 0
    ? "—"
    : list.map((m) => formatMoney(m.amount, m.currency)).join(" · ");
}

/**
 * El día natural de un instante EN LA ZONA DEL TUTOR, como `2026-09-14`.
 *
 * `en-CA` no es un capricho de idioma: es el único locale corriente que da
 * ISO (`YYYY-MM-DD`), así que dos claves se comparan con `===` sin montar
 * fechas intermedias. Y la comparación tiene que ser en SU zona (RN-01/02): a
 * las 23:00 de Bogotá ya es «mañana» en UTC, y el panel diría que la clase de
 * esta noche es de otro día.
 */
const DIA_ISO = "en-CA";
function claveDelDia(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString(DIA_ISO, { timeZone: tz });
}

/**
 * §1.1 · El subtítulo de la cabecera, con datos reales y plural de verdad.
 * Antes era «Resumen de tu actividad como tutor.», que no dice nada.
 *
 * Se arma con las dos cifras que resume la pantalla —las clases de HOY y lo
 * que espera respuesta—, y ninguna de las dos se maquilla: con cero clases
 * dice que no hay clases, que es justo el día en que el tutor quiere saberlo.
 */
function saludo(clasesHoy: number, porAtender: number): string {
  const clases =
    clasesHoy === 0
      ? "no tienes clases"
      : `tienes ${clasesHoy} ${clasesHoy === 1 ? "clase" : "clases"}`;
  const cosas =
    porAtender === 0
      ? "nada espera tu respuesta"
      : `${porAtender} ${porAtender === 1 ? "cosa espera" : "cosas esperan"} tu respuesta`;
  return `Hoy ${clases} y ${cosas}.`;
}

/**
 * El lunes del próximo lote de payouts (§1.4 · «Se paga el lunes 14 de
 * septiembre»). La cadencia semanal de los lunes es la que ya declara
 * /tutor/payouts («Lote semanal, los lunes»); aquí solo se pone fecha.
 *
 * ⚠️ Se fija a las 12:00 UTC y NO a medianoche. Un lunes a las 00:00 UTC es
 * todavía domingo por la tarde en Bogotá, así que al formatearlo en la zona
 * del tutor la etiqueta diría «domingo 13» — la fecha correcta, el día
 * equivocado. Al mediodía UTC ninguna zona habitada cambia de día.
 */
function proximoLunes(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

/** «lunes 14 de septiembre». En dos llamadas porque `es` mete una coma entre
 *  el día de la semana y la fecha, y quitarla a mano es peor que no ponerla. */
function fechaLarga(d: Date, tz: string): string {
  const semana = d.toLocaleDateString("es", { weekday: "long", timeZone: tz });
  const fecha = d.toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    timeZone: tz,
  });
  return `${semana} ${fecha}`;
}

/**
 * Cuándo es esta clase, contado desde hoy: «Hoy, 18:00» · «Mañana, 10:00» ·
 * «jue, 11 sept, 18:00». Es lo que pide la captura de §1, y en una lista de
 * cinco filas es la diferencia entre leer una fecha y entenderla.
 *
 * Vive a nivel de módulo y no dentro del componente por lo mismo que
 * `isUpcoming` en `lib/booking.ts`: leer el reloj en una closure de render
 * dispara la regla de pureza de `react-hooks`.
 */
function cuando(iso: string, tz: string): string {
  const hoy = new Date();
  const mañana = new Date(hoy.getTime() + 86_400_000);
  const dia = claveDelDia(iso, tz);
  const hora = new Date(iso).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
  if (dia === claveDelDia(hoy.toISOString(), tz)) return `Hoy, ${hora}`;
  if (dia === claveDelDia(mañana.toISOString(), tz)) return `Mañana, ${hora}`;
  return formatSessionTime(iso, tz);
}

/**
 * SCR-TU06 — hub del tutor. Es el destino de `pickHome` tras entrar (Doc 3),
 * así que debe existir para cualquiera con perfil de tutor: se usa
 * `requireTutorProfile` (no `requireRole`) porque un tutor **pendiente** aún no
 * tiene el rol y justo necesita ver su estado de aprobación.
 */
export default async function TutorHomePage() {
  const { userId, approvalStatus } = await requireTutorProfile();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  const [
    { data: profile },
    { data: balanceData },
    { data: nextSessions },
    { data: pendientes, count: pendientesTotal },
    { count: reglasCount },
    { count: activosCount },
    { data: preferencia },
    students,
    tier,
  ] = await Promise.all([
    supabase
      .from("tutor_profiles")
      .select(
        // Ver la nota de `admin/tutores/page.tsx`: con `tutor_views` en medio,
        // el embed corto a `profiles` es ambiguo y tumba la consulta entera.
        // `avatar_path` y `payout_country` son nuevos: los pide el checklist.
        "approval_notes, identity_verification_status, avatar_path, payout_country, profiles!tutor_profiles_profile_id_fkey(full_name)",
      )
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase.rpc("tutor_balance"),
    supabase
      .from("sessions")
      .select(
        // B-2 · `end_at` y las dos columnas de ventana: sin ellas este panel
        // no puede saber si la sala está abierta, y ofrecía "Ir a la sala"
        // para clases de dentro de semanas.
        "id, start_at, end_at, status, booking_id, student_id, access_opens_at, access_closes_at, bookings(products(title))",
      )
      .eq("tutor_id", userId)
      .in("status", ["scheduled", "in_progress"])
      // Se filtra por el FIN, no por el inicio: una clase que empezó hace un
      // rato sigue en curso, y desaparecer del panel dejaría al tutor creyendo
      // que no tiene clase mientras el alumno espera en la sala.
      //
      // Se queda en `end_at`, NO en `access_closes_at`. Con los 7 días de
      // MN-05 arrastrar aquí una semana de clases ya dadas habría tapado justo
      // lo que el tutor viene a mirar; con B-2 los dos casi coinciden, pero el
      // criterio correcto sigue siendo el fin de la CLASE — esto es "Próximas
      // clases", no "salas abiertas". La sala de una clase pasada se alcanza
      // desde su reserva.
      .gte("end_at", new Date().toISOString())
      .order("start_at")
      // La LISTA enseña 5 (§1.4), pero el subtítulo cuenta las clases de HOY:
      // con `limit(5)` un tutor con seis clases hoy leería «tienes 5». Se
      // traen 20 y se corta al pintar; son 20 filas, no una consulta más.
      .limit(20),
    // §1.4 · «Por atender». Esta consulta da las filas Y el total, así que
    // sustituye a la vez a «Reservas recientes» y al `count` suelto de
    // pendientes que tenía la v1. Las más antiguas primero: son las que antes
    // vencen (RN-38).
    supabase
      .from("bookings")
      .select(
        "id, created_at, total_amount, currency, student_id, products(title), sessions(start_at)",
        { count: "exact" },
      )
      .eq("tutor_id", userId)
      .eq("status", "pending_acceptance")
      .order("created_at", { ascending: true })
      .limit(5),
    // Checklist (§1.3): dos contadores `head`, o sea sin traer filas.
    supabase
      .from("availability_rules")
      .select("id", { count: "exact", head: true })
      .eq("tutor_id", userId),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("tutor_id", userId)
      .eq("status", "active"),
    // ⚠️ NOVENA CONSULTA, Y NO ES UN ADORNO. El documento da `payout_country`
    // como proxy de «cuenta de cobro empezada», pero desde `20260908130000`
    // ese país ya NO lo elige el tutor: lo deduce un trigger de su zona
    // horaria, y en dev lo tienen los 24 tutores. O sea que ese paso del
    // checklist nacería en verde para todo el mundo y contradiría al propio
    // menú, donde «Mis cuentas 1» está pidiendo justo eso (G-02, H-01). El
    // método preferido es el mismo dato que ya lee `lib/tutor/sidebar-badges`,
    // así que pantalla y menú dicen lo mismo por construcción.
    supabase
      .from("tutor_payout_preferences")
      .select("method")
      .eq("tutor_id", userId)
      .maybeSingle(),
    // N-13: los nombres de TODOS sus alumnos de una vez (la RPC ya filtra por
    // `auth.uid()`), no una consulta por reserva.
    studentsOfTutor(supabase),
    // N-16: el nivel y el reparto. Sin migración: `tutor_tiers_select_own` ya
    // existía; lo que faltaba era enseñárselo al tutor.
    tutorTier(supabase, userId),
  ]);

  const balance = balanceData as unknown as TutorBalance;
  const firstName = profile?.profiles?.full_name?.split(" ")[0];
  const aviso = APPROVAL_PILL[approvalStatus];

  const sesiones = nextSessions ?? [];
  const porAceptar = pendientes ?? [];
  // El total de la consulta, no el de la página: la lista enseña 5 y el
  // contador del menú cuenta la tabla entera. Si divergieran, el menú diría 7
  // y la pantalla 5 sobre lo mismo.
  const porAtenderTotal = pendientesTotal ?? porAceptar.length;
  const hoy = claveDelDia(new Date().toISOString(), tz);
  const clasesHoy = sesiones.filter(
    (s) => claveDelDia(s.start_at, tz) === hoy,
  ).length;

  /**
   * §1.3 · Checklist «Lo que falta para que te reserven». Cinco pasos, cada
   * uno con el enlace al subnivel del menú donde se completa (G-01), y se
   * oculta solo al estar los cinco.
   *
   * No se pinta a un tutor rechazado o suspendido: a ése no le falta rellenar
   * un hueco para que le reserven, le falta que el equipo le apruebe, y eso ya
   * se lo está diciendo el aviso de arriba.
   */
  // Un solo concepto de «ya puede cobrar», leído en dos sitios: el paso del
  // checklist y el aviso ámbar de «Tus ingresos». Ver la nota de la consulta
  // de preferencias sobre por qué NO basta con `payout_country`.
  const cuentaDeCobroLista =
    Boolean(profile?.payout_country) && Boolean(preferencia?.method);

  const pasos = [
    {
      ok: Boolean(profile?.avatar_path),
      label: "Foto de perfil",
      href: "/account#informacion-personal",
      accion: "Subir en Mi cuenta →",
    },
    {
      ok: profile?.identity_verification_status !== "not_submitted",
      label: "Documentos de identidad",
      href: "/tutor/verification",
      accion: "Completar en Verificación →",
    },
    {
      ok: (reglasCount ?? 0) > 0,
      label: "Horario semanal",
      href: "/tutor/availability#horario-semanal",
      accion: "Configurar en Disponibilidad →",
    },
    {
      ok: (activosCount ?? 0) > 0,
      label: "Primera mentoría publicada",
      href: "/tutor/products",
      accion: "Publicar en Mis mentorías →",
    },
    {
      ok: cuentaDeCobroLista,
      label: "Cuenta de cobro",
      href: "/tutor/payouts#mis-cuentas",
      accion: "Configurar en Mis pagos →",
    },
  ];
  const listos = pasos.filter((p) => p.ok).length;
  const faltaAlgo = listos < pasos.length;
  const hayDinero =
    balance.available.length > 0 || balance.in_retention.length > 0;

  return (
    // `TutorShell` y no `PanelShell` con `items` a mano: es el mismo menú, y
    // así el dashboard recibe los contadores (G-02) como el resto del panel.
    <TutorShell
      userId={userId}
      title={firstName ? `Hola, ${firstName}` : "Tu panel"}
      description={saludo(clasesHoy, porAtenderTotal)}
    >
      {/* §1.2 · Un solo aviso de cuenta, y solo si hay algo que avisar. */}
      {aviso ? (
        <PanelCard
          className={cn(
            "flex flex-wrap items-center justify-between gap-3",
            aviso.tone === "red" && "border-[#f0bfbf]",
          )}
        >
          <div>
            <p className="text-sm font-semibold text-[#19191f]">
              {approvalStatus === "pending"
                ? "Tu cuenta está en revisión"
                : `Tu perfil está ${aviso.label.toLowerCase()}`}
            </p>
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
              {approvalStatus === "pending" ? (
                <>
                  Publicar mentorías se habilita cuando se apruebe tu perfil.
                  Mientras tanto puedes dejar todo listo aquí abajo.
                </>
              ) : (
                <>
                  {profile?.approval_notes
                    ? `Motivo: ${profile.approval_notes}. `
                    : ""}
                  Puedes actualizar tus datos y volver a enviarlo.
                </>
              )}
            </p>
          </div>
          <StatusPill tone={aviso.tone}>{aviso.label}</StatusPill>
        </PanelCard>
      ) : null}

      {/* §1.3 · Checklist, A ANCHO COMPLETO y encima de las dos columnas: es
          lo único de la pantalla que caduca, y mientras dure manda. */}
      {faltaAlgo &&
      approvalStatus !== "rejected" &&
      approvalStatus !== "suspended" ? (
        <PanelCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[#19191f]">
              Lo que falta para que te reserven
            </h2>
            <p className="text-[12.5px] text-[#6b6b6b] tabular-nums">
              {listos} de {pasos.length} listos
            </p>
          </div>
          <ul className="mt-2 divide-y divide-[#e0e0e0]">
            {pasos.map((p) => (
              <li
                key={p.label}
                className="flex items-center justify-between gap-3 py-2.5 last:pb-0"
              >
                <span
                  className={cn(
                    "text-[13px]",
                    p.ok ? "text-[#6b6b6b] line-through" : "text-[#19191f]",
                  )}
                >
                  {p.label}
                </span>
                {p.ok ? (
                  <StatusPill tone="green">Listo</StatusPill>
                ) : (
                  <Link
                    href={p.href}
                    className="shrink-0 text-[12.5px] font-medium text-brand hover:underline"
                  >
                    {p.accion}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </PanelCard>
      ) : null}

      {/* §1.4 · Dos columnas: 300 px a la izquierda y el resto a la derecha.
          El `order` solo actúa por debajo de `lg`, donde no hay dos columnas
          que valgan: apiladas, lo primero tiene que ser lo que pide acción,
          no el saldo. */}
      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="order-2 flex flex-col gap-5 lg:order-1 lg:sticky lg:top-24">
          {/* «Tus ingresos» — la tarjeta con más peso de la pantalla (borde
              1.5 px negro): es el recordatorio de por qué el tutor está aquí.
              El detalle vive en /tutor/payouts; aquí solo el titular. */}
          <PanelCard
            id="tus-ingresos"
            className="scroll-mt-24 border-[1.5px] border-[#19191f]"
          >
            <h2 className="text-base font-semibold text-[#19191f]">
              Tus ingresos
            </h2>
            <p className="mt-3 text-xs text-[#6b6b6b]">Disponible para cobrar</p>
            <p className="mt-1 truncate text-[34px] leading-tight font-bold tracking-tight text-[#19191f] tabular-nums">
              {moneyLine(balance.available)}
            </p>
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
              Se paga el{" "}
              <span className="font-semibold text-[#19191f]">
                {fechaLarga(proximoLunes(), tz)}
              </span>
            </p>
            <dl className="mt-3.5 flex flex-col gap-2">
              <PanelRow
                label="En camino (se libera en 7 días)"
                value={moneyLine(balance.in_retention)}
              />
              {/* TODO · DP-3 — «Ganado este mes» necesita el BRUTO del mes y
                  `tutor_balance` solo devuelve netos por moneda, sin ventana
                  temporal (Doc 25 · H-06). No hay de dónde sacarlo sin una
                  función nueva, así que la fila se queda fuera: un importe
                  inventado en la tarjeta de dinero es peor que un hueco. */}
              {/* N-16 · el nivel es una ETIQUETA, no prosa: el reparto sale al
                  pasar el ratón. El nombre lo pone la BD (`tutor_tiers.name`)
                  y no este fichero — AB-06 los deja sin decidir, así que aquí
                  no se bautiza ninguno. */}
              {tier ? (
                <PanelRow
                  label="Tu nivel"
                  value={
                    <StatusPill
                      tone="blue"
                      title={`Te quedas con el ${formatPct(tier.splitPct)} de cada reserva; la comisión de Enséñame Ya es el ${formatPct(tier.commissionPct)}.`}
                    >
                      {tier.name}
                    </StatusPill>
                  }
                />
              ) : null}
            </dl>
            {/* H-01 (Doc 25) · dinero acumulado y ningún sitio donde pagarlo.
                Es el único aviso de esta tarjeta y solo sale cuando hay las
                dos cosas: sin saldo no es urgente, y con cuenta no es nada. */}
            {hayDinero && !cuentaDeCobroLista ? (
              <div className="mt-3.5 rounded-[10px] bg-[#faedcc] p-3">
                <p className="text-[12.5px] font-medium text-[#19191f]">
                  Configura tu cuenta de cobro para poder recibir tu pago.
                </p>
                <Button asChild className="mt-2 h-8">
                  <Link href="/tutor/payouts#mis-cuentas">
                    Configurar cuenta de cobro
                  </Link>
                </Button>
              </div>
            ) : null}
            <Link
              href="/tutor/payouts"
              className="mt-3 block text-[12.5px] font-medium text-brand hover:underline"
            >
              Ver el detalle de mis pagos →
            </Link>
          </PanelCard>

          {/* SUP-01 · soporte. Es la misma tarjeta que ve el alumno: un solo
              componente, un solo buzón. Aquí baja del sitio que ocupaba bajo
              «Accesos rápidos» y se queda pegada al pie de la columna fija. */}
          <SupportCard />
        </div>

        <div className="order-1 flex min-w-0 flex-col gap-5 lg:order-2">
          {/* «Por atender» (borde azul): todo lo que espera al tutor, con su
              acción EN LA FILA. Se pinta siempre —también vacía— porque es el
              destino del subnivel «Por atender» del menú: un ancla que a veces
              no existe manda al tutor al principio de la página sin decirle
              por qué. */}
          <PanelCard
            id="por-atender"
            className={cn(
              "scroll-mt-24",
              porAceptar.length > 0 && "border-[1.5px] border-brand/40",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[#19191f]">
                Por atender
                {porAtenderTotal > 0 ? (
                  <span className="ml-1.5 font-normal text-[#6b6b6b] tabular-nums">
                    ({porAtenderTotal})
                  </span>
                ) : null}
              </h2>
              <Link
                href="/tutor/reservas?f=por-aceptar"
                className="shrink-0 text-[12.5px] font-medium text-brand hover:underline"
              >
                Ver todo
              </Link>
            </div>

            {/* TODO · DP-1 — aquí faltan dos tipos de fila que el documento
                dibuja y deja sin decidir: «Mensaje sin leer · … [Responder]» y
                «Clase por cerrar · … [Marcar como dictada]». Lo que está sin
                responder es de qué consulta sale cada uno: qué cuenta como
                mensaje sin leer para el tutor (`messages` no tiene marca de
                leído por participante) y qué es una clase vencida sin cerrar
                (`sessions` pasadas en `scheduled`, ¿desde cuándo?). Mientras
                tanto esta lista cuenta SOLO reservas por aceptar — que es
                exactamente lo que cuenta el contador del menú
                (`lib/tutor/sidebar-badges.ts`), así que los dos números son el
                mismo. Al cerrarse DP-1 hay que tocar los DOS sitios a la vez o
                volverán a discrepar. */}
            {porAceptar.length === 0 ? (
              <p className="mt-4 text-[13px] text-[#6b6b6b]">
                Nada espera tu respuesta ahora mismo.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[#e0e0e0]">
                {porAceptar.map((b) => {
                  const plazo = aceptaAntesDe(b.created_at);
                  // La sesión es el HOLD del slot: `create_booking` la escribe
                  // antes de que el tutor acepte (S-41), así que la fecha ya
                  // existe. El respaldo es para las reservas viejas sin slot.
                  const inicio = b.sessions?.[0]?.start_at ?? null;
                  return (
                    <li
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0"
                    >
                      {/* `w-full` por debajo de `sm` y columna a partir de
                          ahí: la cuenta atrás más los dos botones miden 257 px
                          fijos, así que en un móvil de 390 al texto le
                          quedaban 49 px y el título se recortaba a una letra.
                          Medido; con el ancho entero se lee y las acciones
                          bajan a su propia línea. */}
                      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                        {/* N-12 · `truncate` + `min-w-0`: los títulos de
                            mentoría llegan a 70 caracteres y sin esto empujan
                            los botones fuera de la tarjeta. */}
                        <p className="truncate text-[13px] font-semibold text-[#19191f]">
                          Reserva nueva · {b.products?.title ?? "Mentoría"}
                        </p>
                        <p className="truncate text-xs text-[#404040]">
                          <StudentLink
                            student={students.get(b.student_id)}
                            className="font-medium text-brand"
                          />
                          {" · "}
                          <span className="first-letter:uppercase">
                            {inicio ? formatSessionTime(inicio, tz) : "Por agendar"}
                          </span>
                          {" · "}
                          {formatMoney(b.total_amount, b.currency)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* G-05 · solo el reloj y el tiempo; la regla de las
                            24 h va en el tooltip del propio componente. */}
                        {plazo ? (
                          <AcceptCountdown
                            label={plazo.label}
                            urgent={plazo.urgent}
                          />
                        ) : null}
                        {/* El mismo componente que /tutor/reservas: una sola
                            regla de aceptar/rechazar, con su confirmación. */}
                        <AcceptRejectButtons bookingId={b.id} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>

          {/* Próximas sesiones (196:3), con acceso a la sala (RN-18 gobierna). */}
          <PanelCard id="proximas-sesiones" className="scroll-mt-24">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#19191f]">
                  Próximas sesiones
                </h2>
                {/* La zona horaria se dice UNA vez bajo el título y no en cada
                    fila: antes cada hora arrastraba «· tu hora local». */}
                <p className="truncate text-xs text-[#6b6b6b]">
                  Horas en tu zona: {tz}
                </p>
              </div>
              <Link
                href="/tutor/reservas?f=proximas"
                className="shrink-0 text-[12.5px] font-medium text-brand hover:underline"
              >
                Ver agenda
              </Link>
            </div>
            {sesiones.length === 0 ? (
              <div className="mt-4">
                <p className="text-[13px] text-[#6b6b6b]">
                  No tienes clases agendadas.
                </p>
                {/* Estado vacío CON SALIDA: qué hacer para que lleguen
                    reservas. Publicar solo se ofrece si no hay ninguna activa;
                    si ya las hay, lo que suele faltar es horario. */}
                <div className="mt-3 flex flex-wrap gap-3">
                  {(activosCount ?? 0) === 0 ? (
                    <Button asChild className="h-9">
                      <Link href="/tutor/products/new">Publicar una mentoría</Link>
                    </Button>
                  ) : null}
                  <Button asChild variant="outline" className="h-9">
                    <Link href="/tutor/availability">Revisar horario</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-[#e0e0e0]">
                {sesiones.slice(0, 5).map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#19191f]">
                        {s.bookings?.products?.title ?? "Mentoría"}
                      </p>
                      {/* N-13: con quién es la llamada. Es el dato que faltaba —
                          el tutor entraba a la sala sin saber a quién iba a
                          encontrarse. */}
                      <p className="truncate text-xs text-[#404040]">
                        con{" "}
                        <StudentLink
                          student={students.get(s.student_id)}
                          className="font-medium text-brand"
                        />
                      </p>
                      {/* `first-letter:uppercase` porque el respaldo de
                          `cuando()` es `formatSessionTime`, y el locale `es`
                          escribe el día en minúscula («mié, 16 sept»). */}
                      <p className="text-[11.5px] text-[#6b6b6b] first-letter:uppercase">
                        {cuando(s.start_at, tz)}
                      </p>
                    </div>
                    {/* G-04 · chat · ojo · videocámara, en ese orden y como
                        iconos: tres botones de texto en esta fila la hacían
                        envolver en cuanto el título pasaba de corto. */}
                    <div className="flex items-center gap-2">
                      {/* Abre el hilo EN LA BURBUJA, sin sacar al tutor de su
                          panel. El porqué del componente aparte (esta página es
                          de servidor) está en `chat-button.tsx`. */}
                      <ChatDeReservaButton bookingId={s.booking_id} />
                      {/* ⚠️ B-2 · La videocámara NO se pinta siempre: se pintaba
                          para toda clase futura, así que el tutor veía «Ir a la
                          sala» semanas antes y el servidor le decía que no.
                          `roomOpen` es la misma comprobación que ya hacían las
                          dos pantallas de detalle. */}
                      {roomOpen(s) ? (
                        <PanelIconButton
                          label="Entrar a la sala"
                          tone="primary"
                          href={`/room/${s.id}`}
                        >
                          <VideoIcon className="size-[17px]" />
                        </PanelIconButton>
                      ) : (
                        <PanelIconButton
                          label="Ver reserva"
                          href={`/tutor/reservas/${s.booking_id}`}
                        >
                          <EyeIcon className="size-4" />
                        </PanelIconButton>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>
        </div>
      </div>
    </TutorShell>
  );
}
