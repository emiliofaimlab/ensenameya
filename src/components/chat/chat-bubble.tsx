"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircleIcon, XIcon } from "lucide-react";

export type Conversation = {
  bookingId: string;
  title: string;
  subtitle: string;
};

/**
 * Burbuja flotante de chat (R24-21, decisión 15): una **bandeja** al estilo
 * LinkedIn — abre la lista de conversaciones y de ahí al hilo de la reserva,
 * sin tener que entrar a la sesión. Solo se monta con sesión (lo decide
 * `ChatLauncher` en servidor).
 */
export function ChatBubble({ conversations }: { conversations: Conversation[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
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

  // En el propio hilo la burbuja sobra (y taparía el composer).
  if (pathname.startsWith("/chat/") || pathname.startsWith("/room/")) return null;

  return (
    <div ref={boxRef} className="fixed right-5 bottom-5 z-50 flex flex-col items-end gap-3">
      {open ? (
        <div className="w-[min(88vw,320px)] overflow-hidden rounded-[16px] border border-[#e0e0e0] bg-card shadow-[0_16px_40px_rgb(0_0_0/0.18)]">
          <div className="flex items-center justify-between border-b border-[#e0e0e0] px-4 py-3">
            <p className="text-sm font-semibold text-[#19191f]">Mensajes</p>
            <button
              type="button"
              aria-label="Cerrar mensajes"
              onClick={() => setOpen(false)}
              className="text-[#8c8c8c] transition-colors hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          {conversations.length === 0 ? (
            <p className="px-4 py-5 text-[13px] text-[#6b6b6b]">
              Todavía no tienes conversaciones. El chat se abre 2 días antes de
              tu primera mentoría.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-[#f0f0f0] overflow-auto">
              {conversations.map((c) => (
                <li key={c.bookingId}>
                  <Link
                    href={`/chat/${c.bookingId}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
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
                  </Link>
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
