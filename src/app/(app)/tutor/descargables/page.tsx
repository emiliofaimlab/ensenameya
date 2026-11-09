import { requireTutorProfile } from "@/lib/auth/tutor";
import { getUserTimezone } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PanelCard } from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { LeadsTable, type Lead } from "@/components/descargables/leads-table";
import { DescargablesManager } from "./descargables-manager";

export const metadata = { title: "Descargables · Enséñame Ya" };

/**
 * EY-248 · Los PDFs que el tutor ofrece en su perfil público a cambio de nombre
 * + email, y los contactos que dejaron. `requireTutorProfile` y no el rol, como
 * `/tutor/faqs`: un tutor pendiente puede prepararlos mientras espera; se ven en
 * el perfil cuando está aprobado (lo decide la RLS pública).
 *
 * ⚠️ No confundir con `/tutor/recursos` (EY-222): ese es material que sube el admin.
 */
export default async function TutorDescargablesPage() {
  const { userId, approvalStatus } = await requireTutorProfile();
  const supabase = await createClient();

  const [{ data: docs, error: errorDocs }, { data: leads, error: errorLeads }, tz] = await Promise.all([
    supabase
      .from("tutor_downloads")
      .select("id, title, description, file_name, size_bytes")
      .eq("tutor_id", userId)
      .is("deleted_at", null)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("tutor_download_leads")
      .select("id, name, email, created_at, tutor_downloads(title)")
      .eq("tutor_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    getUserTimezone(),
  ]);
  // Regla de oro 10: una consulta que alimenta una lista mira su `error`.
  if (errorDocs || errorLeads) throw errorDocs ?? errorLeads;

  const fmt = new Intl.DateTimeFormat("es", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  const filas: Lead[] = (leads ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    email: l.email,
    documento: l.tutor_downloads?.title ?? "—",
    creado: l.created_at,
    cuando: fmt.format(new Date(l.created_at)),
  }));

  return (
    <TutorShell
      userId={userId}
      title="Descargables"
      description="Hasta 4 PDFs en tu perfil público. Para descargarlos, el visitante te deja su nombre y correo."
    >
      {approvalStatus !== "approved" ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            Tus documentos aparecerán en tu perfil cuando esté aprobado. Puedes subirlos desde ya.
          </p>
        </PanelCard>
      ) : null}

      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">Tus documentos</h2>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Ofertas, portafolio, guías: lo que quieras que un futuro alumno se lleve.
        </p>
        <div className="mt-4">
          <DescargablesManager userId={userId} items={docs ?? []} />
        </div>
      </PanelCard>

      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">Quién los descargó</h2>
        <div className="mt-4">
          <LeadsTable leads={filas} />
        </div>
      </PanelCard>
    </TutorShell>
  );
}
