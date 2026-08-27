import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { rangoPublicado } from "@/lib/catalog/queries";
import { bookingTotal } from "@/lib/booking";
import type { Database } from "@/lib/database.types";
import {
  CART_COOKIE,
  cartLineKey,
  decodeCart,
  type CartLine,
} from "@/lib/cart/cookie";

type PricingModel = Database["public"]["Enums"]["pricing_model"];
type BookingStatus = Database["public"]["Enums"]["booking_status"];
type SessionStatus = Database["public"]["Enums"]["session_status"];

/**
 * EY-177 · B3.2 — LA PANTALLA DE REVISIÓN, RESUELTA EN SERVIDOR.
 *
 * La cookie del carrito solo guarda ids e instantes (ver `lib/cart/cookie.ts`).
 * Todo lo demás —título, tutor, duración, **precio**, y si el hueco sigue
 * libre— se vuelve a leer aquí contra la base, con la ANON key y por tanto
 * sujeto a RLS. Regla de oro 2: el navegador no aporta ni un número.
 *
 * ⚠️ EL PRECIO QUE SALE DE AQUÍ ES INFORMATIVO. Es el mismo cálculo que hace
 * `create_booking` (`bookingTotal` copia su fórmula), pero el que se cobra es
 * el que esa función congela en `payments.gross_amount` al crear la reserva. Si
 * el tutor cambia el precio entre la revisión y el pago, manda el de entonces.
 */

/** Lo que hace falta de una mentoría para pintarla y valorarla en el carrito. */
export type CartProduct = {
  id: string;
  title: string;
  pricingModel: PricingModel;
  priceAmount: number;
  currency: string;
  sessionDurationMin: number | null;
  packageNumSessions: number | null;
  tutorId: string;
  tutorName: string | null;
  tutorAvatarPath: string | null;
  /** Portada de la mentoría. En un carrito, la miniatura es lo que hace que
   *  una lista de tres líneas se lea de un vistazo en vez de leerse entera. */
  imagePath: string | null;
};

/** En qué estado está una línea del carrito **ahora mismo**. */
export type CartLineState =
  /** Todo bien: la mentoría existe y sus horarios siguen libres. */
  | { tipo: "ok" }
  /**
   * La mentoría ya no es comprable: se despublicó, o al tutor le retiraron la
   * aprobación. No se puede ni pintar el precio, así que la línea sale con lo
   * mínimo y un botón de quitar.
   */
  | { tipo: "no_disponible" }
  /** Alguien se llevó el hueco entre añadir y ahora (el precio de la opción A). */
  | { tipo: "horario_ocupado" }
  /**
   * La hora ya pasó. Se distingue de `horario_ocupado` porque decirle «ese
   * horario ya no está libre» a alguien cuya clase era el martes pasado suena a
   * mala suerte cuando en realidad es que el carrito lleva ahí una semana. La
   * cookie dura un año a propósito (se abandona por semanas, como el
   * asistente), así que esto va a pasar a menudo.
   */
  | { tipo: "caducado" }
  /**
   * Ya hay una reserva de este alumno con EXACTAMENTE estos horarios y está a
   * medio pagar: es su propio hold, creado al entrar al checkout (D-2). No es
   * un error — es «sigue por donde lo dejaste».
   */
  | { tipo: "pagando"; bookingId: string };

export type CartResolvedLine = {
  key: string;
  line: CartLine;
  /** `null` cuando el estado es `no_disponible`. */
  product: CartProduct | null;
  /** Horarios en ISO **canónico UTC**, listos para la URL del checkout. */
  slotsIso: string[];
  /** Total de ESTA línea, en unidades menores. 0 si no se pudo resolver. */
  total: number;
  estado: CartLineState;
};

export type ResolvedCart = {
  lines: CartResolvedLine[];
  /**
   * Suma de las líneas comprables, **informativa**.
   *
   * ⚠️ SIGUE SIENDO INFORMATIVA AUNQUE DESDE EY-176 YA HAYA UN BOTÓN QUE COBRA
   * el pedido entero. Esta cifra sale del precio de catálogo de HOY
   * (`bookingTotal`); lo que se cobra es la suma de los `payments.gross_amount`
   * que `create_booking_line` congela al crear el pedido, y entre esta pantalla
   * y esa transacción el tutor puede haber cambiado el precio. Manda el
   * congelado (regla de oro 2). Por eso la pantalla lo llama «Total estimado» y
   * la de pago, ya con el pedido creado, lo llama «Total».
   */
  totalEstimado: number;
  /** Moneda común, o `null` si las líneas mezclan monedas. */
  currency: string | null;
  /**
   * Claves de líneas que **ya están compradas** (reserva viva del alumno que
   * pasó de `pending_payment`). No se pintan: se limpian de la cookie desde el
   * navegador. Es el autolimpiado del carrito tras pagar una línea.
   */
  compradas: string[];
};

