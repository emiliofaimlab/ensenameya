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
 */
export default async function ReservarPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
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
        required={required}
        total={bookingTotal(product)}
        currency={product.currency}
        durationMin={product.sessionDurationMin}
      />
    </PanelShell>
  );
}
