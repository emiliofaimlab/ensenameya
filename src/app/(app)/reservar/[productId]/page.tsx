import { notFound, redirect } from "next/navigation";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
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
 * query (`lib/supabase/middleware.ts`).
 *
 * ⚠️ N-33 + N-32 · ESTA PANTALLA YA NO ESTÁ EN EL CAMINO NORMAL DE UNA SESIÓN
 * SUELTA. Si el alumno llega con una hora que existe y la mentoría solo pide
 * una, se le manda derecho al pago: pintarle un segundo calendario para que
 * repita la elección era la queja («estás seleccionando dos veces algo»).
 *
 * Lo que le queda —y no es poco, por eso la pantalla sigue viva—:
 *   · los PAQUETES, que exigen elegir N horarios (RN-12) y no tienen otro sitio
 *     donde hacerlo;
 *   · quien llega SIN hora (el botón grande de la ficha, un enlace guardado);
 *   · quien llega con una hora que ya no existe: se la ocuparon mientras
 *     miraba, o se registró por el camino y pasaron minutos. Ahí el calendario
 *     es la respuesta correcta, no un estorbo.
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
  const [{ data: slots }, names, tz] = await Promise.all([
    supabase.rpc("get_available_slots", { p_product_id: productId }),
    tutorNames(supabase, [product.tutor.id]),
    // Sin zona explícita el SSR agruparía los huecos por el día del SERVIDOR
    // (UTC en Vercel) y el calendario del cliente por el del navegador: dos
    // rejillas distintas para los mismos datos (R24-12 / R24-22).
    getUserTimezone(),
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

  // N-33 · una hora válida + una sola sesión que elegir = no hay nada que
  // preguntar. Se va al pago con el horario ya en la URL.
  //
  // No hay riesgo de bucle con el checkout —que rebota aquí cuando la selección
  // no cuadra— porque ese rebote es a `/reservar/<id>` PELADO, sin `?slot=`, y
  // sin `?slot=` esta condición no se cumple nunca.
  if (required === 1 && elegido) {
    redirect(`/reservar/${productId}/checkout?slots=${encodeURIComponent(elegido)}`);
  }

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
        {/* Traía una hora concreta y ya no está entre las libres: se la
            ocuparon mientras miraba, o se registró por el camino. Sin este
            aviso el calendario aparece "en blanco" y parece que se perdió la
            elección — que es justo la sensación que arregla N-33. */}
        {slot && !elegido ? (
          <p className="text-[13px] text-warning">
            El horario que habías elegido ya no está libre. Elige otro.
          </p>
        ) : null}
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
        timeZone={tz}
      />
    </PanelShell>
  );
}
