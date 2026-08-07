import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { bookingTotal, tutorNames } from "@/lib/booking";
import { PanelShell } from "@/components/layout/panel-shell";
import { activeChargeProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured, listSavedCards } from "@/lib/stripe";
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
  const { user } = await requireUser();

  const product = await getProductDetail(productId);
  if (!product) notFound();

  const slots = (slotsParam ?? "").split(",").filter(Boolean);
  const required =
    product.pricingModel === "per_package" ? (product.packageNumSessions ?? 1) : 1;
  // Selección inválida → de vuelta al picker (evita un checkout inconsistente).
  if (slots.length !== required) redirect(`/reservar/${productId}`);

  const supabase = await createClient();
  const names = await tutorNames(supabase, [product.tutor.id]);
  // La pantalla tiene que decir la verdad ANTES de que el alumno pulse.
  const simulado = (await activeChargeProvider()) === "simulated";

  // La tarjeta ilustrada tiene que enseñar la de verdad o ninguna. Antes era un
  // adorno del Figma con un `4821` escrito a mano, y parecía una tarjeta
  // guardada que no existía —seguía ahí después de guardar una de verdad—.
  const { data: perfilPago } = await createAdminClient()
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const tarjetas =
    !simulado && isStripeConfigured() && perfilPago?.stripe_customer_id
      ? await listSavedCards(perfilPago.stripe_customer_id)
      : [];
  const tutorName =
    names.get(product.tutor.id) ?? product.tutor.headline ?? "tu tutor";

  return (
    <PanelShell back={{ href: `/reservar/${productId}`, label: "Cambiar horario" }}>
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          Confirmar pago
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Revisa y completa el pago de tu reserva. El cobro lo procesa nuestro
          proveedor de pagos.
        </p>
      </div>

      <CheckoutForm
        simulado={simulado}
        tarjetas={tarjetas}
        productId={productId}
        slots={slots}
        total={bookingTotal(product)}
        currency={product.currency}
        productTitle={product.title}
        tutorName={tutorName}
        packageLabel={
          required > 1 ? `Paquete ${required} sesiones` : "Sesión suelta"
        }
      />
    </PanelShell>
  );
}
