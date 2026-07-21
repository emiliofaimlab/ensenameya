import Link from "next/link";

import { Container } from "@/components/layout/container";

/** Columnas de v3-footer. Los enlaces sin página propia todavía dan 404 (ver docs/BACKLOG.md §4.2). */
const columns = [
  {
    title: "PRODUCTO",
    links: [
      { href: "/tutors", label: "Explorar tutores" },
      { href: "/classes", label: "Explorar clases" },
      { href: "/categories", label: "Categorías" },
    ],
  },
  {
    title: "EMPRESA",
    links: [
      { href: "/about", label: "Sobre nosotros" },
      { href: "/how-it-works", label: "¿Cómo funciona?" },
    ],
  },
  {
    title: "LEGAL",
    links: [
      { href: "/terms", label: "Términos" },
      { href: "/privacy", label: "Privacidad" },
      { href: "/cookies", label: "Cookies" },
    ],
  },
];

const social = [
  { href: "https://instagram.com/ensenameya", label: "Instagram" },
  { href: "https://linkedin.com/company/ensenameya", label: "LinkedIn" },
  { href: "https://x.com/ensenameya", label: "X" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-muted/60">
      <Container className="py-10">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <p className="text-lg font-bold tracking-tight text-brand">
              Enséñame ya
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Aprende en vivo, 1 a 1. El tutor vende el resultado, no el
              proceso.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((column) => (
              <nav key={column.title} aria-label={column.title}>
                <p className="text-xs font-semibold tracking-wide text-brand">
                  {column.title}
                </p>
                <ul className="mt-3 space-y-2">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm transition-colors hover:text-brand"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <hr className="mt-8 border-t border-primary" />

        <div className="flex flex-col gap-2 pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Enséñame Ya</p>
          <nav className="flex gap-4" aria-label="Redes sociales">
            {social.map((item) => (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-brand"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </Container>
    </footer>
  );
}
