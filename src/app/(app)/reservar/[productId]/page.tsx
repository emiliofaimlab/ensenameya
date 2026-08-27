import { notFound, redirect } from "next/navigation";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail, rangoPublicado } from "@/lib/catalog/queries";
import { bookingTotal, tutorNames } from "@/lib/booking";
import { cartCount } from "@/lib/cart/resolve";
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
 *   · quien llega SIN hora: un enlace guardado, un marcador. Ya NO el botón
 *     grande de la ficha — desde MN-16 ese botón lleva la hora elegida encima y
 *     solo pasa por aquí si la mentoría es un paquete;
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
  const [{ data: slots }, names, tz, enCarrito] = await Promise.all([
    // ⚠️ El rango va EXPLÍCITO. Sin él la RPC caía a su default de 21 días
    // mientras la ficha pública pedía 60 y `create_booking` revalidaba contra
    // 30: tres ventanas para los mismos huecos. Aquí el síntoma era el
    // silencioso —un hueco del día +25 se anunciaba en la ficha, se reservaba
    // bien, y aun así no aparecía en este calendario, así que quien llegaba sin
    // hora no podía elegirlo—. `rangoPublicado()` es el único sitio donde vive
    // ese número; ver su nota en `lib/catalog/queries`.
    supabase.rpc("get_available_slots", {
      p_product_id: productId,
      ...rangoPublicado(),
    }),
    tutorNames(supabase, [product.tutor.id]),
    // Sin zona explícita el SSR agruparía los huecos por el día del SERVIDOR
    // (UTC en Vercel) y el calendario del cliente por el del navegador: dos
    // rejillas distintas para los mismos datos (R24-12 / R24-22).
    getUserTimezone(),
    // Cuántas mentorías hay ya apuntadas, para decidir si se pinta «Ir al
    // carrito». Se resuelve en SERVIDOR por lo mismo que la insignia de la
    // cabecera (`cart-badge.tsx`): así el botón sale en el primer render en
    // lugar de aparecer de golpe tras la hidratación. No cuesta un viaje a la
    // base — `cartCount()` solo lee la cookie.
    cartCount(),
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
    /*
     * ⚠️ SIN MENÚ LATERAL, Y ES UNA DECISIÓN, NO UN OLVIDO.
     *
     * Esta pantalla tiene UN trabajo: elegir N horarios. El menú del panel
     * —Inicio, Mis reservas, Agendar, Métodos de pago, Cuenta— no ayuda a
     * hacerlo y sí cuesta: 232 px + 24 de separación, o sea **el 21 % del ancho**
     * en la única pantalla que necesita ancho para poner el día, la hora y la
     * selección uno al lado del otro.
     *
     * Y no marcaba nada: ningún ítem casa con `/reservar/<id>`, así que
     * `matchLength` devuelve -1 en los cinco y el menú se pinta entero apagado
     * (ver la nota de `app-sidebar.tsx`, donde ese caso ya está documentado —
     * antes se encendían los cinco a la vez). Un menú que no dice dónde estás
     * solo ofrece cinco formas de abandonar la compra a medias.
     *
     * El precedente es N-37 (`src/app/(checkout)/layout.tsx`), pero NO se llega
     * tan lejos a propósito: allí se quita todo —cabecera, pie, chat— porque se
     * está cobrando. Aquí todavía se está eligiendo, así que la cabecera (con su
     * insignia de carrito, que ahora importa) y el chat se quedan. La salida
     * buena sigue siendo el «Volver a la mentoría» de arriba, que es la que
     * lleva al sitio del que se vino.
     *
     * De paso, esto iguala las dos caras de la misma tarea: `/products/[id]`
     * resuelve la sesión suelta en una pantalla pública SIN menú, y el paquete
     * la resolvía con uno. Misma tarea, dos marcos.
     */
    <PanelShell
      sidebar={false}
      back={{ href: `/products/${productId}`, label: "Volver a la mentoría" }}
    >
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
            elección — que es justo la sensación que arregla N-33.
            ⚠️ Este cartel MENTÍA hasta que se unificaron los horizontes: la
            ficha ofrecía hasta el día +60 y aquí solo se pedían 21, así que un
            hueco perfectamente libre del día +30 caía en esta rama y se
            anunciaba como ocupado. Hoy los dos lados piden el mismo rango, así
            que si sale este texto es porque el hueco de verdad se fue. */}
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
        // ⚠️ Ya NO se pasa `tutorId`. Servía para el «Seguir comprando» de
        // `AddToCart`, que navegaba a la ficha del tutor con la selección en
        // blanco. Con el modelo de botones nuevo eso desaparece: al agregar, la
        // selección se limpia SIN navegar y la pantalla queda lista para el
        // paquete siguiente. Seguir comprando es quedarse.
        slots={slots ?? []}
        preselected={elegido ?? null}
        required={required}
        total={bookingTotal(product)}
        currency={product.currency}
        durationMin={product.sessionDurationMin}
        timeZone={tz}
        enCarrito={enCarrito}
      />
    </PanelShell>
  );
}
