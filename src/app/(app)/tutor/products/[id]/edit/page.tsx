import { notFound } from "next/navigation";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "../../product-form";

export const metadata = { title: "Editar producto · Enséñame Ya" };

/** US-401 — edición de producto. RLS limita a los productos del propio tutor. */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await requireTutorProfile();

  const supabase = await createClient();
  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, title, description, outcome, pricing_model, price_amount, session_duration_min, package_num_sessions, product_categories(category_id)",
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
    <Container>
      <Section className="mx-auto flex w-full max-w-lg flex-col">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Editar producto</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductForm
              userId={userId}
              categories={categories ?? []}
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
              }}
            />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
