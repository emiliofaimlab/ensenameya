"use client";

import { usePathname } from "next/navigation";

import { AdminFooter } from "@/components/layout/admin-footer";
import { SiteFooter } from "@/components/layout/site-footer";
import { isAdminRoute } from "@/lib/panel";

/**
 * Pie y chat del área autenticada, elegidos por la ruta **en cliente**. El
 * layout que los envuelve no vuelve a renderizarse al navegar, así que decidir
 * allí dejaba el pie del admin colgado en el panel del tutor y viceversa.
 *
 * El chat llega ya renderizado desde el servidor (`ChatLauncher` consulta la
 * BD); aquí solo se decide si se pinta.
 */
export function AppChrome({ chat }: { chat: React.ReactNode }) {
  const admin = isAdminRoute(usePathname());
  return (
    <>
      {/* En admin no: no participa en los hilos (RLS por participantes). */}
      {admin ? null : chat}
      {admin ? <AdminFooter /> : <SiteFooter />}
    </>
  );
}
