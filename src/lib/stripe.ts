import "server-only";

import Stripe from "stripe";

/**
 * Cliente de Stripe. **Solo servidor** — `STRIPE_API_KEY` puede crear cobros
 * y reembolsos en nombre del comercio. Misma regla que `service_role` y que
 * `DAILY_API_KEY`: el `server-only` de arriba rompe el build si alguien lo
 * importa desde un componente cliente, en vez de filtrar la clave en el bundle.
 *
 * LA CREDENCIAL ES EL INTERRUPTOR, como el resto del proyecto: sin
 * `STRIPE_API_KEY` no se instancia nada y el checkout sigue por el camino
 * simulado. Activar Stripe es poner la variable y cambiar la fila de
 * `payment_routing_rules` — en ese orden.
 */

/**
 * Versión de API FIJADA a mano, no heredada del panel. Si se deja al panel, el
 * día que Stripe la mueva cambian las formas de los objetos que llegan por
 * webhook sin que nadie haya tocado una línea de código. Este valor es el que
 * trae el SDK instalado (`stripe@22`, node_modules/stripe/cjs/apiVersion.js).
 */
const API_VERSION = "2026-07-29.dahlia" as const;

let cliente: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_API_KEY);
}

/**
 * Clave publicable, la que necesita el navegador para montar el formulario de
 * pago. Es pública por diseño: solo sirve para crear tokens contra la
 * cuenta, nunca para leer ni mover dinero. Aun así NO lleva prefijo
 * `NEXT_PUBLIC_` — se manda desde el Route Handler junto al `client_secret`,
 * para que encender Stripe siga siendo poner las claves del servidor y nada más.
 *
 * Va aparte de `isStripeConfigured()` a propósito: listar y borrar tarjetas
 * guardadas solo necesita la secreta, y acoplarlas dejaría esas pantallas sin
 * funcionar por una clave que no usan.
 */
export function publishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY ?? null;
}

/**
 * Perezoso a propósito. Instanciar en el top-level del módulo revienta
 * `next build` cuando la clave no está en el entorno de build — que es
 * exactamente el estado del proyecto hasta que se configure en Vercel.
 */
export function stripe(): Stripe {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error("STRIPE_API_KEY no configurada");
  cliente ??= new Stripe(key, { apiVersion: API_VERSION });
  return cliente;
}

/**
 * Base absoluta para `return_url`. Stripe la exige absoluta y con protocolo.
 *
 * ⚠️ ESTO ES EX-07. `VERCEL_URL` es la URL del DESPLIEGUE CONCRETO
 * (`ensenameya-a1b2c3….vercel.app`) y **cambia en cada push**, así que la URL a
 * la que Stripe devuelve al alumno tras pagar deja de existir en cuanto alguien
 * publica. Es exactamente el fallo que se reportó como «pantalla de Vercel tras
 * pagar» y que se cerró como «cosa del sandbox, en producción no se reproduce».
 * Se reproduce igual: lo único que lo evitaba era acordarse de poner
 * `NEXT_PUBLIC_SITE_URL` a mano, y nadie se acordó.
 *
 * La corrección es preferir las URL ESTABLES que Vercel ya expone (requieren
 * "System Environment Variables" activado, que lo está):
 *   · producción → `VERCEL_PROJECT_PRODUCTION_URL`, el dominio del proyecto;
 *   · preview    → `VERCEL_BRANCH_URL`, el alias fijo de la rama
 *                  (`ensenameya-git-dev-….vercel.app`), que NO cambia por push.
 *
 * El reparto por entorno es lo que hace esto seguro, y es la pieza que faltaba
 * en la versión anterior de este comentario: `VERCEL_PROJECT_PRODUCTION_URL`
 * está definida TAMBIÉN en los previews, así que usarla sin mirar `VERCEL_ENV`
 * devolvería al alumno a la app de producción tras pagar en pruebas. Por eso se
 * ramifica en vez de encadenar reservas.
 *
 * `NEXT_PUBLIC_SITE_URL` sigue mandando sobre todo: es la salida para un
 * dominio propio el día que lo haya.
 */
