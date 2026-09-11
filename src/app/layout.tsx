import type { Metadata } from "next";
import { Poppins, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { DropdownDismiss } from "@/components/layout/dropdown-dismiss";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { TimezoneSync } from "@/components/layout/timezone-sync";
import { RedAntiBlanco } from "@/components/layout/red-anti-blanco";
import { ProveedorDeMoneda } from "@/components/precio/precio";
import { monedaDelVisitante } from "@/lib/fx";
import { siteUrl } from "@/lib/site-url";

// Única familia del diseño: Poppins en los 4 pesos que usan las 3.691 capas de texto del Figma.
const poppins = Poppins({
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // §5.6 · Base contra la que Next resuelve las URL RELATIVAS de los metadatos
  // (`alternates.canonical`, `openGraph.url`, `openGraph.images`) que declaran las
  // fichas públicas. Sin ella se resuelven contra `http://localhost:3000`.
  metadataBase: new URL(siteUrl()),
  title: "Enséñame Ya",
  description: "Marketplace de mentorías 1:1 en vivo entre alumnos y tutores.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // La moneda en la que se pintan los precios (11-sep-2026). Se resuelve AQUÍ y
  // no en cada grupo de rutas porque el dinero sale en los cuatro —catálogo,
  // panel, carrito y checkout— y hilarlo por props serían cuatro sitios que se
  // desincronizan. El coste real es una lectura de cabecera: la tabla de tasas
  // va por `fetch` con `revalidate: 3600`, compartida entre peticiones, y
  // `cache()` la deduplica dentro de cada una. `null` = se pinta el USD a
  // secas, que es lo que se pintaba antes de este cambio.
  const moneda = await monedaDelVisitante();
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* ponytail: tema forzado a claro — el diseño no tiene modo oscuro. Se mantiene el
            provider porque sonner lee useTheme(). Quitar forcedTheme cuando exista el modo. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          forcedTheme="light"
          disableTransitionOnChange
        >
          <ProveedorDeMoneda valor={moneda}>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </ProveedorDeMoneda>
          {/* RV-03 · Deja la zona del navegador en la cookie `ey-tz` para que el
              servidor pinte los horarios en la hora de quien mira (R24-22).
              Vive AQUÍ y no en el layout público —donde estaba— porque las
              pantallas con horarios que más importan están en `(app)`:
              /reservas, /reservas/[id] y los dos onboardings. Montado solo en lo
              público, quien iniciaba sesión y entraba directo a su panel no
              dejaba nunca la cookie, y el servidor caía a UTC. */}
          <TimezoneSync />
          {/* Último recurso: si una navegación deja el árbol vacío, recarga
              entera. Ver el porqué en el propio componente. */}
          <RedAntiBlanco />
          <DropdownDismiss />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
