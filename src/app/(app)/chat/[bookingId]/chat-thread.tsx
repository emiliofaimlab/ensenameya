"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

// RN-41: el chat abre 2 días antes de la 1ª sesión. El server es la barrera
// (send_message); aquí solo se pinta el estado.
const OPEN_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;

/** RN-41: ¿la ventana del chat ya abrió? (2 días antes de la 1ª sesión). */
function computeOpen(firstSessionAt: string | null): boolean {
  if (!firstSessionAt) return false;
  return Date.now() >= new Date(firstSessionAt).getTime() - OPEN_BEFORE_MS;
}

export function ChatThread({
  bookingId,
  currentUserId,
  firstSessionAt,
  initialMessages,
}: {
  bookingId: string;
  currentUserId: string;
  firstSessionAt: string | null;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Inicializador perezoso (se evalúa una vez, no en cada render). El server
  // sigue siendo la barrera real (send_message); esto solo pinta el estado.
  const [isOpen, setIsOpen] = useState(() => computeOpen(firstSessionAt));

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen || !firstSessionAt) return;
    const opensAt = new Date(firstSessionAt).getTime() - OPEN_BEFORE_MS;
    const id = setInterval(() => {
      if (Date.now() >= opensAt) setIsOpen(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [isOpen, firstSessionAt]);

  // Realtime: cada INSERT en messages de ESTA reserva. Para tablas con RLS hay
  // que autenticar el websocket con el JWT del usuario (`setAuth`) o los cambios
  // no llegan; la RLS de SELECT limita a su reserva y el filtro la estrecha.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`messages:${bookingId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `booking_id=eq.${bookingId}`,
          },
          (payload) => {
            const m = payload.new as {
              id: string;
              sender_id: string;
              body: string;
              created_at: string;
            };
            setMessages((prev) =>
              prev.some((x) => x.id === m.id)
                ? prev
                : [
                    ...prev,
                    { id: m.id, senderId: m.sender_id, body: m.body, createdAt: m.created_at },
                  ],
            );
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [bookingId]);

  // Autoscroll al último mensaje.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("send_message", {
      p_booking_id: bookingId,
      p_body: body,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo enviar el mensaje.");
      return;
    }
    setDraft("");
    // Append optimista: el emisor ve su mensaje al instante, sin depender del
    // eco de Realtime (que dedup por id absorbe si llega). Realtime se encarga
    // de entregárselo al OTRO participante.
    const id = data as string;
    setMessages((prev) =>
      prev.some((x) => x.id === id)
        ? prev
        : [
            ...prev,
            { id, senderId: currentUserId, body, createdAt: new Date().toISOString() },
          ],
    );
  }

  if (!isOpen) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {firstSessionAt
          ? "El chat se abre 2 días antes de tu primera clase."
          : "El chat se habilita cuando la reserva esté confirmada."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[60vh] min-h-64 flex-col gap-2 overflow-y-auto rounded-lg border p-4">
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">
            Aún no hay mensajes. Escribe el primero.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === currentUserId;
            return (
              <div
                key={m.id}
                className={cn("flex flex-col", mine ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                    mine ? "bg-foreground text-background" : "bg-muted",
                  )}
                >
                  {m.body}
                </div>
                <time className="mt-0.5 text-[11px] text-muted-foreground" dateTime={m.createdAt}>
                  {new Date(m.createdAt).toLocaleTimeString("es", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe un mensaje…"
          maxLength={2000}
        />
        <Button type="submit" disabled={busy || !draft.trim()}>
          Enviar
        </Button>
      </form>
    </div>
  );
}
