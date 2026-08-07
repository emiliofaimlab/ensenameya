import "server-only";

import Stripe from "stripe";

/**
 * Cliente de Stripe. **Solo servidor** — `STRIPE_SECRET_KEY` puede crear cobros
 * y reembolsos en nombre del comercio. Misma regla que `service_role` y que
 * `DAILY_API_KEY`: el `server-only` de arriba rompe el build si alguien lo
 * importa desde un componente cliente, en vez de filtrar la clave en el bundle.
 *
 * LA CREDENCIAL ES EL INTERRUPTOR, como el resto del proyecto: sin
 * `STRIPE_SECRET_KEY` no se instancia nada y el checkout sigue por el camino
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
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Perezoso a propósito. Instanciar en el top-level del módulo revienta
 * `next build` cuando la clave no está en el entorno de build — que es
 * exactamente el estado del proyecto hasta que se configure en Vercel.
 */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY no configurada");
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
  const existentes = await s.customers.list({ email: opts.email, limit: 1 });
  if (existentes.data[0]) return existentes.data[0].id;

  const creado = await s.customers.create({
    email: opts.email,
    name: opts.nombre ?? undefined,
    metadata: { profile_id: opts.profileId },
  });
  return creado.id;
}
