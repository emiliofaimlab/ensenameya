import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import { PanelShell } from "@/components/layout/panel-shell";

/**
 * Shell de las pantallas del tutor (TU02…TU09): el armazón del panel del
 * Figma (menú 232, contenido 1200, fondo `#f9fafc`) con el menú del tutor y
 * la cabecera título 24/700 + subtítulo + acción a la derecha (191:39).
 */
export function TutorShell({
  title,
  description,
  actions,
  back,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <PanelShell items={TUTOR_ITEMS} back={back}>
      <div className="flex flex-wrap items-start gap-3">
        <div>
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
