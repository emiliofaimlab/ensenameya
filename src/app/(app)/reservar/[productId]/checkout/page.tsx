import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { CheckoutForm } from "./checkout-form";

export const metadata = { title: "Pagar reserva · Enséñame Ya" };

/**
 * US-602 (SCR-AL05) — checkout. Recibe los slots elegidos en US-601. El total lo
 * congela create_booking server-side; aquí solo se muestra para confirmar.
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ slots?: string }>;
}) {
  const { productId } = await params;
  const { slots: slotsParam } = await searchParams;
  await requireUser();

  const product = await getProductDetail(productId);
  if (!product) notFound();

  const slots = (slotsParam ?? "").split(",").filter(Boolean);
  const required =
    product.pricingModel === "per_package" ? (product.packageNumSessions ?? 1) : 1;
  // Selección inválida → de vuelta al picker (evita un checkout inconsistente).
  if (slots.length !== required) redirect(`/reservar/${productId}`);

  const total =
    product.pricingModel === "per_hour"
      ? Math.round((product.priceAmount * (product.sessionDurationMin ?? 60)) / 60)
      : product.priceAmount;

  return (
    <Container>
      <Section className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <PageHeader
          title={`Pagar: ${product.title}`}
          description={`con ${product.tutor.headline ?? "tu tutor"}`}
        />
        <CheckoutForm
          productId={productId}
          slots={slots}
          total={total}
          currency={product.currency}
        />
      </Section>
    </Container>
  );
}
