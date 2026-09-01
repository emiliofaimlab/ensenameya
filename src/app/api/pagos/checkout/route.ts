import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adapterFor } from "@/lib/payments";
import type { CobroRef, LineaDeCobro } from "@/lib/payments/port";
import { HOLD_POLICY } from "@/lib/policy";
import { ensureCustomer, esCustomerInexistente, siteUrl } from "@/lib/stripe";

/**
 * EP-20 / PAC-01 · abre el checkout de Stripe para una reserva y devuelve su
 * `client_secret`, que es lo que el navegador necesita para montar el formulario
 * de pago en nuestra propia pantalla. Antes devolvía la URL de
 * checkout.stripe.com y se redirigía; el pago ya no sale del sitio.
 *
 * MN-01 · qué formulario se monta con ese secreto lo decide el `ui_mode` de la
 * Session, y eso vive en el adaptador (`lib/payments/stripe-provider.ts`), no
 * aquí. Este archivo no cambió con el paso a `ui_mode: 'form'` salvo en una
 * cosa, y es la importante: la VERSIÓN de la clave de idempotencia (abajo).
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
 * Los dos caminos devuelven además `retencionHasta`: el instante en que el
 * horario se libera solo si nadie paga (D-2 del §20.14). Va aquí y no en el
 * navegador porque se calcula sobre `bookings.created_at` y la ventana de
 * `expire_stale_bookings` — ver `RETENCION_MIN` más abajo.
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
 * 24 HORAS. La reserva, en cambio, la mata `expire_stale_bookings` en minutos
 * (`HOLD_POLICY.minutes`). O sea que durante casi un día entero quedaba un
 * formulario de pago abierto contra un horario que ya se le había dado a otra
 * persona.
 *
 * NO SE PUEDEN CUADRAR LOS DOS PLAZOS, y conviene decirlo claro porque parece
 * que sí. Por dos razones:
 *
 *   · Stripe EXIGE que `expires_at` esté entre 30 minutos y 24 horas desde la
 *     creación de la Session. Nuestra ventana es de 7 minutos — antes 20, y
 *     tampoco entonces. No hay valor legal que coincida.
 *   · Aunque subiéramos la ventana de reserva a 30 tampoco coincidirían: los
 *     dos relojes NO arrancan en el mismo instante. La reserva nace en
 *     `create_booking`, que dispara el navegador al elegir horario; la Session
 *     nace después, cuando la persona llega a la pantalla de pago. Siempre
 *     sobrevive a la reserva, y la diferencia depende de lo que tarde en
 *     rellenar el formulario. Alinearlos es un espejismo.
 *
 * DECISIÓN: se acepta el mínimo de Stripe y se **calcula desde la reserva**, no
 * desde ahora. El número sale de sumar el peor caso: lo que vive la reserva
 * (`HOLD_POLICY.minutes` + lo que tarde el pg_cron en pasar), más los 30 de
 * Stripe, más margen. No se sube la ventana de reserva porque cada minuto de
 * más es horario bloqueado por cada checkout abandonado, y eso lo paga el tutor.
 *
 * ⚠️ B-1 · 60 → 40, Y BAJA PORQUE BAJÓ EL HOLD. Los 60 salían de 20 min de
 * reserva + 5 de cron = 25, más los 30 de Stripe = 55, redondeado. Con V-3 el
 * hold es de 7 y el cron corre cada minuto, así que el peor caso es 8 + 30 = 38
 * → 40.
 *
 * Y no es cosmético: este número ES la ventana en la que alguien puede pagar
 * algo que ya se canceló. Dejarlo en 60 con un hold de 7 la habría estirado de
 * 35-40 minutos a 52-53 — justo lo contrario de lo que pedía la ficha. Con 40
 * queda en ~32, y no baja más porque el suelo duro de Stripe son 30: ese hueco
 * no se puede cerrar del todo, solo estrechar.
 *
 * Que sea DETERMINISTA por reserva no es un detalle estético: la clave de
 * idempotencia de la Session es la reserva, y Stripe devuelve error —no la
 * respuesta cacheada— si la misma clave llega con parámetros distintos. Un
 * `now + 30 min` cambiaría en cada recarga de la pantalla y rompería el
 * checkout con un error opaco. Aun así, el valor entra también en la clave (más
 * abajo) por si el suelo defensivo llega a actuar.
 *
 * El hueco que queda —de los ~8 minutos de la reserva a los 40 de la Session—
 * lo tapa el webhook: si el cobro llega con la reserva ya liberada, lo
 * reembolsa. Esto solo hace que ese caso sea raro; la red de seguridad es
 * `src/app/api/webhooks/stripe`.
 */
