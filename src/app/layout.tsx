import type { Metadata } from "next";
import { Poppins, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { DropdownDismiss } from "@/components/layout/dropdown-dismiss";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { TimezoneSync } from "@/components/layout/timezone-sync";

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
  title: "Enséñame Ya",
  description: "Marketplace de mentorías 1:1 en vivo entre alumnos y tutores.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          {/* RV-03 · Deja la zona del navegador en la cookie `ey-tz` para que el
              servidor pinte los horarios en la hora de quien mira (R24-22).
              Vive AQUÍ y no en el layout público —donde estaba— porque las
              pantallas con horarios que más importan están en `(app)`:
              /reservas, /reservas/[id] y los dos onboardings. Montado solo en lo
              público, quien iniciaba sesión y entraba directo a su panel no
              dejaba nunca la cookie, y el servidor caía a UTC. */}
          <TimezoneSync />
          <DropdownDismiss />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
