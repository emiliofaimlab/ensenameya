import { notFound } from "next/navigation";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { TutorShell } from "@/components/layout/tutor-shell";
import { ProductForm } from "../../product-form";

export const metadata = { title: "Editar mentoría · Enséñame Ya" };

/** US-401 — edición de mentoría. RLS limita a los productos del propio tutor. */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, approvalStatus } = await requireTutorProfile();

  const supabase = await createClient();
  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, title, description, outcome, pricing_model, price_amount, session_duration_min, package_num_sessions, image_path, product_categories(category_id)",
      )
      .eq("id", id)
      .eq("tutor_id", userId)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  if (!product) notFound();

  return (
    <TutorShell
      title="Editar mentoría"
      description="Ajusta el resultado, el precio o el formato."
      back={{ href: "/tutor/products", label: "Volver a mis mentorías" }}
    >
      <ProductForm
        userId={userId}
        categories={categories ?? []}
        isApproved={approvalStatus === "approved"}
        product={{
          id: product.id,
          title: product.title,
          description: product.description ?? "",
          outcome: product.outcome ?? "",
          pricingModel: product.pricing_model,
          priceAmount: product.price_amount,
          sessionDurationMin: product.session_duration_min,
          packageNumSessions: product.package_num_sessions,
          categoryIds: (product.product_categories ?? []).map(
            (pc) => pc.category_id,
          ),
          imagePath: product.image_path,
        }}
      />
    </TutorShell>
  );
}
