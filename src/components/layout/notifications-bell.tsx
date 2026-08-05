"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  NOTICES_LIMIT,
  toNotice,
  type AppNotice,
  type NotificationRow,
} from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * US-1203 · Avisos in-app. La campana del header: las últimas novedades del
 * usuario, con las no leídas contadas.
 *
 * La lista inicial llega del servidor (el layout ya consulta al usuario), así
 * que el contador sale pintado en el primer render y no hay ida y vuelta al
 * cargar cada página. Al abrir la campana se recarga por si hay algo nuevo.
 *
 * ponytail: sin Realtime. Los avisos los encolan triggers de negocio, no llegan
 * al segundo; se refrescan al cargar la página y al abrir la campana. Si algún
 * día hace falta al instante, `messages` ya enseñó cómo (EP-17).
 */
export function NotificationsBell({ initial }: { initial: AppNotice[] }) {
  const router = useRouter();
  const [notices, setNotices] = useState<AppNotice[]>(initial);

  async function load() {
    const { data } = await createClient()
      .from("notifications")
      .select("id, type, template, payload, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(NOTICES_LIMIT);
    setNotices(((data ?? []) as NotificationRow[]).map(toNotice));
  }

  const unread = notices.filter((n) => !n.read).length;

  async function markAllRead() {
    if (unread === 0) return;
    // Optimista: el usuario ya las está viendo, que el punto se apague ya.
    setNotices((prev) => prev.map((n) => ({ ...n, read: true })));
    await createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null); // la RLS acota a las suyas
    router.refresh();
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label={
            unread > 0 ? `Avisos (${unread} sin leer)` : "Avisos"
          }
        >
          <BellIcon className="size-[18px]" />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between gap-3 font-normal">
          <span className="text-[13.5px] font-semibold">Avisos</span>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              className="text-[12px] font-medium text-brand hover:underline"
            >
              Marcar todo leído
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {notices.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
            No tienes avisos todavía.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {notices.map((n) => {
              const inner = (
                <>
                  <span className="flex items-start gap-2">
                    {!n.read ? (
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                      />
                    ) : (
                      <span aria-hidden className="mt-1.5 size-1.5 shrink-0" />
                    )}
                    <span className={n.read ? "text-muted-foreground" : ""}>
                      {n.text}
                    </span>
                  </span>
                  <time
                    dateTime={n.createdAt}
                    className="mt-0.5 block pl-3.5 text-[11px] text-muted-foreground"
                  >
                    {new Date(n.createdAt).toLocaleDateString("es", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </>
              );
              return (
                <li key={n.id} className="px-2 py-2 text-[13px]">
                  {n.href ? (
                    <Link href={n.href} className="block hover:underline">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
