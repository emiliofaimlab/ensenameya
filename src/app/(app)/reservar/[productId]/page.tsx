import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { priceLabel } from "@/lib/catalog/format";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { SlotPicker } from "./slot-picker";

export const metadata = { title: "Elegir horario · Enséñame Ya" };

/**
 * US-601 (SCR-AL04) — elegir horario. Requiere sesión (alumno). Los slots los
 * calcula la función controlada get_available_slots (reglas − excepciones −
 * ocupados, S-41). El checkout (US-602) recibe los slots elegidos.
 */
export default async function ReservarPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  await requireUser();

  // getProductDetail solo devuelve productos reservables (active + tutor aprobado).
  const product = await getProductDetail(productId);
  if (!product) notFound();

  const supabase = await createClient();
  const { data: slots } = await supabase.rpc("get_available_slots", {
    p_product_id: productId,
  });

  const required =
    product.pricingModel === "per_package" ? (product.packageNumSessions ?? 1) : 1;

  return (
    <Container>
      <Section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <PageHeader
          title={`Reservar: ${product.title}`}
          description={`${priceLabel(product)} · con ${product.tutor.headline ?? "tu tutor"}`}
        />
        <SlotPicker productId={productId} slots={slots ?? []} required={required} />
      </Section>
    </Container>
  );
}
