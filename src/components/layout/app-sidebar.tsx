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
  ChevronDownIcon,
  CreditCardIcon,
  FolderTreeIcon,
  GiftIcon,
  HomeIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MailIcon,
  PercentIcon,
  ReceiptIcon,
  TicketIcon,
  Undo2Icon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { PanelCounter } from "@/components/layout/panel-controls";
import { SignOutDialog } from "@/components/layout/sign-out-dialog";

export type SidebarItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Solo activo en la ruta exacta (los "inicio", que son prefijo de las demás). */
  exact?: boolean;
  /** Prefijo extra que también lo marca activo (detalles que cuelgan de otra ruta). */
  alsoMatch?: string;
  /**
   * G-01 · Subniveles, **en acordeón**: abierto el grupo que contiene la ruta
   * activa, cerrados los demás, y cualquiera se pliega o despliega con el
   * chevron de su fila.
   *
   * ⚠️ AQUÍ PONÍA «siempre abiertos (nunca un acordeón)», y no era un descuido:
   * era la decisión G-01 del paquete aprobado, que los quería a la vista en
   * todas las pantallas para que el menú dijera de un vistazo qué hay dentro de
   * cada sección. **El cliente la reabrió el 11-sep-2026** al ver el precio: en
   * el tutor son seis grupos abiertos a la vez, o sea veinte filas en una
   * columna de 232 px, y la sección en la que estás deja de destacar entre
   * ellas.
   *
   * Lo que se temía perder al cerrarlos NO incluye el trabajo pendiente: el
   * contador de la categoría ya es la SUMA de los de sus hijos (G-02), así que
   * un grupo cerrado sigue diciendo cuánto hay dentro.
   *
   * Cada uno es una de dos cosas, y el código las distingue por el `#`:
   *   · un ANCLA al bloque de la propia pantalla (`/tutor#por-atender`) — no se
   *     marca nunca como activo, porque marcarlo pediría un scroll-spy y el
   *     diseño aprobado tampoco lo pinta;
   *   · una RUTA de verdad (`/tutor/verification`) — se marca al estar en ella,
   *     y de paso marca a su categoría, que es cómo «Verificación» deja de ser
   *     entrada de primer nivel sin perder el rastro de dónde estás.
   *
   * ⚠️ Solo se pintan de 768 en adelante. Por debajo el menú es una tira de una
   * línea que se desplaza (decisión de Jose del 9-sep): meter ahí un segundo
   * nivel sería volver a las tres filas que se acaban de quitar. Y por lo mismo
   * **el acordeón tampoco existe por debajo de 768**: no hay nada que plegar,
   * así que el chevron ni se pinta.
   */
  children?: { href: string; label: string }[];
  /**
   * Con qué palabra se lee el contador de esta categoría.
   *
   * Por defecto «pendientes», que es lo que un contador significa (regla 1 de
   * `lib/tutor/sidebar-badges.ts`: un número es trabajo que espera). «Mis
   * mentorías» es la única excepción y la lista aprobada la pide así: su número
   * es el REPARTO DEL CATÁLOGO (activas + pausadas + borradores), no una
   * bandeja. Anunciar «Mis mentorías, 3 pendientes» a un tutor cuyas tres
   * mentorías están publicadas y al día es sencillamente falso.
   */
  contadorSufijo?: { uno: string; varios: string };
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
  // Referidos v2 · «Invita y gana» ya no es un iframe de Referral Factory, es
  // una pantalla nuestra — y la MISMA para alumno y para tutor: dentro se
  // pintan las campañas visibles que le tocan a cada uno, así que el menú no
  // tiene que decidir nada. Va la última porque no es trabajo pendiente: se
  // entra cuando se quiere invitar a alguien, no a diario.
  { href: "/referidos", label: "Invita y gana", icon: GiftIcon },
];

