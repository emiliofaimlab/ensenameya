import { notFound, redirect } from "next/navigation";

import { getSessionContext, getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { perSessionLabel, sessionsLabel } from "@/lib/catalog/format";
import { bookingFormatLabel, bookingTotal } from "@/lib/booking";
import { activeChargeProvider } from "@/lib/payments";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { ChangeSlotLink } from "@/components/checkout/change-slot-link";
import { CheckoutSteps } from "@/components/checkout/checkout-steps";

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
 * ⚠️ CHECKOUT DE INVITADO · ESTA PANTALLA ADMITE ANÓNIMOS, y es la única del
 * grupo que lo hace. Quien llega sin cuenta NO se va a `/login`: el formulario
 * le pide correo, contraseña y la casilla de términos aquí mismo y la cuenta se
 * crea con el clic de pagar (`components/checkout/datos-invitado.tsx` +
 * `api/checkout/invitado`). Todo lo demás de esta página ya funcionaba con la
 * ANON key —el catálogo es público, la zona sale de la cookie `ey-tz`—, así que
 * lo único que cambia es de dónde sale el `studentId`.
 *
 * Quien SÍ tiene cuenta sigue pasando por `requireUser()` entero: es quien
 * exige el onboarding (RN-44) y quien arma el `?next=` con la query a partir
 * del header `x-pathname`, de modo que vuelve del asistente con sus horarios
 * intactos. Se llama solo cuando hay sesión —cuesta una lectura de más y no
 * duplica la guarda, que es justo lo que no se puede tocar aquí—.
 *
 * ⚠️ Y «quien tiene cuenta» incluye a quien se autentica DENTRO del formulario:
 * ese render ya había ocurrido sin sesión, así que la guarda se lo habría
 * saltado entero. Por eso `DatosInvitado` no continúa en cliente —recarga la
 * página— y esta línea vuelve a correr con la sesión puesta. Sin eso, alguien
 * con el onboarding a medias pagaba y aterrizaba en el asistente después.
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
  const { user } = await getSessionContext();
  // ⚠️ Quitar el `requireUser()` de aquí quitaría DOS cosas, no una: la sesión
  // y el onboarding obligatorio. Lo segundo tiene que seguir en pie para quien
  // ya tiene cuenta —el encargo prohíbe relajarlo—, así que la guarda de
  // siempre se llama tal cual en cuanto hay sesión, en vez de reescribir aquí
  // su rama de tutor y su `?next=`, que es como divergen las guardas.
  if (user) await requireUser();

  const product = await getProductDetail(productId);
  if (!product) notFound();

  const slots = (slotsParam ?? "").split(",").filter(Boolean);
  const required =
    product.pricingModel === "per_package" ? (product.packageNumSessions ?? 1) : 1;
  // Selección inválida → de vuelta al picker (evita un checkout inconsistente).
  // ⚠️ Al `/reservar/<id>` PELADO, sin `?slot=`: con la hora en la query esa
  // página rebotaría otra vez aquí (N-33) y serían dos redirecciones en bucle.
  // ⚠️ Y sin sesión, a la ficha PÚBLICA: el selector cuelga de `(app)`, así que
  // mandar ahí a un invitado es mandarlo a `/login`, que es la pantalla que esta
  // página existe para que no vea (mismo criterio que `ChangeSlotLink`).
  if (slots.length !== required) {
    redirect(user ? `/reservar/${productId}` : `/products/${productId}`);
  }

  const supabase = await createClient();
  // RN-01/RN-02 · la zona del alumno, resuelta en SERVIDOR. El checkout pintaba
  // las horas sin ella —y por tanto en la del servidor durante el SSR, UTC en
  // Vercel— mientras el calendario que las eligió y `/reservas/[id]/pagar` sí la
  // usan. O sea que podía enseñar una hora distinta de la reservada.
  const tz = await getUserTimezone();
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

  // V-6 · AQUÍ SOBRABA UNA CONSULTA. `tutorNames()` volvía a `tutor_profiles` a
  // por un nombre que `getProductDetail` ya había traído en la misma petición
  // (`product.tutor.displayName`, del mismo `select` y con la misma RLS). Se
  // quita: un viaje menos y una fuente menos de la que pueden discrepar.
  //
  // Y por lo mismo esta pantalla NO necesita el respaldo de tutor desaprobado
  // que sí llevan las otras cuatro: `getProductDetail` devuelve `null` cuando el
  // tutor no es legible, así que aquí ya se ha respondido 404 antes de llegar.
  const tutorName =
    product.tutor.displayName ?? product.tutor.headline ?? "tu tutor";

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* EY-177 · B3.2 · PASO 3 DE 3.

            ⚠️ Esto es una marcha atrás CONSCIENTE sobre el aislamiento del
            checkout que pidió el cliente («no debe tener más nada esa página»,
            layout de `(checkout)`). El responsable la aceptó para que los tres
            pasos se lean como tres pasos. Se paga lo mínimo: el indicador no
            lleva enlaces —ningún paso anterior es pulsable desde aquí— y va en
            ESTA página y no en el layout, que lo comparte con
            `/reservas/[id]/pagar`, donde «paso 3 de 3 de un carrito» sería
            mentira. El porqué completo está en `checkout-steps.tsx`.

            La única salida sigue siendo «Cambiar horario», que además suelta el
            hold: un «volver al carrito» aquí dejaría el horario retenido. */}
        <CheckoutSteps current={3} className="mb-5" />
        {/* La ÚNICA salida de esta pantalla, y no es una salida del sitio: es
            parte de la misma compra. Aislar el checkout no puede significar
            dejar a alguien encerrado con un horario que ya no le sirve.

            ⚠️ Y desde D-2 (§20.14) no puede ser un enlace pelado. Al llegar
            aquí se creó la reserva, o sea que el horario está RETENIDO: un
            `<Link>` normal llevaba al selector donde el propio hueco ya no
            aparecía —`get_available_slots` descuenta toda sesión no cancelada
            sin mirar de quién es— y, en un paquete, cualquier conjunto que
            solapara chocaba contra la reserva a medias del propio alumno.
            `ChangeSlotLink` la cancela antes de irse: pulsar «Cambiar horario»
            es decir que ese hueco ya no se quiere. */}
        <ChangeSlotLink
          productId={productId}
          // Sin cuenta todavía no hay hold que soltar: aquí es un enlace normal.
          studentId={user?.id ?? null}
          slots={slots}
          etiqueta="Cambiar horario"
          className="mb-4 flex w-fit items-center gap-1.5 text-sm text-[#6b6b6b] transition-colors hover:text-foreground"
        />
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
        productId={productId}
        // D-2 · con la reserva creándose al llegar, el formulario tiene que
        // poder buscar la que ya hubiera de ESTE alumno. El id sale de la
        // sesión de servidor y no de `auth.getUser()` en el navegador: una
        // llamada menos y un dato menos que el cliente pueda equivocar.
        //
        // `null` = invitado: el formulario pide los datos y NO abre reserva ni
        // cobro hasta que la cuenta existe. Esa espera es la que hace que
        // abandonar la pantalla antes de rellenar nada no deje ni cuenta ni
        // horario retenido.
        studentId={user?.id ?? null}
        // El tutor de la mentoría: con él se localizan los holds propios que
        // solapan lo que se va a pedir, que es como se mide el choque en el SQL
        // (`get_available_slots` filtra por tutor, no por mentoría).
        tutorId={product.tutor.id}
        slots={slots}
        timeZone={tz}
        durationMin={product.sessionDurationMin}
        total={bookingTotal(product)}
        currency={product.currency}
        productTitle={product.title}
        tutorName={tutorName}
        tutor={product.tutor}
        packageLabel={bookingFormatLabel(required)}
        // Las dos etiquetas ya existían en el catálogo y se reutilizan tal cual:
        // "4 × 60 min" y "Equivale a 24,00 US$ por sesión · 4 sesiones". Escribir
        // aquí otra versión de lo mismo es como acaban divergiendo la ficha y el
        // checkout en el precio de un paquete.
        incluye={sessionsLabel(product)}
        precioPorSesion={perSessionLabel(product)}
        // Sin fila legible se asume que NO acepta sola: es el mensaje
        // conservador (promete la ventana de 24 h, que es lo que pasa cuando la
        // columna está en false) y nunca promete de menos.
        aceptaSola={aceptacion?.auto_accept_bookings ?? false}
      />
    </div>
  );
}
