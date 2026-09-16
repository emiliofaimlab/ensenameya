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
  const { data, error } = await supabase
    .from("tutor_tiers")
    // El count dice cuántos tutores cobran con este tier (RN-06: uno por tutor).
    .select("id, name, split_pct, is_default, description, tutor_profiles(count)")
    .order("split_pct");

  // ⚠️ Se revienta a propósito en vez de pintar la lista vacía. `const { data }`
  // convierte cualquier fallo de esta consulta —y lleva un EMBED, que es lo que
  // se vuelve ambiguo (PGRST201) en cuanto alguien mete una tabla puente entre
  // `tutor_tiers` y `tutor_profiles`— en «0 tiers configurados»: una frase
  // creíble y falsa, que es el peor tipo de mentira (regla de oro 10, y el
  // precedente literal está en `admin/tutores/page.tsx`). Aquí lo creíble hace
  // daño: el admin que lee «0 tiers» crea uno nuevo y se come el 23505 del
  // índice de «un solo tier por defecto» sin entender de dónde sale.
  if (error) {
    throw new Error(`No se pudo leer la configuración de tiers: ${error.message}`);
  }

  const tiers: TierRow[] = (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    splitPct: Number(t.split_pct),
    isDefault: t.is_default,
    description: t.description,
    tutorCount: t.tutor_profiles?.[0]?.count ?? 0,
  }));

  // Ya vienen ordenados por `split_pct`, así que la lista sale de menor a mayor
  // sola. La comisión se redondea igual que en la fila (`tier-manager.tsx`):
  // 100 − 75.5 son 24.499999999999996 en coma flotante.
  const splits = tiers.map((t) => t.splitPct);
  const comisiones = splits.map((s) => Math.round((100 - s) * 100) / 100);

  return (
    <AdminShell
      title="Comisión / Tiers"
      description="Split del tutor por tier. Los cambios aplican solo a reservas nuevas (S-08)."
    >
      {/* Nota del seed (226:54): los tiers reales y su criterio de ascenso.
          Los porcentajes SE CALCULAN de `tiers`. Escritos a mano decían
          75 / 85 / 90 mientras la lista de justo debajo pintaba 80 / 85 / 90:
          este aviso caduca solo cada vez que un admin edita un split, y quien
          lo lee no tiene forma de saber cuál de los dos números es el bueno.
          Sin tiers no hay nada que resumir, así que la nota no se pinta. */}
      {tiers.length > 0 ? (
        <div className="flex gap-3 rounded-[16px] border border-[#b2d9ff] bg-[#e5f2ff] p-5">
          <p className="text-[12.5px] text-[#405980]">
            C-09 · Split de tutor {splits.join(" / ")} % (comisión{" "}
            {comisiones.join(" / ")} %). Los tutores nuevos entran al tier por
            defecto. Nombres y criterios de ascenso: DP-09.
          </p>
        </div>
      ) : null}

      <TierManager tiers={tiers} />
    </AdminShell>
  );
}
