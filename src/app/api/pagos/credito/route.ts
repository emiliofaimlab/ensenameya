import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 💳 EL COBRO QUE NO TIENE A QUIÉN COBRAR — cuando el crédito cubre el total.
 *
 * Un regalo, o una mentoría gratis que llega al precio, deja
 * `payments.gross_amount - payments.credit_amount = 0`. No hay pasarela que
 * abrir: **un cargo de 0 en Stripe es un 400**, y en dLocal es peor porque el
 * rechazo llega con el pago ya creado. La reserva hay que confirmarla igual —el
 * tutor cobra su `tutor_net_amount` íntegro, solo que lo financia el crédito— y
 * eso es lo que hace esta ruta, con `confirm_credit_booking` /
 * `confirm_credit_order`.
 *
 * ── POR QUÉ ES UNA RUTA APARTE Y NO UNA RAMA DE `/api/pagos/checkout` ────────
 *
 * La razón que decide no es de orden ni de estética: **`/api/pagos/checkout` se
 * dispara por VISITA, no por intención.** Desde D-2 (§20.14) el formulario de
 * pago se monta al LLEGAR a la pantalla, así que esa petición sale sola en
 * cuanto alguien abre el checkout —su propio bloque de `ensureCustomer` lo deja
 * escrito: «quien entre a mirar el precio y se vaya ya tiene una ficha creada en
 * Stripe»—. Si esa misma llamada confirmara la reserva cuando el crédito la
 * cubre entera, **entrar a mirar la pantalla sería comprar**: la reserva pasaría
 * a `confirmed`/`pending_acceptance`, el tutor recibiría su NTF-07 y el crédito
 * quedaría gastado sin que el alumno haya pulsado nada. Confirmar tiene que
 * colgar de un botón, y un POST propio ES ese botón.
 *
 * Las otras dos, que solas no decidirían pero apuntan al mismo sitio:
 *
 *   · **Son verbos distintos.** `/checkout` ABRE un cobro: resuelve la cadena de
 *     candidatos, da de alta al Customer, sella el marcador y devuelve un
 *     `client_secret`. Esto CONFIRMA, que es lo que hace un webhook. Meter las
 *     dos cosas en el mismo handler obligaría a que la mitad de su cuerpo —el
 *     alta en Stripe incluida— se salte por un `if`, y un `if` que se salta el
 *     camino del dinero es como se escriben los agujeros de esta tanda.
 *   · **El fallo se cuenta distinto.** Si `/checkout` falla, no hay compra y se
 *     reintenta recargando. Si falla ESTO, el crédito ya está consumido y la
 *     reserva no está confirmada; hay que saber distinguir los dos casos en el
 *     log y en la pantalla.
 *
 * ⚠️ Y EL COSTE, QUE HAY QUE DECIRLO: son dos peticiones, y entre una y otra hay
 * una ventana. Si el navegador se queda sin la segunda —pestaña cerrada, wifi
 * caído—, la reserva sigue `pending_payment` con el crédito dentro y
 * `expire_stale_bookings` la cancela en ≤ 7 minutos (`HOLD_POLICY`). Eso NO
 * quema el premio: la cancelación pasa por `liberar_credito_de_pago`
 * (`20260912110000`, §4), que devuelve el crédito entero y le da siete días de
 * gracia sobre su caducidad. La ventana existe y tiene red debajo, que no es lo
 * mismo que no existir.
 *
 * ── 🔴 LO QUE EL NAVEGADOR **NO** DICE AQUÍ: CUÁNTO CUBRE EL CRÉDITO ─────────
 *
 * El cuerpo trae un `bookingId` o un `orderId` y nada más. Ni importes, ni
 * `creditId`, ni «está cubierto al 100 %». Quién financia cuánto lo escribió
 * `aplicar_credito` en `payments.credit_amount` y lo reverifica la propia RPC
 * (`credit_amount is distinct from gross_amount` → excepción). Regla de oro 2:
 * el importe sale de la base, y aquí ni siquiera se lee — no hace falta leer un
 * número que no se va a usar para decidir nada.
 *
 * ── 🔴 LA AUTORIZACIÓN ES NUESTRA, PORQUE LA RPC NO PUEDE HACERLA ────────────
 *
 * `confirm_credit_booking` y `confirm_credit_order` corren con `service_role`,
 * o sea **sin `auth.uid()`**: por dentro no hay forma de saber quién llama. Por
 * eso llevan el alumno en la firma, y por eso aquí se resuelve la reserva (o el
 * pedido) con el **cliente de cookies (ANON + RLS)** antes de tocar nada — el
 * mismo patrón que `cobroDeReserva` en `/api/pagos/checkout`, cuyo comentario
 * dice literalmente «si la reserva o el pedido no son tuyos, no los ves. La
 * autorización es la RLS, no una comprobación nuestra».
 *
 * Sin ese paso, con un uuid de reserva ajena cualquiera con sesión podría forzar
 * el `paid` / `pending_acceptance` de otra persona en el momento que quisiera.
 * La RPC vuelve a comprobarlo con el id que le pasamos (cinturón y tirantes: si
 * mañana alguien llama a la RPC desde otro sitio, el dueño sigue siendo
 * obligatorio).
 */

/** `service_role` es `server-only` y esto mueve dinero: nada de edge. */
export const runtime = "nodejs";

