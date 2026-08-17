import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureCustomer,
  esCustomerInexistente,
  isStripeConfigured,
  publishableKey,
  siteUrl,
  stripe,
} from "@/lib/stripe";

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

  // El ruteo manda. Mientras la regla siga en 'simulated', el camino de hoy.
  if (payment.provider !== "stripe") {
    return NextResponse.json({ simulated: true });
  }
  // El embed necesita LAS DOS claves: la secreta para crear la Session y la
  // publicable para que el navegador monte el iframe. Sin la publicable el
  // formulario no aparecería y el alumno se quedaría mirando un hueco, así que
  // se falla aquí y se dice cuál falta.
  const pk = publishableKey();
  if (!isStripeConfigured() || !pk) {
    // Ruteado a Stripe pero sin clave: es un error de configuración y se dice.
    // Caer al simulado aquí sería regalar mentorías (mismo criterio que Daily).
    return NextResponse.json(
      {
        error: `Stripe no configurado (falta ${!isStripeConfigured() ? "STRIPE_API_KEY" : "STRIPE_PUBLISHABLE_KEY"})`,
      },
      { status: 503 },
    );
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
    stripe().checkout.sessions.create(
    {
      mode: "payment",
      customer: cliente,
      client_reference_id: bookingId,
      // X-02 · en segundos Unix, no en milisegundos: Stripe cuenta épocas en
      // segundos y pasarle `Date.now()` a secas daría un año del 57000 que
      // rebota con "no puede ser más de 24 horas". El razonamiento del valor
      // está arriba, en `caducidadSesion`.
      expires_at: caduca,
      // Solo tarjeta. Por defecto Stripe ofrece los métodos activos de la
      // cuenta y salían Cash App Pay, Amazon Pay y Klarna: irrelevantes para
      // Latinoamérica y ruido en una pantalla que se quiere simple. Fijarlo
      // aquí también apaga los métodos que se activen mañana en el panel sin
      // que nadie lo revise. Los locales (C-13) entran por aquí cuando se
      // decida el mercado.
      payment_method_types: ["card"],
      // M-01 · La app presupuesta y confirma «45,00 US$» en tres pantallas y la
      // pasarela cobraba «PAB 46,80», un 4 % más, con un tipo de 1,0400. El
      // balboa está anclado 1:1 al dólar desde 1904: ese tipo no es una
      // conversión, es el margen del *adaptive pricing* de Stripe, que convierte
      // por geolocalización sin avisar. El alumno ve un precio durante toda la
      // compra y otro justo donde pone la tarjeta.
      //
      // Se apaga AQUÍ y no en el panel a propósito: en el panel se pierde el día
      // que se cree otra cuenta o se pase de sandbox a live, y el fallo vuelve
      // sin que nadie lo note. El importe sale de `payments.gross_amount` y la
      // moneda de `payment.currency`, así que una sola moneda de punta a punta.
      adaptive_pricing: { enabled: false },
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
      // Embedded Checkout: el formulario de tarjeta se monta DENTRO de nuestra
      // pantalla (reunión 7-ago) en vez de mandar a checkout.stripe.com. Sigue
      // siendo un iframe de Stripe, así que el PAN no toca nuestro DOM y el
      // proyecto se queda en PCI-DSS SAQ A — que era la razón de no dibujar
      // campos propios.
      // `embedded_page`, NO `embedded`: en la versión de API que tenemos fijada
      // el valor se renombró y la vieja devuelve 400. El typecheck no lo pilla
      // porque la unión del SDK acaba en `OtherString`, que traga cualquier
      // cadena — esto solo se ve llamando a la API de verdad.
      ui_mode: "embedded_page",
      // Sin esto Stripe rotula el formulario según el navegador y en un sitio
      // en español salía "Payment method" / "Save my information". Con el
      // checkout alojado se notaba menos porque era otra página; embebido,
      // media pantalla quedaba en otro idioma.
      locale: "es",
      // Con el checkout embebido NO existe `success_url` ni `cancel_url`: hay
      // un único `return_url` al que Stripe lleva ya pagado. Cancelar es no
      // rellenar el formulario, así que no hay a dónde volver.
      return_url: `${base}/reservas/${bookingId}/confirmacion`,
    },
    // Un doble clic o un reintento de red no debe abrir dos cobros para la
    // misma reserva. La clave es la reserva porque es lo único estable aquí.
    { idempotencyKey: claveIdem },
  );

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

  if (!session.client_secret) {
    return NextResponse.json(
      { error: "Stripe no devolvió client_secret" },
      { status: 502 },
    );
  }
  // La publicable viaja con la respuesta en vez de por `NEXT_PUBLIC_*`: así el
  // interruptor de Stripe sigue siendo UNA sola cosa (las claves del servidor) y
  // no hay que acordarse de una variante pública en Vercel. Es pública por
  // diseño —solo permite crear tokens—, así que no roza la regla de oro 3.
  return NextResponse.json({
    clientSecret: session.client_secret,
    publishableKey: pk,
  });
}
