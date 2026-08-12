"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PaperclipIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ATTACHMENT_TYPES,
  attachmentUrl,
  humanSize,
  uploadAttachment,
  type Attachment,
} from "@/lib/chat/attachments";

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  attachment: Attachment | null;
};

// RN-41: el chat abre 2 días antes de la 1ª sesión. El server es la barrera
// (send_message); aquí solo se pinta el estado.
const OPEN_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;

/** RN-41: ¿la ventana del chat ya abrió? (2 días antes de la 1ª sesión). */
function computeOpen(firstSessionAt: string | null): boolean {
  if (!firstSessionAt) return false;
  return Date.now() >= new Date(firstSessionAt).getTime() - OPEN_BEFORE_MS;
}

/** Adjunto: el bucket es privado, así que la URL se firma al hacer clic. */
function AttachmentLink({ a, mine }: { a: Attachment; mine: boolean }) {
  const [busy, setBusy] = useState(false);

  async function open() {
    // El bucket es privado, así que hay que firmar la URL y eso es asíncrono.
    // Para cuando llega, el clic ya no cuenta como gesto del usuario y el
    // navegador bloquea la pestaña. Se abre YA, en blanco, y se le pone la URL
    // al volver. (`noopener` no vale aquí: hace que window.open devuelva null,
    // así que el aislamiento se consigue anulando `opener` a mano.)
    const w = window.open("", "_blank");
    if (w) w.opener = null;

    setBusy(true);
    const url = await attachmentUrl(a.path);
    setBusy(false);

    if (!url) {
      w?.close();
      toast.error("No se pudo abrir el archivo.");
      return;
    }
    if (w) w.location.replace(url);
    else window.location.href = url; // pestañas bloqueadas: mismo destino
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-opacity hover:opacity-80",
        mine ? "bg-background/15" : "bg-background",
      )}
    >
      <PaperclipIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{a.name}</span>
        <span className="block text-[11px] opacity-70">
          {busy ? "Abriendo…" : humanSize(a.size)}
        </span>
      </span>
    </button>
  );
}

export function ChatThread({
  bookingId,
  currentUserId,
  firstSessionAt,
  initialMessages,
  fill,
}: {
  bookingId: string;
  currentUserId: string;
  firstSessionAt: string | null;
  initialMessages: ChatMessage[];
  /** En la sala (LV01) el hilo ocupa el alto de su columna; suelto, no. */
  fill?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Inicializador perezoso (se evalúa una vez, no en cada render). El server
  // sigue siendo la barrera real (send_message); esto solo pinta el estado.
  const [isOpen, setIsOpen] = useState(() => computeOpen(firstSessionAt));

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
              attachment_path: string | null;
              attachment_name: string | null;
              attachment_size: number | null;
            };
            // setMessages directo (y no `append`): el efecto no debe depender
            // de una función que se recrea en cada render.
            setMessages((prev) =>
              prev.some((x) => x.id === m.id)
                ? prev
                : [
                    ...prev,
                    {
                      id: m.id,
                      senderId: m.sender_id,
                      body: m.body,
                      createdAt: m.created_at,
                      attachment: m.attachment_path
                        ? {
                            path: m.attachment_path,
                            name: m.attachment_name ?? "documento",
                            size: m.attachment_size ?? 0,
                          }
                        : null,
                    },
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

  /** Append con dedup por id: Realtime hace eco del propio INSERT. */
  function append(m: ChatMessage) {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }

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
    // El emisor lo ve al instante, sin depender del eco de Realtime (que el
    // dedup por id absorbe si llega). Realtime lo entrega al OTRO participante.
    append({
      id: data as string,
      senderId: currentUserId,
      body,
      createdAt: new Date().toISOString(),
      attachment: null,
    });
  }

  async function attach(file: File) {
    setBusy(true);
    const res = await uploadAttachment(bookingId, file);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    append({
      id: res.id,
      senderId: currentUserId,
      body: "",
      createdAt: new Date().toISOString(),
      attachment: res.attachment,
    });
    toast.success("Documento compartido.");
  }

  if (!isOpen) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {firstSessionAt
          ? "El chat se abre 2 días antes de tu primera mentoría."
          : "El chat se habilita cuando la reserva esté confirmada."}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", fill && "h-full min-h-0")}>
      {/* US-1702 · descarga del hilo. Enlaces normales con `download`: el
          servidor arma el archivo y la RLS decide si hay algo que armar. Solo
          con mensajes — un archivo vacío no le sirve a nadie. */}
      {messages.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          El chat se borra a los 30 días. Descárgalo en{" "}
          <a
            href={`/api/chat/${bookingId}/download?format=txt`}
            download
            className="font-semibold text-brand hover:underline"
          >
            .txt
          </a>{" "}
          o{" "}
          <a
            href={`/api/chat/${bookingId}/download?format=json`}
            download
            className="font-semibold text-brand hover:underline"
          >
            .json
          </a>
          .
        </p>
      ) : null}

      <div
        className={cn(
          "flex flex-col gap-2 overflow-y-auto rounded-lg border p-4",
          fill ? "min-h-0 flex-1" : "max-h-[60vh] min-h-64",
        )}
      >
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
                    "flex max-w-[80%] flex-col gap-1.5 rounded-2xl px-3 py-2 text-sm",
                    mine ? "bg-foreground text-background" : "bg-muted",
                  )}
                >
                  {m.attachment ? <AttachmentLink a={m.attachment} mine={mine} /> : null}
                  {m.body ? <span>{m.body}</span> : null}
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
        <input
          ref={fileRef}
          type="file"
          accept={ATTACHMENT_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void attach(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={busy}
          aria-label="Adjuntar documento"
          onClick={() => fileRef.current?.click()}
        >
          <PaperclipIcon className="size-4" />
        </Button>
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