/** Estados de sesión que NO retienen horario — espejo de `get_available_slots`. */
const MUERTAS: SessionStatus[] = ["cancelled", "no_show"];

/**
 * Las líneas crudas del carrito, tal y como vienen en la cookie. Para el
 * contador de la cabecera, que no necesita ni un viaje a la base.
 */
export async function readCart(): Promise<CartLine[]> {
  return decodeCart((await cookies()).get(CART_COOKIE)?.value);
}

/** Cuántas mentorías hay apuntadas. Lo pinta la insignia del header. */
export async function cartCount(): Promise<number> {
  return (await readCart()).length;
}

/**
 * Las mentorías del carrito, con su tutor.
 *
 * ⚠️ DOS CONSULTAS PARA TODAS LAS LÍNEAS, no dos por línea. `getProductDetail`
 * habría valido y hace justo eso: dos viajes por mentoría, y encima baja
 * `description` y los dos `jsonb` de FAQ que aquí no se pintan. Con diez líneas
 * eran veinte idas y vueltas delante de alguien que está a punto de pagar.
 *
 * Los dos filtros son los MISMOS que `getProductDetail`, y no son cosméticos:
 * `status = 'active'` deja fuera lo despublicado y el `approval_status` del
 * tutor deja fuera a quien perdió la aprobación. Una mentoría que no pasa por
 * los dos no se puede comprar, y por eso su línea cae a `no_disponible` en vez
 * de pintarse con precio. (La RLS ya lo exigiría igualmente; se escribe aquí
 * para que se lea sin ir a buscar la política.)
 */
async function cartProducts(ids: string[]): Promise<Map<string, CartProduct>> {
  const out = new Map<string, CartProduct>();
  if (ids.length === 0) return out;

  const supabase = await createClient();
  const { data: productos } = await supabase
    .from("products")
    .select(
      "id, title, pricing_model, price_amount, currency, session_duration_min, package_num_sessions, tutor_id, image_path",
    )
    .in("id", ids)
    .eq("status", "active");
  if (!productos || productos.length === 0) return out;

  const tutorIds = [...new Set(productos.map((p) => p.tutor_id))];
  const { data: tutores } = await supabase
    .from("tutor_profiles")
    .select("profile_id, display_name, headline, avatar_path")
    .in("profile_id", tutorIds)
    .eq("approval_status", "approved");

  const porTutor = new Map((tutores ?? []).map((t) => [t.profile_id, t]));

  for (const p of productos) {
    const t = porTutor.get(p.tutor_id);
    // Sin tutor legible la mentoría no es comprable: se omite del mapa y su
    // línea cae a `no_disponible`, igual que hace `getProductDetail` al
    // devolver `null`.
    if (!t) continue;
    out.set(p.id, {
      id: p.id,
      title: p.title,
      pricingModel: p.pricing_model,
      priceAmount: p.price_amount,
      currency: p.currency,
      sessionDurationMin: p.session_duration_min,
      packageNumSessions: p.package_num_sessions,
      tutorId: p.tutor_id,
      tutorName: t.display_name ?? t.headline,
      tutorAvatarPath: t.avatar_path,
      imagePath: p.image_path,
    });
  }
  return out;
}

/**
 * Reservas VIVAS de este alumno para las mentorías del carrito, emparejadas por
 * horario.
 *
 * ⚠️ Es la misma lógica que `buscarReservaDelAlumno` (`lib/checkout/hold.ts`) y
 * está duplicada A PROPÓSITO, no por descuido: aquella recibe el cliente del
 * NAVEGADOR y aquí estamos en servidor, y sobre todo aquella pregunta por UNA
 * mentoría y esto lo hace para todas las del carrito en **una sola consulta**.
 * Lo que sí se copia literal, porque si diverge se rompe, es el criterio:
 *
 *   · se excluyen las `cancelled` (no retienen nada);
 *   · dentro de las que quedan solo cuentan las sesiones vivas, para que una
 *     reserva reembolsada con sus sesiones canceladas no bloquee volver a
 *     comprar ese hueco;
 *   · y se compara por **instante**, nunca por cadena: `…T08:00:00.000Z` y
 *     `…T08:00:00+00:00` son el mismo momento y dos textos distintos.
 */
async function reservasDelAlumno(
  productIds: string[],
): Promise<Map<string, { id: string; status: BookingStatus }>> {
  const out = new Map<string, { id: string; status: BookingStatus }>();
  if (productIds.length === 0) return out;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Sin sesión no hay reservas que cruzar. El carrito anónimo es válido: lo que
  // no existe todavía es su dueño.
  if (!user) return out;

  const { data } = await supabase
    .from("bookings")
    .select("id, status, product_id, sessions(start_at, status)")
    .eq("student_id", user.id)
    .in("product_id", productIds)
    .neq("status", "cancelled");

  for (const b of data ?? []) {
    const vivos = (b.sessions ?? [])
      .filter((s) => !MUERTAS.includes(s.status))
      .map((s) => Date.parse(s.start_at))
      .filter((t) => Number.isFinite(t))
      .sort((a, c) => a - c);
    if (vivos.length === 0) continue;
    out.set(cartLineKey({ productId: b.product_id, slots: vivos }), {
      id: b.id,
      status: b.status,
    });
  }
  return out;
}

