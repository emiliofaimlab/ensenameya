"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDownIcon,
  LogOutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { CartBadge } from "@/components/cart/cart-badge";
import type { AppNotice } from "@/lib/notifications";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Container } from "@/components/layout/container";
import { SearchAutocomplete } from "@/components/layout/search-autocomplete";
import { SignOutDialog } from "@/components/layout/sign-out-dialog";
import { cn } from "@/lib/utils";
import { panelDeCookie, ROLE_HOME } from "@/lib/auth/roles";
import { isAdminRoute, isOnboardingRoute, panelFromPath } from "@/lib/panel";

/** Datos mínimos del usuario que necesita el header (sin tocar la sesión). */
export type HeaderUser = {
  /**
   * El uid. Lo necesita la campana para acotar sus consultas a los avisos
   * PROPIOS — que no es un lujo: un admin tiene política de lectura sobre toda
   * la tabla `notifications` y sin el filtro veía los avisos de los demás (ver
   * `lib/notifications-server.ts`).
   *
   * No es un dato sensible: ya viaja en el JWT que el navegador tiene.
   */
  id: string;
  email: string;
  name: string | null;
  /** Foto de `profiles` ya resuelta a URL pública, o `null` (van iniciales). */
  avatarUrl: string | null;
  /** Panel del usuario según su rol (lo resuelve `toHeaderUser` con pickHome). */
  homeHref: string;
  /**
   * Paneles del switch (`panelsFor`). Aprender/Enseñar salen siempre con
   * sesión — "Enseñar" es la puerta al onboarding de tutor; /tutor resuelve
   * la cascada (sin perfil → onboarding, pendiente → "en revisión").
   */
  panels: { href: string; label: string }[];
};

/**
 * Switch de panel (acuerdo del 17-jul, 00:56:37). Son ENLACES, no estado: el
 * panel activo es la URL, así que no hay preferencia que guardar ni que
 * sincronizar con el server. Se reaprovecha el chip del registro ("Quiero
 * aprender / Quiero enseñar"), que es la idea que se propuso en la reunión.
 *
 * ponytail: sin memoria de la última elección — "Panel" sigue llevando al rol
 * más privilegiado. Se añade si molesta en uso real.
 *
 * US-1601 · el Figma «Mobile y Tablet» dibuja el avatar con su «▾» en los 115
 * frames pero NO dibuja ni uno solo del menú abierto, así que este switch no
 * tiene diseño al que parecerse: se queda donde estaba (menú del avatar y
 * cajón). Es el caso general de R2 — lo que el Figma desconoce no se borra.
 *
 * Verónica (3-sep-2026, captura 30): «estoy como tutor y, al ir a Mi cuenta
 * desde el menú de las 3 rayas, me cambia a alumno». Fuera de un panel
 * (`/account`, `/pagos`, lo público) la ruta no dice de dónde vienes, y marcar
 * «Aprender» por defecto (24-jul) contradecía al menú lateral de ESA MISMA
 * pantalla, que sigue a la cookie `ey-panel` (`panelItems`): chips de tutor
 * arriba y «Aprender» marcado en el cajón. Ahora el switch lee la misma
 * cookie: primero la ruta (`panelFromPath`), después la cookie, y solo sin
 * ninguna de las dos el primero — que sigue siendo el default del 24-jul («un
 * switch sin selección parece roto»). La cookie se valida contra `panels`: un
 * `admin` en la cookie de quien no administra cae al default.
 *
 * `useSyncExternalStore` y no `useState` + `useEffect`: en servidor no hay
 * `document`, así que el snapshot de servidor es `null` («Aprender») y en el
 * cliente el primer render ya lee la cookie, sin un segundo render que
 * parpadee. La cookie no avisa cuando cambia, de ahí la suscripción vacía: se
 * relee en cada render, y este componente se monta cada vez que se abre el
 * menú o el cajón, que es cuando importa. (En la práctica el snapshot de
 * servidor ni se ve: los dos sitios que lo montan están cerrados al hidratar.)
 */
const sinSuscripcion = () => () => {};
const sinCookieEnServidor = () => null;

