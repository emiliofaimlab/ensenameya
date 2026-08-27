/**
 * EY-177 · B3.2 — EL CARRITO. Dónde vive, por qué ahí, y qué NO es.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DÓNDE VIVE: en una COOKIE (`ey-cart`). No en una tabla, no en un contexto.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Las tres opciones reales y por qué gana la cookie:
 *
 *  · **Tabla `cart_items` en Postgres.** Es lo que uno escribe por reflejo, y
 *    aquí no sirve: una tabla con RLS necesita `auth.uid()`, y **el carrito
 *    tiene que funcionar sin sesión**. Quien entra desde Google a la ficha de
 *    un tutor no está registrado, y obligarle a registrarse ANTES de poder
 *    apuntar dos mentorías es exactamente el embudo que este flujo venía a
 *    quitar. Habría que inventar un dueño anónimo (un id de invitado en… una
 *    cookie), o sea la cookie igual pero con una tabla encima. Además exige
 *    migración, políticas, grants y purga de carritos muertos.
 *  · **Contexto de React / zustand.** Sería el PRIMER estado compartido entre
 *    rutas de todo el proyecto (no hay ni un `createContext` en `src/`), no
 *    sobrevive a una recarga y —lo que lo descarta— **no lo puede leer el
 *    servidor**: la pantalla de revisión tendría que pintarse en el navegador
 *    y volver a pedir los precios por AJAX. Ver la nota de abajo sobre precios.
 *  · **Cookie.** La lee el servidor con `cookies()`, así que la pantalla de
 *    revisión y el contador de la cabecera son **componentes de servidor** y no
 *    hace falta estado global ninguno. Sobrevive a la recarga, a cerrar la
 *    pestaña y —esto es lo importante— **al registro**: el anónimo añade,
 *    `requireUser()` le manda a `/login?next=/carrito`, vuelve, y su carrito
 *    sigue ahí porque la cookie es del navegador, no de la sesión.
 *
 * Y no es un patrón nuevo en la casa: `ey-ref` (referidos), `ey-panel` (el
 * switch de panel), `ey-tz` (zona horaria) y `ey-onb-*` (paso del asistente)
 * ya hacen exactamente esto. `wizard-step.ts` es el precedente literal:
 * módulo NEUTRO, escritura con `document.cookie`, lectura con `cookies()`.
 *
 * ⚠️ POR ESO ESTE FICHERO NO LLEVA `"use client"`. Lo importan las dos orillas:
 * el servidor (para el nombre de la cookie y el parser) y el navegador (para
 * escribirla). Exportado desde un fichero `"use client"`, el servidor recibiría
 * una *referencia de cliente* en vez del string y leería `undefined` — el mismo
 * tropiezo que ya documentan `lib/tz.ts` y `wizard-step.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ LO QUE EL CARRITO **NO** ES: UNA FUENTE DE PRECIOS. (Regla de oro 2)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Aquí dentro solo hay **identificadores**: el id de la mentoría y los instantes
 * de los horarios. Ni un importe, ni una moneda, ni un título. Todo lo que se
 * enseña en la pantalla de revisión lo vuelve a resolver el servidor contra
 * `products` (ver `lib/cart/resolve.ts`), y lo que de verdad se cobra sigue
 * saliendo de `payments.gross_amount`, que congela `create_booking`. Una cookie
 * la edita cualquiera desde la consola del navegador en diez segundos; si el
 * precio viniera de aquí, el descuento se lo haría el cliente solo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ EL CARRITO NO RETIENE EL HORARIO. (Opción A del Doc 23 §23.3.5)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Añadir NO crea `bookings` ni `sessions`, así que no bloquea el hueco: entre
 * añadir y pagar, otro alumno puede llevárselo. El hold sigue naciendo donde
 * nace hoy — al llegar a la pantalla de pago (D-2) — y dura `HOLD_POLICY.minutes`.
 * La pantalla de revisión revalida cada línea contra `get_available_slots` y lo
 * dice en voz alta cuando una se ha caído. La alternativa (retener al añadir)
 * exige un vencimiento POR LÍNEA que `expire_stale_bookings` hoy no sabe
 * expresar: corta por `bookings.created_at`, que es de la reserva entera.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ✅ **EY-176 YA ESTÁ** (27-ago). Los dos fallos que este bloque anunciaba
 *    están CERRADOS, y aquí queda el porqué para que nadie los reabra.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. `payment_webhook_events.event_id` era **la clave primaria** de la tabla, y
 *    `confirm_payment` la usa como candado: inserta `(event_id, booking_id)` con
 *    `on conflict (event_id) do nothing` y, si no insertó, devuelve sin hacer
 *    nada. Con UN cobro para N reservas el webhook recibe **un solo evento**, así
 *    que la línea 1 se confirmaba y las 2..N salían en no-op SILENCIOSO, se
 *    quedaban en `pending_payment` y `expire_stale_bookings` las cancelaba a los
 *    7 minutos — cobradas, sin clase y sin reembolso, porque la rama 1 del cron
 *    da por hecho que nunca se llegó a cobrar.
 *    → La clave es ahora `(event_id, booking_id)` (`20260827160000`), y el
 *    webhook llama a `confirm_order_payment`, que recorre TODAS las líneas del
 *    pedido en una transacción. **Nunca acredites una línea de un pedido por
 *    separado.**
 *
 * 2. `late_payment_refunds.provider_payment_id` es `not null unique`, así que un
 *    cobro tardío sobre el PaymentIntent de N líneas se anotaba una vez y el
 *    handler devolvía el cargo ENTERO por culpa de una sola.
 *    → Ahora eso ES la regla, no el fallo: el criterio pasó a ser «¿siguen
 *    esperando el cobro TODAS las líneas?» (P-1), así que un cobro tardío de
 *    pedido se devuelve entero y no se acredita ninguna. Un cargo, una fila
 *    (`20260827170000`).
 *
 * ── LO QUE SIGUE SIENDO VERDAD DE ESTE FICHERO ─────────────────────────────
 *
 * El carrito **sigue sin retener el horario** (P-2, ver arriba) y **sigue sin
 * saber nada de dinero**: aquí dentro no hay ni un importe. Lo que cambió está
 * fuera — `POST /api/pedidos` relee esta cookie EN SERVIDOR, llama a
 * `create_order` y devuelve un `orderId`; de ahí en adelante manda `orders`.
 *
 * Y el paso a pago de **una sola línea** no se tocó: sigue siendo la URL de
 * siempre, `/reservar/<id>/checkout?slots=…`, con un `booking` y un `payment`
 * exactamente como el primer día.
 */