const CADUCIDAD_MIN = 40;
const MINIMO_STRIPE_MIN = 30;

/**
 * CUÁNTO TIEMPO SE LE RETIENE EL HORARIO AL ALUMNO — el número del contador.
 *
 * ⚠️ YA NO SE ESCRIBE AQUÍ: vive en `lib/policy.ts`, que es la copia que se
 * ENSEÑA del `p_payment_cutoff` de `expire_stale_bookings` (hoy en
 * `20260826120000`, pg_cron cada minuto dentro de la propia base). La fuente de
 * verdad sigue siendo la migración (regla de oro 5); si divergen, gana el SQL.
 *
 * Se movió porque hay DOS sitios que le prometen este plazo al alumno y tienen
 * que decir el mismo número: este contador y la línea de «Continuar al pago»
 * del selector de horarios. Con el número tecleado en cada sitio, el selector
 * llegó a prometer justo lo contrario de lo que hace el código.
 *
 * Se cuenta desde `bookings.created_at`, no desde ahora: la reserva ya existía
 * cuando esta pantalla se pintó —desde D-2 (§20.14) se crea AL LLEGAR al
 * checkout— y un contador que arrancara en la petición mentiría en cada
 * recarga.
 */
const RETENCION_MIN = HOLD_POLICY.minutes;

/**
 * ⚠️ VERSIÓN DE LOS PARÁMETROS DE LA SESSION — SÚBELA AL CAMBIARLOS.
 *
 * La clave de idempotencia se compone por reserva (`booking-<id>…`), y Stripe
 * NO devuelve la respuesta cacheada cuando la misma clave llega con parámetros
 * distintos: devuelve un error de idempotencia. O sea que el día que se
 * despliega un cambio en lo que se le manda a `charge()` —el `ui_mode`, el
 * `name_collection`, los métodos de pago, lo que sea— toda reserva que tuviera
 * un checkout abierto con la clave vieja empieza a fallar con un error opaco.
 *
 * Es un fallo que NO se ve en local ni en la preview, porque ahí no hay
 * Sessions viejas: solo aparece en producción y solo el día del despliegue.
 * Subir esta cadena hace que esas reservas abran una Session NUEVA en vez de
 * chocar, que es exactamente lo que queremos. Si acabaran pagándose las dos, el
 * webhook reembolsa la segunda (X-02).
 *
 * v2 · 2026-08-20 — MN-01/MN-02: `ui_mode: 'form'` y el titular opcional.
 * v3 · 2026-08-21 — D-3 (§20.14): la casilla de guardar tarjeta la pinta ahora
 *   Stripe (`saved_payment_method_options.payment_method_save`) y desaparece
 *   nuestro `setup_future_usage`. Son parámetros distintos para la MISMA
 *   reserva, así que sin esta subida toda Session abierta el día del despliegue
 *   chocaría contra su propia clave.
 * v4 · 2026-08-26 — V-4a (A-3 del Doc 22 §22.9): el titular de la tarjeta pasa
 *   de `optional: true` a `false`. Es un parámetro de la Session como los
 *   anteriores y le aplica la misma trampa.
 * v5 · 2026-08-27 — EY-176: los `line_items` pasan a construirse desde una
 *   LISTA (una por mentoría). Para una reserva suelta el objeto resultante es
 *   —hasta donde se puede leer— IDÉNTICO al de v4: una línea, mismo importe,
 *   mismo nombre, mismo `client_reference_id` pelado. Se sube igualmente, y a
 *   propósito: acertar no ahorra nada (subirla solo hace que una reserva con el
 *   checkout abierto abra una Session nueva, que es inofensivo) y equivocarse
 *   cuesta un error de idempotencia opaco en producción el día del despliegue,
 *   para todo el que estuviera pagando. La asimetría decide sola.
 */
