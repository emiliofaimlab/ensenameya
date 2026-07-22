import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/layout/admin-shell";
import { TierManager, type TierRow } from "./tier-manager";

export const metadata = { title: "Comisión y tiers · Enséñame Ya" };

/**
 * US-1103 (SCR-AD12) — tiers y split de comisión (RN-06/07).
 * Escritura por RLS (`tutor_tiers_*_admin`): no mueve dinero, solo configura
 * el número que `create_booking` congelará en la próxima reserva.
 * S-08 (no retroactivo) es gratis: `bookings`/`payments` guardan su propio
 * `tier_split_pct`, así que ninguna reserva pasada consulta esta tabla.
 */
export default async function AdminTiersPage() {
  await requireRole("admin");

  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_tiers")
    // El count dice cuántos tutores cobran con este tier (RN-06: uno por tutor).
    .select("id, name, split_pct, is_default, description, tutor_profiles(count)")
    .order("split_pct");

  const tiers: TierRow[] = (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    splitPct: Number(t.split_pct),
    isDefault: t.is_default,
    description: t.description,
    tutorCount: t.tutor_profiles?.[0]?.count ?? 0,
  }));

  return (
    <AdminShell
          title="Comisión y tiers"
          description="El split es el % que se lleva el tutor; el resto es comisión de la plataforma."
    >
        <TierManager tiers={tiers} />
    </AdminShell>
  );
}
