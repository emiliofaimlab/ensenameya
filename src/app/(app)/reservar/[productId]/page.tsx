import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { priceLabel } from "@/lib/catalog/format";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
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
  const { data: slots } = await supabase.rpc("get_available_slots", {
    p_product_id: productId,
  });

  const required =
    product.pricingModel === "per_package" ? (product.packageNumSessions ?? 1) : 1;

  return (
    <div className="bg-muted">
      <Container>
        <Section className="flex flex-col gap-6">
          <Link
            href={`/products/${productId}`}
            className="flex w-fit items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <ArrowLeftIcon className="size-4" />
            Volver a la mentoría
          </Link>

          <div>
            <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-[26px]">
              {required > 1
                ? `Agenda tu paquete: ${product.title}`
                : `Agenda tu sesión: ${product.title}`}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {required > 1
                ? `Elige ${required} sesiones`
                : "Elige tu horario"}
              {product.sessionDurationMin
                ? ` de ${product.sessionDurationMin} min`
                : ""}
              . Todos los horarios están en tu hora local.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {priceLabel(product)} · con{" "}
              {product.tutor.headline ?? "tu tutor"}
            </p>
          </div>

          <SlotPicker
            productId={productId}
            slots={slots ?? []}
            required={required}
          />
        </Section>
      </Container>
    </div>
  );
}