export function siteUrl(): string {
  const explicita = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicita) return explicita.replace(/\/$/, "");

  const entorno = process.env.VERCEL_ENV;
  const estable =
    entorno === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : entorno === "preview"
        ? process.env.VERCEL_BRANCH_URL
        : undefined;
  if (estable) return `https://${estable}`;

  // Último recurso: la del despliegue. Inestable, pero mejor que nada — y en
  // `development` (vercel dev) es la única que hay.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Devuelve el Customer de la persona, creándolo solo la primera vez.
 *
 * Por qué no basta con `customer_email` en la Session: ese campo solo rellena
 * el formulario. Con `customer_creation: 'always'` Stripe crea un Customer
 * NUEVO en cada compra, y entonces Referral Factory ve cinco fichas de 20 USD
 * en vez de una de 100 — el umbral no se alcanza y el referidor no cobra.
 *
 * Se busca por email antes de crear porque el Customer puede existir ya: lo
 * crea Referral Factory al registrar al lead, antes incluso de que la persona
 * se registre en la plataforma. Si creáramos otro, romperíamos la atribución
 * justo en el caso que el programa de referidos existe para cubrir.
 */
export async function ensureCustomer(opts: {
  email: string;
  nombre: string | null;
  profileId: string;
  /** El que ya tuviéramos guardado, si lo hay. */
  guardado: string | null;
}): Promise<string> {
  if (opts.guardado) return opts.guardado;

  const s = stripe();
  // ponytail: `list` por email es una llamada de más en el alta, pero es la que
  // engancha con el Customer que Referral Factory pudo crear antes que nosotros.
  const existentes = await s.customers.list({ email: opts.email, limit: 1 });
  if (existentes.data[0]) return existentes.data[0].id;

  const creado = await s.customers.create({
    email: opts.email,
    name: opts.nombre ?? undefined,
    metadata: { profile_id: opts.profileId },
  });
  return creado.id;
}

/** Una tarjeta guardada, con lo justo para enseñarla. Nunca el PAN. */
export type SavedCard = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  /** Titular tal como lo guardó el proveedor. Puede venir vacío. */
  nombre: string | null;
};

/**
 * PAC-02 · las tarjetas guardadas de una persona.
 *
 * Se leen de Stripe y NO de nuestra tabla: el PSP es quien sabe si una tarjeta
 * sigue viva, si caducó o si el banco la reemplazó. Una copia local solo añade
 * un sitio donde quedar desfasado y enseñarle al alumno una tarjeta que ya no
 * existe.
 */
export async function listSavedCards(customerId: string): Promise<SavedCard[]> {
  const res = await stripe().paymentMethods.list({
    customer: customerId,
    type: "card",
  });
  return res.data
    .filter((pm) => pm.card)
    .map((pm) => ({
      id: pm.id,
      brand: pm.card!.brand,
      last4: pm.card!.last4,
      expMonth: pm.card!.exp_month,
      expYear: pm.card!.exp_year,
      nombre: pm.billing_details?.name ?? null,
    }));
}

/**
 * La tarjeta con la que se pagó por última vez.
 *
 * Stripe lista los medios de pago por fecha de CREACIÓN, no de uso, así que sin
 * esto "la última que usaste" sería mentira en cuanto alguien pague con la
 * segunda. Se saca del historial de cobros, que es donde consta de verdad.
 *
 * Devuelve null si no hay cobros aún o si la tarjeta con la que se pagó ya se
 * quitó: el que llama se queda con el orden por defecto.
 */
export async function lastUsedCardId(customerId: string): Promise<string | null> {
  const res = await stripe().paymentIntents.list({ customer: customerId, limit: 5 });
  for (const pi of res.data) {
    if (pi.status !== "succeeded") continue;
    const pm = pi.payment_method;
    if (typeof pm === "string") return pm;
  }
  return null;
}

/**
 * Desvincula una tarjeta del Customer. `detach` no borra el histórico de cobros
 * —los pagos ya hechos siguen ahí, como debe ser— solo deja de poder usarse.
 */
export async function detachCard(paymentMethodId: string): Promise<void> {
  await stripe().paymentMethods.detach(paymentMethodId);
}

