import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Nivel del tutor y reparto de cada reserva (N-16). `split_pct` es lo que se
 * lleva el TUTOR (RN-06): el seed de C-09 son 75/85/90, o sea comisiones de
 * 25/15/10. La comisión no se guarda: es el complemento, y calcularla aquí
 * evita que se desincronicen dos números que son el mismo.
 */
export type TutorTier = {
  name: string;
  /** % que se queda el tutor. */
  splitPct: number;
  /** % que se queda la plataforma = 100 − split. */
  commissionPct: number;
};

/**
 * El tier del tutor que llama. Sin migración: `tutor_tiers_select_own`
 * (`20260715170000`) ya deja al tutor leer EL SUYO y el grant de select existe
 * desde entonces; lo que faltaba era enseñárselo.
 *
 * Devuelve `null` si el tutor aún no tiene tier asignado —pasa entre el alta y
 * la aprobación, porque `review_tutor` es quien pone el de por defecto—. En ese
 * caso NO se inventa un 75 %: se calla. Un número de dinero equivocado en
 * pantalla es peor que un hueco (misma razón por la que `create_booking` se
 * para en vez de suponer un split).
 */
export async function tutorTier(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<TutorTier | null> {
  const { data } = await supabase
    .from("tutor_profiles")
    .select("tutor_tiers(name, split_pct)")
    .eq("profile_id", userId)
    .maybeSingle();

  const tier = data?.tutor_tiers;
  if (!tier) return null;

  const splitPct = Number(tier.split_pct);
  return {
    name: tier.name,
    splitPct,
    commissionPct: Math.round((100 - splitPct) * 100) / 100,
  };
}

/** `75` → "75 %" (con espacio duro: la cifra y el signo no se separan de línea). */
export function formatPct(pct: number): string {
  return `${new Intl.NumberFormat("es", { maximumFractionDigits: 2 }).format(pct)} %`;
}
