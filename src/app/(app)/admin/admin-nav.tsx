"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Nav del panel admin. Nace con 2 secciones (US-1101 / US-1102); las de
 * US-1104/1105 se añaden a esta lista.
 * ponytail: enlaces planos, sin layout compartido ni estado — el panel tiene
 * dos páginas. Si crece a media docena, entonces sí un layout.
 */
const LINKS = [
  { href: "/admin", label: "Tutores" },
  { href: "/admin/categorias", label: "Categorías" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b pb-2">
      {LINKS.map((l) => {
        // "/admin" solo está activo en la ruta exacta; el resto acepta subrutas
        // (p. ej. /admin/tutores/[id] mantiene "Tutores" marcado).
        const active =
          l.href === "/admin"
            ? pathname === "/admin" || pathname.startsWith("/admin/tutores")
            : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
