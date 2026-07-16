"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";

type SessionStatus = Database["public"]["Enums"]["session_status"];
type BookingStatus = Database["public"]["Enums"]["booking_status"];

// RN-18 / S-45: la ventana abre 10 min antes y cierra 10 min después. El server
// es la barrera real; aquí solo se pinta el estado y la cuenta regresiva.
const WINDOW_MIN = 10;

type Joined = { roomUrl: string; token: string; endsAt: string };

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
  startAt,
  endAt,
  sessionStatus,
  bookingStatus,
  productTitle,
  isTutor,
}: {
  sessionId: string;
  startAt: string;
  endAt: string;
  sessionStatus: SessionStatus;
  bookingStatus: BookingStatus;
  productTitle: string;
  isTutor: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [joined, setJoined] = useState<Joined | null>(null);
  const [busy, setBusy] = useState(false);
  // Controles locales (con Daily real accionan el track; simulado, demuestran
  // que los toques funcionan en móvil — US-803).
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);

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

  // "En vivo" es un estado DERIVADO: uniste y la ventana sigue abierta. Al vencer
  // se cae solo al estado "ventana cerró" sin tocar el state en un efecto.
  const live = joined !== null && !afterWindow;

  async function join() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("join_session", { p_session_id: sessionId });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo entrar a la sala.");
      router.refresh();
      return;
    }
    const d = data as { room_url: string; token: string; ends_at: string };
    setJoined({ roomUrl: d.room_url, token: d.token, endsAt: d.ends_at });
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
    return (
      <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
        {/* Área de video: crece para ocupar la pantalla (móvil y escritorio). */}
        <div className="relative flex flex-1 items-center justify-center bg-neutral-900 text-neutral-300">
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-sm uppercase tracking-wide text-neutral-500">Sala simulada</p>
            <p className="max-w-sm text-sm">
              El video real de Daily se conecta al cablear las credenciales del
              proveedor. La sala, el token y la ventana ya funcionan.
            </p>
            <p className="mt-2 break-all font-mono text-xs text-neutral-600">
              {joined.roomUrl}
            </p>
          </div>
          <div className="absolute right-3 top-3 rounded-md bg-black/50 px-2 py-1 text-xs text-neutral-200">
            Termina en {human(new Date(joined.endsAt).getTime() - now)}
          </div>
        </div>

        {/* Barra de controles: objetivos táctiles grandes (US-803). */}
        <div className="flex flex-wrap items-center justify-center gap-2 border-t bg-background p-3">
          <Button
            variant={muted ? "default" : "outline"}
            size="lg"
            className="min-w-24"
            onClick={() => setMuted((m) => !m)}
          >
            {muted ? "Activar micro" : "Silenciar"}
          </Button>
          <Button
            variant={camOff ? "default" : "outline"}
            size="lg"
            className="min-w-24"
            onClick={() => setCamOff((c) => !c)}
          >
            {camOff ? "Activar cámara" : "Apagar cámara"}
          </Button>
          {isTutor ? (
            <Button variant="default" size="lg" disabled={busy} onClick={complete}>
              Marcar completada
            </Button>
          ) : null}
          <Button variant="destructive" size="lg" onClick={() => setJoined(null)}>
            Salir
          </Button>
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
            <p className="mt-1 text-3xl font-semibold tabular-nums">{human(opensAt - now)}</p>
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
          <p className="text-sm text-muted-foreground">
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
