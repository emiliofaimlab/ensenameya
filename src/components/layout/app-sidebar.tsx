"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ActivityIcon,
  BarChart3Icon,
  BellIcon,
  FlagIcon,
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
 *
 * ⚠️ Sigue siendo así en móvil y tablet. El Figma nuevo repite esos mismos
 * chips inexistentes en «AL02 — Dashboard — Mobile» (11 chips donde el menú
 * real tiene 6) y en TU06/AD02; se pintan los reales, no los dibujados.
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
  // la fila: "Mentorías impartidas" (20 caracteres, en el menú de admin) ya
  // mide 154 px a 14/600 de los ~158 que deja la columna de 232. "Preguntas
  // frecuentes" tiene los mismos 20 y quedaría al límite. El título de la
  // pantalla sí es el largo.
  //
  // Desde US-1601 la fila es `min-h-[41px]`, o sea que una etiqueta larga
  // ENVUELVE en vez de desbordar (antes era `h-[41px]` fija y se salía). Eso
  // quita el riesgo de rotura, no la razón de la etiqueta corta: dos líneas en
  // el menú siguen sin ser lo que se quiere.
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
  // 154 px a 14/600 de los ~158 que deja la columna de 232 px, y 143 px a
  // 13/600 de los 146 que deja la de 196 px que US-1601 le da a tablet. Cabe en
  // una línea en las dos —medido con `measureText`, no estimado—, y si algún
  // día no cupiera envolvería: la fila ya no tiene alto fijo.
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
  // EY-189 · La cola de moderación. Va pegada a Alertas porque es lo
  // mismo que ellas —trabajo que pide una decisión— y porque el Figma no
  // la dibujó: la pantalla nació después.
  { href: "/admin/reportes", label: "Reportes", icon: FlagIcon },
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
      className={cn(
        // US-1601 · POR DEBAJO DE 768 ESTO NO ES UNA TARJETA, SON CHIPS.
        //
        // El Figma «Mobile y Tablet» no dibuja ni un cajón ni una pestaña con
        // scroll en los 115 frames: a 390 el menú del panel es una fila de
        // chips que ENVUELVE y está siempre a la vista (`sidebar-nav · row
        // wrap gap8` en AL02 — Dashboard — Mobile, `nav-chips` en TU06 y AD02).
        // Sin marco, sin fondo y sin padding: los chips se apoyan directamente
        // sobre el #f9fafc de la página.
        //
        // De 768 en adelante vuelve a ser la tarjeta de siempre (r16, borde
        // #e0e0e0, 12 de padding), que es lo que pintan AL02 y AD02 tablet y lo
        // que ya había en escritorio: la restitución en `md:` deja ≥1024 igual.
        "h-fit rounded-none border-0 bg-transparent p-0",
        "md:rounded-[16px] md:border md:border-[#e0e0e0] md:bg-card md:p-3",
        // El `lg:sticky` se queda tal cual: los chips no deben pegarse, y el
        // `top-24` (96) sigue despejando la cabecera de 73.
        "lg:sticky lg:top-24",
      )}
    >
      <ul className="flex flex-row flex-wrap gap-2 md:flex-col md:flex-nowrap md:gap-1">
        {items.map((item) => {
          const { href, label, icon: Icon } = item;
          // ⚠️ `mejorMatch >= 0` NO sobra. Sin él, en una ruta del área
          // autenticada que no está en el menú —`/reservar/<id>`, por ejemplo—
          // todos los ítems devuelven -1, `mejorMatch` es -1, y `-1 === -1`
          // marcaba TODO el menú como activo: cinco botones azules a la vez.
          // El comentario de arriba ya decía que en ese caso no debía marcarse
          // nada; el código hacía lo contrario.
          const active =
            mejorMatch >= 0 && matchLength(item, pathname) === mejorMatch;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // CHIP (base, <768): 38 de alto = pad9/14 + texto 13/20. Aquí
                  // son pad 8 + borde 1 para que el total sea 38 EXACTOS con
                  // `box-sizing: border-box`, que es lo que Figma dibuja sin
                  // contar el trazo. r14 y no r8 porque en el archivo nuevo el
                  // nodo se llama literalmente `chip` en dos de las tres áreas
                  // (TU06 y AD02) y r14 es el radio de chip del sistema; el r8
                  // de AL02 es la fila del menú reaprovechada.
                  "flex min-h-[38px] items-center gap-2.5 rounded-[14px] border px-3.5 py-2 text-[13px] leading-5 transition-colors",
                  // COLUMNA (≥768): `nav-item` 148x41 / 172x41 del Figma tablet,
                  // pad10/12 y r8. `min-h` en vez del `h-[41px]` de antes: la
                  // altura sale igual (10+20+10 = 40 → 41 por el mínimo) pero
                  // una etiqueta que no quepa envuelve en vez de desbordar, que
                  // es justo lo que avisaban los comentarios de arriba y lo que
                  // el propio Figma hace con "Configuración de perfil" (148x62).
                  "md:min-h-[41px] md:w-full md:rounded-lg md:border-0 md:px-3 md:py-2.5",
                  // 13px hasta 1023 y 14 a partir de ahí. El Figma pide 14/21 en
                  // la columna de tablet, pero con 168 px de columna solo quedan
                  // 120 para la etiqueta y "Métodos de pago" mide 123 a 14/400
                  // (medido con `measureText` en Poppins): a 13 mide 115 y entra
                  // en una línea. El escritorio se restituye con `lg:text-sm`.
                  "lg:text-sm",
                  active
                    ? // El borde va del color del relleno para que activo e
                      // inactivo midan lo mismo: el activo del Figma no tiene
                      // trazo y sin esto la fila de chips bailaría 2 px.
                      "border-brand bg-brand font-semibold text-white"
                    : "border-[#e0e0e0] bg-card text-[#666666] hover:bg-muted hover:text-foreground",
                )}
              >
                {/* El Figma no pinta iconos en NINGÚN menú de panel, ni en los
                    chips de 390 ni en la columna de 768; son de la maqueta de
                    escritorio (EP-22). Se esconden hasta `lg:` porque además son
                    los 26 px que le faltan a la columna de 168 para que las
                    etiquetas quepan en una línea. */}
                <Icon className="size-4 shrink-0 max-lg:hidden" />
                {label}
              </Link>
            </li>
          );
        })}
        {/* El aire que separa "Salir" del resto es el `Frame 10x8` que el Figma
            mete antes de él en la columna de tablet. En modo chip no hay tal
            separación: allí "Salir" es un chip más de la fila que envuelve. */}
        <li className="mt-0 pt-0 md:mt-2 md:pt-1">
          <button
            type="button"
            onClick={() => setSignOutOpen(true)}
            className={cn(
              // Mismo chip que los demás; solo cambia el color del texto
              // (#bf3333, el rojo apagado del "Salir" del archivo — el #dc2626
              // de TU06 es de la página «tutor» del Figma, que va con los grises
              // por defecto de Tailwind y es otra sesión de trabajo).
              "flex min-h-[38px] w-auto items-center gap-2.5 rounded-[14px] border border-[#e0e0e0] bg-card px-3.5 py-2 text-[13px] leading-5 font-medium text-[#bf3333] transition-colors hover:bg-[#bf3333]/5",
              "md:min-h-[41px] md:w-full md:rounded-lg md:border-0 md:bg-transparent md:px-3 md:py-2.5",
              "lg:text-sm",
            )}
          >
            <LogOutIcon className="size-4 shrink-0 max-lg:hidden" />
            Salir
          </button>
        </li>
      </ul>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </nav>
  );
}
