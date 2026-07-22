"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

/** Datos mínimos del usuario que necesita el header (sin tocar la sesión). */
export type HeaderUser = {
  email: string;
  name: string | null;
  /** Panel del usuario según su rol (lo resuelve `toHeaderUser` con pickHome). */
  homeHref: string;
};

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
          className="h-11 w-full rounded-lg bg-secondary pr-3 pl-9 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>
    </form>
  );
}

export function SiteHeader({ user }: { user?: HeaderUser | null }) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/60">
      <Container className="flex h-18 items-center gap-4">
        <Link
          href="/"
          className="shrink-0 text-lg font-bold tracking-tight text-brand"
        >
          Enséñame ya
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {/* Con sesión, "Panel" es la vuelta a casa: sin él solo se llegaba
              por URL o rebuscando en el menú del avatar. */}
          {user ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={user.homeHref}>Panel</Link>
            </Button>
          ) : null}
          {navGroups.map((group) => (
            <DropdownMenu key={group.label}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="font-medium">
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

        <SearchBox className="hidden max-w-xl flex-1 md:block" />

        <div className="ml-auto hidden items-center gap-2 md:flex">
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
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {user.email}
                </DropdownMenuLabel>
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
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Iniciar sesión</Link>
              </Button>
              <Button asChild>
                <Link href="/signup">Crear cuenta</Link>
              </Button>
            </>
          )}
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto md:hidden"
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
              {user ? (
                <Link
                  href={user.homeHref}
                  className="rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
                >
                  Panel
                </Link>
              ) : null}
              {navGroups.flatMap((group) => group.links).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-2 py-2 text-sm hover:bg-muted"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="mt-2 flex flex-col gap-2 px-4">
              {user ? (
                <>
                  <Button asChild variant="outline">
                    <Link href={user.homeHref}>Mi panel</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/account">Mi cuenta</Link>
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
      </Container>
    </header>
  );
}
