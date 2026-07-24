import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import { PanelShell } from "@/components/layout/panel-shell";

/**
 * Shell de las pantallas de admin (AD02…AD15): el armazón del panel del Figma
 * con el menú del admin y la cabecera título 24/700 + subtítulo + acción.
 */
export function AdminShell({
  title,
  description,
  breadcrumb,
  actions,
  children,
}: {
  title: string;
  description?: string;
  /** "Tutores / Detalle" (214:45): miga de pan sobre el título. */
  breadcrumb?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PanelShell items={ADMIN_ITEMS}>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          {breadcrumb ? (
            <p className="text-xs text-[#6b6b6b]">{breadcrumb}</p>
          ) : null}
          <h1 className="text-[24px] font-bold tracking-tight text-[#19191f]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-[13px] text-[#6b6b6b]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="ml-auto">{actions}</div> : null}
      </div>

      {children}
    </PanelShell>
  );
}