const VERSION_PARAMS = "v5";

/** Hasta cuándo se le promete el horario al alumno, en ISO (o null si no
 *  hay `created_at` legible: mejor sin contador que con uno inventado). */
function retencionHasta(creadaEn: string | null): string | null {
  const nacimiento = Date.parse(creadaEn ?? "");
  if (!Number.isFinite(nacimiento)) return null;
  return new Date(nacimiento + RETENCION_MIN * 60_000).toISOString();
}

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

/**
 * EY-176 · LO QUE SE VA A COBRAR, VENGA DE UNA RESERVA O DE UN PEDIDO.
 *
 * A partir de aquí el resto del fichero no distingue: el Customer, la
 * caducidad, la clave de idempotencia y el rescate del Customer perdido son los
 * mismos para los dos. Lo único que cambia es de dónde salen estos campos.
 */
type Cobro = {
  ref: CobroRef;
  /** Una por mentoría, con su importe congelado. Nunca vacía. */
  lineas: LineaDeCobro[];
  currency: string;
  /** El snapshot de `payments.provider`, no la regla activa de hoy. */
  provider: string | null;
  /** `payments.payer_country`, si se congeló. dLocal lo usa; Stripe lo ignora. */
  payerCountry: string | null;
  /** El nacimiento del hold: de aquí salen el contador y la caducidad. */
  creadoEn: string | null;
  /** A dónde devuelve la pasarela cuando el cobro sale bien. */
  returnPath: string;
  /** El prefijo de la clave de idempotencia. Ver `VERSION_PARAMS`. */
  claveBase: string;
};

/** El error ya con su código HTTP, para no repetir `NextResponse` en cada rama. */
type Fallo = { error: string; status: number };