/** Menú del tutor (TU06). Mismos criterios: solo rutas que existen. */
export const TUTOR_ITEMS: Item[] = [
  {
    href: "/tutor",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    exact: true,
    children: [
      { href: "/tutor#por-atender", label: "Por atender" },
      { href: "/tutor#proximas-sesiones", label: "Próximas sesiones" },
      { href: "/tutor#tus-ingresos", label: "Tus ingresos" },
    ],
  },
  {
    href: "/tutor/products",
    label: "Mis mentorías",
    icon: BookOpenIcon,
    contadorSufijo: { uno: "mentoría", varios: "mentorías" },
    children: [
      { href: "/tutor/products?f=activas", label: "Activas" },
      { href: "/tutor/products?f=pausadas", label: "Pausadas" },
      { href: "/tutor/products?f=borradores", label: "Borradores" },
    ],
  },
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
  {
    href: "/tutor/availability",
    label: "Disponibilidad",
    icon: CalendarPlusIcon,
    children: [
      { href: "/tutor/availability#horario-semanal", label: "Horario semanal" },
      { href: "/tutor/availability#calendario", label: "Calendario" },
      { href: "/tutor/availability#excepciones", label: "Excepciones" },
    ],
  },
  {
    href: "/tutor/reservas",
    label: "Reservas",
    icon: TicketIcon,
    children: [
      { href: "/tutor/reservas?f=por-aceptar", label: "Por aceptar" },
      { href: "/tutor/reservas?f=proximas", label: "Próximas" },
      { href: "/tutor/reservas?f=pasadas", label: "Pasadas" },
    ],
  },
  // G-01 · «Payouts» pasa a «Mis pagos». Era la única entrada del menú en
  // inglés, y el propio panel ya llamaba «pagos» a lo que hay dentro.
  {
    href: "/tutor/payouts",
    label: "Mis pagos",
    icon: WalletIcon,
    children: [
      { href: "/tutor/payouts#saldo", label: "Saldo" },
      { href: "/tutor/payouts#como-cobras", label: "Cómo cobras" },
      { href: "/tutor/payouts#mis-cuentas", label: "Mis cuentas" },
      { href: "/tutor/payouts#movimientos", label: "Movimientos" },
    ],
  },
  // R29-03a: "Métodos de pago" (/pagos) es card-on-file del ALUMNO (RN-43): como
  // tutor no pago, cobro. Sigue a un clic desde el panel de alumno (el switch de
  // `panelItems` le devuelve ese menú). La cuenta de cobro del tutor es R29-03b,
  // aplazada a EP-20 mientras el PSP no tenga cuentas.
  // G-01 · «Verificación» DEJA de ser entrada de primer nivel y pasa a colgar
  // de «Mi cuenta». No se pierde el acceso —sigue siendo una ruta propia y el
  // subnivel se marca al estar en ella—, y el menú deja de mezclar un trámite
  // que se hace una vez con las secciones que se visitan siempre.
  //
  // El comentario que había aquí decía que sin entrada propia «no había forma
  // de llegar a ellos desde el panel»: sigue habiéndola, solo que un nivel
  // más adentro.
  {
    href: "/account",
    label: "Mi cuenta",
    icon: UserIcon,
    children: [
      { href: "/tutor/verification", label: "Verificación" },
      { href: "/account#informacion-personal", label: "Información personal" },
      { href: "/account#contrasena", label: "Contraseña" },
      { href: "/account#avisos", label: "Avisos" },
    ],
  },
  // Referidos v2 · «Invita y gana» ya no es un iframe de Referral Factory, es
  // una pantalla nuestra — y la MISMA para alumno y para tutor: dentro se
  // pintan las campañas visibles que le tocan a cada uno, así que el menú no
  // tiene que decidir nada. Va la última porque no es trabajo pendiente: se
  // entra cuando se quiere invitar a alguien, no a diario.
  { href: "/referidos", label: "Invita y gana", icon: GiftIcon },
];