/** Nombre de la cookie. Mismo prefijo `ey-` que el resto de las nuestras. */
export const CART_COOKIE = "ey-cart";

/**
 * Evento del navegador con el que las partes de cliente se enteran de que el
 * carrito cambió (el contador de la cabecera, sobre todo).
 *
 * ⚠️ NO es un bus de estado y no debe convertirse en uno. La verdad sigue
 * estando en la cookie; esto solo dice «vuelve a leerla». Se eligió un
 * `CustomEvent` del `window` en lugar de un contexto porque un contexto exige
 * un proveedor por encima de TODA la app —cabecera incluida—, o sea el primer
 * estado global del proyecto, y porque el contador se pinta desde dos layouts
 * distintos (`(public)` y `(app)`) que nunca comparten árbol de React.
 */
export const CART_EVENT = "ey-cart-change";

/**
 * Tope de líneas. No es un capricho de producto: una cookie no puede pasar de
 * ~4 KB y va en CADA petición al servidor. Una línea suelta ocupa ~50 bytes
 * (36 del uuid + 13 del instante), así que 10 líneas son ~500 bytes en el peor
 * caso realista. Si algún día hace falta más, el carrito deja de caber en una
 * cookie y toca la tabla — que es una decisión de EY-176, no de aquí.
 */
export const CART_MAX_LINEAS = 10;