/**
 * Lo que ve el alumno cuando la RPC se niega.
 *
 * Cubre tres casos que por dentro son distintos y por fuera son el mismo: el
 * cobro no está cubierto al 100 % (alguien tocó el crédito entre la pantalla y
 * este botón), el crédito ya no está vivo, o la reserva no es suya. Los tres se
 * arreglan igual —recargar y mirar— y ninguno de los tres se explica sin contar
 * cómo funciona la tabla por dentro.
 */
const MENSAJE_FALLO =
  "No pudimos confirmar esta reserva con tu crédito. Recarga la página para ver su estado y, si sigue igual, escríbenos a info@ensenameya.com.";

type Cuerpo = { bookingId?: string; orderId?: string };

export async function POST(req: Request) {
  const { bookingId, orderId } = (await req.json().catch(() => ({}))) as Cuerpo;

  if (!bookingId && !orderId) {
    return NextResponse.json({ error: "falta bookingId u orderId" }, { status: 400 });
  }
  // Igual que en `/api/pagos/checkout`: con los dos no se sabe qué se está
  // confirmando. Se para aquí en vez de elegir uno por orden de aparición.
  if (bookingId && orderId) {
    return NextResponse.json(
      { error: "bookingId y orderId son excluyentes" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const admin = createAdminClient();

  /**
   * Confirma UNA reserva.
   *
   * El `select` va con el cliente de cookies a propósito (ver la cabecera): que
   * la fila aparezca ES la autorización. Y se mira el `error` además del `data`
   * —regla de oro 10—: un `const { data } = …` convertiría un fallo de la
   * consulta en «la reserva no existe», que es un 404 mentiroso sobre una
   * reserva que sí es tuya y que acabas de financiar con un regalo.
   */
  const confirmarReserva = async (id: string) => {
    const { data: booking, error } = await supabase
      .from("bookings")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[pagos/credito] no se pudo leer la reserva:", {
        reserva: id,
        error: error.message,
      });
      return NextResponse.json(
        { error: "No pudimos comprobar tu reserva. Vuelve a intentarlo." },
        { status: 503 },
      );
    }
    if (!booking) return NextResponse.json({ error: "reserva no encontrada" }, { status: 404 });

    // Ya pagada o ya cancelada: no se confirma nada dos veces. La RPC es
    // idempotente por su cuenta (`confirm_payment` no reprocesa un pago
    // resuelto), pero un 409 aquí le dice a la pantalla que recargue en vez de
    // dejarla creyendo que acaba de comprar.
    if (booking.status !== "pending_payment") {
      return NextResponse.json(
        { error: `la reserva está en ${booking.status}`, estado: booking.status },
        { status: 409 },
      );
    }

    const { data: estado, error: eRpc } = await admin.rpc("confirm_credit_booking", {
      p_booking_id: id,
      // 🔴 El alumno sale de la SESIÓN, nunca del cuerpo de la petición. Es lo
      // que la RPC reverifica contra `bookings.student_id`.
      p_student: user.id,
    });

    if (eRpc) {
      // Al log entero —es lo único que va a poder mirar quien investigue— y
      // hacia fuera una frase sin interioridades: los mensajes de la RPC nombran
      // columnas e importes («este cobro no está cubierto al 100 %, 4500 de
      // 18000») y eso no se le enseña a nadie.
      console.error("[pagos/credito] 🔴 confirm_credit_booking falló:", {
        reserva: id,
        alumno: user.id,
        error: eRpc.message,
      });
      return NextResponse.json({ error: MENSAJE_FALLO }, { status: 409 });
    }

    return NextResponse.json({ modo: "credito", estado, destino: `/reservas/${id}/confirmacion` });
  };

  /** Lo mismo para un pedido: N líneas, todas cubiertas al 100 %, un recibo. */
  const confirmarPedido = async (id: string) => {
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[pagos/credito] no se pudo leer el pedido:", {
        pedido: id,
        error: error.message,
      });
      return NextResponse.json(
        { error: "No pudimos comprobar tu pedido. Vuelve a intentarlo." },
        { status: 503 },
      );
    }
    if (!order) return NextResponse.json({ error: "pedido no encontrado" }, { status: 404 });
    if (order.status !== "pending_payment") {
      return NextResponse.json(
        { error: `el pedido está en ${order.status}`, estado: order.status },
        { status: 409 },
      );
    }

    // ⚠️ NO se comprueba línea a línea aquí. `confirm_credit_order` exige que
    // TODAS estén cubiertas al 100 % y aborta la transacción entera si una sola
    // no lo está — que es lo que hace que un pedido no se pueda confirmar a
    // medias (P-1: todo o nada). Repetir esa cuenta aquí sería tener dos
    // versiones de la misma regla, y la de fuera sería la que se queda vieja.
    const { data: estado, error: eRpc } = await admin.rpc("confirm_credit_order", {
      p_order_id: id,
      p_student: user.id,
    });

    if (eRpc) {
      console.error("[pagos/credito] 🔴 confirm_credit_order falló:", {
        pedido: id,
        alumno: user.id,
        error: eRpc.message,
      });
      return NextResponse.json({ error: MENSAJE_FALLO }, { status: 409 });
    }

    return NextResponse.json({ modo: "credito", estado, destino: `/pedidos/${id}/confirmacion` });
  };

  return orderId ? await confirmarPedido(orderId) : await confirmarReserva(bookingId!);
}
