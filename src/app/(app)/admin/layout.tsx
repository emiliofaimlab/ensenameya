import { adminSidebarBadges } from "@/lib/admin/sidebar-badges";

/**
 * Mismo motivo y misma forma que `(app)/tutor/layout.tsx`: adelantar los
 * contadores del menú para que no sean el último peldaño del render. Los del
 * admin no dependen del usuario, así que ni siquiera hay que esperar la sesión.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  void adminSidebarBadges().catch(() => {});
  return children;
}
