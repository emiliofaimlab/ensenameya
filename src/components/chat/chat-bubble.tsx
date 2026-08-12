"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon, MessageCircleIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { ChatThread } from "./chat-thread";
import {
  MESSAGE_COLUMNS,
  toChatMessage,
  type ChatMessage,
  type MessageRow,
} from "@/lib/chat/messages";

export type Conversation = {
  bookingId: string;
  title: string;
  subtitle: string;
  /** RN-41: la ventana del hilo la decide la 1ª sesión, no la burbuja. */
  firstSessionAt: string | null;
};

/**
 * Burbuja flotante de chat (R24-21, decisión 15): una **bandeja** al estilo
 * LinkedIn — abre la lista de conversaciones y el hilo **dentro de la propia
 * burbuja**, sin sacar a nadie de la página en la que está (reunión 7-ago).
 * Antes cada conversación era un enlace a `/chat/[id]`, así que abrir el chat
 * te echaba de la pantalla que estabas usando.
 *
 * `/chat/[id]` sigue existiendo para enlaces directos; esto es la vía rápida,
 * no su sustituto.
 *
 * Solo se monta con sesión (lo decide `ChatLauncher` en servidor).
 */
export function ChatBubble({
  conversations,
  currentUserId,
}: {
  conversations: Conversation[];
  currentUserId: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [abierta, setAbierta] = useState<Conversation | null>(null);
  const [mensajes, setMensajes] = useState<ChatMessage[] | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Cerrar con Escape o al clicar fuera.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, []);

  // Los mensajes se piden al abrir la conversación, no al montar la burbuja:
  // cargar de golpe los hilos de hasta 20 reservas para una bandeja que puede
  // que nadie despliegue es trabajo tirado. La RLS de participante ya filtra,
  // así que se leen desde el navegador sin endpoint propio.
  useEffect(() => {
    if (!abierta) return;
    let cancelado = false;

    void (async () => {
      const { data } = await createClient()
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("booking_id", abierta.bookingId)
        .order("created_at");
      // Sin esto, cambiar de conversación deprisa puede pintar los mensajes de
      // la anterior encima de la nueva.
      if (!cancelado) {
        setMensajes((data ?? []).map((m) => toChatMessage(m as MessageRow)));
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [abierta]);

  function volver() {
    setAbierta(null);
    setMensajes(null);
  }

  // En el propio hilo la burbuja sobra (y taparía el composer).
  if (pathname.startsWith("/chat/") || pathname.startsWith("/room/")) return null;

  return (
    <div ref={boxRef} className="fixed right-5 bottom-5 z-50 flex flex-col items-end gap-3">
      {open ? (
        <div
          className={`overflow-hidden rounded-[16px] border border-[#e0e0e0] bg-card shadow-[0_16px_40px_rgb(0_0_0/0.18)] ${
            // Con un hilo abierto la bandeja necesita sitio para el composer.
            abierta ? "w-[min(92vw,400px)]" : "w-[min(88vw,320px)]"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-[#e0e0e0] px-4 py-3">
            {abierta ? (
              <button
                type="button"
                aria-label="Volver a mensajes"
                onClick={volver}
                className="text-[#8c8c8c] transition-colors hover:text-foreground"
              >
                <ArrowLeftIcon className="size-4" />
              </button>
            ) : null}
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[#19191f]">
              {abierta ? abierta.title : "Mensajes"}
            </p>
            <button
              type="button"
              aria-label="Cerrar mensajes"
              onClick={() => setOpen(false)}
              className="text-[#8c8c8c] transition-colors hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          {abierta ? (
            <div className="flex h-[min(70vh,520px)] flex-col p-3">
              {mensajes === null ? (
                <p className="m-auto text-[13px] text-[#6b6b6b]">
                  Abriendo la conversación…
                </p>
              ) : (
                <ChatThread
                  // Sin `key` React reutilizaría el hilo anterior con su estado:
                  // borrador a medio escribir y suscripción de Realtime incluidos.
                  key={abierta.bookingId}
                  bookingId={abierta.bookingId}
                  currentUserId={currentUserId}
                  firstSessionAt={abierta.firstSessionAt}
                  initialMessages={mensajes}
                  fill
                />
              )}
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-4 py-5 text-[13px] text-[#6b6b6b]">
              Todavía no tienes conversaciones. El chat se abre 2 días antes de
              tu primera mentoría.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-[#f0f0f0] overflow-auto">
              {conversations.map((c) => (
                <li key={c.bookingId}>
                  <button
                    type="button"
                    onClick={() => setAbierta(c)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e0eeff] text-brand">
                      <MessageCircleIcon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-[#333333]">
                        {c.title}
                      </span>
                      <span className="block truncate text-xs text-[#6b6b6b]">
                        {c.subtitle}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <button
        type="button"
        aria-label="Abrir mensajes"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-14 place-items-center rounded-full bg-brand text-white shadow-[0_8px_24px_rgb(0_0_0/0.22)] transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <MessageCircleIcon className="size-6" />
        {conversations.length > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-white">
            {conversations.length}
          </span>
        ) : null}
      </button>
    </div>
  );
}