export async function POST(req: Request) {
  // ⚠️ El cuerpo trae SOLO el sujeto del cobro: una reserva O un pedido. Aquí
  // llegaba también `guardarTarjeta`, la casilla de PAC-02, y desde D-3
  // (§20.14) la pinta Stripe dentro de su formulario: ver el bloque de
  // `saved_payment_method_options` en `lib/payments/stripe-provider.ts` antes
  // de volver a añadirla.
  const { bookingId, orderId } = (await req.json().catch(() => ({}))) as {
    bookingId?: string;
    orderId?: string;
  };
  if (!bookingId && !orderId) {
    return NextResponse.json({ error: "falta bookingId u orderId" }, { status: 400 });
  }
  if (bookingId && orderId) {
    // Con los dos no se sabe a quién acreditar el dinero. Se para aquí en vez
    // de elegir uno por orden de aparición.
    return NextResponse.json(
      { error: "bookingId y orderId son excluyentes" },
      { status: 400 },
    );
  }

  // Cliente de cookies (ANON + RLS): si la reserva o el pedido no son tuyos, no
  // los ves. La autorización es la RLS, no una comprobación nuestra.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const admin = createAdminClient();

  /** Una reserva suelta: el camino de siempre, sin un cambio de fondo. */
  const cobroDeReserva = async (id: string): Promise<Cobro | Fallo> => {
    // `created_at` no es decorativo: de ahí sale la caducidad de la Session
    // (X-02). Es la marca de cuándo empezó a correr la ventana del hold.
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, status, product_id, created_at, products(title)")
      .eq("id", id)
      .maybeSingle();

    if (!booking) return { error: "reserva no encontrada", status: 404 };
    if (booking.status !== "pending_payment") {
      // Ya pagada, ya cancelada o ya aceptada: no se abre un cobro nuevo.
      return { error: `la reserva está en ${booking.status}`, status: 409 };
    }

    const { data: payment } = await admin
      .from("payments")
      .select("id, provider, gross_amount, currency, payer_country")
      .eq("booking_id", id)
      .maybeSingle();
    if (!payment) return { error: "sin pago asociado", status: 500 };

    return {
      ref: { tipo: "booking", id },
      // ⚠️ EL IMPORTE SALE DE `payments.gross_amount`, NUNCA DEL NAVEGADOR
      // (regla de oro 2).
      lineas: [
        {
          concepto: booking.products?.title ?? "Mentoría",
          amountMinor: payment.gross_amount,
        },
      ],
      currency: payment.currency,
      provider: payment.provider,
      payerCountry: payment.payer_country,
      creadoEn: booking.created_at,
      returnPath: `/reservas/${id}/confirmacion`,
      claveBase: `booking-${id}`,
    };
  };

  /**
   * Un pedido: N líneas, UN cargo (P-3).
   *
   * ⚠️ P-1 · TODO O NADA TAMBIÉN AL ABRIR EL COBRO. Si una sola línea ha dejado
   * de esperar el pago —la venció `expire_stale_bookings` a los 7 minutos, o la
   * canceló otro camino— no se abre nada. Abrir el cobro por las que quedan
   * sería cobrar un pedido distinto del que el alumno revisó, y confirmar solo
   * parte de él es exactamente el estado que esta ficha existe para impedir.
   */
  const cobroDePedido = async (id: string): Promise<Cobro | Fallo> => {
    const conPedidos = supabase;

    const { data: order } = await conPedidos
      .from("orders")
      .select("id, status, currency, provider, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!order) return { error: "pedido no encontrado", status: 404 };
    if (order.status !== "pending_payment") {
      return { error: `el pedido está en ${order.status}`, status: 409 };
    }

    const { data: lineas } = await conPedidos
      .from("bookings")
      .select("id, status, products(title)")
      .eq("order_id", id);

    const filas = lineas ?? [];
    if (filas.length === 0) return { error: "el pedido no tiene líneas", status: 409 };

    const caida = filas.find((b) => b.status !== "pending_payment");
    if (caida) {
      return {
        error: `una mentoría del pedido está en ${caida.status}`,
        status: 409,
      };
    }

    // Los importes, con `service_role` y en UNA consulta. Uno por línea, y cada
    // uno es el que congeló `create_booking_line`: el total del cargo es su
    // suma y no se calcula en ningún otro sitio (regla de oro 2).
    const { data: pagos } = await admin
      .from("payments")
      .select("booking_id, provider, gross_amount, currency, payer_country")
      .in(
        "booking_id",
        filas.map((b) => b.id),
      );

    const porReserva = new Map((pagos ?? []).map((p) => [p.booking_id, p]));
    if (porReserva.size !== filas.length) {
      return { error: "alguna línea del pedido no tiene pago", status: 500 };
    }

    return {
      ref: { tipo: "order", id },
      lineas: filas.map((b) => ({
        concepto: b.products?.title ?? "Mentoría",
        amountMinor: porReserva.get(b.id)!.gross_amount,
      })),
      // La moneda y la pasarela del pedido, que `create_order` ya obligó a ser
      // únicas entre las líneas: aquí solo se leen.
      currency: order.currency,
      provider: order.provider,
      // De la primera línea: `create_order` obliga a que todas compartan
      // pasarela y moneda, y el país del pagador es el mismo alumno.
      payerCountry: porReserva.get(filas[0]!.id)?.payer_country ?? null,
      creadoEn: order.created_at,
      returnPath: `/pedidos/${id}/confirmacion`,
      claveBase: `order-${id}`,
    };
  };

  const resuelto = orderId
    ? await cobroDePedido(orderId)
    : await cobroDeReserva(bookingId!);

  if ("error" in resuelto) {
    return NextResponse.json({ error: resuelto.error }, { status: resuelto.status });
  }
  const cobrar = resuelto;

  // El ruteo manda, y manda el SNAPSHOT: `payments.provider` es lo que
  // `create_booking` congeló al reservar, no la regla activa de ahora mismo.
  // Mientras siga en 'simulated', el camino de hoy — y la pregunta va ANTES de
  // dar de alta al Customer porque al revés el camino simulado empezaría a
  // llamar a Stripe, que hoy no lo hace.
  const proveedor = adapterFor(cobrar.provider);
  const retencion = retencionHasta(cobrar.creadoEn);
  if (!proveedor.opensRemoteCheckout) {
    // El contador viaja también por aquí: con el proveedor simulado no hay
    // formulario que montar, pero el horario se retiene exactamente igual y la
    // pantalla tiene que poder decir hasta cuándo.
    // `simulated` se conserva por compatibilidad con lo que ya leían las
    // pantallas; `modo` es lo que se mira desde A2. Los dos dicen lo mismo.
    return NextResponse.json({
      modo: "simulado",
      simulated: true,
      retencionHasta: retencion,
    });
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

  // ⚠️ AQUÍ SE DA DE ALTA AL ALUMNO EN STRIPE, Y DESDE EL 21-AGO ESO OCURRE POR
  // VISITA, NO POR INTENCIÓN DE PAGAR.
  //
  // Qué cambió: hasta D-2 (§20.14) este endpoint solo se llamaba al pulsar
  // «Continuar al pago», así que el Customer —correo y nombre del alumno, que
  // son datos personales— salía hacia un tercero cuando alguien decidía pagar.
  // Con el formulario montándose al llegar al checkout, esta petición sale sola
  // al ABRIR la pantalla: quien entre a mirar el precio y se vaya ya tiene una
  // ficha creada en Stripe.
  //
  // NO SE CORRIGE, y por eso queda escrito. Es consecuencia directa de lo que
  // el cliente aprobó: el formulario al llegar exige un `client_secret`, que
  // exige una Session, que exige un Customer. Retrasarlo sería volver a poner
  // la puerta que D-2 quitó. Lo que no puede ser es que nadie recuerde que se
  // decidió: si algún día hay que declarar qué se envía a quién y cuándo —una
  // política de privacidad, un encargado de tratamiento, una pregunta del
  // cliente—, el momento del alta es ESTE y no el del pago.
  //
  // Lo que se manda es lo mínimo (correo, nombre y el id de perfil como
  // metadato); ampliarlo es una decisión aparte y más gorda de lo que parece.
  let customer = await ensureCustomer({
    email: user.email!,
    nombre: perfil?.full_name ?? null,
    profileId: user.id,
    guardado: perfil?.stripe_customer_id ?? null,
  });
  if (customer !== perfil?.stripe_customer_id) await guardarCustomer(customer);

  const base = siteUrl();
  const caduca = caducidadSesion(cobrar.creadoEn);
  const crearSesion = (cliente: string, claveIdem: string) =>
    proveedor.charge({
      ref: cobrar.ref,
      // ⚠️ LOS IMPORTES Y LA MONEDA SALEN DE `payments`, NUNCA DEL NAVEGADOR
      // (regla de oro 2). El puerto los transporta; no los calcula nadie por el
      // camino, y el total del cargo es la SUMA de estas líneas y de nada más.
      lineas: cobrar.lineas,
      currency: cobrar.currency,
      customerRef: cliente,
      expiresAt: caduca,
      // Con el formulario en nuestra pantalla NO hay `cancel_url`: Stripe
      // devuelve aquí ya pagado, y cancelar es no rellenar el formulario.
      returnUrl: `${base}${cobrar.returnPath}`,
      // A2 · a dónde avisa el PSP cuando el cobro cambie de estado. Stripe lo
      // ignora (su webhook se configura una vez en su panel); dLocal Go lo
      // exige POR COBRO y sin él no notifica NADA — el cobro se pagaría y nadie
      // se enteraría. Va aquí porque es este archivo el que sabe la URL base
      // del entorno, no el adaptador.
      notificationUrl: `${base}/api/webhooks/dlocalgo`,
      // El país del pagador, si `create_booking` llegó a congelarlo. Stripe lo
      // deduce del medio de pago y lo ignora; dLocal lo usa para acotar los
      // métodos locales que ofrece, y si falta se lo pregunta a la persona.
      payerCountry: cobrar.payerCountry,
      idempotencyKey: claveIdem,
    });

  // ⚠️ LA CLAVE VOLVIÓ A SER DETERMINISTA POR RESERVA, Y AHORA HACE FALTA QUE
  // LO SEA. Llevaba un sufijo `-save` cuando la casilla de guardar tarjeta era
  // nuestra y viajaba en el cuerpo: dos valores posibles, dos Sessions posibles
  // para la misma reserva. Desde D-3 (§20.14) esa casilla la pinta Stripe y no
  // entra en los parámetros, así que la misma reserva pide siempre la MISMA
  // Session — que es justo lo que sostiene el montaje al llegar de D-2: recargar
  // el checkout devuelve el cobro que ya estaba abierto en vez de abrir otro.
  //
  // Y por lo mismo entra la caducidad (X-02). Normalmente es constante para una
  // reserva dada —se calcula desde su `created_at`— y la clave no se mueve, que
  // es lo que queremos: recargar la pantalla devuelve LA MISMA Session. Pero si
  // el suelo defensivo de `caducidadSesion` llegara a actuar, el valor cambiaría
  // entre peticiones; llevarlo en la clave convierte ese caso en "se abre una
  // Session nueva" en lugar de "el checkout devuelve un error de idempotencia y
  // nadie entiende por qué". Que se abra una segunda Session ya no es peligroso:
  // si acabaran pagándose las dos, el webhook reembolsa la segunda.
  //
  // Y por lo mismo va la VERSIÓN de los parámetros: ver `VERSION_PARAMS` arriba.
  //
  // ⚠️ EY-176 · LA CLAVE ES DEL SUJETO DEL COBRO, NO SIEMPRE DE UNA RESERVA.
  // `claveBase` es `booking-<id>` o `order-<id>`, y esa distinción es lo que
  // impide que un pedido y una de sus líneas se peleen por la misma Session.
  // Sigue siendo DETERMINISTA por sujeto —la caducidad se calcula desde su
  // `created_at`—, que es lo que sostiene el montaje del formulario al llegar
  // (D-2): recargar la pantalla devuelve el cobro que ya estaba abierto.
  const clave = `${cobrar.claveBase}-c${caduca}-${VERSION_PARAMS}`;

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

  /**
   * A2 · EL COBRO QUE NO SE MONTA, SE VISITA.
   *
   * dLocal Go no tiene formulario embebible (SmartFields exige que su soporte
   * lo habilite; `direct: true` se ignora hoy), así que su cobro es una URL a la
   * que hay que mandar a la persona. El navegador la reconoce por `modo` y
   * navega.
   *
   * ⚠️ `modo` VIAJA SIEMPRE, TAMBIÉN EN EL CAMINO EMBEBIDO, y esa es la mitad
   * del arreglo. Las tres pantallas de cobro decidían con
   * `if (salida.clientSecret && salida.publishableKey)` y **caían al camino
   * simulado en cualquier otro caso**: una respuesta de redirección habría
   * pintado el botón de «simular pago» de un entorno de pruebas sobre un cobro
   * real. Con un discriminante explícito, lo desconocido es un error visible en
   * vez de un checkout de mentira.
   */
  if (cobro.modo === "redireccion") {
    return NextResponse.json({
      modo: "redireccion",
      redirectUrl: cobro.redirectUrl,
      retencionHasta: retencion,
    });
  }

  // La publicable viaja con la respuesta en vez de por `NEXT_PUBLIC_*`: así el
  // interruptor de Stripe sigue siendo UNA sola cosa (las claves del servidor) y
  // no hay que acordarse de una variante pública en Vercel. Es pública por
  // diseño —solo permite crear tokens—, así que no roza la regla de oro 3.
  return NextResponse.json({
    modo: "embebido",
    clientSecret: cobro.clientSecret,
    publishableKey: cobro.publishableKey,
    // D-2 (§20.14) · hasta cuándo se le retiene el horario. Sale del servidor y
    // no del navegador a propósito: es `bookings.created_at` + la ventana de
    // `expire_stale_bookings`, dos datos que el cliente no tiene y no debería
    // adivinar.
    retencionHasta: retencion,
  });
}
