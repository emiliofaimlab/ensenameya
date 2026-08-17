import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { bookingTotal, tutorNames } from "@/lib/booking";
import { PanelShell } from "@/components/layout/panel-shell";
import { SlotPicker } from "./slot-picker";

export const metadata = { title: "Elegir horario · Enséñame Ya" };

/**
 * US-601 (SCR-AL04) — elegir horario. Requiere sesión (alumno). Los slots los
 * calcula la función controlada get_available_slots (reglas − excepciones −
 * ocupados, S-41). El checkout (US-602) recibe los slots elegidos.
 *
 * M-10 · `?slot=…` llega desde el panel de reserva de la ficha pública
 * (`BookingPanel`), donde el alumno YA pulsó una hora. Sin sesión, esa hora
 * sobrevive al desvío por el login gracias a que el `?next=` ahora viaja con su
 * query (`lib/supabase/middleware.ts`); aquí se vuelve a marcar sola.
 */
export default async function ReservarPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ slot?: string }>;
}) {
  const [{ productId }, { slot }] = await Promise.all([params, searchParams]);
  await requireUser();

  // getProductDetail solo devuelve productos reservables (active + tutor aprobado).
  const product = await getProductDetail(productId);
  if (!product) notFound();

  const supabase = await createClient();
  const [{ data: slots }, names] = await Promise.all([
    supabase.rpc("get_available_slots", { p_product_id: productId }),
    tutorNames(supabase, [product.tutor.id]),
  ]);

  const tutorName = names.get(product.tutor.id) ?? product.tutor.headline ?? undefined;
  const required =
    product.pricingModel === "per_package" ? (product.packageNumSessions ?? 1) : 1;

  // Se compara por INSTANTE, no por cadena: el hueco que enlaza la ficha sale
  // de otra llamada a `get_available_slots` (con rango de fechas propio) y basta
  // con que Postgres devuelva el mismo momento con otro formato —o que el
  // navegador reescriba el `+` del ISO— para que un `===` no case nunca. Se
  // guarda el `slot_start` canónico, que es la clave que maneja el selector.
  const elegido = slot
    ? (slots ?? []).find(
        (s) => Date.parse(s.slot_start) === Date.parse(slot),
      )?.slot_start
    : undefined;

  return (
    <PanelShell back={{ href: `/products/${productId}`, label: "Volver a la mentoría" }}>
      <div className="flex flex-col gap-1.5">
        {tutorName ? (
          <p className="text-[13px] text-[#6b6b6b]">con {tutorName}</p>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-balance text-[#19191f] sm:text-[24px]">
          {required > 1
            ? `Agenda tu paquete: ${product.title}`
            : `Agenda tu sesión: ${product.title}`}
        </h1>
        <p className="text-sm text-[#6b6b6b]">
          {required > 1 ? `Elige ${required} sesiones` : "Elige tu horario"}
          {product.sessionDurationMin ? ` de ${product.sessionDurationMin} min` : ""}
          . Todos los horarios están en tu hora local.
        </p>
      </div>

      <SlotPicker
        productId={productId}
        productTitle={product.title}
        tutorName={tutorName}
        slots={slots ?? []}
        preselected={elegido ?? null}
        required={required}
        total={bookingTotal(product)}
        currency={product.currency}
        durationMin={product.sessionDurationMin}
      />
    </PanelShell>
  );
}
