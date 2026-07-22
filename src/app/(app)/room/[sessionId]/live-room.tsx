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
import { ATTACHMENT_TYPES, uploadAttachment } from "@/lib/chat/attachments";

type SessionStatus = Database["public"]["Enums"]["session_status"];
type BookingStatus = Database["public"]["Enums"]["booking_status"];

// RN-18 / S-45: la ventana abre 10 min antes y cierra 10 min después. El server
// es la barrera real; aquí solo se pinta el estado.
const WINDOW_MIN = 10;

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

/** ms → "2 h 05 min" / "4 min 12 s" para la cuenta regresiva. */
function human(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(sec).padStart(2, "0")} s`;
  return `${sec} s`;
}

export function LiveRoom({
  sessionId,
  bookingId,
  startAt,
  endAt,
  sessionStatus,
  bookingStatus,
  productTitle,
  isTutor,
  currentUserId,
  firstSessionAt,
  initialMessages,
}: {
  sessionId: string;
  bookingId: string;
  startAt: string;
  endAt: string;
  sessionStatus: SessionStatus;
  bookingStatus: BookingStatus;
  productTitle: string;
  isTutor: boolean;
  currentUserId: string;
  firstSessionAt: string | null;
  initialMessages: ChatMessage[];
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [joined, setJoined] = useState<Joined | null>(null);
  const [busy, setBusy] = useState(false);
  // Controles locales de la sala simulada (con Daily real los trae el SDK).
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [uploading, setUploading] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const opensAt = new Date(startAt).getTime() - WINDOW_MIN * 60000;
  const closesAt = new Date(endAt).getTime() + WINDOW_MIN * 60000;

  // Reloj de 1 s para la cuenta regresiva y para reaccionar al abrir/cerrar.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const bookingActive = bookingStatus === "confirmed" || bookingStatus === "in_progress";
  const sessionOver =
    sessionStatus === "completed" ||
    sessionStatus === "cancelled" ||
    sessionStatus === "no_show";
  const beforeWindow = now < opensAt;
  const afterWindow = now > closesAt;

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
        showFullscreenButton: true,
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
    setJoined({
      roomUrl: body.roomUrl,
      token: body.token,
      endsAt: body.endsAt,
      simulated: Boolean(body.simulated),
    });
  }

  /**
   * "Subir documentos" (LV01). Publica el archivo en el hilo de la reserva: el
   * panel de al lado lo recibe por Realtime, así que no hace falta cablear nada
   * entre los dos componentes.
   */
  async function shareDoc(file: File) {
    setUploading(true);
    const res = await uploadAttachment(bookingId, file);
    setUploading(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success("Documento compartido en el chat.");
  }

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
  if (live && joined) {
    const total = new Date(endAt).getTime() - new Date(startAt).getTime();
    const elapsed = now - new Date(startAt).getTime();

    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-4">
        {/* Barra de sesión (LV01): qué clase es y cuánto lleva. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-background pb-3">
          <h1 className="font-bold">{productTitle}</h1>
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

        {/* Dos columnas como en LV01: vídeo + hilo. En móvil el chat baja. */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col overflow-hidden rounded-xl border">
            {joined.simulated ? (
              // Sin credenciales de Daily: la sala, el token y la ventana ya
              // funcionan; falta solo el transporte de video.
              <div className="relative flex h-[clamp(20rem,55vh,34rem)] items-center justify-center bg-neutral-900 text-neutral-300">
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
              <div ref={frameRef} className="relative h-[clamp(20rem,55vh,34rem)] bg-neutral-900" />
            )}

            <div className="flex flex-wrap items-center gap-2 border-t bg-background p-3">
              <span className="mr-auto text-sm text-muted-foreground" suppressHydrationWarning>
                Termina en {human(new Date(joined.endsAt).getTime() - now)}
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

              <input
                ref={docRef}
                type="file"
                accept={ATTACHMENT_TYPES.join(",")}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void shareDoc(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                disabled={uploading}
                onClick={() => docRef.current?.click()}
              >
                {uploading ? "Subiendo…" : "Subir documentos"}
              </Button>

              {isTutor ? (
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
          <aside className="flex h-[clamp(24rem,66vh,42rem)] flex-col rounded-xl border p-4">
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
      <div>
        <p className="text-sm text-muted-foreground">Clase</p>
        <h1 className="text-xl font-semibold">{productTitle}</h1>
      </div>

      {!bookingActive || sessionOver ? (
        <>
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {sessionOver
              ? "Esta sesión ya terminó."
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
              {human(opensAt - now)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Podrás entrar {WINDOW_MIN} min antes de la hora de inicio.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {new Date(startAt).toLocaleString("es")}
          </p>
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
            La sala está abierta. Cierra en {human(closesAt - now)}.
          </p>
          <Button size="lg" disabled={busy} onClick={join} className="min-w-40">
            {busy ? "Entrando…" : "Entrar a la sala"}
          </Button>
        </>
      )}
    </div>
  );
}
