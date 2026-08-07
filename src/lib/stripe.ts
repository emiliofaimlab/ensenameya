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
 * Base absoluta para `success_url` / `cancel_url`. Stripe las exige absolutas
 * y con protocolo.
 *
 * El orden importa: `VERCEL_PROJECT_PRODUCTION_URL` NO sirve de reserva porque
 * apunta siempre a producción — usarla en un preview devolvería al alumno a la
 * app de producción tras pagar en el entorno de pruebas. `VERCEL_URL` sí es la
 * del despliegue concreto, pero viene sin protocolo.
 */
export function siteUrl(): string {
  const explicita = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicita) return explicita.replace(/\/$/, "");
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