function PanelSwitch({
  panels,
  pathname,
  onNavigate,
}: {
  panels: HeaderUser["panels"];
  pathname: string;
  onNavigate?: () => void;
}) {
  // Antes del `return` temprano: los hooks no pueden ser condicionales.
  const panelCookie = useSyncExternalStore(
    sinSuscripcion,
    panelDeCookie,
    sinCookieEnServidor,
  );
  if (panels.length < 2) return null;

  const panel = panelFromPath(pathname) ?? panelCookie;
  const activeHref =
    (panel && panels.find((p) => p.href === ROLE_HOME[panel])?.href) ??
    panels[0].href;

  return (
    <div
      role="group"
      aria-label="Cambiar de panel"
      className="grid gap-1 rounded-[10px] bg-accent p-1"
      style={{ gridTemplateColumns: `repeat(${panels.length}, minmax(0, 1fr))` }}
    >
      {panels.map((p) => {
        const active = p.href === activeHref;
        return (
          <Link
            key={p.href}
            href={p.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              // `truncate` + min-w-0: una etiqueta larga se recorta dentro de
              // su celda en vez de desbordar el menú.
              "min-w-0 truncate rounded-lg px-1.5 py-1.5 text-center text-[13px] transition-colors",
              active
                ? "bg-card font-semibold text-foreground shadow-sm"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Agrupación de v3-header: los mismos destinos que las columnas del footer. */
const navGroups = [
  {
    label: "Explorar",
    links: [
      { href: "/tutors", label: "Explorar tutores" },
      { href: "/classes", label: "Explorar mentorías" },
      { href: "/categories", label: "Categorías" },
    ],
  },
  {
    label: "Nosotros",
    links: [
      { href: "/about", label: "Sobre nosotros" },
      { href: "/how-it-works", label: "¿Cómo funciona?" },
    ],
  },
];

/** Cómo llamar al usuario: su nombre; el correo solo si no hay nombre. */
function displayName(user: HeaderUser): string {
  return user.name?.trim() || user.email;
}

/** Iniciales de las DOS primeras palabras del nombre ("Jose Mora" → JM). */
function initials(user: HeaderUser): string {
  const words = displayName(user).split(/[\s@._-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]);
  return (letters.join("") || "?").toUpperCase();
}

/** Avatar del usuario: su foto si la subió, si no sus iniciales. */
function UserAvatar({
  user,
  className,
}: {
  user: HeaderUser;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-8", className)}>
      {user.avatarUrl ? (
        <AvatarImage src={user.avatarUrl} alt="" />
      ) : null}
      <AvatarFallback className="bg-brand-muted text-[11px] font-semibold text-brand">
        {initials(user)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Form GET nativo: navega a /search?q=… sin JS, igual que la página de búsqueda. */
function SearchBox({ className }: { className?: string }) {
  return (
    <form action="/search" className={className}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          name="q"
          placeholder="Buscar tutores, mentorías o categorías"
          aria-label="Buscar tutores, mentorías o categorías"
          className="h-11 w-full rounded-lg border border-border bg-secondary pr-3 pl-9 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>
    </form>
  );
}

export function SiteHeader({
  user,
  notices = [],
  cartCount = 0,
}: {
  user?: HeaderUser | null;
  /** US-1203 · avisos ya consultados por el layout (server). */
  notices?: AppNotice[];
  /**
   * EY-177 · cuántas mentorías hay en el carrito, leídas de la cookie por el
   * layout (server). Es solo el valor de arranque: `CartBadge` relee la cookie
   * en el navegador, porque un layout del App Router no se vuelve a renderizar
   * al navegar dentro de su propio segmento y este número se quedaría viejo.
   */
  cartCount?: number;
}) {
  const pathname = usePathname();
  /**
   * Modo onboarding (AL01 180:1282 / TU01): sin "Panel" ni menú de cuenta, con
   * "Guardar y salir" a la derecha. Durante el asistente el resto del área
   * autenticada está cerrada (`requireUser` rebota), así que enseñar el panel
   * sería un enlace a ninguna parte.
   *
   * Modo admin (AD02 218:1725): logo + píldora negra "Admin", sin la
   * navegación pública. El "Buscar en el panel…" del Figma no se pinta: no
   * hay búsqueda global del panel a la que conectarlo.
   *
   * Ambos salen de la ruta del cliente y no de una prop del layout: el layout
   * de `(app)` no vuelve a renderizarse al navegar y dejaba el header del
   * asistente pegado al entrar al panel.
   */
  const onboarding = isOnboardingRoute(pathname);
  const admin = isAdminRoute(pathname);

  /**
   * US-1601 · ¿se pinta el buscador de la cabecera?
   *
   * En admin no (R3, ver arriba: los 26 frames de admin lo piden y no hay
   * búsqueda de panel detrás). En el asistente tampoco, por lo mismo que el
   * resto del cromo: el área autenticada está cerrada hasta terminarlo.
   *
   * ⚠️ Que el `else` de onboarding lo dejara FUERA era un fallo medido: a 768
   * el asistente pintaba a la vez nav (x=167..370), buscador (x=105..663) y
   * "Guardar y salir" (x=644..735) en la misma línea, y el buscador se comía
   * los 19 px finales del enlace. Ahora la condición es una sola y explícita.
   */
  const conBuscador = !admin && !onboarding;

  /**
   * ¿La fila de acciones ocupa el ancho ENTERO a 390 con dos controles en los
   * extremos (campana a la izquierda, píldora del avatar a la derecha)?
   *
   * Sí siempre que haya sesión. El Figma dibuja aquí la `avatar-row` de «AL02
   * — Dashboard — Mobile» (358x42, r999, borde #e0e0e0, pad 6/12/6/6, contenido
   * pegado a la derecha con `main:max`), y hasta el 8-sep la fila ENTERA era
   * esa píldora, con la campana suelta dentro a la izquierda. Verónica
   * (3-sep-2026, captura 29): «esta barra no existe en diseño; me gusta, pero
   * mejor 2 botones, notificaciones a la izquierda y usuario a la derecha, sin
   * que estén unidos». Así que el borde deja la fila y se lo queda cada
   * control: la campana como círculo de 42 (`NotificationsBell`) y la píldora
   * del avatar con el suyo, las dos con el mismo #e0e0e0 y la misma altura. La
   * fila vuelve a ser un grupo transparente a los tres anchos, solo que a 390
   * es `justify-between` y desde 768 `justify-end`, como siempre. Sin sesión la
   * fila es la `auth-row` de AU01 (222x40, pegada a la izquierda), que es hug
   * y no lleva borde.
   *
   * ⚠️ Admin va con el resto AUNQUE «AD02 — Dashboard Admin — Mobile» ponga su
   * `avatar-pill` en la misma fila que el logo. Ahí el Figma gasta los 358 px
   * enteros en logo (125) + píldora «Admin» (58) + píldora del avatar (163) y
   * no le sobra ni un píxel — y nosotros tenemos que meter además la campana y
   * la hamburguesa, que el archivo no dibuja en ningún frame (R2). Medido a
   * 390 con la fila compartida: 453 px de contenido para 350 de sitio. Con la
   * píldora en su propia fila cabe todo y el nombre solo se recorta si es muy
   * largo (ver `min-w-0 shrink` en el disparador).
   */
  const filaAvatar = !!user && !onboarding;

  // El sheet no se cierra solo al navegar (Next navega en cliente, el diálogo
  // no se entera). Se nota sobre todo en el switch de panel: cambias de panel y
  // el menú te tapa el resultado.
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  // Cerrar sesión pide confirmación (SignOutDialog). El diálogo se abre desde
  // aquí y no desde el item del menú: al elegir la opción el menú se desmonta y
  // se llevaría el diálogo. Por eso el menú de cuenta va controlado: hay que
  // cerrarlo a mano, o se queda abierto detrás del diálogo.
  const [accountOpen, setAccountOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const confirmSignOut = () => {
    setAccountOpen(false);
    setMenuOpen(false);
    setSignOutOpen(true);
  };

  /**
   * US-1601 · dónde cae el grupo de acciones (CTA de invitado, o campana +
   * píldora del avatar) en cada uno de los tres anchos del Figma.
   *
   *   390 → TERCERA fila, a todo el ancho (`auth-row` / `avatar-row`).
   *   768 → sube a la PRIMERA, a la izquierda del ☰ (`right-group`, gap 16-20).
   *  1024 → columna derecha de la barra de una sola fila: lo de hoy.
   *
   * Se reordena con `order`, no duplicando marcado: el grupo es UNO solo, así
   * que el carrito, la campana y el menú de cuenta no pueden "desaparecer" en
   * una banda de anchos por olvidarse una copia.
   */
  const claseAcciones = cn(
    "flex items-center gap-2",
    // `lg:min-w-max`, igual que en la columna del logo: a partir de 1024 estos
    // botones no ceden ancho (`buttonVariants` los pinta `shrink-0` y
    // `whitespace-nowrap`), así que su columna tiene que declarar como suelo el
    // ancho que de verdad ocupan o se desbordan sobre el buscador. Solo en
    // `lg:`: por debajo, el nombre del avatar SÍ tiene que poder recortarse.
    "order-4 w-full md:order-2 md:w-auto lg:order-3 lg:min-w-max lg:flex-1 lg:justify-end",
    // Con sesión, a 390 son DOS controles con borde propio en los extremos
    // (ver `filaAvatar`): la fila no lleva ni borde ni alto, lo ponen la
    // campana (42) y la píldora (42). A partir de 768 el grupo se pega a la
    // derecha, como siempre.
    filaAvatar && "justify-between md:justify-end md:gap-4 lg:gap-2",
    // Sin sesión, AU01 pega los dos CTA a la IZQUIERDA de su fila con gap 16;
    // a 768 son un grupo hug a la derecha con gap 20.
    !user && "gap-4 md:gap-5 lg:gap-2",
  );

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/60">
      {/*
        La cabecera es UNA sola fila que ENVUELVE, no tres maquetados distintos:
        `flex-wrap` + `order` bastan para las tres formas del Figma (3 filas a
        390, 2 a 768, 1 desde 1024) sin repetir marcado. `lg:flex-nowrap` +
        `lg:h-18` + `lg:py-0` restituyen la barra de escritorio publicada en
        EP-22, que no se toca (R1).

        Alturas medidas contra el Figma (incluido nuestro borde de 1 px):
        390 sin sesión 173 (AU01 = 173) · 390 con sesión 175 (AL02 = 172) ·
        768 sin sesión 147 (AU01 = 146) · 768 con sesión 146 (AL02 = 142) ·
        768 admin 83 (AD02 = 145 menos los 62 del buscador que no se pinta) ·
        390 onboarding 61 (TU01 = 56) · 768 onboarding 69 (TU01 = 71).
      */}
      <Container className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4 md:gap-y-4 md:py-5 lg:h-18 lg:flex-nowrap lg:gap-4 lg:py-0">
        {/* ── Fila 1 · marca, píldora de admin y navegación de escritorio ── */}
        {/*
          `lg:min-w-max` es la otra mitad del arreglo del solape, y no es
          cosmética. El mínimo automático de una columna flex es su ancho de
          CONTENIDO MÍNIMO, y ahí el logo cuenta por su palabra más larga
          («Enséñame», 94 px) y no por la línea entera (119): medido a 1024, la
          columna se quedaba en 313 px con 339 de contenido y el logo —que es
          `shrink-0`— se salía 26 px por debajo del buscador. Con `max-content`
          el suelo es el ancho real, así que quien cede sitio es el buscador.
        */}
        <div className="order-1 flex flex-1 items-center gap-2.5 md:gap-4 lg:min-w-max">
          <Link
            href="/"
            // 18px es el tamaño del logo en 4 de los 5 headers del Figma; los
            // canónicos de tablet (AU01/AL02) lo suben a 20, y ahí es donde se
            // aplica —sin tocar el escritorio, que se queda en 18 (R1).
            className="shrink-0 text-lg font-bold tracking-tight text-brand md:max-lg:text-xl"
          >
            Enséñame ya
          </Link>

          {admin ? (
            <span className="inline-flex h-[25px] shrink-0 items-center rounded-full bg-[#19191f] px-2.5 text-[11px] font-semibold text-white">
              Admin
            </span>
          ) : null}

          {/* Sin enlace "Panel" suelto: la vuelta a casa vive en el menú del
              avatar ("Mi panel") y en el switch de rol — pedirlo dos veces en la
              barra era ruido (24-jul).

              `lg:flex` y no `md:flex`: entre 768 y 1023 el Figma NO pinta estos
              desplegables (AU01/AL02 tablet ponen ☰ en su lugar), y es además
              lo que quita de raíz el solape con el buscador en esa banda. */}
          <nav className="hidden items-center gap-1 lg:flex">
            {admin
              ? null
              : navGroups.map((group) => (
                  <DropdownMenu key={group.label}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 text-sm font-medium"
                      >
                        {group.label}
                        <ChevronDownIcon className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {group.links.map((link) => (
                        <DropdownMenuItem key={link.href} asChild>
                          <Link href={link.href}>{link.label}</Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ))}
          </nav>
        </div>

        {conBuscador ? (
          /*
            ── EL BUSCADOR, Y EL BUG QUE ARREGLA (decisión D-1 del Doc 24) ──
            Hasta ahora esto era `hidden w-full max-w-[558px] shrink-0 md:block`
            entre dos columnas `min-w-0 flex-1`, y esa combinación TAPABA la
            navegación de 768 a ~1370: con `shrink-0` el buscador se quedaba
            558 px fijos y, con `min-w-0`, la columna izquierda se encogía por
            debajo de su contenido y lo dejaba desbordado por debajo del input.
            Medido: a 768 el nav caía en x=167..370 y el buscador en x=97..655,
            y `document.elementFromPoint(190,36)` devolvía el `<input>` — o sea
            que «Explorar» y «Nosotros» no se podían pulsar. A 1024 el solape
            era de 203 px y a 1280 de 49.

            El propio Figma da la solución: en «TU06 — Dashboard Tutor —
            Tablet» el buscador es `w:fill grow`, o sea FLEXIBLE. Aquí eso se
            traduce en tres cosas que hay que leer juntas:

              1. `lg:grow-[3] lg:basis-0` — el buscador crece MÁS DEPRISA que
                 las dos columnas de los lados. Con factor 1 el reparto sería a
                 tres partes iguales y nunca llegaría a los 558 del diseño; con
                 3 llega a su tope y se congela ahí, y el sobrante se reparte a
                 partes iguales entre izquierda y derecha. Resultado a 1440:
                 columnas de 353,5 y buscador de 558 — EXACTAMENTE lo de antes.
              2. `lg:max-w-[558px]` — el tope, que es lo que hace que a partir
                 de ~1409 px el reparto quede idéntico al publicado en EP-22.
              3. Las columnas de los lados YA NO llevan `min-w-0` (ver abajo):
                 su mínimo vuelve a ser su contenido, así que cuando no cabe
                 todo es el buscador —y no la navegación— quien cede sitio.

            Por debajo de 1024 el buscador es una fila entera (`w-full`), que
            es lo que piden AU01/AL02 en los dos anchos: 358x44 a 390 y 704x47
            a 768.
          */
          <SearchAutocomplete
            className="order-3 w-full min-w-0 md:order-4 lg:order-2 lg:w-auto lg:max-w-[558px] lg:grow-[3] lg:basis-0"
            inputClassName="md:max-lg:h-[47px]"
          />
        ) : null}

        {onboarding ? (
          /* El borrador se guarda al avanzar de paso, así que "salir" es solo
             salir. Lleva a la home pública: el área autenticada sigue cerrada
             hasta terminar el asistente. */
          <div className="order-2 flex flex-1 justify-end">
            <Link
              href="/"
              className="shrink-0 text-[12.5px] text-[#6b6b6b] transition-colors hover:text-foreground md:text-[13px]"
            >
              Guardar y salir
            </Link>
          </div>
        ) : (
          <>
            <div className={claseAcciones}>
              {/* EY-177 · el carrito, CON O SIN SESIÓN. Ésa es la diferencia con
                  la campana de al lado: los avisos son de una cuenta y el
                  carrito es del navegador (vive en una cookie), así que un
                  anónimo puede apuntar mentorías y revisarlas antes de
                  registrarse. En admin no se pinta: ese panel no compra nada.

                  Por debajo de 768 esta copia se apaga y manda la de al lado
                  del ☰ (ver más abajo): el contador tiene que estar SIEMPRE en
                  la primera fila, y a 390 esta fila es la tercera. */}
              {admin ? null : (
                <span className="hidden md:inline-flex">
                  <CartBadge initial={cartCount} />
                </span>
              )}

              {/* US-1203 · avisos in-app, solo con sesión (son los tuyos).
                  ⚠️ Hasta ahora vivía dentro de un `hidden … md:flex` y no tenía
                  copia en el cajón, así que POR DEBAJO DE 768 UN USUARIO CON
                  SESIÓN NO TENÍA NINGÚN ACCESO A SUS AVISOS (verificado a 390
                  con 3 sin leer: el contenedor tenía `display:none`). No es un
                  hueco del Figma —la campana no sale en ninguno de sus 115
                  frames—, es un fallo del código; se arregla aquí metiéndola en
                  el grupo único de acciones, que sí se pinta a los tres anchos.
                  A 390 cae en el hueco que la `avatar-row` del Figma deja a la
                  izquierda, que es justo para lo que sirve esa fila. */}
              {user ? (
                <NotificationsBell initial={notices} userId={user.id} />
              ) : null}

              {user ? (
                <DropdownMenu open={accountOpen} onOpenChange={setAccountOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        // Píldora del Figma: círculo de 30 + nombre + «▾»,
                        // 42 de alto, r999, borde #e0e0e0, pad 6/12 (AL02
                        // `avatar-row` a 390 y a 768, `avatar-pill` de AD02).
                        // El borde va aquí a TODOS los anchos por debajo de
                        // 1024: hasta el 8-sep a 390 lo llevaba la fila entera
                        // y Verónica (3-sep-2026) pidió los dos controles
                        // separados (ver `filaAvatar`).
                        "h-[42px] w-auto justify-start gap-2 rounded-full border-border p-0 pr-3 pl-1.5",
                        // `shrink` + `min-w-0` (`buttonVariants` pone
                        // `shrink-0`): sin esto el nombre real de la cuenta NO
                        // se recorta y la píldora se sale de la pantalla —
                        // medido a 390 con un nombre de 47 caracteres: 403 px
                        // de disparador y 470 de `scrollWidth`, o sea scroll
                        // horizontal de página. Ahora el suelo es el círculo y
                        // el `truncate` del nombre actúa: la píldora no pasa
                        // del sitio que deja la campana (350 − 42 − 8).
                        "min-w-0 shrink",
                        // ≥1024 vuelve a ser el círculo pelado de 32 que hay
                        // publicado desde EP-22 (R1): sin nombre ni padding, y
                        // `shrink-0` como todos los botones de esa barra.
                        "lg:size-8 lg:min-w-auto lg:shrink-0 lg:justify-center lg:gap-0 lg:p-0",
                      )}
                      aria-label="Abrir menú de cuenta"
                    >
                      <UserAvatar
                        user={user}
                        className="size-[30px] lg:size-8"
                      />
                      {/* `min-w-0` + `truncate`: el Figma dibuja «María» y
                          «Néstor · Admin», pero aquí va el nombre real de la
                          cuenta, que puede ser mucho más largo. A 768 comparte
                          fila con el logo, el carrito, la campana y el ☰: se
                          recorta en vez de desbordar. */}
                      <span className="min-w-0 truncate text-sm font-medium text-foreground lg:hidden">
                        {displayName(user)}
                      </span>
                      <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground lg:hidden" />
                    </Button>
                  </DropdownMenuTrigger>
                  {/* w-72: con tres paneles (admin) ni w-56 ni w-64 daban — en
                      w-64 "Aprender" se recortaba dentro de su celda. El
                      `max-w-` lo acota a la pantalla y `collisionPadding` lo
                      despega del borde (medido a 390: x=82..370 con la píldora
                      pegada a la derecha; y también cabía cuando la píldora
                      iba suelta dentro de la fila, que es de donde viene). */}
                  <DropdownMenuContent
                    align="end"
                    collisionPadding={12}
                    className="w-72 max-w-[calc(100vw-24px)]"
                  >
                    {/* Quién eres, no con qué correo entraste: nombre y foto. El
                        correo solo aparece si la cuenta aún no tiene nombre. */}
                    <DropdownMenuLabel className="flex items-center gap-2.5 py-2.5 font-normal">
                      <UserAvatar user={user} className="size-9" />
                      <span className="min-w-0 truncate text-[13.5px] font-semibold text-foreground">
                        {displayName(user)}
                      </span>
                    </DropdownMenuLabel>

                    {user.panels.length > 1 ? (
                      <div className="px-2 pb-2">
                        <PanelSwitch panels={user.panels} pathname={pathname} />
                      </div>
                    ) : null}

                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href={user.homeHref}>
                        <UserIcon />
                        Mi panel
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/account">
                        <SettingsIcon />
                        Mi cuenta
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        confirmSignOut();
                      }}
                    >
                      <LogOutIcon />
                      Cerrar sesión
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  {/* AU01 · «Iniciar sesión» 13/500 a 390 y 14 a 768; el botón
                      naranja 120x40 a 390 y 131x43 a 768. El escritorio se
                      queda con el h-9/h-10 y el `text-sm` de EP-22. */}
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-10 px-2.5 text-[13px] md:text-sm lg:h-9"
                  >
                    <Link href="/login">Iniciar sesión</Link>
                  </Button>
                  {/* El Figma pinta este botón en 600, no en el 500 del resto. */}
                  <Button
                    asChild
                    className="h-10 px-4 text-[13px] font-semibold md:text-sm md:max-lg:h-[43px]"
                  >
                    <Link href="/signup">Crear cuenta</Link>
                  </Button>
                </>
              )}
            </div>

            {/* ── Carrito móvil + hamburguesa ──────────────────────────────
                EY-177 · por debajo de 768 el carrito NO se esconde en el menú
                lateral: es el único punto de la cabecera que dice cuántas
                mentorías llevas apuntadas, y detrás de la hamburguesa no lo
                diría hasta abrirla. Sigue habiendo DOS `CartBadge` a propósito,
                con visibilidades excluyentes (`hidden md:inline-flex` arriba y
                `md:hidden` aquí): a 390 el grupo de acciones es la tercera fila
                y el contador tiene que verse en la primera.

                La hamburguesa pasa de `md:hidden` a `lg:hidden`: AU01 y AL02
                tablet la pintan CONVIVIENDO con los CTA y con la píldora del
                avatar a 768, que es justo donde el repo la escondía. */}
            <div className="order-2 flex items-center gap-1 md:order-3 lg:hidden">
              {admin ? null : (
                <span className="md:hidden">
                  <CartBadge initial={cartCount} />
                </span>
              )}

              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Abrir menú">
                    <MenuIcon />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72">
                  <SheetHeader>
                    <SheetTitle className="text-brand">Enséñame ya</SheetTitle>
                  </SheetHeader>
                  {/* Solo en admin: en el resto de áreas la cabecera ya pinta
                      su propio buscador a 390 y a 768, y dos cajas de búsqueda a
                      40 px una de otra sobran. En admin no hay ninguna (R3), y
                      ésta es la única forma de buscar en el sitio público desde
                      el panel. */}
                  {admin ? <SearchBox className="px-4" /> : null}
                  <nav className="flex flex-col gap-1 px-4">
                    {/* Sin "Panel" duplicado: abajo ya van el switch y "Mi panel". */}
                    {navGroups.flatMap((group) => group.links).map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={closeMenu}
                        className="rounded-md px-2 py-2 text-sm hover:bg-muted"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </nav>
                  {/*
                    ⚠️ CON SESIÓN, AQUÍ NO VA NADA DE LA CUENTA. Y no es un
                    olvido: hasta el 9-sep este cajón repetía el switch
                    Aprender/Enseñar, «Mi panel», «Mi cuenta» y «Cerrar sesión»
                    —los mismos cuatro que ya están en el menú del avatar, a
                    dos dedos de distancia en la misma cabecera—. Jose lo
                    señaló mirando las dos capturas juntas: «que salga en los
                    dos lados es redundante».

                    El reparto que queda, y la regla para lo que venga:

                      · La hamburguesa es el SITIO — lo que puede ver
                        cualquiera: explorar, categorías, quiénes somos.
                      · El avatar es lo MÍO — quién soy, en qué panel estoy,
                        mi cuenta y salir.
                      · La fila de la pantalla son las SECCIONES del panel en
                        el que estoy (`app-sidebar.tsx`).

                    Cada destino vive en UN sitio, y cuál es se deduce de la
                    pregunta que se está haciendo el usuario. Sin sesión el
                    avatar no existe, así que los dos CTA de alta sí se quedan
                    aquí: no duplican nada.
                  */}
                  {user ? null : (
                    <div className="mt-2 flex flex-col gap-2 px-4">
                      <Button asChild variant="outline">
                        <Link href="/login">Iniciar sesión</Link>
                      </Button>
                      <Button asChild>
                        <Link href="/signup">Crear cuenta</Link>
                      </Button>
                    </div>
                  )}
                </SheetContent>
              </Sheet>
            </div>
          </>
        )}
      </Container>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </header>
  );
}
