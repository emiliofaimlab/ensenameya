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
  const [
    { data: product },
    { data: categories },
    { data: materials },
    { data: rules },
    { data: ruleLinks },
  ] = await Promise.all([
      supabase
        .from("products")
        .select(
          "id, title, description, outcome, pricing_model, price_amount, session_duration_min, package_num_sessions, image_path, faqs, level, language, auto_accept_bookings, product_categories(category_id)",
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
      // N-04 · franjas del tutor + las que YA usa esta mentoría. Son dos
      // consultas y no un embed sobre `products` a propósito: `products` es el
      // select del que cuelga toda la pantalla y no conviene arrastrarlo a una
      // relación nueva. Si la segunda falla, el formulario abre en «toda mi
      // disponibilidad» — que es exactamente lo que significa no tener filas.
      supabase
        .from("availability_rules")
        .select("id, weekday, start_time, end_time, is_active")
        .eq("tutor_id", userId)
        .order("weekday")
        .order("start_time"),
      supabase
        .from("product_availability_rules")
        .select("rule_id")
        .eq("product_id", id),
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
        availabilityRules={rules ?? []}
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
          availabilityRuleIds: (ruleLinks ?? []).map((l) => l.rule_id),
          // M-02 · la columna es `not null`, así que esto no puede ser nulo; el
          // `??` es para el día que alguien quite el campo del `select` de
          // arriba y no para un dato ausente de verdad.
          autoAccept: product.auto_accept_bookings ?? true,
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
