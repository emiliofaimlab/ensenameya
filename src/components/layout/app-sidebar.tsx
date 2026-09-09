"use client";

import { useEffect, useRef, useState } from "react";
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
  // ⚠️ Apunta a `/agendar` y NO a `/tutors`. Llevaba al buscador PÚBLICO: el
  // alumno pulsaba una entrada de su menú y salía del panel —otra cabecera,
  // otro ancho, sin menú— a la misma pantalla que ve cualquiera sin cuenta. El
  // cliente lo señaló como error. `/agendar` es lo mismo dentro de casa: sus
  // tutores, lo que se le recomienda y su historial.
  { href: "/agendar", label: "Agendar", icon: CalendarPlusIcon },
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
  // OCULTA (petición del cliente, 28-ago): la sección de FAQ de perfil no se
  // ofrece en el panel. No se borra nada — la ruta `/tutor/faqs` y su editor
  // siguen en el repo, solo dejan de tener puerta de entrada. Para volver a
  // enseñarla hay que descomentar esta línea, reponer el import de
  // `MessageCircleQuestionIcon` y el enlace de product-form.
  // { href: "/tutor/faqs", label: "Mis FAQ", icon: MessageCircleQuestionIcon },
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

/**
 * Contadores por `href` (petición del cliente, 28-ago: «que en un badge al lado
 * de reportes, incidentes, etc salga un número»).
 *
 * ⚠️ **CERO NO PINTA BADGE.** Un badge con «0» no informa de nada y además
 * ENTRENA a no mirarlos: si están siempre puestos, el que sí importa deja de
 * saltar a la vista. Se resuelve aquí, en el render, y no en quien cuenta, para
 * que la regla valga sea cual sea la fuente del número.
 *
 * Se resuelven en SERVIDOR y llegan como prop: este componente es de cliente y
 * consultarlos desde aquí sería una ida y vuelta por pantalla, con el menú
 * pintándose primero sin números y saltando después. Quién los cuenta:
 * `lib/admin/sidebar-badges.ts`.
 */
