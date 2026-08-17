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
  const [{ data: product }, { data: categories }, { data: materials }] =
    await Promise.all([
      supabase
        .from("products")
        .select(
          "id, title, description, outcome, pricing_model, price_amount, session_duration_min, package_num_sessions, image_path, faqs, level, language, product_categories(category_id)",
        )
        .eq("id", id)
        .eq("tutor_id", userId)
        .maybeSingle(),
      supabase
        .from("categories")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order"),
      // Materiales de ESTA oferta (R24-16). `storage_path` va en el select
      // porque quitar un material tiene que borrar TAMBIÉN el objeto del
      // bucket: sin la ruta, la fila desaparecía y el archivo se quedaba
      // ocupando cuota en un bucket privado para siempre.
      supabase
        .from("tutor_materials")
        .select("id, file_name, size_bytes, storage_path")
        .eq("product_id", id)
        .order("created_at"),
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
        materials={materials ?? []}
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
          level: product.level,
          language: product.language,
          categoryIds: (product.product_categories ?? []).map(
            (pc) => pc.category_id,
          ),
          imagePath: product.image_path,
          // jsonb → lista tipada; se ignora lo que no tenga forma {q,a}.
          faqs: Array.isArray(product.faqs)
            ? (product.faqs as { q?: unknown; a?: unknown }[])
                .filter((f) => typeof f?.q === "string" && typeof f?.a === "string")
                .map((f) => ({ q: f.q as string, a: f.a as string }))
            : [],
        }}
      />
    </TutorShell>
  );
}
