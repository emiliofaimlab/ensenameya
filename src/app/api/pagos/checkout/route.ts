import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adapterFor } from "@/lib/payments";
import { ensureCustomer, esCustomerInexistente, siteUrl } from "@/lib/stripe";

/**
 * EP-20 / PAC-01 · abre el checkout de Stripe para una reserva y devuelve su
 * `client_secret`, que es lo que el navegador necesita para montar el Embedded
 * Checkout en nuestra propia pantalla. Antes devolvía la URL de
 * checkout.stripe.com y se redirigía; el pago ya no sale del sitio.
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
 *
 * NO HABLA CON NINGÚN SDK. Desde el puerto de pagos (`lib/payments`), lo único
 * que este archivo sabe del proveedor es lo que el puerto expone: si abre cobro
 * remoto, qué credencial le falta y cómo se le pide un cobro. Lo que queda aquí
 * —la caducidad, la clave de idempotencia y el rescate del Customer perdido— se
 * queda a propósito: es política de ESTA reserva, no del proveedor.
 */

/**
 * X-02 · CUÁNDO DEBE MORIR LA CHECKOUT SESSION.
 *
 * Hasta hoy no se le ponía `expires_at`, así que vivía el default de Stripe:
 * 24 HORAS. La reserva, en cambio, la mata `expire_stale_bookings` a los 20
 * minutos. O sea que durante casi un día entero quedaba un formulario de pago
 * abierto contra un horario que ya se le había dado a otra persona.
 *
 * NO SE PUEDEN CUADRAR LOS DOS PLAZOS, y conviene decirlo claro porque parece
 * que sí. Por dos razones:
 *
 *   · Stripe EXIGE que `expires_at` esté entre 30 minutos y 24 horas desde la
 *     creación de la Session. Nuestra ventana son 20. No hay valor legal que
 *     coincida.
 *   · Aunque subiéramos la ventana de reserva a 30 tampoco coincidirían: los
 *     dos relojes NO arrancan en el mismo instante. La reserva nace en
 *     `create_booking`, que dispara el navegador al elegir horario; la Session
 *     nace después, cuando la persona llega a la pantalla de pago. Siempre
 *     sobrevive a la reserva, y la diferencia depende de lo que tarde en
 *     rellenar el formulario. Alinearlos es un espejismo.
 *
 * DECISIÓN: se acepta el mínimo de Stripe y se **calcula desde la reserva**, no
 * desde ahora. `created_at + 60 min` sale de sumar el peor caso: la reserva
 * vive 20 minutos, el pg_cron corre cada 5 (así que puede tardar 25 en morir) y
 * este endpoint puede abrir un cobro hasta ese último instante — 25 + los 30 de
 * Stripe = 55, redondeado a 60 con margen. No se sube la ventana de reserva a
 * 30 porque eso son 10 minutos más de horario bloqueado por cada checkout
 * abandonado, que es el coste que paga el tutor.
 *
 * Que sea DETERMINISTA por reserva no es un detalle estético: la clave de
 * idempotencia de la Session es la reserva, y Stripe devuelve error —no la
 * respuesta cacheada— si la misma clave llega con parámetros distintos. Un
 * `now + 30 min` cambiaría en cada recarga de la pantalla y rompería el
 * checkout con un error opaco. Aun así, el valor entra también en la clave (más
 * abajo) por si el suelo defensivo llega a actuar.
 *
 * El hueco que queda —de los ~25 minutos de la reserva a los 60 de la Session—
 * lo tapa el webhook: si el cobro llega con la reserva ya liberada, lo
 * reembolsa. Esto solo hace que ese caso sea raro; la red de seguridad es
 * `src/app/api/webhooks/stripe`.
 */
const CADUCIDAD_MIN = 60;
const MINIMO_STRIPE_MIN = 30;

