"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftIcon, MessageCircleIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import { ChatThread } from "./chat-thread";
import {
  conversationSubtitle,
  counterpartFallback,
  type Conversation,
} from "./types";
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

export type { Conversation } from "./types";

/** Con quién hablas, o el respaldo por rol. Nunca un "Alumno" de relleno. */
function nombreDe(c: Conversation): string {
  return c.counterpart ?? counterpartFallback(c.counterpartRole);
}

/**
 * Burbuja flotante de chat (R24-21, decisión 15): una **bandeja** al estilo
 * LinkedIn — abre la lista de conversaciones y el hilo **dentro de la propia
 * burbuja**, sin sacar a nadie de la página en la que está (reunión 7-ago).
 *
 * `/chat/[id]` sigue existiendo para enlaces directos; esto es la vía rápida,
 * no su sustituto. Solo se monta con sesión (lo decide `ChatLauncher`).
 *
 * N-23 · y además SE ENTERA: los no leídos salen de `./unread`, que mantiene su
 * propio canal de Realtime a nivel de burbuja.
 *
 * M-12 · y ahora la bandeja es de PERSONAS, no de reservas. Una fila por cada
 * tutor (o alumno) con el que hablas, tenga o no reserva de por medio, y ahí
 * dentro está todo lo hablado con esa persona — incluido lo de antes de
 * comprar. Era lo que la decisión 15 ya pedía al llamarla "bandeja tipo
 * LinkedIn": en una bandeja se habla con gente, no con facturas.
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
  // ⚠️ Lo de `/room/` es un cinturón, no una condición viva: desde MN-04 la sala
  // cuelga del grupo `(room)`, que NO monta el launcher —solo lo montan `(app)`
  // y `(public)`—, así que esa rama ya no puede darse. Se conserva para que
  // devolver la ruta a `(app)` no reviva la burbuja flotante encima del vídeo.
  const visible =
    !pathname.startsWith("/chat/") && !pathname.startsWith("/room/");

  const unread = useChatUnread();

  useChatUnreadWatcher({
    enabled: visible,
    currentUserId,
    reloadKey: aperturas,
    onMessage: (conversationId) => {
      // La lista la arma el servidor (`ChatLauncher`), así que una conversación
      // que hoy no está en ella —alguien que acaba de escribirte por primera
      // vez desde tu ficha pública— no aparecería hasta recargar la página. Un
      // mensaje de una conversación desconocida es justo la señal de que la
      // lista se quedó vieja: `router.refresh()` vuelve a ejecutar los
      // componentes de servidor sin tirar el estado del cliente.
      if (conversations.some((c) => c.id === conversationId)) return;
      // Con freno de mano: si tras refrescar la conversación SIGUE sin salir,
      // cada mensaje siguiente pediría otro refresco.
      const ahora = Date.now();
      if (ahora - ultimoRefresco.current < 10_000) return;
      ultimoRefresco.current = ahora;
      router.refresh();
    },
  });

  // Sin leer de las conversaciones que la bandeja SÍ lista: sumar todo lo que
  // hay en el almacén sería enseñar una insignia que no se puede abrir.
  const total = useMemo(
    () => totalUnread(unread, conversations.map((c) => c.id)),
    [unread, conversations],
  );

  // Quien te acaba de escribir, arriba. `sort` es estable, así que las
  // conversaciones sin actividad conocida conservan el orden del servidor
  // (que ya viene por `last_message_at`).
  const ordenadas = useMemo(
    () =>
      [...conversations].sort(
        (a, b) =>
          (unread[b.id]?.activityAt ?? 0) - (unread[a.id]?.activityAt ?? 0),
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
  // cargar de golpe los hilos de veinte conversaciones para una bandeja que
  // puede que nadie despliegue es trabajo tirado. La RLS de participante ya
  // filtra, así que se leen desde el navegador sin endpoint propio.
  useEffect(() => {
    if (!abierta) return;
    let cancelado = false;

    void (async () => {
      const { data } = await createClient()
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", abierta.id)
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
            {/* Con el hilo abierto manda el NOMBRE de la otra persona, y la
                mentoría baja a la línea pequeña: en una bandeja con varias
                conversaciones, saber con quién hablas es lo primero. */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#19191f]">
                {abierta ? nombreDe(abierta) : "Mensajes"}
              </p>
              {abierta ? (
                // MN-08 · «3 mentorías · Álgebra desde cero». El contador va
                // delante porque esto trunca; el porqué, en `types.ts`.
                <p className="truncate text-[11px] text-[#6b6b6b]">
                  {conversationSubtitle(abierta)}
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
                  key={abierta.id}
                  conversationId={abierta.id}
                  // La reserva más reciente del par, si la hay: es lo que
                  // etiqueta el mensaje y lo que permite adjuntar.
                  bookingId={abierta.bookingId ?? undefined}
                  hasBooking={abierta.hasBooking}
                  // MN-06 · la bandeja es donde siguen viviendo los hilos que
                  // el cierre del chat previo dejó en solo lectura (P-1b: se
                  // ven, no se escriben).
                  canChat={abierta.canChat}
                  reservarHref={
                    abierta.counterpartRole === "tutor"
                      ? `/tutors/${abierta.counterpartId}`
                      : undefined
                  }
                  blocked={abierta.blocked}
                  currentUserId={currentUserId}
                  initialMessages={mensajes}
                  fill
                />
              )}
            </div>
          ) : conversations.length === 0 ? (
            // ⚠️ MN-06 · esta frase decía «puedes escribirle a cualquier tutor
            // desde su perfil, antes incluso de reservar». Eso dejó de ser
            // verdad el 20-ago: el chat se abre AL reservar, y el botón de la
            // ficha pública ya no existe.
            //
            // Redactada sin rol: con cero conversaciones esta burbuja no sabe
            // si la mira un alumno o un tutor, y a un tutor no se le dice que
            // reserve.
            <p className="px-4 py-5 text-[13px] text-[#6b6b6b]">
              Todavía no tienes conversaciones. El chat se abre con la primera
              mentoría reservada.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-[#f0f0f0] overflow-auto">
              {ordenadas.map((c) => {
                const sinLeer = unread[c.id]?.unread ?? 0;
                const nombre = nombreDe(c);
                const avatar = storageUrl("avatars", c.avatarPath);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setAbierta(c)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
                    >
                      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[#e0eeff] text-[11px] font-semibold text-brand">
                        {avatar ? (
                          // `img` a secas y no `next/image`: es un avatar de 36
                          // px dentro de una lista que puede tener veinte, y
                          // `unoptimized` haría lo mismo con más ceremonia.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatar}
                            alt=""
                            className="size-9 object-cover"
                          />
                        ) : (
                          initialsFrom(nombre)
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13.5px] text-[#333333] ${
                            sinLeer > 0 ? "font-bold" : "font-medium"
                          }`}
                        >
                          {nombre}
                        </span>
                        {/* MN-08 · el recuento de mentorías del par, delante
                            del título de la última reserva. */}
                        <span className="block truncate text-xs text-[#6b6b6b]">
                          {conversationSubtitle(c)}
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
            nada, no hay número. */}
        {total > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-white">
            {total > 9 ? "9+" : total}
          </span>
        ) : null}
      </button>
    </div>
  );
}
