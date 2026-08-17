"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftIcon, MessageCircleIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { ChatThread } from "./chat-thread";
import {
  totalUnread,
  useChatUnread,
  useChatUnreadWatcher,
} from "./unread";
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
  /** N-28 · nombre del otro participante, o `null` si no hay ninguno legible. */
  counterpart: string | null;
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
 *
 * N-23 · y además SE ENTERA. El contador que había aquí era
 * `conversations.length` disfrazado de insignia —cuántas conversaciones tienes,
 * no cuántos mensajes te deben—, y como el Realtime vivía solo dentro del hilo,
 * con la burbuja cerrada no llegaba nada. Ahora los no leídos salen de
 * `./unread`, que mantiene su propio canal a nivel de burbuja.
 */
export function ChatBubble({
  conversations,
  currentUserId,
}: {
  conversations: Conversation[];
  currentUserId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Cuántas veces se ha desplegado la bandeja. Es la señal de "vuelve a pedir el
  // recuento": el momento en que el número importa de verdad es justo cuando el
  // usuario lo mira, y así cualquier desajuste acumulado se corrige solo.
  const [aperturas, setAperturas] = useState(0);
  const [abierta, setAbierta] = useState<Conversation | null>(null);
  const [mensajes, setMensajes] = useState<ChatMessage[] | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const ultimoRefresco = useRef(0);

  // En el propio hilo la burbuja sobra (y taparía el composer). El cálculo va
  // aquí arriba, y no como un `return null` antes de tiempo, porque los hooks
  // de abajo tienen que llamarse siempre; lo que hace `visible` es apagarles el
  // trabajo (ni recuento ni websocket) mientras no se pinta nada.
  const visible =
    !pathname.startsWith("/chat/") && !pathname.startsWith("/room/");

  const unread = useChatUnread();

  useChatUnreadWatcher({
    enabled: visible,
    currentUserId,
    reloadKey: aperturas,
    onMessage: (bookingId) => {
      // La lista de conversaciones la arma el servidor (`ChatLauncher`), así que
      // una conversación que hoy no está en ella —una reserva recién aceptada,
      // o una cuya ventana de RN-41 acaba de abrirse— no aparecería hasta
      // recargar la página. Un mensaje de una reserva desconocida es justo la
      // señal de que la lista se quedó vieja: `router.refresh()` vuelve a
      // ejecutar los componentes de servidor sin tirar el estado del cliente.
      if (conversations.some((c) => c.bookingId === bookingId)) return;
      // Con freno de mano: si tras refrescar la conversación SIGUE sin salir
      // (una reserva cancelada, que la bandeja no lista a propósito), cada
      // mensaje siguiente pediría otro refresco.
      const ahora = Date.now();
      if (ahora - ultimoRefresco.current < 10_000) return;
      ultimoRefresco.current = ahora;
      router.refresh();
    },
  });

  // Sin leer de las conversaciones que la bandeja SÍ lista. Sumar todo lo que
  // hay en el almacén sería enseñar una insignia que no se puede abrir ni
  // apagar: `unread_message_counts` también cuenta hilos de reservas canceladas.
  const total = useMemo(
    () => totalUnread(unread, conversations.map((c) => c.bookingId)),
    [unread, conversations],
  );

  // Quien te acaba de escribir, arriba. `sort` es estable, así que las
  // conversaciones sin actividad conocida conservan el orden del servidor
  // (reserva más reciente primero).
  const ordenadas = useMemo(
    () =>
      [...conversations].sort(
        (a, b) =>
          (unread[b.bookingId]?.activityAt ?? 0) -
          (unread[a.bookingId]?.activityAt ?? 0),
      ),
    [conversations, unread],
  );

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

  function alternar() {
    const siguiente = !open;
    setOpen(siguiente);
    if (siguiente) setAperturas((n) => n + 1);
  }

  if (!visible) return null;

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
            {/* N-28 · con el hilo abierto manda el NOMBRE de la otra persona, y
                la mentoría baja a la línea pequeña: en una bandeja con varias
                conversaciones, saber con quién hablas es lo primero. Sin nombre
                legible se queda como estaba (el título de la mentoría). */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#19191f]">
                {abierta ? (abierta.counterpart ?? abierta.title) : "Mensajes"}
              </p>
              {abierta?.counterpart ? (
                <p className="truncate text-[11px] text-[#6b6b6b]">
                  {abierta.title}
                </p>
              ) : null}
            </div>
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
              {ordenadas.map((c) => {
                const sinLeer = unread[c.bookingId]?.unread ?? 0;
                return (
                  <li key={c.bookingId}>
                    <button
                      type="button"
                      onClick={() => setAbierta(c)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e0eeff] text-brand">
                        <MessageCircleIcon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13.5px] text-[#333333] ${
                            sinLeer > 0 ? "font-bold" : "font-medium"
                          }`}
                        >
                          {c.title}
                        </span>
                        <span className="block truncate text-xs text-[#6b6b6b]">
                          {c.subtitle}
                        </span>
                      </span>
                      {sinLeer > 0 ? (
                        <span
                          className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white"
                          aria-label={`${sinLeer} sin leer`}
                        >
                          {sinLeer > 99 ? "99+" : sinLeer}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <button
        type="button"
        aria-label={
          total > 0 ? `Abrir mensajes (${total} sin leer)` : "Abrir mensajes"
        }
        aria-expanded={open}
        onClick={alternar}
        className="relative grid size-14 place-items-center rounded-full bg-brand text-white shadow-[0_8px_24px_rgb(0_0_0/0.22)] transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <MessageCircleIcon className="size-6" />
        {/* La insignia dice MENSAJES SIN LEER, no conversaciones: si no te deben
            nada, no hay número. Antes salía siempre que tuvieras algún chat, así
            que dejaba de significar nada y la gente la ignoraba. */}
        {total > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-white">
            {total > 9 ? "9+" : total}
          </span>
        ) : null}
      </button>
    </div>
  );
}