function caducidadSesion(creadaEn: string | null): number {
  const ahora = Math.floor(Date.now() / 1000);
  // Suelo: si el pg_cron estuviera parado, una reserva podría llevar horas en
  // `pending_payment` y `created_at + 60 min` ya sería pasado — Stripe
  // rechazaría la Session entera. Un minuto de colchón sobre su mínimo.
  const suelo = ahora + (MINIMO_STRIPE_MIN + 1) * 60;

  const nacimiento = Date.parse(creadaEn ?? "");
  if (!Number.isFinite(nacimiento)) return suelo;

  return Math.max(Math.floor(nacimiento / 1000) + CADUCIDAD_MIN * 60, suelo);
}

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

  // `created_at` no es decorativo: de ahí sale la caducidad de la Session
  // (X-02). Es la marca de cuándo empezó a correr la ventana de 20 minutos.
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, product_id, created_at, products(title)")
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

  // El ruteo manda, y manda el SNAPSHOT: `payments.provider` es lo que
  // `create_booking` congeló al reservar, no la regla activa de ahora mismo.
  // Mientras siga en 'simulated', el camino de hoy — y la pregunta va ANTES de
  // dar de alta al Customer porque al revés el camino simulado empezaría a
  // llamar a Stripe, que hoy no lo hace.
  const proveedor = adapterFor(payment.provider);
  if (!proveedor.opensRemoteCheckout) {
    return NextResponse.json({ simulated: true });
  }

  // Ruteado a un PSP pero sin credencial: es un error de configuración y se
  // dice cuál falta. Caer al simulado aquí sería regalar mentorías (mismo
  // criterio que Daily).
  const falta = proveedor.missingChargeConfig();
  if (falta) {
    return NextResponse.json({ error: falta }, { status: 503 });
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
  const caduca = caducidadSesion(booking.created_at);
  const crearSesion = (cliente: string, claveIdem: string) =>
    proveedor.charge({
      bookingId,
      // ⚠️ EL IMPORTE Y LA MONEDA SALEN DE `payments`, NUNCA DEL NAVEGADOR
      // (regla de oro 2). El puerto los transporta; no los calcula nadie por
      // el camino.
      amountMinor: payment.gross_amount,
      currency: payment.currency,
      concepto: booking.products?.title ?? "Mentoría",
      customerRef: cliente,
      expiresAt: caduca,
      guardarMedioDePago: Boolean(guardarTarjeta),
      // Con el checkout embebido NO hay `cancel_url`: Stripe devuelve aquí ya
      // pagado, y cancelar es no rellenar el formulario.
      returnUrl: `${base}/reservas/${bookingId}/confirmacion`,
      idempotencyKey: claveIdem,
    });

  // La casilla entra en la clave: reutilizar la misma con parámetros distintos
  // es un error de la API, no la respuesta cacheada.
  //
  // Y por lo mismo entra la caducidad (X-02). Normalmente es constante para una
  // reserva dada —se calcula desde su `created_at`— y la clave no se mueve, que
  // es lo que queremos: recargar la pantalla devuelve LA MISMA Session. Pero si
  // el suelo defensivo de `caducidadSesion` llegara a actuar, el valor cambiaría
  // entre peticiones; llevarlo en la clave convierte ese caso en "se abre una
  // Session nueva" en lugar de "el checkout devuelve un error de idempotencia y
  // nadie entiende por qué". Que se abra una segunda Session ya no es peligroso:
  // si acabaran pagándose las dos, el webhook reembolsa la segunda.
  const clave = `booking-${bookingId}${guardarTarjeta ? "-save" : ""}-c${caduca}`;

  let cobro;
  try {
    cobro = await crearSesion(customer, clave);
  } catch (e) {
    // El Customer que teníamos guardado ya no existe en Stripe (datos de prueba
    // borrados, cuenta cambiada, alguien lo eliminó). Sin esto, esa persona se
    // queda con un 500 en cada intento de pago para siempre.
    //
    // Este rescate es LO ÚNICO que queda aquí con nombre de Stripe, y se queda
    // a propósito: lo que repara es `profiles.stripe_customer_id`, una columna
    // nuestra y de Stripe. Generalizarlo sin un segundo proveedor que tenga el
    // mismo problema sería inventarse la forma del hueco.
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
    cobro = await crearSesion(customer, `${clave}-r2`);
  }

  if (!cobro.ok) {
    return NextResponse.json({ error: cobro.error }, { status: 502 });
  }
  // La publicable viaja con la respuesta en vez de por `NEXT_PUBLIC_*`: así el
  // interruptor de Stripe sigue siendo UNA sola cosa (las claves del servidor) y
  // no hay que acordarse de una variante pública en Vercel. Es pública por
  // diseño —solo permite crear tokens—, así que no roza la regla de oro 3.
  return NextResponse.json({
    clientSecret: cobro.clientSecret,
    publishableKey: cobro.publishableKey,
  });
}
