import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  crearSesionDeAltaDeTarjeta,
  detachCard,
  ensureCustomer,
  esCustomerInexistente,
  isStripeConfigured,
  listSavedCards,
  permitirReutilizacion,
  publishableKey,
  recuperarSesionDeAlta,
  siteUrl,
} from "@/lib/stripe";

/**
 * PAC-02 · las tarjetas guardadas: alta (POST + PATCH) y baja (DELETE).
 *
 * El dato vive en Stripe, no en nuestra base: aquí la RLS no protege nada, así
 * que TODA comprobación de pertenencia se hace a mano contra el Customer de
 * quien llama. Un id `pm_…` o `cs_…` es solo una cadena, y sin ese chequeo
 * bastaría para tocarle el medio de pago a otra persona.
 *
 * ⚠️ ESTA RUTA NO PASA POR EL PUERTO DE PAGOS, y es deliberado: guardar
 * tarjetas no es cobrar. El puerto cubre lo que un segundo PSP tendrá que
 * implementar entero (cobro, reembolso, webhook) y el vault de tarjetas de
 * Stripe no tiene equivalente garantizado en dLocal — meterlo en la interfaz
 * sería obligar al próximo adaptador a fingir tres métodos más. Lo que sí se
 * respeta es el invariante: las llamadas al SDK viven en `lib/stripe.ts`, no
 * aquí. El porqué completo está allí, en «la caja fuerte de tarjetas».
 */

/**
 * Quién llama y con qué Customer. Devuelve `null` si no hay sesión.
 *
 * `profiles` se lee con `service_role` (como ya hacía el borrado): la columna
 * `stripe_customer_id` es de servidor y no queremos exponerla al navegador solo
 * para esto. Regla de oro 9: sus `grant` ya están puestos desde
 * `20260806170000`, esta ruta no estrena tabla.
 */
async function quienLlama() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: perfil } = await admin
    .from("profiles")
    .select("full_name, stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  return { user, perfil, admin };
}

const noAutenticado = () =>
  NextResponse.json({ error: "no autenticado" }, { status: 401 });

/**
 * N-31 · AÑADIR una tarjeta desde el perfil, sin tener que empezar una compra.
 *
 * Hasta hoy la pantalla de "Métodos de pago" solo sabía borrar: la única forma
 * de guardar una tarjeta era llegar al checkout de una reserva y marcar la
 * casilla. Quien quería dejar el medio de pago listo antes de reservar no podía.
 *
 * ⚠️ SIGUE SIENDO PCI-DSS SAQ A. Esa es la razón declarada por la que esto no
 * se hizo antes (ver el comentario grande de `checkout-form.tsx`): dibujar
 * campos de tarjeta propios metería el proyecto en SAQ D. Lo que se abre aquí es
 * una Checkout Session en `mode: 'setup'` montada en el MISMO componente
 * embebido que el cobro (`StripeEmbed`), así que el PAN sigue viviendo en un
 * iframe del proveedor y no toca nuestro DOM.
 *
 * `mode: 'setup'` en vez de un SetupIntent + Elements a pelo porque reutiliza
 * entero el camino que ya está probado: mismo embed, mismo `locale`, mismo
 * `return_url`. Un PaymentElement propio daría control sobre `usage` (ver más
 * abajo) a cambio de un segundo formulario de pago que mantener.
 */
