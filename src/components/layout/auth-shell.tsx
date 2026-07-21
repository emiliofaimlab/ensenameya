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
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center bg-muted px-4 py-12">
        <div className={cn("w-full max-w-[440px]", className)}>{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
