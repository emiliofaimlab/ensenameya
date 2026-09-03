import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adapterFor, chargeProvidersFor } from "@/lib/payments";
import type { ChargeResult, CobroRef, LineaDeCobro, PspProvider } from "@/lib/payments/port";
import type { Json } from "@/lib/database.types";
import { HOLD_POLICY } from "@/lib/policy";
import { ensureCustomer, esCustomerInexistente, siteUrl } from "@/lib/stripe";

import { cadenaDeCobro, porQueNadie, recorreLaCadena, type Salida } from "./cadena";

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
 * ── EL COBRO TIENE RESPALDO, Y ESTE ES EL ÚNICO SITIO QUE PUEDE TENERLO ─────
 * `payment_routing_rules.charge_providers` es una LISTA ORDENADA desde
 * `20260903140000` (VE/CO `{stripe,dlocal}`, los ocho `{dlocal,stripe}`), que es
 * la regla 1 del §1 de `docs/PAGOS-Y-PAYOUTS.md`: «que un cobro no se pueda
 * abrir por una pasarela no debe dejar al alumno sin comprar». Hasta hoy esa
 * lista se leía y se usaba UN elemento — si el primero no podía, el checkout
 * devolvía 503 y ahí se acababa.
 *
 * `create_booking_line` no puede recorrerla y lo dice ella misma: congela
 * `charge_providers[1]` en `payments.provider` porque «aquí todavía no ha
 * cobrado nadie; el cobro se abre después, en el Route Handler, que es el único
 * que puede caerse al segundo de la lista». Esto es ese sitio.
 *
 * El orden de la cadena y —lo importante— CUÁNDO SE DEJA DE INTENTAR viven en
 * `./cadena.ts`, sin un solo import, para que `npm run check:cadena` los pueda
 * ejecutar. Resumen de la regla de parada: se cae al siguiente cuando el
 * candidato no pudo NI EMPEZAR (no es PSP, le falta credencial) o cuando el
 * puerto devolvió `{ok:false}` —que por contrato no creó nada—, y **se para en
 * seco cuando `charge()` LANZA**, porque entonces la petición pudo llegar y un
 * segundo cobro deja dos cobros vivos para la misma reserva.
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

/** `payments.provider_metadata` ya narrado, que es `jsonb` y llega como `Json`. */
type Metadata = Record<string, Json | undefined>;

