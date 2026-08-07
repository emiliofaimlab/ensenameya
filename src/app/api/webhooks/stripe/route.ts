import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

/**
 * EP-20 / PAC-03 · webhook de Stripe. Cierra RN-34, el criterio que EY-56 dio
 * por cumplido en julio sin que existiera.
 *
 * Es el ÚNICO sitio donde un cobro pasa a `paid`. El navegador no confirma
 * pagos: el alumno puede cerrar la pestaña justo después de pagar y el dinero
 * existe igual, o puede volver a la página de éxito sin haber pagado nada.
 *
 * ── Las tres trampas que tiene este archivo ────────────────────────────────
 * 1. `req.text()`, nunca `req.json()`. Stripe firma un HMAC sobre la cadena
 *    EXACTA del cuerpo; `JSON.parse` + `stringify` reordena claves y cambia
 *    espacios, y la firma deja de cuadrar. El cuerpo se lee UNA vez.
 * 2. Firma inválida → **400**, no 500. Un 500 hace que Stripe reintente
 *    durante tres días un payload que no va a validar nunca.
 * 3. `payment_intent.payment_failed` NO está en la lista. Una tarjeta
 *    rechazada deja la Session abierta y el alumno reintenta con otra; si
 *    canceláramos ahí, le habríamos liberado el horario a alguien que estaba
 *    a punto de pagar. Los únicos fallos terminales son `expired` y
 *    `async_payment_failed`.
 */

/** Node, no edge: `constructEvent` usa crypto de Node. Es el runtime por defecto. */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  // Sin secreto no se procesa NADA. Aceptar sin verificar sería dejar que
  // cualquiera marque reservas como pagadas con un POST.
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET no configurada" }, { status: 503 });
  }

  const firma = req.headers.get("stripe-signature");
  if (!firma) return NextResponse.json({ error: "sin firma" }, { status: 400 });

  const crudo = await req.text();

  let evento: Stripe.Event;
  try {
    evento = stripe().webhooks.constructEvent(crudo, firma, secret);
  } catch (e) {
    return NextResponse.json(
      { error: `firma inválida: ${e instanceof Error ? e.message : "?"}` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  /**
   * El booking viaja en `client_reference_id` y, por si acaso, en metadata.
   * Se comprueban los dos: el primero solo existe en los eventos de Session.
   */
  const sesion = evento.data.object as Stripe.Checkout.Session;
  const bookingId = sesion.client_reference_id ?? sesion.metadata?.booking_id ?? null;

  if (!bookingId) {
    // No es nuestro, o es un evento que no lleva reserva. 200 para que Stripe
    // no reintente: no hay nada que arreglar reintentando.
    return NextResponse.json({ status: "ignorado", tipo: evento.type });
  }

  /**
   * `confirm_payment` ya es idempotente por dos vías: descarta el `event_id`
   * repetido (US-703) y no reprocesa un pago que ya esté resuelto. Por eso
   * aquí no hace falta una tabla de deduplicación aparte — se le pasa el id
   * del evento y él decide.
   */
  const llamar = async (exito: boolean) => {
    const { error } = await admin.rpc("confirm_payment", {
      p_booking_id: bookingId,
      p_success: exito,
      p_event_id: evento.id,
    });
    if (error) throw new Error(error.message);
  };

  switch (evento.type) {
    // Cobro completado. `payment_status` importa: con métodos diferidos la
    // Session se completa ANTES de que el dinero exista.
    case "checkout.session.completed": {
      if (sesion.payment_status === "unpaid") {
        return NextResponse.json({ status: "en-curso", tipo: evento.type });
      }
      await llamar(true);
      break;
    }

    // Métodos no instantáneos (transferencia, débito bancario): el dinero
    // llega días después de que la Session se completara.
    case "checkout.session.async_payment_succeeded":
      await llamar(true);
      break;

    // Los DOS únicos fallos terminales. `expired` es además el que libera el
    // horario cuando el alumno abandona el checkout.
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      await llamar(false);
      break;

    default:
      return NextResponse.json({ status: "ignorado", tipo: evento.type });
  }

  // La referencia externa se guarda DESPUÉS de confirmar, y su fallo no tumba
  // el webhook: el cobro ya está registrado, y perder el `pi_` solo complica
  // un reembolso futuro. Se guarda el PaymentIntent y no la Session porque es
  // el que traen los eventos de reembolso y disputa.
  const pi = typeof sesion.payment_intent === "string" ? sesion.payment_intent : null;
  if (pi) {
    await admin
      .from("payments")
      .update({ provider_payment_id: pi })
      .eq("booking_id", bookingId);
  }

  return NextResponse.json({ status: "ok", tipo: evento.type, booking: bookingId });
}
