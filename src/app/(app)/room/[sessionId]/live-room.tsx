"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { DailyCall } from "@daily-co/daily-js";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import { RecordingConsent } from "@/components/room/recording-consent";
import { SessionRef } from "@/components/room/session-ref";

type SessionStatus = Database["public"]["Enums"]["session_status"];
type BookingStatus = Database["public"]["Enums"]["booking_status"];

// MN-05 · La ventana de acceso ya NO se calcula aquí. Llega por props desde
// `page.tsx`, que la lee de `sessions.access_opens_at` / `access_closes_at` —
// las columnas que la migración `20260820190000` despertó. Antes esto era
// `const WINDOW_MIN = 10` y era una de las cinco copias del número; con la
// ventana en días, una copia desactualizada sería un botón que aparece siete
// días antes junto a un texto que promete diez minutos.
//
// Lo que sigue siendo cierto: el server es la barrera real (`join_session`),
// aquí solo se pinta el estado.

type Joined = {
  roomUrl: string;
  token: string | null;
  endsAt: string;
  /** Sin credenciales de Daily la sala va simulada (ver `lib/daily.ts`). */
  simulated: boolean;
};

/** ms → "12:34" para el cronómetro de la sesión (AL/LV01). */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * ms → "6 d 04 h" / "2 h 05 min" / "4 min 12 s" para la cuenta regresiva.
 *
 * MN-05 · El tramo de días es nuevo y hace falta: con la sala abierta 7 días,
 * la cuenta atrás llegaba a "167 h 59 min", que no lo lee nadie.
 */