/**
 * ¿Stripe se está quejando de que el Customer que le pasamos no existe?
 *
 * Pasa más de lo que parece: se borran los datos de prueba del sandbox, se
 * cambia de cuenta, alguien elimina el Customer a mano. El id que guardamos en
 * `profiles` queda apuntando a la nada, y como lo reutilizamos a ciegas en cada
 * compra, esa persona se queda **sin poder pagar nunca más** — un 500 en cada
 * intento, para siempre, hasta que alguien mire la base de datos.
 *
 * Verificar el Customer antes de cada checkout costaría una llamada extra
 * SIEMPRE para cubrir un caso raro. Sale más barato ser optimista y saber
 * reconocer este error concreto para rehacerlo una vez.
 */
export function esCustomerInexistente(e: unknown): boolean {
  const err = e as { type?: string; code?: string; param?: string };
  return (
    err?.type === "StripeInvalidRequestError" &&
    err?.code === "resource_missing" &&
    err?.param === "customer"
  );
}

/**
 * ── LA CAJA FUERTE DE TARJETAS (N-31 / PAC-02) ─────────────────────────────
 *
 * Guardar, listar y quitar tarjetas NO está en el puerto de pagos, y es una
 * decisión, no un olvido: el puerto cubre cobrar, devolver y escuchar webhooks
 * —lo que un segundo PSP tendrá que implementar entero— y el vault de tarjetas
 * de Stripe no tiene equivalente garantizado en dLocal. Meterlo en la interfaz
 * sería obligar al próximo adaptador a fingir tres métodos más.
 *
 * Vive aquí, junto al cliente del SDK, para que siga cumpliéndose el invariante
 * que hace barato el adaptador de dLocal: `stripe()` solo se importa en ESTE
 * archivo y en `lib/payments/stripe-provider.ts`. Si aparece un tercero, algo
 * se ha escapado del puerto.
 */

/**
 * N-31 · abre el formulario para AÑADIR una tarjeta desde el perfil, sin
 * empezar una compra.
 *
 * `mode: 'setup'` en vez de un SetupIntent + Elements a pelo porque reutiliza
 * entero el camino que ya está probado: mismo componente de montaje
 * (`StripeEmbed`), mismo `ui_mode`, mismo `locale`, mismo `return_url`. Un
 * PaymentElement propio daría control sobre `usage` (ver abajo) a cambio de un
 * segundo formulario de pago que mantener. Y sigue siendo PCI-DSS SAQ A: el PAN
 * vive en un iframe del proveedor y no toca nuestro DOM.
 *
 * SIN `idempotencyKey`, y es a propósito: aquí no hay entidad estable que sirva
 * de clave —una persona puede querer añadir una segunda tarjeta un minuto
 * después de la primera, y cualquier clave por usuario le devolvería la Session
 * anterior—. El cobro sí la necesita porque un doble clic abría dos cobros; una
 * Session de `setup` no mueve dinero, así que la peor consecuencia de
 * duplicarla es una Session sin completar que caduca sola.
 */
