import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/auth/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
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
    <div className="bg-muted">
      <Container>
        <Section className="flex flex-col gap-6">
          <Link
            href={`/reservar/${productId}`}
            className="flex w-fit items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <ArrowLeftIcon className="size-4" />
            Cambiar horario
          </Link>

          <div>
            <h1 className="text-[28px] font-bold tracking-tight">
              Confirmar pago
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Revisa y completa el pago de tu reserva. El cobro lo procesa
              nuestro proveedor de pagos.
            </p>
          </div>

          <CheckoutForm
            productId={productId}
            slots={slots}
            total={total}
            currency={product.currency}
            productTitle={product.title}
            tutorName={product.tutor.headline ?? "tu tutor"}
          />
        </Section>
      </Container>
    </div>
  );
}
