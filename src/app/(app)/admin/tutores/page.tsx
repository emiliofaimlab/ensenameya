import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Tutores · Enséñame Ya" };

type Approval = Database["public"]["Enums"]["tutor_approval_status"];

/** Chips del Figma (213:51): Por aprobar / Aprobados / Suspendidos. */
const FILTERS: { id: string; label: string; statuses: Approval[] }[] = [
  { id: "por-aprobar", label: "Por aprobar", statuses: ["pending"] },
  { id: "aprobados", label: "Aprobados", statuses: ["approved"] },
  { id: "suspendidos", label: "Suspendidos", statuses: ["suspended", "rejected"] },
];

const APPROVAL_PILL: Record<Approval, { label: string; tone: PillTone }> = {
  pending: { label: "Por aprobar", tone: "amber" },
  approved: { label: "Aprobado", tone: "green" },
  rejected: { label: "Rechazado", tone: "red" },
  suspended: { label: "Suspendido", tone: "red" },
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * US-1101 (SCR-AD03/AD04) — tutores por aprobar y aprobados, misma vista con
 * chips. Lee por RLS con la sesión del admin; el `service_role` no aparece.
 */
export default async function AdminTutoresPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  await requireRole("admin");
  const { f } = await searchParams;
  const filter = FILTERS.find((x) => x.id === f) ?? FILTERS[0];

  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select(
      "profile_id, headline, approval_status, identity_verification_status, created_at, profiles(full_name)",
    )
    .order("created_at", { ascending: true }); // los que más llevan esperando, primero

  const tutors = data ?? [];

  // Categorías en consulta aparte: `tutor_categories.tutor_id` apunta a
  // `profiles`, no a `tutor_profiles`, así que el embed directo no existe.
  const { data: catRows } = await supabase
    .from("tutor_categories")
    .select("tutor_id, categories(name)")
    .in("tutor_id", tutors.map((t) => t.profile_id));
  const catsByTutor = new Map<string, string[]>();
  for (const r of catRows ?? []) {
    if (!r.categories?.name) continue;
    const list = catsByTutor.get(r.tutor_id) ?? [];
    list.push(r.categories.name);
    catsByTutor.set(r.tutor_id, list);
  }
  const counts = Object.fromEntries(
    FILTERS.map((x) => [
      x.id,
      tutors.filter((t) => x.statuses.includes(t.approval_status)).length,
    ]),
  );
  const visible = tutors.filter((t) =>
    filter.statuses.includes(t.approval_status),
  );

  return (
    <AdminShell
      title="Tutores"
      description="Por aprobar y aprobados (misma vista, AD03/AD04)."
    >
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((x) => {
          const on = x.id === filter.id;
          return (
            <Link
              key={x.id}
              href={
                x.id === "por-aprobar"
                  ? "/admin/tutores"
                  : `/admin/tutores?f=${x.id}`
              }
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
                on
                  ? "border-brand bg-brand font-semibold text-white"
                  : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
              )}
            >
              {x.label} ({counts[x.id]})
            </Link>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            No hay tutores en este filtro.
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {visible.map((t) => {
              const pill = APPROVAL_PILL[t.approval_status];
              const cats = (catsByTutor.get(t.profile_id) ?? []).join(" · ");
              return (
                <li
                  key={t.profile_id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 sm:w-72">
                    <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                      {t.profiles?.full_name ?? "Tutor sin nombre"}
                    </p>
                    <p className="truncate text-xs text-[#6b6b6b]">
                      {cats || t.headline || "Sin categorías"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11.5px] text-[#6b6b6b]">Solicitud</p>
                    <p className="text-[13px] font-medium text-[#404040]">
                      {fmtDate(t.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill tone={pill.tone} className="h-7">
                      {pill.label}
                    </StatusPill>
                    <Button
                      asChild
                      variant="outline"
                      className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                    >
                      <Link href={`/admin/tutores/${t.profile_id}`}>Ver</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </PanelCard>
      )}
    </AdminShell>
  );
}
