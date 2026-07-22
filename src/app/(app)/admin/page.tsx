import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/layout/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { APPROVAL_BADGE, IDENTITY_BADGE } from "./badges";

export const metadata = { title: "Panel admin · Enséñame Ya" };

/**
 * US-1101 (SCR-AD03) — cola de revisión de tutores.
 * Lee por RLS con la sesión del admin (`tutor_profiles_select_admin` +
 * `profiles_select_admin`); el `service_role` no aparece por aquí.
 */
export default async function AdminPage() {
  await requireRole("admin");

  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select(
      "profile_id, headline, approval_status, identity_verification_status, created_at, profiles(full_name)",
    )
    .order("created_at", { ascending: true }); // los que más llevan esperando, primero

  const tutors = data ?? [];
  // Pendientes arriba: es la cola de trabajo real del admin.
  const queue = [...tutors].sort(
    (a, z) =>
      Number(z.approval_status === "pending") - Number(a.approval_status === "pending"),
  );

  const pendingCount = tutors.filter((t) => t.approval_status === "pending").length;

  return (
    <AdminShell
          title="Revisión de tutores"
          description={
            pendingCount
              ? `${pendingCount} ${pendingCount === 1 ? "tutor espera" : "tutores esperan"} revisión.`
              : "No hay tutores esperando revisión."
          }
    >

        {queue.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Todavía no hay perfiles de tutor.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {queue.map((t) => {
              const approval = APPROVAL_BADGE[t.approval_status];
              const identity = IDENTITY_BADGE[t.identity_verification_status];
              return (
                <li
                  key={t.profile_id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {t.profiles?.full_name ?? "Tutor sin nombre"}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {t.headline ?? "Sin titular"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant={approval.variant}>{approval.label}</Badge>
                      <Badge variant={identity.variant}>Identidad: {identity.label}</Badge>
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/tutores/${t.profile_id}`}>Revisar</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
    </AdminShell>
  );
}
