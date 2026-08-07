import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureCustomer,
  esCustomerInexistente,
  isStripeConfigured,
  siteUrl,
  stripe,
} from "@/lib/stripe";

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
  const { bookingId, guardarTarjeta } = (await req.json().catch(() => ({}))) as {
    bookingId?: string;
    guardarTarjeta?: boolean;
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

  const guardarCustomer = async (id: string) => {
    await admin.from("profiles").update({ stripe_customer_id: id }).eq("id", user.id);
  };

  let customer = await ensureCustomer({
    email: user.email!,
    nombre: perfil?.full_name ?? null,
    profileId: user.id,
    guardado: perfil?.stripe_customer_id ?? null,
  });
  if (customer !== perfil?.stripe_customer_id) await guardarCustomer(customer);

  const base = siteUrl();
  const crearSesion = (cliente: string, claveIdem: string) =>
    stripe().checkout.sessions.create(
    {
      mode: "payment",
      customer: cliente,
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
      // Sin esto la pasarela NO ofrece las tarjetas ya guardadas: pide una
      // nueva cada vez y la pantalla de "Métodos de pago" no sirve de nada.
      // Comprobado abriendo cuatro sesiones y mirándolas: el filtro es lo único
      // que hace falta —`payment_method_save` no, y añadirlo metería una
      // segunda casilla de guardado, la de Stripe, encima de la nuestra—.
      // `limited` es como `setup_future_usage` marca lo que guarda; `always`
      // por si algún día se guarda desde otro sitio.
      saved_payment_method_options: {
        allow_redisplay_filters: ["always", "limited"],
      },
      payment_intent_data: {
        metadata: { booking_id: bookingId },
        // PAC-02 · solo si la persona marcó la casilla, que nace DESMARCADA.
        // `on_session` y no `off_session` a propósito: el permiso que pedimos
        // es reutilizar la tarjeta con ella delante, en su próxima reserva —
        // no cobrarle cuando no está. Es el permiso menor de los dos y es el
        // que corresponde a lo que dice la casilla.
        ...(guardarTarjeta ? { setup_future_usage: "on_session" as const } : {}),
      },
      success_url: `${base}/reservas/${bookingId}/confirmacion`,
      cancel_url: `${base}/reservar/${booking.product_id}/checkout?cancelado=1`,
    },
    // Un doble clic o un reintento de red no debe abrir dos cobros para la
    // misma reserva. La clave es la reserva porque es lo único estable aquí.
    { idempotencyKey: claveIdem },
  );

  // La casilla entra en la clave: reutilizar la misma con parámetros distintos
  // es un error de la API, no la respuesta cacheada.
  const clave = `booking-${bookingId}${guardarTarjeta ? "-save" : ""}`;

  let session;
  try {
    session = await crearSesion(customer, clave);
  } catch (e) {
    // El Customer que teníamos guardado ya no existe en Stripe (datos de prueba
    // borrados, cuenta cambiada, alguien lo eliminó). Sin esto, esa persona se
    // queda con un 500 en cada intento de pago para siempre.
    if (!esCustomerInexistente(e)) throw e;

    customer = await ensureCustomer({
      email: user.email!,
      nombre: perfil?.full_name ?? null,
      profileId: user.id,
      guardado: null, // a propósito: el guardado es el que está roto
    });
    await guardarCustomer(customer);
    // Clave de idempotencia DISTINTA: reutilizar la misma con parámetros
    // distintos es un error de la API de Stripe, no la respuesta cacheada.
    session = await crearSesion(customer, `${clave}-r2`);
  }

  if (!session.url) {
    return NextResponse.json({ error: "Stripe no devolvió URL" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
