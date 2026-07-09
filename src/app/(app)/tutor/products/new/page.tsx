import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "../product-form";

export const metadata = { title: "Nuevo producto · Enséñame Ya" };

/** US-401 — alta de producto (guarda como borrador). */
export default async function NewProductPage() {
  const { userId } = await requireTutorProfile();

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");

  return (
    <Container>
      <Section className="mx-auto flex w-full max-w-lg flex-col">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Nuevo producto</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductForm userId={userId} categories={categories ?? []} />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}