/** Un `jsonb` que sea un objeto; cualquier otra cosa (array, escalar) es `{}`. */
function objeto(v: Json | null | undefined): Metadata {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/**
 * Quién abrió el cobro, si alguien lo abrió ya. Se lee con tolerancia a propósito
 * —un `jsonb` que nadie más escribe hoy pero que mañana puede tener cualquier
 * forma— porque el fallo de leerlo mal no es cosmético: sería mandar la cadena a
 * empezar por otro proveedor y abrir un segundo cobro.
 */
function cobradorAnotado(metadata: Metadata): string | null {
  const checkout = objeto(metadata.checkout).cobrador;
  return typeof checkout === "string" && checkout ? checkout : null;
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
  /**
   * 🔴 QUIÉN ABRIÓ EL COBRO DE VERDAD, si una visita anterior ya lo abrió.
   *
   * Sale de `payments.provider_metadata.checkout.cobrador` y **no de
   * `payments.provider`**, que es el snapshot y que no se puede reescribir desde
   * aquí: `service_role` solo tiene `grant update (provider_payment_id,
   * provider_metadata)` sobre `payments` (`20260806170000:49`), y la regla de
   * oro 9 dice que eso muerde en tiempo de ejecución, no en el typecheck. Ver
   * `anotarCobrador` más abajo, y el riesgo que arrastra.
   *
   * Lo que compra: que la cadena de respaldo empiece por quien ya cobró. Sin
   * esto, el día que se arregle la credencial del preferido una recarga del
   * checkout abriría un cobro nuevo con él mientras el del respaldo sigue vivo
   * y pagable en el otro proveedor.
   */
  cobrador: string | null;
  /** `payments.payer_country`, si se congeló. dLocal lo usa; Stripe lo ignora. */
  payerCountry: string | null;
  /**
   * Los países de cobro (`payments.payee_country`) de las líneas, sin repetir.
   * Es la clave con la que `chargeProvidersFor` resuelve la cadena, igual que
   * `create_booking_line` resolvió el snapshot. `null` es un país legítimo: el
   * tutor que no lo ha declarado, que tiene su propia fila en la tabla.
   */
  payeeCountries: (string | null)[];
  /**
   * Las reservas cuya fila de `payments` hay que anotar: una para una reserva
   * suelta, N para un pedido. Todas comparten cobro, así que todas comparten
   * cobrador.
   */
  reservas: string[];
  /** Lo que ya hubiera en `provider_metadata`, para no pisarlo al anotar. */
  metadata: Metadata;
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
      .select(
        "id, provider, gross_amount, currency, payer_country, payee_country, provider_metadata",
      )
      .eq("booking_id", id)
      .maybeSingle();
    if (!payment) return { error: "sin pago asociado", status: 500 };

    const metadata = objeto(payment.provider_metadata);

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
      cobrador: cobradorAnotado(metadata),
      payerCountry: payment.payer_country,
      payeeCountries: [payment.payee_country],
      reservas: [id],
      metadata,
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
      .select(
        "booking_id, provider, gross_amount, currency, payer_country, payee_country, provider_metadata",
      )
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
      // De la primera línea, y basta: el cobro es UNO para todo el pedido
      // (P-3), así que si alguna línea lleva cobrador anotado lo llevan todas
      // — `anotarCobrador` las escribe juntas, igual que `sellarRef`.
      cobrador: cobradorAnotado(objeto(porReserva.get(filas[0]!.id)?.provider_metadata)),
      // De la primera línea: `create_order` obliga a que todas compartan
      // pasarela y moneda, y el país del pagador es el mismo alumno.
      payerCountry: porReserva.get(filas[0]!.id)?.payer_country ?? null,
      /**
       * ⚠️ AQUÍ SÍ PUEDE HABER VARIOS PAÍSES, y no es lo mismo que la moneda.
       * `create_order` obliga a que todas las líneas compartan `provider` y
       * `currency`, pero NO país de cobro: un carrito con dos tutores de países
       * distintos pasa su filtro mientras los dos ruteen al mismo primer
       * candidato. El primer candidato es por tanto común (es lo que congela el
       * snapshot); el RESPALDO no tiene por qué serlo, y usar el de una línea
       * cualquiera sería cobrar la mentoría de otro tutor por una pasarela que
       * su país no rutea. Se intersecan más abajo.
       */
      payeeCountries: [...new Set((pagos ?? []).map((p) => p.payee_country))],
      reservas: filas.map((b) => b.id),
      metadata: objeto(porReserva.get(filas[0]!.id)?.provider_metadata),
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

  /**
   * EL RESPALDO QUE **TODAS** LAS LÍNEAS AUTORIZAN.
   *
   * Con una reserva suelta hay un país y esto devuelve su lista tal cual. Con un
   * pedido puede haber varios (ver `payeeCountries`), y entonces se interseca
   * conservando el orden del primero: un candidato que la regla de otra línea no
   * nombra no es un respaldo, es cobrarle la mentoría de ese tutor por una
   * pasarela que su país no rutea — y con ella un `payments.provider` que miente
   * sobre de qué balance sale su payout.
   *
   * La cabeza sobrevive siempre a la intersección: `create_order` obliga a que
   * todas las líneas compartan `payments.provider`, que es `charge_providers[1]`
   * de cada una. Lo que se puede quedar por el camino es el respaldo, y quedarse
   * sin respaldo es exactamente el comportamiento de ayer.
   */
  const ruteoComun = async (paises: (string | null)[]): Promise<string[]> => {
    const listas = await Promise.all(paises.map((p) => chargeProvidersFor(p)));
    const [primera = [], ...resto] = listas;
    return primera.filter((clave) => resto.every((otra) => otra.includes(clave)));
  };

  // ⚠️ SE RESUELVE LA LISTA ENTERA, NO «EL PROVEEDOR». `chargeProvidersFor` no
  // filtra por disponibilidad a propósito: quien cobra necesita saber qué se
  // intentó, porque eso es lo que acaba en el 503.
  const cadena = cadenaDeCobro({
    cobrador: cobrar.cobrador,
    snapshot: cobrar.provider,
    ruteo: await ruteoComun(cobrar.payeeCountries),
  });

  // El ruteo manda, y manda la CABEZA de la cadena — que en el caso normal es el
  // snapshot: `payments.provider` es lo que `create_booking` congeló al
  // reservar, no la regla activa de ahora mismo. Mientras siga en 'simulated',
  // el camino de hoy — y la pregunta va ANTES de dar de alta al Customer porque
  // al revés el camino simulado empezaría a llamar a Stripe, que hoy no lo hace.
  //
  // ⚠️ SOLO DECIDE LA CABEZA, y no «¿hay algún PSP en la cadena?». Una reserva
  // congelada en 'simulated' se termina en simulado aunque la tabla ya nombre a
  // Stripe detrás: cambiar de camino a mitad es lo que la regla del snapshot
  // existe para impedir. El respaldo respalda a un cobro real, no convierte en
  // real uno que nació de mentira.
  const cabeza = adapterFor(cadena[0] ?? null);
  const retencion = retencionHasta(cobrar.creadoEn);
  if (!cabeza.opensRemoteCheckout) {
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

  // ⚠️ AQUÍ ESTABA EL `missingChargeConfig()` DEL ÚNICO PROVEEDOR, Y ERA EL
  // FINAL DEL CAMINO: sin credencial se devolvía 503 y el alumno no compraba,
  // aunque la tabla nombrara una segunda pasarela detrás. Ahora esa pregunta se
  // hace CANDIDATO A CANDIDATO dentro de `intentar`, y solo cuando la cadena se
  // agota entera se devuelve el 503 — con lo que le faltaba a cada uno.
  //
  // Lo que NO cambia: ningún camino cae al simulado por su cuenta (mismo
  // criterio que Daily). Caer al simulado sería regalar mentorías.
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
  const crearSesion = (psp: PspProvider, cliente: string, claveIdem: string) =>
    psp.charge({
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
  //
  // ⚠️ Y LA MISMA CLAVE VIAJA A LOS DOS PROVEEDORES DE LA CADENA, A PROPÓSITO.
  // No se le añade quién cobra, y no es un olvido: **cada proveedor tiene su
  // propio espacio de claves** y no se pueden pisar. En Stripe es la cabecera
  // `Idempotency-Key`, que vive dentro de nuestra cuenta de Stripe; en dLocal Go
  // es el `order_id` del cobro, que vive dentro de nuestra cuenta de dLocal (y
  // que su adaptador emula, porque repetirlo da `5009 Order id is duplicated` en
  // vez de devolver el cobro anterior — ver `ChargeInput.idempotencyKey`). Dos
  // sistemas distintos: la misma cadena no colisiona en ninguno.
  //
  // Y meter la clave del proveedor dentro sería PEOR, no más seguro: la clave
  // dejaría de ser determinista por sujeto en cuanto la cadena cambiara de
  // ganador, y lo que sostiene el montaje del formulario al llegar (D-2) es
  // justo que no cambie. Recargar el checkout tiene que reencontrar el cobro que
  // ya estaba abierto, sea de quien sea.
  const clave = `${cobrar.claveBase}-c${caduca}-${VERSION_PARAMS}`;

  /**
   * UN candidato: se le pregunta si puede y, si puede, se le pide el cobro.
   *
   * Las tres salidas y sus consecuencias están documentadas en `./cadena.ts`, y
   * la que importa es la tercera: si `charge()` LANZA se devuelve `en-duda` y la
   * cadena PARA. La petición pudo llegar, y abrir otro cobro deja dos cobros
   * vivos para la misma reserva.
   */
  const intentar = async (
    quien: string,
  ): Promise<Salida<Extract<ChargeResult, { ok: true }>>> => {
    const psp = adapterFor(quien);
    if (!psp.opensRemoteCheckout) {
      // 'simulated', 'manual', `null` o un error de tecleo en la tabla. No abre
      // cobros, así que no es un candidato — y no se cae al simulado por esto:
      // se anota el motivo y se pasa al siguiente.
      return { tipo: "descartado", motivo: `'${quien}' no es una pasarela: no abre cobros` };
    }
    // La credencial es el interruptor, candidato a candidato. Es determinista y
    // no se ha enviado nada: caerse al siguiente es gratis.
    const falta = psp.missingChargeConfig();
    if (falta) return { tipo: "descartado", motivo: falta };

    try {
      let cobro: ChargeResult;
      try {
        cobro = await crearSesion(psp, customer, clave);
      } catch (e) {
        // El Customer que teníamos guardado ya no existe en Stripe (datos de
        // prueba borrados, cuenta cambiada, alguien lo eliminó). Sin esto, esa
        // persona se queda con un 500 en cada intento de pago para siempre.
        //
        // Este rescate es LO ÚNICO que queda aquí con nombre de Stripe, y se
        // queda a propósito: lo que repara es `profiles.stripe_customer_id`, una
        // columna nuestra y de Stripe. Generalizarlo sin un segundo proveedor que
        // tenga el mismo problema sería inventarse la forma del hueco.
        //
        // ⚠️ Y ES UN REINTENTO CON EL MISMO PROVEEDOR, NO UN PASO AL SIGUIENTE.
        // No contradice la regla de parada: `esCustomerInexistente` reconoce un
        // 400 `resource_missing`, o sea un rechazo determinista de la propia
        // petición —el proveedor la validó y no creó nada—, que es el mismo
        // criterio que el `{ok:false}` del puerto. Lo que no se sabe si llegó es
        // un timeout o un 5xx, y esos siguen cayendo al `catch` de fuera.
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
        cobro = await crearSesion(psp, customer, `${clave}-r2`);
      }

      // El proveedor contestó y dijo que no. Por contrato del puerto no ha
      // creado nada, así que se prueba el siguiente de la cadena.
      if (!cobro.ok) {
        // 🔴 AQUÍ ESTUVO EL AGUJERO. Este `if` decía «no cobró → siguiente
        // candidato», sobre la premisa de que un `{ok:false}` significaba que
        // el proveedor no había creado nada. El puerto NUNCA dijo eso, y de sus
        // cuatro sitios TRES tienen un cobro vivo detrás. Ahora lo dice el
        // adaptador, campo `creado`, y solo 'nada' autoriza a probar otro.
        return cobro.creado === "nada"
          ? { tipo: "descartado", motivo: cobro.error }
          : {
              tipo: "en-duda",
              mensaje:
                `${cobro.error} — y el adaptador no puede descartar que haya un cobro abierto, ` +
                `así que NO se prueba otra pasarela`,
            };
      }
      return { tipo: "abierto", cobro };
    } catch (e) {
      // 🔴 NO SE SABE SI LLEGÓ. Se registra entero en el log —es lo único que va
      // a poder mirar quien investigue— y hacia fuera va un mensaje sin
      // interioridades del proveedor.
      console.error(`[pagos/checkout] ${quien} lanzó al abrir el cobro:`, e);
      return {
        tipo: "en-duda",
        mensaje: `'${quien}' no respondió y la petición pudo llegar`,
      };
    }
  };

  const recorrido = await recorreLaCadena(cadena, intentar);

  if (recorrido.estado === "en-duda") {
    // 503 y NO se prueba el siguiente candidato: ver la regla de parada en
    // `./cadena.ts`. Reintentar es recargar la pantalla, y entonces el cobro
    // que quizá se abrió se reencuentra por su lado —`refGuardada` en dLocal, la
    // clave de idempotencia en Stripe— en vez de duplicarse.
    return NextResponse.json(
      { error: `${recorrido.mensaje}. Vuelve a intentarlo en un momento.` },
      { status: 503 },
    );
  }

  if (recorrido.estado === "nadie") {
    // ⚠️ EL 503 DICE QUÉ LE FALTABA A CADA UNO, y por eso `chargeProvidersFor`
    // no filtra por disponibilidad: es lo que hace DEPURABLE encender un
    // proveedor. «No se pudo cobrar» obliga a adivinar entre una clave que
    // falta, una regla mal escrita y un país sin cobertura.
    //
    // Y sigue sin caer al simulado: una cadena agotada es un error de
    // configuración, no una invitación a fingir un cobro.
    return NextResponse.json({ error: porQueNadie(recorrido.intentos) }, { status: 503 });
  }

  const cobro = recorrido.cobro;

  /**
   * 🔴 QUE QUEDE ESCRITO QUIÉN COBRÓ DE VERDAD.
   *
   * `create_booking_line` congeló el PRIMER candidato en `payments.provider` y
   * su propio comentario dice que «quien abra el cobro ACTUALIZA esta columna si
   * acaba cobrando otro» (`20260903160000:147`). De esa columna cuelga el payout
   * entero: `build_payout_for_tutor` la copia a `payouts.funding_provider`
   * (`20260901130000`), que es el balance contra el que se paga y la atadura que
   * `payoutProviderFor` comprueba.
   *
   * ⚠️ Y NO SE PUEDE ESCRIBIR ESA COLUMNA DESDE AQUÍ. `service_role` tiene
   * exactamente `grant update (provider_payment_id, provider_metadata)` sobre
   * `payments` (`20260806170000:49`) — `provider` no está, y por la regla de oro
   * 9 eso no lo ve el typecheck: sería `permission denied` en tiempo de
   * ejecución, con el cobro ya abierto y el alumno mirando. Así que se anota en
   * `provider_metadata`, que sí está concedida, y **el resto está en `riesgos`
   * con la migración que hace falta**: sin ella, un cobro por el respaldo deja un
   * `funding_provider` que nombra al proveedor que NO tiene el dinero.
   *
   * Lo que esta anotación sí resuelve entera es la otra mitad, y es la que
   * podría cobrar dos veces: la cadena empieza por `checkout.cobrador`, así que
   * una recarga vuelve al proveedor que ya abrió el cobro en vez de abrir otro
   * con el preferido recién arreglado.
   */
  const anotarCobrador = async (quien: string) => {
    // Si antes cobró otro, su rastro no se borra: hay un cobro suyo abierto en su
    // proveedor y alguien va a tener que conciliarlo (mismo criterio que «anotar
    // no borra el rastro», `20260902180000`, con los payouts).
    const rastro = objeto(cobrar.metadata.checkout).previos;
    const previos = [
      ...(Array.isArray(rastro) ? rastro : []),
      ...(cobrar.cobrador ? [cobrar.cobrador] : []),
    ];
    const checkout: Metadata = {
      cobrador: quien,
      anotado_en: new Date().toISOString(),
      ...(previos.length > 0 ? { previos } : {}),
    };

    // ⚠️ UNA SOLA SENTENCIA PARA TODAS LAS LÍNEAS del pedido, y el `metadata`
    // que se conserva es el de la primera. Hoy es exacto porque **nadie más
    // escribe `payments.provider_metadata`** (el único que la toca es este
    // bloque). ponytail: el techo es ese; el día que otro camino escriba ahí por
    // línea, esto tiene que pasar a un merge fila a fila.
    const { error } = await admin
      .from("payments")
      .update({ provider_metadata: { ...cobrar.metadata, checkout } })
      .in("booking_id", cobrar.reservas);

    // 🔴 Y LO QUE DE VERDAD IMPORTA: mover `payments.provider` al que cobró.
    //
    // El rastro de arriba sirve para conciliar; esta columna DECIDE. De ella
    // cuelgan dos cosas y las dos son dinero: de qué saldo sale el pago al tutor
    // (la atadura de balance que comprueba `payoutProviderFor`) y por qué
    // proveedor se le devuelve el dinero a un alumno que cancela. Si la cadena
    // se cayó al segundo candidato y esta columna sigue diciendo el primero, el
    // payout se ata a un saldo que no tiene el dinero y el reembolso sale por
    // donde nunca entró.
    //
    // Va por RPC y no por un `update` directo porque `service_role` NO tiene
    // `grant update (provider)` — a propósito: una columna de dinero abierta a
    // cualquier código de servidor es una que alguien mueve por accidente.
    // `set_charge_provider` solo la deja ir a un proveedor que la ruta de ESE
    // pago nombra, y solo mientras el cobro sigue pendiente (`20260903190000`).
    if (quien !== cobrar.provider) {
      const { data: pagos } = await admin
        .from("payments")
        .select("id")
        .in("booking_id", cobrar.reservas);

      for (const { id } of pagos ?? []) {
        const { error: e } = await admin.rpc("set_charge_provider", {
          p_payment_id: id,
          p_provider: quien,
        });
        // Mismo criterio que el rastro: no se aborta con el cobro ya abierto.
        // Pero esto sí se grita distinto, porque deja un dato de dinero mal.
        if (e) {
          console.error(
            `[pagos/checkout] 🔴 el cobro lo abrió '${quien}' y payments.provider ` +
              `sigue en '${cobrar.provider}' para ${id}: ${e.message}`,
          );
        }
      }
    }

    // No se aborta: el cobro ya está abierto y dejar al alumno sin pantalla por
    // no poder anotar sería cambiar un problema de conciliación por uno de venta.
    // Se grita en el log, que es donde se mira cuando un payout no cuadra.
    if (error) {
      console.error("[pagos/checkout] no se pudo anotar quién cobró:", error.message);
    }
  };

  // Se anota solo cuando hace falta: si ganó el snapshot, `payments.provider` ya
  // lo dice, y si ganó el que ya estaba anotado, no hay nada nuevo que decir.
  if (recorrido.clave !== cobrar.provider && recorrido.clave !== cobrar.cobrador) {
    await anotarCobrador(recorrido.clave);
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
