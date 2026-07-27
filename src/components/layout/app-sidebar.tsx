"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3Icon,
  BellIcon,
  BookOpenIcon,
  CalendarPlusIcon,
  CreditCardIcon,
  FolderTreeIcon,
  HomeIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PercentIcon,
  ReceiptIcon,
  TicketIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

export type SidebarItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Solo activo en la ruta exacta (los "inicio", que son prefijo de las demás). */
  exact?: boolean;
  /** Prefijo extra que también lo marca activo (detalles que cuelgan de otra ruta). */
  alsoMatch?: string;
};

type Item = SidebarItem;

/**
 * Menú lateral del área autenticada (AL02 y siguientes).
 *
 * ponytail: solo los destinos que existen. El Figma lista además "Pagos",
 * "Mensajes", "Reseñas" y "Ayuda", que no tienen pantalla — un menú que lleva
 * a 404 es peor que un menú corto. "Configuración de perfil" se omite por
 * duplicar "Cuenta" (`/account`).
 */
const STUDENT_ITEMS: Item[] = [
  { href: "/app", label: "Inicio", icon: HomeIcon, exact: true },
  { href: "/reservas", label: "Mis reservas", icon: TicketIcon },
  { href: "/tutors", label: "Agendar", icon: CalendarPlusIcon },
  { href: "/pagos", label: "Métodos de pago", icon: CreditCardIcon },
  { href: "/account", label: "Cuenta", icon: UserIcon },
];

/** Menú del tutor (TU06). Mismos criterios: solo rutas que existen. */
export const TUTOR_ITEMS: Item[] = [
  { href: "/tutor", label: "Dashboard", icon: LayoutDashboardIcon, exact: true },
  { href: "/tutor/products", label: "Mis mentorías", icon: BookOpenIcon },
  { href: "/tutor/availability", label: "Disponibilidad", icon: CalendarPlusIcon },
  { href: "/tutor/reservas", label: "Reservas", icon: TicketIcon },
  { href: "/tutor/payouts", label: "Payouts", icon: WalletIcon },
  { href: "/pagos", label: "Métodos de pago", icon: CreditCardIcon },
  { href: "/account", label: "Cuenta", icon: UserIcon },
];

/**
 * Menú del panel admin, en el orden del Figma (218:1739): Dashboard, Tutores,
 * Pagos, Reservas, Categorías, Tiers, Estadísticas, Alertas, Payouts.
 * `/admin` es el dashboard (AD02) y la cola de tutores vive en /admin/tutores.
 *
 * Vive aquí y no en `admin-shell` a propósito: los iconos son componentes, y
 * un Server Component no puede pasar funciones a uno de cliente.
 */
export const ADMIN_ITEMS: Item[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboardIcon, exact: true },
  { href: "/admin/tutores", label: "Tutores", icon: UsersIcon },
  { href: "/admin/payments", label: "Pagos", icon: ReceiptIcon },
  { href: "/admin/bookings", label: "Reservas", icon: TicketIcon },
  { href: "/admin/categorias", label: "Categorías", icon: FolderTreeIcon },
  { href: "/admin/tiers", label: "Tiers", icon: PercentIcon },
  { href: "/admin/stats", label: "Estadísticas", icon: BarChart3Icon },
  { href: "/admin/alertas", label: "Alertas", icon: BellIcon },
  { href: "/admin/payouts", label: "Payouts", icon: WalletIcon },
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
      className="h-fit rounded-[16px] border border-[#e0e0e0] bg-card p-3 lg:sticky lg:top-24"
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const { href, label, icon: Icon } = item;
          const active =
            (item.exact ? pathname === href : pathname.startsWith(href)) ||
            (item.alsoMatch ? pathname.startsWith(item.alsoMatch) : false);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-[41px] items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
                  active
                    ? "bg-brand font-semibold text-white"
                    : "text-[#666666] hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
        <li className="mt-2 pt-1">
          <button
            type="button"
            onClick={signOut}
            className="flex h-[41px] w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-[#bf3333] transition-colors hover:bg-[#bf3333]/5"
          >
            <LogOutIcon className="size-4 shrink-0" />
            Salir
          </button>
        </li>
      </ul>
    </nav>
  );
}