/** Tope de horarios por línea. El paquete más largo del catálogo no llega. */
const MAX_SLOTS = 12;

/** Un año. El carrito se abandona por semanas, como el asistente (M-03). */
const MAX_AGE = 31_536_000;

/**
 * Una línea del carrito: UNA mentoría con SUS horarios. Es exactamente la
 * unidad que `create_booking` sabe comprar (un producto, N horarios, una
 * reserva), y por eso el paso a pago de una línea suelta es literalmente la URL
 * de siempre — no hay traducción que hacer.
 */
export type CartLine = {
  productId: string;
  /**
   * ⚠️ INSTANTES EN MILISEGUNDOS, NO CADENAS ISO. Y es a propósito.
   *
   * El ISO no sirve como identidad: la misma hora llega de la URL como
   * `…T08:00:00.000Z` y de Postgres como `…T08:00:00+00:00`, y un `+` del
   * offset se lee como espacio al decodificar. Comparar por texto es la trampa
   * que ya documentan `booking-panel.tsx` y `lib/checkout/hold.ts` («se compara
   * por INSTANTE, nunca con `===`»). Guardando el número no hay dos formas de
   * escribir el mismo momento, y de paso la cookie ocupa la mitad.
   *
   * Se vuelve a ISO con `toISOString()` justo al construir la URL del checkout;
   * Postgres lo recibe como `timestamptz` y compara por instante igual.
   */
  slots: number[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Separadores. Los tres están en el `cookie-octet` de la RFC 6265 (que excluye
 * coma, punto y coma, comillas, barra invertida y espacios) y ninguno lo escapa
 * `encodeURIComponent`, así que el valor viaja tal cual y se lee tal cual.
 */
const SEP_LINEA = "!";
const SEP_CAMPO = "~";
const SEP_SLOT = ".";

/** La clave con la que se identifica una línea: mentoría + sus horarios. */
export function cartLineKey(l: CartLine): string {
  return `${l.productId}${SEP_CAMPO}${[...l.slots].sort((a, b) => a - b).join(SEP_SLOT)}`;
}

/** Serializa el carrito al valor de la cookie. */
export function encodeCart(lines: CartLine[]): string {
  return lines.map(cartLineKey).join(SEP_LINEA);
}

/**
 * Lee el valor de la cookie y devuelve líneas **válidas**.
 *
 * ⚠️ ESTO ES ENTRADA DEL USUARIO, igual que la barra de direcciones. La cookie
 * la escribe el navegador y la puede editar cualquiera desde la consola, así
 * que aquí no se confía en nada: uuid con forma de uuid, instantes finitos,
 * sin duplicados, y con tope. Lo que no cumpla se DESCARTA en silencio en vez
 * de reventar la pantalla — un carrito corrupto no puede dejar a nadie sin
 * poder comprar, y además así una cookie de una versión anterior del formato
 * se limpia sola en cuanto se toca el carrito.
 *
 * Que la línea sea válida NO significa que la mentoría exista, ni que el
 * horario siga libre, ni cuánto cuesta. Eso lo resuelve el SERVIDOR contra la
 * base en `lib/cart/resolve.ts`.
 */
export function decodeCart(raw: string | null | undefined): CartLine[] {
  if (!raw) return [];
  const vistas = new Set<string>();
  const out: CartLine[] = [];

  for (const trozo of raw.split(SEP_LINEA)) {
    if (out.length >= CART_MAX_LINEAS) break;
    const [productId, slotsRaw] = trozo.split(SEP_CAMPO);
    if (!productId || !UUID.test(productId) || !slotsRaw) continue;

    const slots = [
      ...new Set(
        slotsRaw
          .split(SEP_SLOT)
          .map((n) => Number(n))
          .filter((n) => Number.isSafeInteger(n) && n > 0),
      ),
    ].sort((a, b) => a - b);
    if (slots.length === 0 || slots.length > MAX_SLOTS) continue;

    const line = { productId, slots };
    const key = cartLineKey(line);
    // La misma mentoría con los mismos horarios dos veces es una sola línea:
    // comprarla dos veces sería reservar el mismo hueco dos veces, que
    // `create_booking` rechazaría de todas formas contra su índice único.
    if (vistas.has(key)) continue;
    vistas.add(key);
    out.push(line);
  }

  return out;
}

/* ─────────────────────────── SOLO NAVEGADOR ────────────────────────────── */

/** El carrito tal y como lo ve el navegador ahora mismo. */
export function readCartCookie(): CartLine[] {
  if (typeof document === "undefined") return [];
  const par = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CART_COOKIE}=`));
  return decodeCart(par ? decodeURIComponent(par.slice(CART_COOKIE.length + 1)) : null);
}

/**
 * Escribe el carrito y avisa a quien esté escuchando.
 *
 * Sin `Secure`: en local la app corre en http y la cookie no llegaría nunca —
 * misma razón que en `wizard-step.ts`. No lleva nada sensible: son ids
 * públicos de mentorías y horarios que cualquiera ve en el catálogo.
 */
function writeCartCookie(lines: CartLine[]) {
  if (typeof document === "undefined") return;
  const valor = encodeCart(lines.slice(0, CART_MAX_LINEAS));
  document.cookie = valor
    ? `${CART_COOKIE}=${encodeURIComponent(valor)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`
    : `${CART_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(CART_EVENT));
}

/**
 * Suscripción a los cambios del carrito, con la firma que pide
 * `useSyncExternalStore`. Vive a nivel de módulo porque esa función tiene que
 * ser **estable entre renders**: pasada como closure, React se resuscribiría en
 * cada repintado.
 *
 * `pageshow` además del evento propio: al volver con el botón atrás desde la
 * caché del navegador (bfcache) no hay montaje nuevo, así que sin él el
 * contador se quedaría con el número de antes de irse.
 */
export function subscribeCart(onChange: () => void): () => void {
  window.addEventListener(CART_EVENT, onChange);
  window.addEventListener("pageshow", onChange);
  return () => {
    window.removeEventListener(CART_EVENT, onChange);
    window.removeEventListener("pageshow", onChange);
  };
}

/**
 * Cuántas líneas hay, para `useSyncExternalStore`.
 *
 * ⚠️ Devuelve un NÚMERO y no la lista a propósito: React compara el resultado
 * de esta función con `Object.is` en cada render, y un array nuevo cada vez
 * nunca es igual al anterior → bucle infinito de renders. Lo mismo vale para
 * cualquier instantánea que se añada aquí: primitivas, o memoizadas.
 */
export function cartCountSnapshot(): number {
  return readCartCookie().length;
}

/** ¿está esta línea en el carrito? Instantánea booleana, por lo mismo. */
export function cartHasKeySnapshot(key: string): boolean {
  return readCartCookie().some((l) => cartLineKey(l) === key);
}

/** Por qué no se pudo añadir, o `null` si se añadió (o ya estaba). */
export type AddResult = null | "lleno" | "invalida";

/**
 * Añade una línea. Idempotente: añadir dos veces lo mismo no duplica nada, que
 * es justo lo que pasa cuando alguien pulsa dos veces el botón.
 */
export function addCartLine(line: CartLine): AddResult {
  if (!UUID.test(line.productId) || line.slots.length === 0) return "invalida";
  const actual = readCartCookie();
  const key = cartLineKey(line);
  if (actual.some((l) => cartLineKey(l) === key)) return null;
  if (actual.length >= CART_MAX_LINEAS) return "lleno";
  writeCartCookie([...actual, line]);
  return null;
}

/** Quita las líneas cuyas claves se pasan. Una sola escritura para todas. */
export function removeCartLines(keys: string[]) {
  if (keys.length === 0) return;
  const fuera = new Set(keys);
  const actual = readCartCookie();
  const quedan = actual.filter((l) => !fuera.has(cartLineKey(l)));
  if (quedan.length === actual.length) return; // nada que hacer, ni evento
  writeCartCookie(quedan);
}
