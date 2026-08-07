import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { detachCard, isStripeConfigured } from "@/lib/stripe";

/**
 * PAC-02 · quitar una tarjeta guardada.
 *
 * Comprueba que el `payment_method` pertenece AL CUSTOMER DE QUIEN LLAMA antes
 * de desvincularlo. Sin esa comprobación, un id de tarjeta ajeno —que es solo
 * una cadena `pm_…`— bastaría para borrarle el medio de pago a otra persona.
 * La RLS aquí no protege nada: el dato vive en Stripe, así que la comprobación
 * la tenemos que hacer nosotros.
 */
export async function DELETE(req: Request) {
  const { paymentMethodId } = (await req.json().catch(() => ({}))) as {
    paymentMethodId?: string;
  };
  if (!paymentMethodId) {
    return NextResponse.json({ error: "falta paymentMethodId" }, { status: 400 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const admin = createAdminClient();
  const { data: perfil } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil?.stripe_customer_id) {
    return NextResponse.json({ error: "sin tarjetas" }, { status: 404 });
  }

  // La pertenencia se comprueba contra Stripe, que es la fuente de verdad.
  const { listSavedCards } = await import("@/lib/stripe");
  const propias = await listSavedCards(perfil.stripe_customer_id);
  if (!propias.some((c) => c.id === paymentMethodId)) {
    // Mismo criterio que la RLS: si no es tuya, no existe.
    return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  }

  await detachCard(paymentMethodId);
  return NextResponse.json({ status: "ok" });
}
