import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { bookingTotal, tutorNames } from "@/lib/booking";
import { activeChargeProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured, lastUsedCardId, listSavedCards } from "@/lib/stripe";
import { CheckoutForm } from "@/components/checkout/checkout-form";

export const metadata = { title: "Confirmar pago · Enséñame Ya" };

/**
 * US-602 (SCR-AL05) — checkout. Recibe los slots elegidos (en el flujo normal,
 * directamente desde el calendario de la ficha: N-33). El total lo congela
 * `create_booking` server-side; aquí solo se muestra para confirmar.
 *
 * N-37 · cuelga del grupo `(checkout)`, no de `(app)`: sin cabecera, sin menú,
 * sin pie y sin chat. El porqué y la trampa de los layouts anidados están en
 * `src/app/(checkout)/layout.tsx`. La URL no cambia —los grupos de rutas no
 * salen en la dirección—, así que todos los enlaces de siempre siguen valiendo.
 *
 * La guarda de sesión la pone este `requireUser()` y no el layout: es también
 * quien exige el onboarding y quien arma el `?next=` con la query, de modo que
 * quien llegue aquí sin sesión vuelve del login con sus horarios intactos.
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ slots?: string }>;
}) {
  const { productId } = await params;
  const { slots: slotsParam } = await searchParams;
  const { user } = await requireUser();

  const product = await getProductDetail(productId);
  if (!product) notFound();

  const slots = (slotsParam ?? "").split(",").filter(Boolean);
  const required =
    product.pricingModel === "per_package" ? (product.packageNumSessions ?? 1) : 1;
  // Selección inválida → de vuelta al picker (evita un checkout inconsistente).
  // ⚠️ Al `/reservar/<id>` PELADO, sin `?slot=`: con la hora en la query esa
  // página rebotaría otra vez aquí (N-33) y serían dos redirecciones en bucle.
  if (slots.length !== required) redirect(`/reservar/${productId}`);

  const supabase = await createClient();
  const names = await tutorNames(supabase, [product.tutor.id]);
  // La pantalla tiene que decir la verdad ANTES de que el alumno pulse.
  const simulado = (await activeChargeProvider()) === "simulated";

  // M-02 · ¿esta mentoría acepta sola? Cambia lo que se promete abajo: con la
  // aceptación automática la reserva pagada salta a `confirmed` sin pasar por
  // `pending_acceptance`, así que NO hay ventana de 24 h ni reembolso íntegro
  // automático (RN-38). Va en consulta aparte porque `getProductDetail` no trae
  // la columna y `lib/catalog/queries.ts` lo comparten media docena de
  // pantallas públicas que no necesitan este dato.
  const { data: aceptacion } = await supabase
    .from("products")
    .select("auto_accept_bookings")
    .eq("id", productId)
    .maybeSingle();

  // La tarjeta ilustrada tiene que enseñar la de verdad o ninguna. Antes era un
  // adorno del Figma con un `4821` escrito a mano, y parecía una tarjeta
  // guardada que no existía —seguía ahí después de guardar una de verdad—.
  const { data: perfilPago } = await createAdminClient()
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const cliente =
    !simulado && isStripeConfigured() ? (perfilPago?.stripe_customer_id ?? null) : null;

  // Las dos consultas van juntas: la segunda solo sirve para poner delante la
  // que de verdad se usó la última vez, y esperarla en serie sería medio
  // segundo de nada a cambio de nada.
  const [guardadas, ultimaId] = cliente
    ? await Promise.all([listSavedCards(cliente), lastUsedCardId(cliente)])
    : [[], null];

  const tarjetas = ultimaId
    ? [...guardadas].sort((a, b) => Number(b.id === ultimaId) - Number(a.id === ultimaId))
    : guardadas;
  const tutorName =
    names.get(product.tutor.id) ?? product.tutor.headline ?? "tu tutor";

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* La ÚNICA salida de esta pantalla, y no es una salida del sitio: es
            parte de la misma compra. Aislar el checkout no puede significar
            dejar a alguien encerrado con un horario que ya no le sirve. */}
        <Link
          href={`/reservar/${productId}`}
          className="mb-4 flex w-fit items-center gap-1.5 text-sm text-[#6b6b6b] transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Cambiar horario
        </Link>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          Confirmar pago
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Revisa y completa el pago de tu reserva. El cobro lo procesa nuestro
          proveedor de pagos.
        </p>
      </div>

      <CheckoutForm
        simulado={simulado}
        tarjetas={tarjetas}
        hayUltimaUsada={Boolean(ultimaId && tarjetas[0]?.id === ultimaId)}
        productId={productId}
        slots={slots}
        total={bookingTotal(product)}
        currency={product.currency}
        productTitle={product.title}
        tutorName={tutorName}
        packageLabel={
          required > 1 ? `Paquete ${required} sesiones` : "Sesión suelta"
        }
        // Sin fila legible se asume que NO acepta sola: es el mensaje
        // conservador (promete la ventana de 24 h, que es lo que pasa cuando la
        // columna está en false) y nunca promete de menos.
        aceptaSola={aceptacion?.auto_accept_bookings ?? false}
      />
    </div>
  );
}
