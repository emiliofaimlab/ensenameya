"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDownIcon,
  LogOutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
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
import { cn } from "@/lib/utils";

/** Datos mínimos del usuario que necesita el header (sin tocar la sesión). */
export type HeaderUser = {
  email: string;
  name: string | null;
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
 */
function PanelSwitch({
  panels,
  pathname,
  onNavigate,
}: {
  panels: HeaderUser["panels"];
  pathname: string;
  onNavigate?: () => void;
}) {
  if (panels.length < 2) return null;

  // Fuera de un panel (explorar, /account…) se marca "Aprender" (el primero):
  // navegar lo público ES el modo aprender, y un switch sin selección parece
  // roto (24-jul).
  const activeHref =
    panels.find(
      (p) => pathname === p.href || pathname.startsWith(`${p.href}/`),
    )?.href ?? panels[0].href;

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
      { href: "/classes", label: "Explorar clases" },
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

function initials(user: HeaderUser): string {
  const base = user.name?.trim() || user.email;
  return base.slice(0, 2).toUpperCase();
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
  onboarding = false,
  admin = false,
}: {
  user?: HeaderUser | null;
  /**
   * Modo onboarding (AL01 180:1282 / TU01): sin "Panel" ni menú de cuenta, con
   * "Guardar y salir" a la derecha. Durante el asistente el resto del área
   * autenticada está cerrada (`requireUser` rebota), así que enseñar el panel
   * sería un enlace a ninguna parte.
   */
  onboarding?: boolean;
  /**
   * Modo admin (AD02 218:1725): logo + píldora negra "Admin", sin la
   * navegación pública. El "Buscar en el panel…" del Figma no se pinta: no
   * hay búsqueda global del panel a la que conectarlo.
   */
  admin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // El sheet no se cierra solo al navegar (Next navega en cliente, el diálogo
  // no se entera). Se nota sobre todo en el switch de panel: cambias de panel y
  // el menú te tapa el resultado.
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/60">
      <Container className="flex h-18 items-center gap-4">
        {/* Izquierda y derecha comparten `flex-1`, así el buscador queda
            EXACTAMENTE centrado en la barra —como en el Figma (v3-header: el
            buscador cae sobre el centro)— en vez de pegarse a la navegación y
            dejar un hueco enorme a su derecha al ensanchar el sitio (R24-01). */}
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Link
            href="/"
            className="shrink-0 text-lg font-bold tracking-tight text-brand"
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
            barra era ruido (24-jul). */}
          <nav className="hidden items-center gap-1 md:flex">
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

        {/* Columna central: ancho fijo del Figma (558) y centrada por los dos
            `flex-1` de los lados. En admin no hay buscador. */}
        {admin ? null : (
          <SearchAutocomplete className="hidden w-full max-w-[558px] shrink-0 md:block" />
        )}

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {onboarding ? (
          /* El borrador se guarda al avanzar de paso, así que "salir" es solo
             salir. Lleva a la home pública: el área autenticada sigue cerrada
             hasta terminar el asistente. */
          <Link
            href="/"
            className="shrink-0 text-[12.5px] text-[#6b6b6b] transition-colors hover:text-foreground"
          >
            Guardar y salir
          </Link>
        ) : (
          <>
        <div className="hidden items-center gap-2 md:flex">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label="Abrir menú de cuenta"
                >
                  <Avatar className="size-8">
                    <AvatarFallback>{initials(user)}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              {/* w-72: con tres paneles (admin) ni w-56 ni w-64 daban — en w-64
                  "Aprender" se recortaba dentro de su celda. */}
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {user.email}
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
                <DropdownMenuItem onSelect={signOut}>
                  <LogOutIcon />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="h-9 text-sm">
                <Link href="/login">Iniciar sesión</Link>
              </Button>
              {/* El Figma pinta este botón en 600, no en el 500 del resto. */}
              <Button asChild className="h-10 px-4 text-sm font-semibold">
                <Link href="/signup">Crear cuenta</Link>
              </Button>
            </>
          )}
        </div>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Abrir menú"
            >
              <MenuIcon />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle className="text-brand">Enséñame ya</SheetTitle>
            </SheetHeader>
            <SearchBox className="px-4" />
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
            <div className="mt-2 flex flex-col gap-2 px-4">
              {user ? (
                <>
                  <PanelSwitch
                    panels={user.panels}
                    pathname={pathname}
                    onNavigate={closeMenu}
                  />
                  <Button asChild variant="outline">
                    <Link href={user.homeHref} onClick={closeMenu}>
                      Mi panel
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/account" onClick={closeMenu}>
                      Mi cuenta
                    </Link>
                  </Button>
                  <Button variant="ghost" onClick={signOut}>
                    Cerrar sesión
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild variant="outline">
                    <Link href="/login">Iniciar sesión</Link>
                  </Button>
                  <Button asChild>
                    <Link href="/signup">Crear cuenta</Link>
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
          </>
        )}
        </div>
      </Container>
    </header>
  );
}