export function AppSidebar({
  items = STUDENT_ITEMS,
  badges,
}: {
  items?: Item[];
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  // El ítem más específico que casa con la ruta. `-1` = ninguno (rutas del área
  // autenticada que no están en el menú); entonces no se marca nada, como antes.
  const mejorMatch = Math.max(...items.map((item) => matchLength(item, pathname)));

  const [signOutOpen, setSignOutOpen] = useState(false);

  /**
   * La fila de móvil trae a la vista la sección en la que estás.
   *
   * Sin esto, el panel de admin —once secciones en una tira de ~1.200 px— se
   * abría en «Payouts» con la tira empezando por «Dashboard»: la marca azul
   * quedaba fuera de la pantalla y la fila parecía no tener nada seleccionado.
   *
   * Se mueve `scrollLeft` A MANO y no con `scrollIntoView`: éste último puede
   * desplazar también el eje vertical de la PÁGINA —justo el «brinca» que el
   * cliente lleva un correo pidiendo que se quite— y aquí solo hace falta el
   * horizontal. Se centra el ítem si hay recorrido para ello; si está al
   * principio o al final, el `max/min` deja la tira pegada a su borde.
   */
  const tira = useRef<HTMLUListElement>(null);
  const activo = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const t = tira.current;
    const a = activo.current;
    // `clientWidth` 0 = la tira no se está pintando (a partir de 768 es una
    // columna): no hay nada que centrar.
    if (!t || !a || t.scrollWidth <= t.clientWidth) return;
    const centrado = a.offsetLeft - (t.clientWidth - a.offsetWidth) / 2;
    t.scrollLeft = Math.max(0, Math.min(centrado, t.scrollWidth - t.clientWidth));
  }, [pathname]);

  return (
    <nav
      aria-label="Menú del panel"
      className={cn(
        // ── POR DEBAJO DE 768 ESTO ES UNA SOLA FILA QUE SE DESPLAZA ──────────
        //
        // Hasta el 9-sep era una fila que ENVOLVÍA, que es lo que dibuja el
        // Figma («sidebar-nav · row wrap gap8» en AL02 — Dashboard — Mobile).
        // Con los destinos reales eso son dos filas en el panel del alumno y
        // tres en el de admin: 150 px de menú antes del saludo, y lo que se ve
        // al abrir el panel es el menú, no el panel. Jose lo rechazó mirándolo
        // en un iPhone («se ven mal mal en mobile»), y su decisión gana al
        // Figma (R3 del Doc 24).
        //
        // Ahora es una tira de una línea con scroll horizontal —la misma
        // `scroll-strip` de los chips de categoría y de los filtros—, con la
        // sección activa traída a la vista. Cuesta 48 px fijos en vez de 150 y
        // sigue estando a un toque, que es lo que se pierde al esconder el
        // menú detrás de un botón.
        //
        // El sangrado hasta el borde del viewport es el de `PanelShell`
        // (px-4 / sm:px-6), no el de `Container`: este menú vive dentro del
        // panel, no de la rejilla pública.
        // ⚠️ `min-w-0` NO es decorativo. Este `<nav>` es hijo de la rejilla de
        // `PanelShell`, y el mínimo automático de un ítem de rejilla es el
        // ancho de su CONTENIDO: con la tira dentro, ese contenido son los
        // ~550 px de las cinco secciones sin envolver, así que la pista se
        // ensanchaba y la PÁGINA ENTERA salía de 549 px en una pantalla de
        // 390, con scroll horizontal. Medido dentro de un iframe de 390 —a ojo
        // no se ve, porque el panel del navegador emula más ancho—. Es el mismo
        // fallo que ya mordió en Explorar tutores con las píldoras de filtro.
        "h-fit min-w-0 rounded-none border-0 bg-transparent p-0",
        "md:rounded-[16px] md:border md:border-[#e0e0e0] md:bg-card md:p-3",
        // El `lg:sticky` se queda tal cual: la tira no debe pegarse, y el
        // `top-24` (96) sigue despejando la cabecera de 73.
        "lg:sticky lg:top-24",
      )}
    >
      <ul
        ref={tira}
        className={cn(
          "max-md:scroll-strip max-md:-mx-4 max-md:gap-2 max-md:px-4 max-md:scroll-px-4",
          // `py-1 -my-1`: aire para que la tira no recorte el anillo de foco
          // del chip enfocado (un contenedor con scroll recorta lo que asoma).
          "max-md:-my-1 max-md:py-1 max-sm:-mx-4 max-sm:px-4 sm:max-md:-mx-6 sm:max-md:px-6 sm:max-md:scroll-px-6",
          "md:flex md:flex-col md:gap-1",
        )}
      >
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
          // Cero (o sin contador) = sin badge. Ver la nota de `badges`.
          const pendientes = badges?.[href] ?? 0;
          return (
            <li key={href}>
              <Link
                href={href}
                ref={active ? activo : undefined}
                aria-current={active ? "page" : undefined}
                aria-label={
                  pendientes > 0
                    ? `${label}, ${pendientes} ${pendientes === 1 ? "pendiente" : "pendientes"}`
                    : undefined
                }
                className={cn(
                  // CHIP (base, <768). 40 de alto y no los 38 del Figma: es el
                  // mínimo táctil del proyecto, y en una tira que se desplaza
                  // con el pulgar se nota. `whitespace-nowrap` porque en una
                  // fila que no envuelve una etiqueta de dos palabras partida
                  // en dos líneas descuadra el alto de toda la tira.
                  "flex min-h-10 items-center gap-2.5 rounded-[14px] border px-3.5 py-2 text-[13px] leading-5 whitespace-nowrap transition-colors",
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
                {/* La cuenta, al final de la fila. `ml-auto` la empuja a la
                    derecha en la columna (≥768) y no hace nada en el chip,
                    donde el ancho lo marca el contenido.

                    ⚠️ `aria-hidden`, porque el número ya va en el `aria-label`
                    del enlace: leído tal cual, "Tutores 8" suena a que el menú
                    tiene ocho entradas. Con la etiqueta se anuncia "Tutores, 8
                    pendientes", que es lo que es.

                    `min-w` en vez de ancho fijo: "99+" son tres caracteres y
                    una píldora cuadrada los cortaría. */}
                {pendientes > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                      active
                        ? // Sobre el naranja del activo, el contraste lo da el
                          // relleno blanco: un badge naranja sobre naranja no se
                          // ve, y el blanco sobre blanco tampoco.
                          "bg-white text-brand"
                        : "bg-brand text-white",
                    )}
                  >
                    {pendientes > 99 ? "99+" : pendientes}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        {/* ⚠️ «Salir» NO se pinta por debajo de 768, y esto tiene dos motivos.
            El primero es de reparto (ver la nota del cajón en
            `site-header.tsx`): cerrar sesión es lo MÍO, y lo mío vive en el
            menú del avatar, que en móvil está siempre a la vista en la
            cabecera. El segundo es que una acción destructiva no debería ser
            un vecino más de una fila de navegación por la que se arrastra el
            pulgar: aquí, además, la tira se desplaza, así que «Salir» podía
            quedar justo donde el dedo suelta.

            De 768 en adelante se queda tal cual estaba, con el aire que el
            Figma le da en la columna (`Frame 10x8`) — el escritorio no se
            toca (R1). */}
        <li className="max-md:hidden md:mt-2 md:pt-1">
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
