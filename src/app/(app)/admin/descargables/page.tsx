import { getUserTimezone, requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/layout/admin-shell";
import { PanelCard } from "@/components/layout/panel-shell";
import { LeadsTable, type Lead } from "@/components/descargables/leads-table";

export const metadata = { title: "Leads de descargables · Enséñame Ya" };

/**
 * EY-248 · Todos los contactos que dejaron los descargables de los tutores.
 * Los lee el admin por `tutor_download_leads_select` (`has_role('admin')`).
 */
export default async function AdminDescargablesPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [{ data, error }, tz] = await Promise.all([
    supabase
      .from("tutor_download_leads")
      .select(
        // FK nombrada por la regla de oro 10, aunque hoy haya un solo camino.
        "id, name, email, created_at, tutor_downloads(title, tutor_profiles!tutor_downloads_tutor_id_fkey(display_name))",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
    getUserTimezone(),
  ]);
  // Una lista vacía por un error es una mentira creíble: se revienta.
  if (error) throw error;

  const fmt = new Intl.DateTimeFormat("es", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  const filas: Lead[] = (data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    email: l.email,
    documento: l.tutor_downloads?.title ?? "—",
    tutor: l.tutor_downloads?.tutor_profiles?.display_name ?? "—",
    creado: l.created_at,
    cuando: fmt.format(new Date(l.created_at)),
  }));

  return (
    <AdminShell
      title="Leads de descargables"
      description="Quién descargó los PDFs que los tutores publican en su perfil. Los últimos 1000."
    >
      <PanelCard>
        <LeadsTable leads={filas} conTutor />
      </PanelCard>
    </AdminShell>
  );
}
