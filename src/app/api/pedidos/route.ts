import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveCart } from "@/lib/cart/resolve";
import { esCarreraDeHorario, mensajeDeApertura } from "@/lib/checkout/hold";
import type { LineaDePedido } from "@/lib/orders/tipos";

/**
 * EY-176 · B3.1 — DE UN CARRITO A UN PEDIDO.
 *
 * Es la única puerta por la que nace un `orders`. Recibe una petición sin
 * cuerpo y devuelve `{ orderId }`; a partir de ahí el pago del pedido es
 * `/pedidos/<id>/pagar`, que abre UN cobro para las N líneas.
 *
 * ⚠️ LAS LÍNEAS NO VIENEN DEL NAVEGADOR. Se releen aquí de la cookie `ey-cart`
 * con `resolveCart()`, que es servidor puro: valida la cookie (que es entrada
 * del usuario, editable desde la consola en diez segundos), resuelve cada
 * mentoría contra `products` con la ANON key —o sea con RLS—, comprueba la
 * disponibilidad real contra `get_available_slots` y descarta lo que no se
 * puede comprar. Aceptar una lista del cliente sería dejarle elegir qué
 * mentorías y qué horarios entran en un cobro.
 *
 * Y el precio no aparece por ningún lado de este fichero: lo congela
 * `create_booking_line` en `payments.gross_amount`, línea por línea, y de ahí
 * lo lee `/api/pagos/checkout` para abrir el cargo (regla de oro 2).
 *
 * ── QUÉ LÍNEAS ENTRAN ───────────────────────────────────────────────────────
 * Las `ok` y las `pagando`. Las segundas son holds que este mismo alumno ya
 * tenía abiertos con exactamente esos horarios: entran porque quiere
 * comprarlas, y `create_order` las suelta y las recrea dentro del pedido. Lo
 * que queda fuera es lo que de verdad no se puede vender —hueco perdido, hora
 * pasada, mentoría despublicada—, y queda fuera en el servidor.
 *
 * ── P-1 · TODO O NADA ───────────────────────────────────────────────────────
 * `create_order` crea las N reservas en UNA transacción: si la tercera pierde
 * su hueco, no se crea ninguna. Aquí solo hay que contar cuál falló, y para eso
 * la RPC manda el índice en `details` y la mentoría en `hint`.
 */
export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // El carrito es anónimo a propósito (la cookie es del navegador), pero pagar
  // no: `create_order` resuelve al alumno con `auth.uid()`. El `?next=` que
  // devuelve a la persona a su carrito lo arma la pantalla, no esto.
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const carrito = await resolveCart();
  const comprables = carrito.lines.filter(
    (l) => l.estado.tipo === "ok" || l.estado.tipo === "pagando",
  );

  if (comprables.length === 0) {
    return NextResponse.json(
      { error: "No hay ninguna mentoría que se pueda comprar en tu carrito." },
      { status: 409 },
    );
  }

  const lineas: LineaDePedido[] = comprables.map((l) => ({
    product_id: l.line.productId,
    // ISO canónico UTC. Postgres lo recibe como `timestamptz` y compara por
    // INSTANTE, así que da igual cómo lo serialice él de vuelta — la trampa que
    // documentan `booking-panel.tsx` y `lib/checkout/hold.ts`.
    slots: l.slotsIso,
  }));

  const rpc = supabase;
  const { data, error } = await rpc.rpc("create_order", { p_lines: lineas });

  if (!error && typeof data === "string") {
    return NextResponse.json({ orderId: data });
  }

  // ⚠️ UNA CARRERA NO ES UN FALLO, y aquí es más probable que en la compra
  // suelta: son N huecos en lugar de uno, y basta que UNO se caiga. Dos
  // pestañas o un doble clic hacen que las dos peticiones llamen a
  // `create_order`; si la ganadora fue esta misma persona, su pedido YA EXISTE
  // y es reutilizable. Se pregunta una vez más antes de rendirse — mismo gesto
  // que hace `checkout-form.tsx` con `buscarReservaDelAlumno`.
  if (esCarreraDeHorario(error)) {
    const { data: existente } = await rpc.rpc("find_open_order", { p_lines: lineas });
    if (typeof existente === "string") {
      return NextResponse.json({ orderId: existente });
    }
  }

  // Cuál falló. El índice viene en `details` y la mentoría en `hint`, tal y
  // como los pone el bloque `exception` de `create_order`: así la pantalla
  // puede señalar la línea sin parsear el mensaje de Postgres.
  const indice = Number(error?.details);
  const linea = Number.isSafeInteger(indice) && indice > 0 ? indice : null;

  return NextResponse.json(
    {
      // ⚠️ NUNCA `error.message` TAL CUAL. Del otro lado hay una función de
      // Postgres y sus mensajes van de lo casi presentable a lo que no debe
      // salir de nuestros registros — el nombre de un índice único, o «el tutor
      // no tiene tier asignado», que es un fallo de configuración NUESTRO
      // contado como si fuera culpa de quien iba a pagar. Se traduce con el
      // mismo helper que la compra suelta, para que las dos pantallas digan lo
      // mismo ante el mismo choque.
      error: mensajeDeApertura(error),
      linea,
      productId: error?.hint ?? null,
    },
    { status: 409 },
  );
}