export async function POST() {
  const ctx = await quienLlama();
  if (!ctx) return noAutenticado();
  const { user, perfil, admin } = ctx;

  // Las DOS claves, igual que el checkout: la secreta crea la Session y la
  // publicable monta el iframe. Sin la publicable el formulario no aparecería
  // y la persona se quedaría mirando un hueco, así que se dice cuál falta.
  const pk = publishableKey();
  if (!isStripeConfigured() || !pk) {
    return NextResponse.json(
      {
        error: `Stripe no configurado (falta ${!isStripeConfigured() ? "STRIPE_API_KEY" : "STRIPE_PUBLISHABLE_KEY"})`,
      },
      { status: 503 },
    );
  }

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
  const crearSesion = (cliente: string) =>
    crearSesionDeAltaDeTarjeta({
      customerId: cliente,
      profileId: user.id,
      // Vuelve a la misma pantalla, con el id de la Session para poder
      // verificar lo guardado (ver PATCH). El placeholder lo sustituye Stripe.
      returnUrl: `${base}/pagos?tarjeta={CHECKOUT_SESSION_ID}`,
    });

  let session;
  try {
    session = await crearSesion(customer);
  } catch (e) {
    // Mismo caso que en el checkout: el Customer guardado ya no existe en
    // Stripe (datos de prueba borrados, cambio de cuenta). Sin esto, esa persona
    // no podría volver a añadir una tarjeta nunca.
    if (!esCustomerInexistente(e)) throw e;

    customer = await ensureCustomer({
      email: user.email!,
      nombre: perfil?.full_name ?? null,
      profileId: user.id,
      guardado: null, // a propósito: el guardado es el que está roto
    });
    await guardarCustomer(customer);
    session = await crearSesion(customer);
  }

  if (!session.client_secret) {
    return NextResponse.json(
      { error: "Stripe no devolvió client_secret" },
      { status: 502 },
    );
  }

  // La publicable viaja en la respuesta, no por `NEXT_PUBLIC_*`: encender
  // Stripe sigue siendo poner las claves del servidor y nada más. Es pública por
  // diseño (solo crea tokens), así que no roza la regla de oro 3.
  return NextResponse.json({
    clientSecret: session.client_secret,
    publishableKey: pk,
  });
}

/**
 * N-31 · red de seguridad al volver del formulario.
 *
 * El `allow_redisplay: 'always'` ya va puesto al crear la Session, así que esto
 * normalmente es un no-op. Existe porque el fallo que cubre es MUDO: si Stripe
 * no aplicara el override, la tarjeta se guardaría igual, se vería aquí igual, y
 * solo faltaría en el desplegable del checkout — nadie lo relacionaría con esta
 * pantalla. Una llamada idempotente al volver convierte "creemos que funcionó"
 * en "funcionó".
 *
 * Se hace en un PATCH y no al pintar la página porque es una escritura: un
 * Server Component puede renderizarse dos veces y no es sitio para efectos.
 */
export async function PATCH(req: Request) {
  const { sessionId } = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
  };
  // Sanidad barata: el id llega por query string y lo puede teclear cualquiera.
  if (!sessionId?.startsWith("cs_")) {
    return NextResponse.json({ error: "sesión inválida" }, { status: 400 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 503 });
  }

  const ctx = await quienLlama();
  if (!ctx) return noAutenticado();

  const customerId = ctx.perfil?.stripe_customer_id;
  if (!customerId) return NextResponse.json({ error: "sin cliente" }, { status: 404 });

  // El id viene de la URL, así que puede ser cualquier cosa con forma de `cs_`.
  // Un id inexistente es "no encontrada", no un 500 nuestro llenando los logs.
  const session = await recuperarSesionDeAlta(sessionId);
  if (!session) return NextResponse.json({ error: "no encontrada" }, { status: 404 });

  // Pertenencia: la Session tiene que ser de NUESTRO Customer y de tipo setup.
  // Mismo criterio que la RLS — si no es tuya, no existe.
  const customerSesion =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (session.mode !== "setup" || customerSesion !== customerId) {
    return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  }

  const intent = session.setup_intent;
  const metodo =
    typeof intent === "string" || !intent
      ? null
      : typeof intent.payment_method === "string"
        ? intent.payment_method
        : (intent.payment_method?.id ?? null);

  // `complete` es lo único que garantiza que hay tarjeta. Se llega aquí también
  // si alguien pega la URL a mano con una Session abandonada: no es un error,
  // simplemente no hay nada que confirmar.
  if (session.status !== "complete" || !metodo) {
    return NextResponse.json({ guardada: false });
  }

  await permitirReutilizacion(metodo);

  return NextResponse.json({ guardada: true });
}

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

  const ctx = await quienLlama();
  if (!ctx) return noAutenticado();

  if (!ctx.perfil?.stripe_customer_id) {
    return NextResponse.json({ error: "sin tarjetas" }, { status: 404 });
  }

  // La pertenencia se comprueba contra Stripe, que es la fuente de verdad.
  const propias = await listSavedCards(ctx.perfil.stripe_customer_id);
  if (!propias.some((c) => c.id === paymentMethodId)) {
    // Mismo criterio que la RLS: si no es tuya, no existe.
    return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  }

  await detachCard(paymentMethodId);
  return NextResponse.json({ status: "ok" });
}
