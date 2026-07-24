import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { TutorShell } from "@/components/layout/tutor-shell";
import { ProductForm } from "../product-form";

export const metadata = { title: "Nueva mentoría · Enséñame Ya" };

/** US-401 (SCR-TU04) — alta de mentoría, dentro del panel del tutor. */
export default async function NewProductPage() {
  const { userId, approvalStatus } = await requireTutorProfile();

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");

  return (
    <TutorShell
      title="Nueva mentoría"
      description="Describe el resultado que ayudas a lograr y define el formato."
      back={{ href: "/tutor/products", label: "Volver a mis mentorías" }}
    >
      <ProductForm
        userId={userId}
        categories={categories ?? []}
        isApproved={approvalStatus === "approved"}
      />
    </TutorShell>
  );
}
