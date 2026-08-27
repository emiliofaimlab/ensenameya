import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

/**
 * Shell de AU01…AU04: header y footer del sitio con la card centrada sobre el
 * gris de página. Sin `user` en el header — en estas pantallas no hay sesión
 * (o se está creando ahora mismo).
 */
export function AuthShell({
  children,
  // US-1601 · El ancho de la tarjeta va en el **valor por defecto** del prop,
  // no en un `cn("max-w-[440px]", className)`. Con la escala responsive
  // (440 → 460 en tablet → 440 en escritorio) esa mezcla se volvía trampa:
  // `tailwind-merge` trata `md:max-w-*` y `lg:max-w-*` como grupos distintos
  // del `max-w-*` sin prefijo, así que un llamador que pasa `max-w-[420px]`
  // —lo hacen `(recovery)/layout.tsx` y `auth/callback/page.tsx`— solo
  // pisaría la base y se comería un 460 en tablet y un 440 en escritorio que
  // nadie le pidió. Como default, quien trae su ancho lo trae entero.
  className = "max-w-[440px] md:max-w-[460px] lg:max-w-[440px]",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      {/* Del `content` de AU01: `col pad32/20/40/20` a 390 y `col pad56/0/64/0`
          a 768 (ahí la tarjeta de 460 se centra sola, el pad-x da igual).
          `lg:pt-12 lg:pb-12` devuelve el `py-12` del escritorio. El `px-5`
          son los 20 px de aire lateral del contrato a 390 — y a ≥1024 no
          mueve nada, porque la tarjeta va centrada y sobra sitio. */}
      <main className="flex flex-1 items-center justify-center bg-muted px-5 pt-8 pb-10 md:pt-14 md:pb-16 lg:pt-12 lg:pb-12">
        <div className={cn("w-full", className)}>{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
