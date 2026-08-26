"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ActivityIcon,
  BarChart3Icon,
  BellIcon,
  BookOpenIcon,
  CalendarPlusIcon,
  CreditCardIcon,
  FolderTreeIcon,
  HomeIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MessageCircleQuestionIcon,
  PercentIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  TicketIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { SignOutDialog } from "@/components/layout/sign-out-dialog";

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
  // EY-194 · va pegada a "Mis mentorías" porque es lo mismo visto desde el otro
  // lado: contenido de la vitrina que se hereda en todas ellas.
  //
  // ⚠️ La etiqueta dice "Mis FAQ" y no "Preguntas frecuentes" por el hueco de
  // la fila, que es `h-[41px]` FIJA y no envuelve: "Mentorías impartidas" (20
  // caracteres, en el menú de admin) ya mide 155 px de los ~158 disponibles.
  // "Preguntas frecuentes" tiene los mismos 20 y se saldría o quedaría al
  // límite. El título de la pantalla sí es el largo.
  { href: "/tutor/faqs", label: "Mis FAQ", icon: MessageCircleQuestionIcon },
  { href: "/tutor/availability", label: "Disponibilidad", icon: CalendarPlusIcon },
  { href: "/tutor/reservas", label: "Reservas", icon: TicketIcon },
  { href: "/tutor/payouts", label: "Payouts", icon: WalletIcon },
  // R29-03a: "Métodos de pago" (/pagos) es card-on-file del ALUMNO (RN-43): como
  // tutor no pago, cobro. Sigue a un clic desde el panel de alumno (el switch de
  // `panelItems` le devuelve ese menú). La cuenta de cobro del tutor es R29-03b,
  // aplazada a EP-20 mientras el PSP no tenga cuentas.
  // TU02: los documentos se suben, se reemplazan y se consultan aquí. En el
  // Figma cuelgan de "Cuenta", pero sin entrada propia no había forma de
  // llegar a ellos desde el panel.
  { href: "/tutor/verification", label: "Verificación", icon: ShieldCheckIcon },
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
  // MN-14a · no está en el Figma porque la pantalla tampoco: es el registro de
  // mentorías impartidas, uso interno para segmentar la campaña de tutores.
  // Cuelga de /admin/tutores y por eso va detrás: son el mismo tema.
  // ⚠️ Es la etiqueta más larga del menú y va justa: en activo (semibold) mide
  // 155px de los ~158 que deja la columna de 232px. Cabe en una línea —medido,
  // no estimado—, pero la fila es `h-[41px]` FIJA: una etiqueta más larga no
  // envolvería, desbordaría. Si hace falta un nombre mayor, antes hay que
  // quitarle el alto fijo a la fila.
  {
    href: "/admin/tutores/actividad",
    label: "Mentorías impartidas",
    icon: ActivityIcon,
  },
  { href: "/admin/payments", label: "Pagos", icon: ReceiptIcon },
  { href: "/admin/bookings", label: "Reservas", icon: TicketIcon },
  { href: "/admin/categorias", label: "Categorías", icon: FolderTreeIcon },
  { href: "/admin/tiers", label: "Tiers", icon: PercentIcon },
  { href: "/admin/stats", label: "Estadísticas", icon: BarChart3Icon },
  { href: "/admin/alertas", label: "Alertas", icon: BellIcon },
  { href: "/admin/payouts", label: "Payouts", icon: WalletIcon },
];

/**
 * Cuánto de la ruta actual cubre este ítem, o `-1` si no la cubre.
 *
 * Existe porque el menú marca por PREFIJO y hay rutas que cuelgan de otras:
 * `/admin/tutores/actividad` empieza por `/admin/tutores`, así que con un
 * `startsWith` a secas se encendían las dos entradas a la vez. Hasta ahora el
 * único choque era el "inicio" de cada panel (`/app`, `/tutor`, `/admin`), que
 * es prefijo de todo lo suyo, y se resolvió con `exact`. Ese apaño no sirve
 * aquí: `/admin/tutores` TIENE que seguir marcada en el detalle
 * `/admin/tutores/<id>`, así que no puede ser exacta.
 *
 * La regla general —gana el prefijo más largo— cubre los dos casos y el
 * siguiente que aparezca. No cambia nada de lo que ya había: donde solo casa
 * un ítem, ese ítem sigue siendo el activo.
 */
function matchLength(item: Item, pathname: string): number {
  const porHref = item.exact
    ? pathname === item.href
      ? item.href.length
      : -1
    : pathname.startsWith(item.href)
      ? item.href.length
      : -1;
  const porAlias =
    item.alsoMatch && pathname.startsWith(item.alsoMatch) ? item.alsoMatch.length : -1;
  return Math.max(porHref, porAlias);
}

export function AppSidebar({ items = STUDENT_ITEMS }: { items?: Item[] }) {
  const pathname = usePathname();

  // El ítem más específico que casa con la ruta. `-1` = ninguno (rutas del área
  // autenticada que no están en el menú); entonces no se marca nada, como antes.
  const mejorMatch = Math.max(...items.map((item) => matchLength(item, pathname)));

  const [signOutOpen, setSignOutOpen] = useState(false);

  return (
    <nav
      aria-label="Menú del panel"
      className="h-fit rounded-[16px] border border-[#e0e0e0] bg-card p-3 lg:sticky lg:top-24"
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const { href, label, icon: Icon } = item;
          const active = matchLength(item, pathname) === mejorMatch;
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
            onClick={() => setSignOutOpen(true)}
            className="flex h-[41px] w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-[#bf3333] transition-colors hover:bg-[#bf3333]/5"
          >
            <LogOutIcon className="size-4 shrink-0" />
            Salir
          </button>
        </li>
      </ul>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </nav>
  );
}
