import { requireRole } from "@/lib/auth/server";
import { AdminShell } from "@/components/layout/admin-shell";
import { PanelCard } from "@/components/layout/panel-shell";
import { FormularioAcademia, VACIA } from "../formulario-academia";

export const metadata = { title: "Crear academia · Admin · Enséñame Ya" };

/** A2 · RA-01: solo el admin de EY crea academias. Nace en borrador. */
export default async function NuevaAcademiaPage() {
  await requireRole("admin");
  return (
    <AdminShell eyebrow="Academias" title="Crear academia" description="Nace en borrador. Al nombrar a su administrador pasa a activa.">
      <PanelCard>
        <FormularioAcademia id={null} inicial={VACIA} />
      </PanelCard>
    </AdminShell>
  );
}