function human(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} d ${String(h).padStart(2, "0")} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(sec).padStart(2, "0")} s`;
  return `${sec} s`;
}

export function LiveRoom({
  sessionId,
  bookingId,
  startAt,
  endAt,
  opensAt,
  closesAt,
  sessionStatus,
  bookingStatus,
  productTitle,
  sessionRef,
  timeZone,
  isTutor,
  currentUserId,
  firstSessionAt,
  initialMessages,
  consent,
}: {
  sessionId: string;
  bookingId: string;
  startAt: string;
  endAt: string;
  /** MN-05 · `sessions.access_opens_at`: cuándo la sala admite gente (7 días
   *  antes del inicio). NO es cuándo empieza la mentoría — eso es `startAt`. */
  opensAt: string;
  /** MN-05 · `sessions.access_closes_at` (7 días tras el fin). Tampoco es
   *  cuándo se cierra la contabilidad: eso pasa a los 10 min y no se toca. */
  closesAt: string;
  sessionStatus: SessionStatus;
  bookingStatus: BookingStatus;
  productTitle: string;
  /** N-27 · "N.º de sesión" visible. Null en reservas viejas (ver migración). */
  sessionRef: string | null;
  /** RV-18/RN-01 · la resuelve la página en servidor; sin ella el SSR
   *  formatea en UTC y la hora no coincide con la del navegador. */
  timeZone: string;
  isTutor: boolean;
  currentUserId: string;
  firstSessionAt: string | null;
  initialMessages: ChatMessage[];
  /** US-1801 · quién ha aceptado ya que se grabe (RN-42). */
  consent: { mine: boolean; other: boolean };
}) {
  const router = useRouter();
  /**
   * RV-18 · `now` arranca en `null` A PROPÓSITO, y no en `Date.now()`.
   *
   * Este componente es de cliente pero SE RENDERIZA TAMBIÉN EN EL SERVIDOR, y
   * de `now` salen `beforeWindow` y `afterWindow`, que deciden QUÉ RAMA del
   * árbol se pinta. Si el SSR cae a un lado del umbral y la hidratación al
   * otro, no cambia un texto: cambia la ESTRUCTURA — que es exactamente el
   * React #418 de "marcado distinto", no el #425 de "texto distinto". Y el
   * `suppressHydrationWarning` de la cuenta atrás no cubre nada de esto:
   * silencia el texto de ESE nodo, no la elección de rama.
   *
   * Con `null`, el servidor y el primer render del cliente pintan lo mismo
   * (la sala aún no decidida) y el reloj entra en el efecto de montaje.
   */
  const [now, setNow] = useState<number | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [busy, setBusy] = useState(false);
  // Controles locales de la sala simulada (con Daily real los trae el SDK).
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  // "Modo teatro" (reunión 7-ago): la sala ocupa toda la ventana y el vídeo
  // crece, pero el chat sigue al lado. Es lo que el fullscreen de Daily no
  // puede hacer, porque el suyo solo agranda su iframe.
  const [teatro, setTeatro] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  // MN-05 · cuándo se pidió entrada. Solo se usa para saber si fue ANTES de que
  // la mentoría empezara; ver el efecto de re-autorización más abajo.
  const joinedAt = useRef<number | null>(null);
  const cicloPedido = useRef(false);

  const opens = new Date(opensAt).getTime();
  const closes = new Date(closesAt).getTime();
  // La ventana de la CLASE (RN-18/S-45, los 10 min de siempre). Es la que
  // decide si esto es la mentoría o alguien mirando la sala, y la que el server
  // usa para mover el ciclo M5 — de ahí cuelga el cobro del tutor. Se pinta a
  // partir de `startAt`/`endAt` porque es una propiedad de la clase, no una
  // columna: en la BD es `session_live_window()`.
  const liveOpens = new Date(startAt).getTime() - 10 * 60_000;
  const liveCloses = new Date(endAt).getTime() + 10 * 60_000;

  // Reloj de 1 s para la cuenta regresiva y para reaccionar al abrir/cerrar.
  //
  // La primera puesta en hora va en un `setTimeout(…, 0)` y no en una llamada
  // directa a `setNow` dentro del efecto: así el reloj arranca en el primer
  // hueco tras pintar —sin el segundo de espera que costaría dejárselo al
  // intervalo— y sin el `setState` directo en el efecto, que `react-hooks`
  // marca con razón porque fuerza un render extra en cascada.
  useEffect(() => {
    const enHora = () => setNow(Date.now());
    const primera = setTimeout(enHora, 0);
    const id = setInterval(enHora, 1000);
    return () => {
      clearTimeout(primera);
      clearInterval(id);
    };
  }, []);

  // Escape sale del modo teatro. Es lo que hace el fullscreen del navegador y
  // lo que la gente va a intentar; sin esto la única salida sería el botón, que
  // en pantalla completa cuesta encontrar.
  useEffect(() => {
    if (!teatro) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTeatro(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [teatro]);

  // MN-05 · `completed` entra en la lista. En cuanto el cron cierra la última
  // sesión, la reserva pasa a `completed`; sin esta línea la sala se cerraría a
  // los 10 min por la puerta de al lado y los 7 días no se notarían. Fuera se
  // quedan las que no deben tener sala nunca: `cancelled`/`refunded` porque el
  // dinero volvió, y las dos pendientes porque aún no hay clase que abrir.
  // Misma lista, palabra por palabra, que la guarda de `join_session`: si
  // divergen, el botón aparece y el server dice que no.
  const bookingAllowsRoom =
    bookingStatus === "confirmed" ||
    bookingStatus === "in_progress" ||
    bookingStatus === "completed";

  // ⚠️ MN-05 · Antes esto incluía `completed` y `no_show` y cerraba la sala.
  // Ya no: esos dos son estados de la CONTABILIDAD —dicen que el reloj de la
  // clase venció y que arrancó el del cobro del tutor—, no una orden de cerrar
  // la puerta. La única sesión sin sala es la `cancelled`: esa clase no va a
  // existir y su dinero volvió.
  const sessionCancelled = sessionStatus === "cancelled";
  const sessionEnded =
    sessionStatus === "completed" || sessionStatus === "no_show";
  // Mientras no haya reloj (SSR y primer render del cliente) no se decide nada:
  // ni "todavía no abre" ni "ya cerró". Así las dos pasadas pintan el mismo
  // árbol y la elección de rama ocurre después de hidratar.
  const beforeWindow = now !== null && now < opens;
  const afterWindow = now !== null && now > closes;

  // "En vivo" es un estado DERIVADO: uniste y la ventana sigue abierta.
  const live = joined !== null && !afterWindow;

  // Embed de Daily: se monta al unirse y se destruye al salir/desmontar. El SDK
  // trae los controles (micro, cámara, salir, compartir pantalla) y la
  // reconexión automática ante caída de red (US-803).
  useEffect(() => {
    if (!live || !joined || joined.simulated || !frameRef.current || callRef.current) return;

    let cancelled = false;
    void (async () => {
      const DailyIframe = (await import("@daily-co/daily-js")).default;
      if (cancelled || !frameRef.current) return;

      const call = DailyIframe.createFrame(frameRef.current, {
        showLeaveButton: true,
        // SIN el botón de pantalla completa de Daily (reunión 7-ago): pone el
        // IFRAME a pantalla completa, y como nuestro chat vive fuera de él,
        // desaparecía justo cuando más se usa. En su lugar está el "modo
        // teatro" de aquí abajo, que agranda el vídeo conservando el hilo.
        showFullscreenButton: false,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
      });
      callRef.current = call;

      call.on("left-meeting", () => {
        setJoined(null);
        router.refresh();
      });
      call.on("error", (e) => {
        toast.error("Se perdió la conexión con la sala.");
        console.error("[daily] error:", JSON.stringify(e));
      });

      try {
        await call.join({ url: joined.roomUrl, token: joined.token ?? undefined });
      } catch (e) {
        console.error("[daily] join falló:", JSON.stringify(e));
        toast.error("No pudimos conectar con la sala de video.");
      }
    })();

    return () => {
      cancelled = true;
      if (callRef.current) {
        void callRef.current.destroy();
        callRef.current = null;
      }
    };
  }, [live, joined, router]);

  async function join() {
    setBusy(true);
    // El endpoint autoriza vía `join_session` (ventana, participante, ciclo) y
    // firma el token contra Daily con la API key (server-only).
    const res = await fetch(`/api/room/${sessionId}`, { method: "POST" });
    const body = await res.json();
    setBusy(false);

    if (!res.ok) {
      toast.error(body.error ?? "No se pudo entrar a la sala.");
      router.refresh();
      return;
    }
    joinedAt.current = Date.now();
    setJoined({
      roomUrl: body.roomUrl,
      token: body.token,
      endsAt: body.endsAt,
      simulated: Boolean(body.simulated),
    });
  }

  // ⚠️ MN-05 · Vuelve a pedir entrada cuando empieza la MENTORÍA. Aquí hay
  // dinero, aunque no lo parezca.
  //
  // `join_session` solo mueve el ciclo M5 (sesión → `in_progress`, y con ella la
  // reserva) si el reloj cae dentro de la ventana de la CLASE, no de la de
  // acceso. Es a propósito: abrir la sala el martes para probar la cámara no es
  // empezar la clase del lunes siguiente, y si lo fuera, la reserva saltaría a
  // `in_progress` una semana antes y `cancel_booking` dejaría de aceptarla — el
  // alumno perdería sin enterarse el reembolso del 100 % que le da RN-37 por
  // avisar con 24 h.
  //
  // El precio de esa decisión es este efecto. Quien entró antes de esos 10
  // minutos y se quedó dentro del iframe toda la clase no volvería a pedir
  // entrada jamás: el cron cerraría la sesión como `no_show` y el tutor no
  // cobraría una clase que sí dio. Una llamada más, justo al abrirse la
  // ventana de la clase, lo arregla.
  //
  // Solo para quien entró ANTES: en una entrada normal el ciclo ya se movió en
  // el `join()` de arriba y repetir solo gastaría un token de Daily.
  useEffect(() => {
    if (!joined || now === null || cicloPedido.current) return;
    if (joinedAt.current === null || joinedAt.current >= liveOpens) return;
    if (now < liveOpens || now > liveCloses) return;
    cicloPedido.current = true;
    void fetch(`/api/room/${sessionId}`, { method: "POST" });
  }, [joined, now, liveOpens, liveCloses, sessionId]);

  // N-24 · AQUÍ VIVÍA "Subir documentos", y se quita por feedback del cliente:
  // subir un archivo se ofrecía DOS veces en la misma pantalla —este botón de la
  // barra y el clip del composer del chat, a treinta centímetros— y las dos
  // acababan en el mismo sitio, `uploadAttachment(bookingId, …)`, porque el
  // panel de al lado es el hilo de EP-17, no una copia.
  //
  // Se va este y no el clip porque este era además el peor de los dos: no hacía
  // append optimista, así que quien subía desde la barra no veía su archivo
  // hasta que Realtime devolvía el eco, y con la sala en primer plano eso
  // parecía que no había pasado nada.
  //
  // ⚠️ Venía del Figma (LV01). Si no queda constancia, la próxima pasada de
  // diseño lo devuelve tal cual y volvemos a tener dos botones.

  async function complete() {
    if (!window.confirm("¿Marcar la sesión como completada? La sala se cerrará.")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("complete_session", { p_session_id: sessionId });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo completar la sesión.");
      return;
    }
    setJoined(null);
    toast.success("Sesión completada.");
    router.refresh();
  }

  // ── Estado en vivo (unido) ────────────────────────────────────────────────
  if (live && joined && now !== null) {
    const total = new Date(endAt).getTime() - new Date(startAt).getTime();
    // MN-05 · topado al total. Sin esto, entrar a la sala al día siguiente
    // pintaba "4320:00 / 60:00" en la cabecera: la sala vive una semana, la
    // clase sigue durando lo que dura.
    const elapsed = Math.min(now - new Date(startAt).getTime(), total);

    return (
      <div
        className={
          teatro
            ? "fixed inset-0 z-50 flex w-full flex-col bg-background px-4 py-4"
            : "mx-auto flex w-full max-w-7xl flex-col px-4 py-4"
        }
      >
        {/* Barra de sesión (LV01): qué clase es, con qué número y cuánto lleva.
            El número va en la cabecera y no escondido en un menú porque el caso
            de uso es "estoy en la clase y llamo a soporte": tiene que poder
            leerse sin salir de aquí. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-background pb-3">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate font-bold">{productTitle}</h1>
            <SessionRef nro={sessionRef} />
          </div>
          <div className="ml-auto text-right">
            <p
              className="font-mono text-lg tabular-nums"
              suppressHydrationWarning
            >
              {clock(elapsed)} / {clock(total)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Tiempo de sesión
            </p>
          </div>
        </div>

        {/* Dos columnas como en LV01: vídeo + hilo. En móvil el chat baja. En
            teatro la rejilla se come el alto que sobra y ambas columnas crecen
            con ella — el chat NO se sacrifica, que es la diferencia con el
            fullscreen de Daily. */}
        <div
          className={`mt-4 grid gap-4 lg:grid-cols-[1fr_340px] ${
            teatro ? "min-h-0 flex-1" : ""
          }`}
        >
          <div
            className={`flex flex-col overflow-hidden rounded-xl border ${
              teatro ? "min-h-0" : ""
            }`}
          >
            {joined.simulated ? (
              // Sin credenciales de Daily: la sala, el token y la ventana ya
              // funcionan; falta solo el transporte de video.
              <div
                className={`relative flex items-center justify-center bg-neutral-900 text-neutral-300 ${
                  teatro ? "min-h-0 flex-1" : "h-[clamp(20rem,55vh,34rem)]"
                }`}
              >
                <div className="flex flex-col items-center gap-2 p-6 text-center">
                  <p className="text-sm uppercase tracking-wide text-neutral-500">Sala simulada</p>
                  <p className="max-w-sm text-sm">
                    Falta configurar el proveedor de video. La sala, el token y la
                    ventana de acceso ya funcionan.
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-neutral-600">
                    {joined.roomUrl}
                  </p>
                </div>
              </div>
            ) : (
              // El iframe prefabricado de Daily trae sus propios tiles y su barra
              // de controles: los del Figma (micro/cámara/compartir con iconos)
              // exigirían el modo call-object, que es reescribir EP-08.
              <div
                ref={frameRef}
                className={`relative bg-neutral-900 ${
                  teatro ? "min-h-0 flex-1" : "h-[clamp(20rem,55vh,34rem)]"
                }`}
              />
            )}

            <div className="flex flex-wrap items-center gap-2 border-t bg-background p-3">
              <span className="mr-auto text-sm text-muted-foreground" suppressHydrationWarning>
                Termina en {human(new Date(joined.endsAt).getTime() - (now ?? 0))}
              </span>

              {/* Con Daily real los controles los trae el SDK (y con ellos la
                  reconexión de red, US-803); en simulado se pintan aquí para que
                  los toques en móvil sean ejercitables. */}
              {joined.simulated ? (
                <>
                  <Button
                    variant={muted ? "default" : "outline"}
                    onClick={() => setMuted((m) => !m)}
                  >
                    {muted ? "Activar micro" : "Silenciar"}
                  </Button>
                  <Button
                    variant={camOff ? "default" : "outline"}
                    onClick={() => setCamOff((c) => !c)}
                  >
                    {camOff ? "Activar cámara" : "Apagar cámara"}
                  </Button>
                </>
              ) : null}

              {/* Sustituye al fullscreen de Daily: mismo objetivo (ver grande),
                  pero sin perder el chat. Como el de teatro de YouTube.
                  Solo en lg+: medido en móvil, el "teatro" deja el vídeo MÁS
                  pequeño que el tamaño normal, porque la rejilla pasa a una
                  columna y hay que repartir el alto con el chat. */}
              <Button
                variant="outline"
                className="hidden lg:inline-flex"
                aria-pressed={teatro}
                onClick={() => setTeatro((t) => !t)}
                title={teatro ? "Salir del modo teatro (Esc)" : "Ampliar el vídeo sin perder el chat"}
              >
                {teatro ? "Salir del modo teatro" : "Modo teatro"}
              </Button>

              {/*
                ⚠️ Doble puerta, y la segunda es de dinero.

                Hasta MN-05 esta vista solo se alcanzaba dentro de los ±10 min
                de la clase, así que el botón vivía pegado a ella. Ahora la sala
                abre 7 días antes, y con ella venía el botón.

                · El ESTADO evita el botón que solo sabe dar error:
                  `complete_session` acepta `scheduled`/`in_progress` y nada
                  más. Es el mismo criterio que `tutor/reservas/[id]`.
                · La VENTANA DE LA CLASE es la que importa de verdad: una
                  mentoría que es dentro de seis días también está `scheduled`,
                  así que sin esto el tutor podía entrar el martes, pulsar, y
                  `complete_session` ponía `bookings.completed_at = now()` —
                  exactamente el reloj que toda la migración de MN-05 existe
                  para NO mover, y del que cuelga su payout.
              */}
              {isTutor &&
              (sessionStatus === "scheduled" || sessionStatus === "in_progress") &&
              now >= liveOpens &&
              now <= liveCloses ? (
                <Button disabled={busy} onClick={complete}>
                  Marcar completada
                </Button>
              ) : null}

              {joined.simulated ? (
                <Button variant="destructive" onClick={() => setJoined(null)}>
                  Salir
                </Button>
              ) : null}
            </div>
          </div>

          {/* El hilo es el MISMO de EP-17 (`/chat/<reserva>`), no una copia:
              mismos mensajes, misma RLS, mismo Realtime. */}
          <aside
            className={`flex flex-col rounded-xl border p-4 ${
              teatro ? "min-h-0 lg:h-auto" : "h-[clamp(24rem,66vh,42rem)]"
            }`}
          >
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">Chat</h2>
              <Link
                href={`/chat/${bookingId}`}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                title="Ver el hilo completo fuera de la sala"
              >
                Disponible durante la sesión
              </Link>
            </div>
            <div className="min-h-0 flex-1">
              <ChatThread
                fill
                bookingId={bookingId}
                currentUserId={currentUserId}
                firstSessionAt={firstSessionAt}
                initialMessages={initialMessages}
              />
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // ── Estados previos / posteriores ─────────────────────────────────────────
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm text-muted-foreground">Mentoría</p>
        <h1 className="text-xl font-semibold">{productTitle}</h1>
        {/* También antes de entrar y después de salir: la consulta a soporte
            suele ser justo cuando la sala NO deja pasar. */}
        <SessionRef nro={sessionRef} />
      </div>

      {now === null ? (
        /*
         * RV-18 · Estado neutro mientras no hay reloj — o sea, en el SSR y en
         * el primer render del cliente.
         *
         * NO se puede caer a ninguna de las ramas de abajo: todas dependen de
         * comparar la hora actual con la ventana de la sala, y si el servidor
         * eligiera una rama y el navegador otra, cambiaría la ESTRUCTURA del
         * árbol — el React #418 que se ve en producción. Un estado propio, que
         * dura lo que tarda el efecto de montaje, es la única forma de que las
         * dos pasadas pinten lo mismo sin mentir sobre el estado de la sala.
         */
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Comprobando el horario de la sesión…
        </p>
      ) : !bookingAllowsRoom || sessionCancelled ? (
        <>
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {sessionCancelled
              ? "Esta sesión se canceló, así que su sala no se abre."
              : "Esta reserva no está activa, así que la sala no está disponible."}
          </p>
          <Button asChild variant="outline">
            <Link href={isTutor ? "/tutor/reservas" : "/reservas"}>Volver a mis reservas</Link>
          </Button>
        </>
      ) : beforeWindow ? (
        <>
          <div className="rounded-lg border p-6">
            <p className="text-sm text-muted-foreground">La sala abre en</p>
            {/* El reloj del server y el del cliente difieren en segundos: es
                esperado en una cuenta regresiva, no un fallo de render. */}
            <p className="mt-1 text-3xl font-semibold tabular-nums" suppressHydrationWarning>
              {human(opens - now)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              La sala abre 7 días antes de la mentoría y sigue abierta 7 días
              después.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {new Date(startAt).toLocaleString("es", { timeZone, dateStyle: "full", timeStyle: "short" })}
          </p>
          {/* El permiso se puede dar mientras esperas: RN-42 pide que esté
              decidido ANTES de entrar, no que la sala ya esté abierta. */}
          <RecordingConsent
            sessionId={sessionId}
            userId={currentUserId}
            isTutor={isTutor}
            mine={consent.mine}
            other={consent.other}
          />
        </>
      ) : afterWindow ? (
        <>
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            La ventana de acceso de esta sesión ya cerró.
          </p>
          <Button asChild variant="outline">
            <Link href={isTutor ? "/tutor/reservas" : "/reservas"}>Volver a mis reservas</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {/* MN-05 · Con la clase ya cerrada la sala sigue abierta una
                semana, y decir solo "la sala está abierta" haría pensar que la
                mentoría no ha ocurrido. El estado de la sesión y el de la sala
                son cosas distintas y aquí se dicen las dos. */}
            {sessionEnded
              ? `Esta mentoría ya terminó, pero su sala sigue abierta ${human(closes - (now ?? 0))} más.`
              : `La sala está abierta. Cierra en ${human(closes - (now ?? 0))}.`}
          </p>
          {/* RN-42: el permiso se pide ANTES de entrar, no a mitad de clase. */}
          <RecordingConsent
            sessionId={sessionId}
            userId={currentUserId}
            isTutor={isTutor}
            mine={consent.mine}
            other={consent.other}
          />
          <Button size="lg" disabled={busy} onClick={join} className="min-w-40">
            {busy ? "Entrando…" : "Entrar a la sala"}
          </Button>
        </>
      )}
    </div>
  );
}