export async function crearSesionDeAltaDeTarjeta(opts: {
  customerId: string;
  profileId: string;
  returnUrl: string;
}): Promise<Stripe.Checkout.Session> {
  return await stripe().checkout.sessions.create({
    mode: "setup",
    customer: opts.customerId,
    // Mismo criterio que el cobro: solo tarjeta. Dejarlo al panel traería
    // Cash App Pay, Amazon Pay y Klarna, que además de irrelevantes para
    // Latinoamérica ni siquiera se pueden "guardar" como un card-on-file.
    payment_method_types: ["card"],
    // ⚠️ ESTA LÍNEA ES LA QUE HACE QUE TODO ESTO SIRVA DE ALGO.
    //
    // El checkout de una reserva filtra las tarjetas guardadas por
    // `saved_payment_method_options.allow_redisplay_filters: ['always',
    // 'limited']` (ver `lib/payments/stripe-provider.ts`). Una tarjeta que nace
    // con `allow_redisplay: 'unspecified'` —el valor por defecto de las que se
    // guardan fuera de un cobro— NO entra en ese filtro: se vería en esta
    // pantalla y NO aparecería a la hora de pagar. O sea, la funcionalidad
    // parecería hecha y no serviría para nada, que es el peor fallo posible
    // porque nadie lo reporta.
    //
    // El campo existe justo para esto: la propia API lo describe como
    // "override the allow_redisplay value determined by Checkout".
    payment_method_data: { allow_redisplay: "always" },
    setup_intent_data: {
      // Para poder rastrear de quién salió, igual que el `booking_id` del
      // cobro: los eventos de SetupIntent no traen la Session.
      metadata: { profile_id: opts.profileId },
    },
    // OJO: `saved_payment_method_options` NO se pasa aquí. La API solo lo
    // admite en `payment` y `subscription`; en `setup` devuelve 400.
    //
    // ⚠️ Y `setup_intent_data` no expone `usage`, así que esta Session crea el
    // SetupIntent con el `off_session` que Checkout pone por defecto. Antes
    // eso era una divergencia —el cobro pedía el permiso menor,
    // `setup_future_usage: 'on_session'`, y esta pantalla el mayor—; desde D-3
    // (§20.14) el cobro también deja el guardado en manos de Checkout
    // (`payment_method_save`), así que los dos caminos guardan igual y el
    // trato es el mismo en los dos sitios. Cambia cómo se autentica la tarjeta
    // (se pide 3DS ahora para que un cargo futuro sin la persona delante no lo
    // vuelva a pedir), NO lo que hacemos con ella: no existe ni un solo camino
    // que cobre fuera de una Checkout Session con la persona delante. Si algún
    // día se quisiera el permiso menor de verdad, habría que bajar a
    // SetupIntent + Elements en los DOS.
    //
    // MN-01 · `form`, igual que el cobro, y por la MISMA razón: `embedded_page`
    // pintaba la pantalla completa de Stripe dentro del recuadro y su interior
    // no se podía reestilizar. Aquí el sinsentido era mayor todavía —una
    // pantalla de «resumen del pedido» para un alta de tarjeta que no cobra
    // nada—. Este sitio va con los otros dos A PROPÓSITO: dejar el alta de
    // tarjeta en el modo viejo dejaría dos formularios de pago con dos aspectos
    // distintos en el mismo producto, que es justo lo que N-37 vino a arreglar.
    ui_mode: "form",
    // MN-02 · el titular, también al guardar tarjeta — el cliente pidió las
    // dos. **Requerido desde V-4a (24-ago)**, que da marcha atrás sobre la
    // respuesta P-5 del 20-ago; el porqué y el límite del literal están en
    // `lib/payments/stripe-provider.ts`, que es el sitio del cobro.
    //
    // Aquí NO hay clave de idempotencia que versionar —esta Session no la
    // tiene, a propósito (ver arriba)—, así que el cambio no arrastra nada.
    // Comprobado contra *test mode* el 26-ago: en `mode: 'setup'` la Session
    // acepta `optional: false` y lo devuelve.
    name_collection: { individual: { enabled: true, optional: false } },
    // Sin esto Stripe rotula según el navegador y salía "Payment method" en
    // mitad de una pantalla en español.
    locale: "es",
    return_url: opts.returnUrl,
  });
}

/**
 * La Session de alta, con su SetupIntent dentro, o `null` si Stripe no la
 * reconoce.
 *
 * El id viene de la URL, así que puede ser cualquier cosa con forma de `cs_`.
 * Un id inexistente es "no encontrada", no un 500 nuestro llenando los logs.
 */
export async function recuperarSesionDeAlta(
  sessionId: string,
): Promise<Stripe.Checkout.Session | null> {
  try {
    return await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ["setup_intent"],
    });
  } catch (e) {
    if ((e as { type?: string })?.type !== "StripeInvalidRequestError") throw e;
    return null;
  }
}

/**
 * Deja la tarjeta marcada como reutilizable. Es idempotente: se pone sin
 * preguntar antes, porque comprobar el valor actual costaría una llamada extra
 * siempre para ahorrar una escritura que ya no hace daño.
 */
export async function permitirReutilizacion(paymentMethodId: string): Promise<void> {
  await stripe().paymentMethods.update(paymentMethodId, { allow_redisplay: "always" });
}

/**
 * ── CONNECT · LO QUE HACE FALTA PARA PAGARLE A UN TUTOR ─────────────────────
 *
 * Cuatro llamadas y ninguna más. Viven aquí y no en el adaptador por el mismo
 * invariante que el resto del archivo: las llamadas al SDK están en `lib/`, la
 * decisión de qué significa cada respuesta está en el puerto.
 *
 * ⚠️ EL ACUERDO ES `recipient`, Y ESO CAMBIA QUÉ ES LA CUENTA. Bajo el
 * *recipient service agreement* la cuenta conectada solo puede RECIBIR
 * transferencias y pagarse a sí misma al banco: no cobra, no tiene panel de
 * Stripe y no es un comercio. Es lo correcto para un tutor —no vende nada a
 * través de nuestra plataforma con su propia cuenta— y es además lo que hace
 * que baste con la capability `transfers`, sin el KYC completo de un comercio.
 */

