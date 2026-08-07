import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureCustomer, isStripeConfigured, siteUrl, stripe } from "@/lib/stripe";

/**
 * EP-20 / PAC-01 · abre el checkout alojado de Stripe para una reserva.
 *
 * Recibe una reserva YA creada. `create_booking` sigue llamándose desde el
 * navegador y no se mueve aquí: esa RPC resuelve al alumno con
 * `(select auth.uid())`, así que con `service_role` —que no tiene usuario—
 * fallaría. Además es la que congela el snapshot financiero, y cuanto menos se
 * toque, mejor.
 *
 * EL IMPORTE NO VIENE DEL CLIENTE. Se lee de `payments.gross_amount`, que es lo
 * que `create_booking` congeló al reservar (regla de oro 2). Un checkout que
 * acepta el precio que le manda el navegador es un checkout regalado.
 *
 * Devuelve `{ simulated: true }` cuando el ruteo del pago no es Stripe. Así el
 * interruptor sigue siendo el dato —`payment_routing_rules`— y no un flag
 * repartido por el código: mientras la regla diga `simulated`, el checkout de
 * hoy funciona igual que siempre.
 */
export async function POST(req: Request) {
  const { bookingId } = (await req.json().catch(() => ({}))) as {
    bookingId?: string;
  };
  if (!bookingId) {
    return NextResponse.json({ error: "falta bookingId" }, { status: 400 });
  }

  // Cliente de cookies (ANON + RLS): si la reserva no es tuya, no la ves. La
  // autorización es la RLS, no una comprobación nuestra.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, product_id, products(title)")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) return NextResponse.json({ error: "reserva no encontrada" }, { status: 404 });
  if (booking.status !== "pending_payment") {
    // Ya pagada, ya cancelada o ya aceptada: no se abre un cobro nuevo.
    return NextResponse.json(
      { error: `la reserva está en ${booking.status}` },
      { status: 409 },
    );
  }

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("id, provider, gross_amount, currency")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (!payment) {
    return NextResponse.json({ error: "sin pago asociado" }, { status: 500 });
  }

  // El ruteo manda. Mientras la regla siga en 'simulated', el camino de hoy.
  if (payment.provider !== "stripe") {
    return NextResponse.json({ simulated: true });
  }
  if (!isStripeConfigured()) {
    // Ruteado a Stripe pero sin clave: es un error de configuración y se dice.
    // Caer al simulado aquí sería regalar clases (mismo criterio que Daily).
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 503 });
  }

  const { data: perfil } = await admin
    .from("profiles")
    .select("full_name, stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const customer = await ensureCustomer({
    email: user.email!,
    nombre: perfil?.full_name ?? null,
    profileId: user.id,
    guardado: perfil?.stripe_customer_id ?? null,
  });

  if (customer !== perfil?.stripe_customer_id) {
    await admin.from("profiles").update({ stripe_customer_id: customer }).eq("id", user.id);
  }

  const base = siteUrl();
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      customer,
      client_reference_id: bookingId,
      line_items: [
        {
          price_data: {
            currency: payment.currency.toLowerCase(),
            unit_amount: payment.gross_amount,
            product_data: { name: booking.products?.title ?? "Mentoría" },
          },
          quantity: 1,
        },
      ],
      // La metadata de la Session NO baja al PaymentIntent, y los eventos de
      // reembolso y disputa solo traen el PaymentIntent. Sin esta segunda copia
      // no habría forma de mapear un reembolso a su reserva.
      metadata: { booking_id: bookingId },
      payment_intent_data: { metadata: { booking_id: bookingId } },
      success_url: `${base}/reservas/${bookingId}/confirmacion`,
      cancel_url: `${base}/reservar/${booking.product_id}/checkout?cancelado=1`,
    },
    // Un doble clic o un reintento de red no debe abrir dos cobros para la
    // misma reserva. La clave es la reserva porque es lo único estable aquí.
    { idempotencyKey: `booking-${bookingId}` },
  );

  if (!session.url) {
    return NextResponse.json({ error: "Stripe no devolvió URL" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
