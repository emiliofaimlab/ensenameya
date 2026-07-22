"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarPlusIcon,
  HomeIcon,
  LogOutIcon,
  TicketIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type Item = { href: string; label: string; icon: LucideIcon };

/**
 * Menú lateral del área autenticada (AL02 y siguientes).
 *
 * ponytail: solo los destinos que existen. El Figma lista además "Pagos",
 * "Mensajes", "Reseñas" y "Ayuda", que no tienen pantalla — un menú que lleva
 * a 404 es peor que un menú corto. "Configuración de perfil" se omite por
 * duplicar "Cuenta" (`/account`).
 */
const STUDENT_ITEMS: Item[] = [
  { href: "/app", label: "Inicio", icon: HomeIcon },
  { href: "/reservas", label: "Mis reservas", icon: TicketIcon },
  { href: "/tutors", label: "Agendar", icon: CalendarPlusIcon },
  { href: "/account", label: "Cuenta", icon: UserIcon },
];

export function AppSidebar({ items = STUDENT_ITEMS }: { items?: Item[] }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <nav
      aria-label="Menú del panel"
      className="h-fit rounded-2xl bg-card p-3 lg:sticky lg:top-24"
    >
      <ul className="flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          // `/app` solo coincide exacto; el resto acepta sus subrutas.
          const active =
            href === "/app" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-brand font-semibold text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
        <li className="mt-1 border-t pt-1">
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOutIcon className="size-4 shrink-0" />
            Salir
          </button>
        </li>
      </ul>
    </nav>
  );
}