/**
 * Crea la cuenta conectada de un tutor. Devuelve el `acct_…`.
 *
 * ⚠️ EL PAÍS SE CONGELA AQUÍ Y STRIPE NO LO DEJA CAMBIAR. Si un tutor se muda,
 * la cuenta vieja no vale y hay que crear otra — por eso el país sale del
 * `payout_country` que él mismo declaró y no de una IP ni de su zona horaria.
 */
export async function crearCuentaConectada(opts: {
  country: string;
  email: string | null;
}): Promise<string> {
  const cuenta = await stripe().accounts.create({
    type: "express",
    country: opts.country.toUpperCase(),
    ...(opts.email ? { email: opts.email } : {}),
    // Solo recibir. Nada de `card_payments`: este tutor no cobra por su cuenta.
    capabilities: { transfers: { requested: true } },
    tos_acceptance: { service_agreement: "recipient" },
  });
  return cuenta.id;
}

/**
 * El enlace de alta que el tutor tiene que abrir. Caduca en minutos y es de un
 * solo uso: se pide uno nuevo cada vez que pulsa, y por eso este helper no
 * cachea nada.
 */
export async function enlaceDeAltaConectada(opts: {
  account: string;
  returnUrl: string;
}): Promise<string> {
  const enlace = await stripe().accountLinks.create({
    account: opts.account,
    // Las dos al mismo sitio: la pantalla de payouts ya sabe leer el estado de
    // la cuenta y decir si el alta quedó a medias.
    refresh_url: opts.returnUrl,
    return_url: opts.returnUrl,
    type: "account_onboarding",
  });
  return enlace.url;
}

/** ¿Puede esta cuenta recibir dinero ya? Es lo único que se le pregunta. */
export async function cuentaConectadaLista(account: string): Promise<{
  lista: boolean;
  pendiente: string | null;
}> {
  const c = await stripe().accounts.retrieve(account);
  if (c.capabilities?.transfers === "active") return { lista: true, pendiente: null };
  const falta = c.requirements?.currently_due ?? [];
  return {
    lista: false,
    pendiente: falta.length > 0 ? falta.join(", ") : "Stripe sigue revisando el alta",
  };
}

/**
 * La transferencia. `idempotencyKey` es LA MARCA del payout, y es lo que hace
 * que este riel no necesite el barrido de páginas que sí necesita dLocal Go:
 * repetir esta llamada con la misma clave devuelve la misma transferencia.
 *
 * `transfer_group` lleva también la marca, y no es duplicar por duplicar: la
 * clave de idempotencia caduca a las 24 h y el grupo no, así que una orden que
 * se reanuda dos días después todavía se puede encontrar por él.
 */
export async function crearTransferencia(opts: {
  amountMinor: number;
  currency: string;
  destination: string;
  marca: string;
  descripcion: string;
}): Promise<Stripe.Transfer> {
  return await stripe().transfers.create(
    {
      amount: opts.amountMinor,
      currency: opts.currency.toLowerCase(),
      destination: opts.destination,
      transfer_group: opts.marca,
      description: opts.descripcion,
      metadata: { marca: opts.marca },
    },
    { idempotencyKey: opts.marca },
  );
}

/**
 * Busca por la marca. UNA llamada, sin paginar: el filtro es exacto y la marca
 * es única por (payout, intento), así que una lista vacía DEMUESTRA que no se
 * creó nada — que es la palabra cara del puerto y la única que autoriza a
 * devolver una orden a la cola.
 */
export async function transferenciaPorMarca(marca: string): Promise<Stripe.Transfer | null> {
  const lista = await stripe().transfers.list({ transfer_group: marca, limit: 2 });
  return lista.data[0] ?? null;
}

/** Una transferencia concreta, para seguir una orden que ya está en vuelo. */
export async function recuperarTransferencia(id: string): Promise<Stripe.Transfer> {
  return await stripe().transfers.retrieve(id);
}
