import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/auth/server";
import { TutorShell } from "@/components/layout/tutor-shell";
import { ProductForm } from "../product-form";

export const metadata = { title: "Nueva mentoría · Enséñame Ya" };

/** US-401 (SCR-TU04) — alta de mentoría, dentro del panel del tutor. */
export default async function NewProductPage() {
  const { userId, approvalStatus } = await requireTutorProfile();

  const supabase = await createClient();
  // N-04 · las franjas del tutor viajan con el formulario para poder elegir
  // cuáles usa la mentoría. Se piden aunque no haya ninguna: el propio selector
  // convierte «no hay» en el aviso de que sin horarios nadie puede reservar.
  const [{ data: categories }, { data: rules }, { data: perfil }, tz] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("availability_rules")
      .select("id, weekday, start_time, end_time, is_active")
      .eq("tutor_id", userId)
      .order("weekday")
      .order("start_time"),
    // G1 · RG-18: el tipo «Clase grupal» solo aparece con el interruptor.
    supabase
      .from("tutor_profiles")
      .select("group_classes_enabled")
      .eq("profile_id", userId)
      .maybeSingle(),
    getUserTimezone(),
  ]);

  return (
    <TutorShell
      userId={userId}
      title="Nueva mentoría"
      description="Describe el resultado que ayudas a lograr y define el formato."
      back={{ href: "/tutor/products", label: "Volver a mis mentorías" }}
    >
      <ProductForm
        userId={userId}
        categories={categories ?? []}
        availabilityRules={rules ?? []}
        isApproved={approvalStatus === "approved"}
        groupClassesEnabled={perfil?.group_classes_enabled ?? false}
        timezone={tz}
      />
    </TutorShell>
  );
}