/**
 * Menú del panel admin, en el orden del Figma (218:1739): Dashboard, Tutores,
 * Pagos, Reservas, Categorías, Tiers, Estadísticas, Alertas, Payouts.
 * `/admin` es el dashboard (AD02) y la cola de tutores vive en /admin/tutores.
 *
 * Lo que el Figma no dibujó se coloca PEGADO A SU TEMA (así entraron «Mentorías
 * impartidas» tras Tutores y «Reportes» tras Alertas), salvo las dos
 * herramientas internas —«Operaciones» y «Notificaciones»—, que no son tema de
 * nadie y hacen cola al final, detrás de Payouts.
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
  // X-01 · no está en el Figma. Va pegada a Pagos y no a Payouts porque un
  // reembolso es un COBRO al revés: cada fila cuelga de un `payment`, la
  // pantalla reutiliza los filtros de `/admin/payments` y el dinero vuelve al
  // alumno. Payouts es el otro flujo —lo que se le debe al tutor— y mezclarlos
  // en el menú es lo que hace buscar los reembolsos donde no están.
  { href: "/admin/reembolsos", label: "Reembolsos", icon: Undo2Icon },
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
  // ── HERRAMIENTAS INTERNAS ───────────────────────────────────────────────
  // Las dos existían sin puerta: se llegaba escribiendo la URL, o desde los
  // enlaces sueltos del dashboard. NO son primer nivel por importancia sino
  // por alcance: como hijas de otra entrada desaparecerían por debajo de 768
  // —los subniveles son `max-md:hidden`— y volverían a no tener acceso justo
  // en el ancho en el que nadie se sabe la URL de memoria.
  //
  // RV-20 · «Operaciones» es la única acción destructiva del panel, pero la
  // destrucción vive detrás de una vista previa y un envío en su propia
  // pantalla: lo que hay aquí es un enlace, no un botón (por eso no comparte
  // el criterio de «Salir», que dispara el diálogo al tocarlo). Aun así va
  // ANTES que «Notificaciones» para no ser el último chip de la tira de móvil,
  // que es donde el pulgar suelta al arrastrar.
  { href: "/admin/operaciones", label: "Operaciones", icon: WrenchIcon },
  // Diagnóstico, no bandeja: qué avisos están pending/sent/failed. La etiqueta
  // no es el título de la pantalla («Cola de notificaciones», 22 caracteres):
  // el tope de la columna son ~158 px a 14/600 y ahí ya va justa «Mentorías
  // impartidas» con 20. «Notificaciones» son 14 y entra de sobra.
  { href: "/admin/notificaciones", label: "Notificaciones", icon: MailIcon },
  // Referidos v2 · qué campañas de Referral Factory se enseñan en «Invita y
  // gana» y con qué texto. Entra CON puerta desde el primer día a propósito:
  // /admin/notificaciones, /admin/operaciones y /admin/reembolsos vivieron
  // meses sin entrada en el menú y se llegaba escribiendo la URL.
  { href: "/admin/referidos", label: "Referidos", icon: GiftIcon },
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
  // G-01 · un subnivel que es RUTA propia marca también a su categoría: en
  // `/tutor/verification` la sección activa es «Mi cuenta», que es de donde
  // cuelga. Cuenta con la longitud de la ruta del hijo para que gane al resto
  // por el mismo criterio de siempre (el prefijo más largo).
  const porHijo = Math.max(
    -1,
    ...(item.children ?? []).map((c) =>
      rutaDe(c.href) === pathname ? rutaDe(c.href).length : -1,
    ),
  );
  return Math.max(porHref, porAlias, porHijo);
}

/** La ruta de un enlace de subnivel, sin el `#ancla` ni la `?query`. */
function rutaDe(href: string): string {
  return href.split(/[#?]/)[0];
}

/**
 * ¿Este subnivel es la página en la que estás?
 *
 * Solo lo son los que llevan a una RUTA PROPIA (hoy únicamente «Verificación»,
 * dentro de «Mi cuenta»). Los otros dos tipos no se marcan nunca:
 *
 * · **Anclas** (`/tutor#por-atender`) — llevan a un bloque de la página en la
 *   que ya estás; marcarlas diría que la página actual es otra.
 * · **Filtros** (`/tutor/products?f=activas`) — igual, y además aquí estaba el
 *   fallo: `rutaDe()` recorta la `?query`, así que en `/tutor/products` los
 *   TRES filtros colapsaban al mismo `pathname` y se encendían a la vez, con
 *   sus tres `aria-current="page"`, mientras la categoría —que sí es la página
 *   actual— se quedaba sin ninguno. Medido el 9-sep-2026: cuatro en
 *   `/tutor/reservas` contando el chip «Todas».
 *
 * Y no se arregla leyendo la query, se arregla NO marcándolos: las capturas
 * aprobadas pintan la categoría resaltada y sus filtros en gris
 * (`reservas-propuesta.png`). Además la información no se pierde —qué filtro
 * está puesto lo dicen los chips de la propia pantalla, que es donde el tutor
 * está mirando— y así el menú no depende de `useSearchParams`, que arrastraría
 * un `<Suspense>` a cada pantalla que lo monta.
 */
function esSubnivelActivo(href: string, pathname: string): boolean {
  return !/[#?]/.test(href) && href === pathname;
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
   * G-01 (reabierta el 11-sep-2026) · QUÉ GRUPOS ESTÁN ABIERTOS.
   *
   * Por defecto, el que contiene la ruta activa. Y eso **no es estado**: sale
   * de `active`, que ya se calcula por `matchLength` y que ya cuenta a los
   * hijos que son ruta propia. Aquí solo vive lo que el usuario ha plegado o
   * desplegado A MANO en la pantalla en la que está.
   *
   * ⚠️ POR ESO LO GUARDADO LLEVA PEGADA SU RUTA, y no es rebuscado: es lo que
   * quita el brinco. Vaciar el mapa en un `useEffect` al cambiar de pantalla
   * pinta primero el estado viejo y lo corrige después —el salto al hidratar
   * que el cliente lleva un correo pidiendo que se quite—, y hacerlo durante el
   * render es escribir estado en el render. Comparando la ruta, lo que el
   * usuario tocó en otra pantalla simplemente deja de aplicar, y el estado
   * inicial sale del `pathname` EN EL PRIMER RENDER: así el esqueleto
   * (`tutor/loading.tsx` monta este MISMO menú) y la pantalla de verdad pintan
   * lo mismo.
   *
   * `usePathname()` no incluye `#` ni `?`, así que pulsar un ancla o un filtro
   * —que es lo que son casi todos los hijos— no cierra lo que acabas de abrir.
   */
  const [plegados, setPlegados] = useState<{
    ruta: string;
    mapa: Record<string, boolean>;
  }>({ ruta: pathname, mapa: {} });
  const aMano: Record<string, boolean> =
    plegados.ruta === pathname ? plegados.mapa : {};

  /**
   * La fila de móvil trae a la vista la sección en la que estás.
   *
   * Sin esto, el panel de admin —hoy catorce secciones; eran once, y entonces
   * la tira medía ~1.200 px— se abría en «Payouts» con la tira empezando por
   * «Dashboard»: la marca azul quedaba fuera de la pantalla y la fila parecía
   * no tener nada seleccionado. Cada entrada nueva empeora ese caso, así que
   * esto pasa a hacer más falta, no menos.
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
          // G-02 · el contador de la categoría es la SUMA de los de sus
          // subniveles, no un número aparte: así el menú no puede decir «Mis
          // pagos 3» y enseñar dentro un solo 1. Sin subniveles, el suyo.
          const hijos = item.children ?? [];
          const pendientes = hijos.length
            ? hijos.reduce((n, c) => n + (badges?.[c.href] ?? 0), 0)
            : (badges?.[href] ?? 0);
          // ⚠️ Cuando quien estás mirando es un SUBNIVEL con ruta propia, la
          // categoría deja de ser «la página actual»: su href lleva a otro
          // sitio. Sin esto el menú declaraba `aria-current="page"` DOS veces
          // —medido en `/tutor/verification`: «Mi cuenta» (→ /account) y
          // «Verificación»—, así que un lector de pantalla anunciaba dos
          // páginas actuales y ofrecía como «la actual» un enlace que te saca
          // de donde estás (4.1.2). Pasa en toda categoría cuyos hijos son
          // rutas y no anclas.
          //
          // El resaltado VISUAL de la categoría no se toca: ahí sí es correcto
          // —dice dónde estás dentro del menú— y `active` sigue igual. Lo que
          // se corrige es solo lo que se ANUNCIA.
          const hijoActivo = hijos.some((c) => esSubnivelActivo(c.href, pathname));
          // Abierto el grupo de la ruta activa; lo que el usuario haya tocado
          // a mano en esta pantalla manda por encima. Ver `plegados`.
          const abierto = aMano[href] ?? active;
          const idSub = `sub-${href.replace(/[^a-z0-9]+/gi, "-")}`;
          return (
            <li key={href}>
              {/* ⚠️ `md:relative` Y NO `relative` A SECAS. El chevron se ancla
                  aquí, pero por debajo de 768 no existe (`max-md:hidden`) y un
                  envoltorio posicionado sí tendría consecuencia: pasaría a ser
                  el `offsetParent` del enlace, y el `offsetLeft` con el que la
                  tira centra la sección activa se volvería 0 — o sea que el
                  menú de móvil dejaría de traerla a la vista. */}
              <div className="md:relative">
                <Link
                  href={href}
                  ref={active ? activo : undefined}
                  aria-current={active && !hijoActivo ? "page" : undefined}
                  aria-label={
                    pendientes > 0
                      ? `${label}, ${pendientes} ${
                          pendientes === 1
                            ? (item.contadorSufijo?.uno ?? "pendiente")
                            : (item.contadorSufijo?.varios ?? "pendientes")
                        }`
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
                    // El hueco del chevron, solo donde el chevron se pinta. El
                    // contador va con `ml-auto`, así que se corre solo con él.
                    hijos.length ? "md:pr-9" : undefined,
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
                  {/* G-02 · círculo de 20 px NARANJA, el mismo de la campana:
                      es lo que reclama atención.
                      ⚠️ Y SIGUE NARANJA EN LA FILA ACTIVA. Aquí ponía
                      `tone={active ? "activo" : "naranja"}` con un comentario que
                      afirmaba justo lo contrario de lo que hacía el código («no
                      cambia de color»). El translúcido sobre la fila azul deja el
                      número en 2,62:1 —peor que el 2,89 del naranja— y lo hace
                      precisamente en la fila que el tutor está mirando. Las dos
                      capturas aprobadas que lo enseñan (`dashboard-propuesta.png`
                      y `reservas-propuesta.png`) lo pintan naranja, y G-02 no
                      contempla excepción por estado activo: G-03 sí la escribe
                      para los chips, que es la prueba de que la lista sabe
                      decirlo cuando la quiere. */}
                  <PanelCounter
                    value={pendientes}
                    tone="naranja"
                    className="ml-auto"
                  />
                </Link>

                {/* G-01 · EL DISPARADOR DEL ACORDEÓN ES ESTE BOTÓN, NO LA FILA.
                    La fila sigue siendo un enlace que navega —«Reservas» tiene
                    que llevar a Reservas—, así que plegar necesita su propio
                    objetivo; y no puede ir DENTRO del `<a>`, porque un botón
                    dentro de un enlace no es HTML válido. De ahí el envoltorio
                    posicionado y este absoluto encima del hueco que le abre el
                    `md:pr-9`.

                    ⚠️ Y ES UN BOTÓN DE VERDAD, no un `:hover` sobre la fila: por
                    encima de 768 hay tablets sin ratón, y un submenú al que solo
                    se llega pasando el puntero no existe para el teclado (2.1.1).
                    28x41 de área táctil —por encima de los 24x24 de 2.5.8, que es
                    el mínimo que ya usa el resto del panel— y `aria-expanded` +
                    `aria-controls` para que un lector de pantalla sepa qué abre y
                    si está abierto. */}
                {hijos.length ? (
                  <button
                    type="button"
                    aria-expanded={abierto}
                    aria-controls={idSub}
                    aria-label={`${abierto ? "Contraer" : "Desplegar"} ${label}`}
                    onClick={() =>
                      setPlegados({
                        ruta: pathname,
                        mapa: { ...aMano, [href]: !abierto },
                      })
                    }
                    className={cn(
                      "absolute inset-y-0 right-1 grid w-7 place-items-center rounded-md transition-colors max-md:hidden",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      active
                        ? // Sobre la fila azul, blanco: el gris de abajo daría
                          // 1,6:1 contra el 3:1 que pide 1.4.11 para un icono.
                          "text-white hover:bg-white/20"
                        : "text-[#8a8a8a] hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-4 transition-transform",
                        !abierto && "-rotate-90",
                      )}
                    />
                  </button>
                ) : null}
              </div>

              {/* G-01 · Subniveles, solo en la columna (≥768) y solo si su
                  grupo está abierto. La línea izquierda de 1 px es lo que los
                  ata visualmente a su categoría.

                  ⚠️ Cerrado se esconde con `display:none` y no con altura 0 o
                  `visibility`: lo que sigue alcanzable con el tabulador después
                  de plegarlo es un submenú que el usuario cree cerrado, y el
                  `aria-expanded` de arriba estaría mintiendo. */}
              {hijos.length ? (
                <ul
                  id={idSub}
                  className={cn(
                    "mt-1 ml-4 border-l border-[#e0e0e0] max-md:hidden",
                    !abierto && "hidden",
                  )}
                >
                  {hijos.map((c) => {
                    // Ver `esSubnivelActivo`: ni anclas ni filtros se marcan.
                    const hijoActivo = esSubnivelActivo(c.href, pathname);
                    const n = badges?.[c.href] ?? 0;
                    return (
                      <li key={c.href}>
                        <Link
                          href={c.href}
                          aria-current={hijoActivo ? "page" : undefined}
                          className={cn(
                            "flex min-h-[26px] items-center gap-2 py-0.5 pl-3 text-xs transition-colors",
                            hijoActivo
                              ? // `brand-foreground` (#036fda, 4,9:1 sobre
                                // blanco) y no `brand` (#0080ff, 3,80:1): son
                                // 12 px, o sea texto pequeño, y AA pide 4,5.
                                // A ojo es el mismo azul y el token existe
                                // justo para esto (mismo criterio que los chips
                                // de filtro y la tarjeta de soporte).
                                "font-semibold text-brand-foreground"
                              : "text-[#595959] hover:text-foreground",
                          )}
                        >
                          <span className="min-w-0 truncate">{c.label}</span>
                          {/* Círculo de 18 px, gris y con 16 px de aire a la
                              derecha: pide menos atención que el de la
                              categoría, y ese margen es lo que impide que los
                              dos números se lean como uno solo. */}
                          <PanelCounter
                            value={n}
                            tone="suave"
                            size={18}
                            className="mr-4 ml-auto"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
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
