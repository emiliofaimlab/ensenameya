import Link from "next/link";

import { Container } from "@/components/layout/container";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <Container className="flex flex-col gap-2 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Enséñame Ya</p>
        <nav className="flex gap-4">
          <Link href="/about" className="transition-colors hover:text-foreground">
            Sobre nosotros
          </Link>
          <Link
            href="/how-it-works"
            className="transition-colors hover:text-foreground"
          >
            Cómo funciona
          </Link>
        </nav>
      </Container>
    </footer>
  );
}