/**
 * El carrito, resuelto y listo para pintar.
 *
 * Un viaje por mentoría para los huecos (`get_available_slots` es por producto y
 * no admite lista), más dos para los productos y uno para las reservas. Con el
 * tope de 10 líneas son 14 consultas en el peor caso, todas en paralelo.
 */
export async function resolveCart(): Promise<ResolvedCart> {
  const lines = await readCart();
  if (lines.length === 0) {
    return { lines: [], totalEstimado: 0, currency: null, compradas: [] };
  }

  const ids = [...new Set(lines.map((l) => l.productId))];
  const supabase = await createClient();

  const [productos, reservas, huecosPorProducto] = await Promise.all([
    cartProducts(ids),
    reservasDelAlumno(ids),
    // Los instantes libres de cada mentoría, en un `Set` para poder preguntar
    // por pertenencia sin recorrer la lista una vez por horario.
    Promise.all(
      ids.map(async (id) => {
        const { data } = await supabase.rpc("get_available_slots", {
          p_product_id: id,
          ...rangoPublicado(),
        });
        return [
          id,
          new Set((data ?? []).map((s) => Date.parse(s.slot_start))),
        ] as const;
      }),
    ).then((pares) => new Map(pares)),
  ]);

  const compradas: string[] = [];
  const resueltas: CartResolvedLine[] = [];
  // Un solo reloj para todas las líneas: leerlo dentro del bucle podría dejar
  // dos líneas del mismo carrito juzgadas con milisegundos distintos.
  const ahora = Date.now();

  for (const line of lines) {
    const key = cartLineKey(line);
    const product = productos.get(line.productId) ?? null;
    // El ISO canónico UTC: es lo que entiende la URL del checkout y lo que
    // Postgres compara por instante contra `slot_start`.
    const slotsIso = line.slots.map((ms) => new Date(ms).toISOString());
    const reserva = reservas.get(key);

    // Ya pagada (el webhook la movió de `pending_payment`): fuera del carrito.
    // No se pinta ni se cuenta; se limpia de la cookie desde el navegador.
    if (reserva && reserva.status !== "pending_payment") {
      compradas.push(key);
      continue;
    }

    if (!product) {
      resueltas.push({
        key,
        line,
        product: null,
        slotsIso,
        total: 0,
        estado: { tipo: "no_disponible" },
      });
      continue;
    }

    const total = bookingTotal(product);

    // Su propio hold: no se mira la disponibilidad, porque el hueco lo está
    // ocupando ÉL. `get_available_slots` descuenta toda sesión no cancelada del
    // tutor sin mirar de quién es, así que sin esta rama el alumno vería
    // «horario ocupado» sobre la reserva que está pagando en otra pestaña.
    if (reserva) {
      resueltas.push({
        key,
        line,
        product,
        slotsIso,
        total,
        estado: { tipo: "pagando", bookingId: reserva.id },
      });
      continue;
    }

    // El pasado primero: un horario que ya ocurrió tampoco está en
    // `get_available_slots`, así que sin esta comprobación saldría como
    // «ocupado» y el mensaje culparía a otro alumno de algo que fue el reloj.
    if (line.slots.some((ms) => ms <= ahora)) {
      resueltas.push({
        key,
        line,
        product,
        slotsIso,
        total,
        estado: { tipo: "caducado" },
      });
      continue;
    }

    const libres = huecosPorProducto.get(line.productId);
    const sigueLibre =
      libres != null && line.slots.every((ms) => libres.has(ms));

    resueltas.push({
      key,
      line,
      product,
      slotsIso,
      total,
      estado: sigueLibre ? { tipo: "ok" } : { tipo: "horario_ocupado" },
    });
  }

  // El total solo suma lo que de verdad se puede comprar: meter dentro una
  // línea cuyo hueco se ha ido sería anunciar un importe que nadie va a cobrar.
  const comprables = resueltas.filter(
    (l) => l.estado.tipo === "ok" || l.estado.tipo === "pagando",
  );
  const monedas = new Set(
    comprables.map((l) => l.product?.currency).filter(Boolean),
  );

  return {
    lines: resueltas,
    totalEstimado: comprables.reduce((s, l) => s + l.total, 0),
    // Con dos monedas distintas no hay total que sumar, y sumarlas igualmente
    // sería inventarse un tipo de cambio. Hoy el catálogo es de una sola, pero
    // `products.currency` es por mentoría y nada lo impide.
    currency: monedas.size === 1 ? [...monedas][0]! : null,
    compradas,
  };
}
