import Link from "next/link";

import { getFormatoHora, getUserTimezone, requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatSessionTime } from "@/lib/booking";
import { PanelCard, StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";

export const metadata = { title: "Clases grupales · Admin · Enséñame Ya" };

/** Las reservas que ocupan cupo: las mismas que cuenta la ficha de la clase. */
const VIVAS = new Set(["pending_payment", "pending_acceptance", "confirmed", "in_progress"]);

const ESTADO: Record<string, { label: string; tone: PillTone }> = {
  active: { label: "Activa", tone: "green" },
  paused: { label: "Pausada", tone: "amber" },
  draft: { label: "Borrador", tone: "neutral" },
  archived: { label: "Archivada", tone: "gray" },
};

/**
 * P22 · el listado de clases grupales del admin. Hasta hoy a una clase solo se
 * llegaba desde la ficha de su tutor, o sea sabiendo de antemano de quién era.
 * Solo lectura: las acciones (cancelar, sacar a alguien) viven en la ficha de
 * cada clase, `/admin/clases-grupales/[id]`.
 *
 * Con el cliente del admin: sus políticas `*_admin` le dejan leer productos,
 * fechas y reservas de todos. Las FK van nombradas (regla de oro 10).
 *
 * RG-01 (24-oct) · lista las clases NACIDAS (las abre un alumno al elegir
 * hora; `group_template_id` no nulo): son las que tienen fechas, inscritos y
 * dinero. Las plantillas que publica el tutor no tienen nada de eso y se ven
 * en su ficha de tutor como cualquier mentoría. Aquí no se crean ni se editan
 * fechas: solo se miran y se gestionan las clases que ya existen.
 */
export default async function AdminClasesGrupalesPage() {
  await requireRole("admin");
  const [tz, formato] = await Promise.all([getUserTimezone(), getFormatoHora()]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, title, status, capacity, tutor:profiles!products_tutor_id_fkey(full_name), group_classes!group_classes_product_id_fkey(start_at, status), bookings!bookings_product_id_fkey(status)",
    )
    .eq("pricing_model", "group")
    .not("group_template_id", "is", null)
    .order("created_at", { ascending: false });
  // Regla de oro 10: una lectura caída no es «todavía no hay clases».
  if (error) throw error;

  const clases = data ?? [];
  const ahora = new Date().toISOString();

  return (
    <AdminShell
      eyebrow="Clases grupales"
      title="Todas las clases"
      description="Las clases grupales que han abierto los alumnos, la más nueva primero."
    >
      {clases.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">Todavía no hay clases grupales.</p>
        </PanelCard>
      ) : (
        <PanelCard className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-[#6b6b6b]">
              <tr>
                <th className="py-2 pr-3 font-medium">Clase</th>
                <th className="py-2 pr-3 font-medium">Tutor</th>
                <th className="py-2 pr-3 font-medium">Próxima fecha</th>
                <th className="py-2 pr-3 font-medium">Cupos</th>
                <th className="py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e0e0e0]">
              {clases.map((c) => {
                // ISO-8601 UTC ordena bien como texto.
                const proxima =
                  (c.group_classes ?? [])
                    .filter((f) => f.status === "scheduled" && f.start_at >= ahora)
                    .map((f) => f.start_at)
                    .sort()[0] ?? null;
                const vivas = (c.bookings ?? []).filter((b) => VIVAS.has(b.status)).length;
                const estado = ESTADO[c.status] ?? { label: c.status, tone: "neutral" as const };
                return (
                  <tr key={c.id}>
                    <td className="py-2.5 pr-3">
                      <Link
                        href={`/admin/clases-grupales/${c.id}`}
                        className="font-medium text-brand-foreground hover:underline"
                      >
                        {c.title}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">{c.tutor?.full_name ?? "Tutor"}</td>
                    <td className="py-2.5 pr-3 first-letter:uppercase">
                      {proxima ? formatSessionTime(proxima, tz, formato) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {vivas}/{c.capacity ?? 0}
                    </td>
                    <td className="py-2.5">
                      <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PanelCard>
      )}
    </AdminShell>
  );
}
