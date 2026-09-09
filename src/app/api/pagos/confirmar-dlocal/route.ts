import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DlocalCheckoutError,
  abrirSesionDeCheckout,
  camposDelPagador,
  confirmarCheckout,
  fijarMetodoDePago,
  isDlocalGoConfigured,
  recuperarPago,
  type CampoDePagador,
} from "@/lib/dlocalgo";

/**
 * EL EMPUJÓN DEL CHECKOUT TRANSPARENTE DE dLOCAL — dictado de pagos §2, punto 2.
 *
 * `dlocal-embed.tsx` tokeniza la tarjeta contra dLocal (el PAN no pasa por aquí
 * ni por ningún sitio nuestro) y le pide a esta ruta que confirme el cobro.
 *
 * ── 🔴 LO QUE ESTA RUTA **NO** HACE: ESCRIBIR EN `payments` ──────────────────
 * Ni una línea. Acreditar un cobro sigue siendo exclusivo del webhook
 * (`api/webhooks/dlocalgo`), que es quien llama a `confirm_payment` /
 * `confirm_order_payment` con el importe de `payments.gross_amount`. Regla de
 * oro 2 y §6 del dictado, palabra por palabra: «La ruta nueva de confirmación de
 * dLocal no escribe en `payments`».
 *
 * Esto empuja el cobro y CUENTA QUÉ PASÓ. Lo que devuelve sirve para pintar la
 * pantalla, no para decidir si hay dinero. Y por eso una respuesta `pagado` de
 * aquí no significa que la reserva esté confirmada: significa que dLocal aceptó
 * el cargo y que su notificación está en camino. La pantalla de confirmación ya
 * sabe leer la reserva y distinguir pagado de no pagado.
 *
 * ── 🔴 EL `DP-…` NUNCA VIENE DEL NAVEGADOR ──────────────────────────────────
 * Se relee de `payments.provider_payment_id` con `service_role`, a partir del
 * `bookingId` / `orderId` que el navegador dice y cuya PROPIEDAD comprueba la
 * RLS con el cliente de cookies. Aceptar el `DP-…` (o el token de checkout) del
 * cliente permitiría a cualquiera con sesión empujar el cobro de otra persona:
 * el token viaja en la URL alojada, así que no es ningún secreto.
 *
 * ── LOS TRES PASOS, Y POR QUÉ ESTÁN LOS TRES AQUÍ ───────────────────────────
 * `GET /v1/checkout/{token}` → `POST /v1/checkout/prepare-confirm` →
 * `POST /v1/checkout/confirm`. Están los tres en el servidor porque el segundo y
 * el tercero se identifican con una COOKIE de `api-sbx.dlocalgo.com`: desde el
 * navegador serían cookies de tercero y Safari las bloquea de serie. Aquí la
 * cookie se pone a mano (ver `checkoutFetch` en `lib/dlocalgo.ts`) y el orden es
 * obligatorio: sin el paso 1 el 2 revienta con un 500
 * (`java.lang.NullPointerException`) y sin el 2 el 3 devuelve 406.
 *
 * Todo medido el 9-sep-2026 contra `api-sbx.dlocalgo.com` con nuestras claves.
 */

/** Node, no edge: `lib/dlocalgo` es `server-only` y usa `crypto` de Node. */
export const runtime = "nodejs";

/**
 * SERIALIZACIÓN POR COBRO — y con su techo dicho, que es lo importante.
 *
 * Dos pulsaciones del botón de pagar no pueden empujar el mismo cobro dos veces.
 * El candado vive EN MEMORIA porque la alternativa era escribir en `payments`, y
 * eso es justo lo que esta ruta no hace.
 *
 * ⚠️ NO ES UN CANDADO DISTRIBUIDO. Cada instancia de la función tiene el suyo,
 * así que dos peticiones que caigan en instancias distintas pasan las dos. Lo
 * que impide entonces el doble cargo son cosas que no son nuestras y que existen
 * igual: dLocal solo acepta UN confirm por sesión de checkout (el segundo
 * responde que el pago ya está completado) y `confirm_payment` es idempotente
 * por `event_id`. Este candado ahorra el 99 % de los casos —el doble clic— sin
 * fingir que resuelve el 1 % restante.
 *
 * ⚠️ Y NO ES UN LÍMITE POR IP, A PROPÓSITO. Un 429 en mitad de un pago es lo peor
 * que le puede pasar a alguien que ya escribió su tarjeta: se llave por COBRO, y
 * el mensaje dice que ya se está procesando, no que se ha portado mal.
 */
const enVuelo = new Set<string>();

/** Lo que el navegador manda para identificar SU cobro. Nada más. */
type Sujeto = { tipo: "booking"; id: string } | { tipo: "order"; id: string };

type Resuelto = {
  sujeto: Sujeto;
  /** El `DP-…`. Leído con `service_role`, jamás del cliente. */
  dp: string;
  /** Las reservas del sujeto, para comprobar que siguen esperando pago. */
  reservas: string[];
  /**
   * El correo de la sesión, que es lo que dLocal exige como `clientEmail`.
   *
   * Viaja aquí y no se vuelve a pedir porque `getUser()` habla con Auth por la
   * red: llamarlo dos veces en la misma petición es exactamente lo que hacía
   * lento al sitio (`4f4be13`).
   */
  email: string | null;
};

type Fallo = { error: string; status: number; estado?: string; redirectUrl?: string };

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Del sujeto que dice el navegador al `DP-…` que dice la base de datos.
 *
 * ⚠️ TRES COMPROBACIONES Y NINGUNA SOBRA:
 *   1. la RLS (cliente de cookies) decide si esa reserva o ese pedido son suyos;
 *   2. **la reserva sigue viva** — con el hold de 7 minutos, `expire_stale_
 *      bookings` puede haberla cancelado mientras se teclea la tarjeta, y
 *      empujar el cobro entonces es cobrarle una clase que ya no existe (la
 *      devolvería X-02 en el webhook, pero cobrar para devolver es peor que no
 *      cobrar);
 *   3. el pago sigue `pending` — si ya está `paid`, el webhook llegó primero.
 */
async function resolver(sujeto: Sujeto): Promise<Resuelto | Fallo> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "no autenticado", status: 401 };

  const admin = createAdminClient();

  // ── 1 · propiedad y estado, con RLS ──────────────────────────────────────
  let reservas: string[];
  if (sujeto.tipo === "order") {
    const { data: pedido } = await supabase
      .from("orders")
      .select("id, status")
      .eq("id", sujeto.id)
      .maybeSingle();
    if (!pedido) return { error: "pedido no encontrado", status: 404 };
    if (pedido.status !== "pending_payment") {
      return { error: `el pedido está en ${pedido.status}`, status: 409 };
    }

    const { data: lineas } = await supabase
      .from("bookings")
      .select("id, status")
      .eq("order_id", sujeto.id);
    const filas = lineas ?? [];
    if (filas.length === 0) return { error: "el pedido no tiene líneas", status: 409 };
    // P-1 · todo o nada: una línea vencida invalida el pedido entero.
    const caida = filas.find((b) => b.status !== "pending_payment");
    if (caida) {
      return {
        error:
          "Se acabó el tiempo de reserva de una de las mentorías y se liberó el horario. " +
          "Vuelve a elegirlo para pagar.",
        status: 409,
      };
    }
    reservas = filas.map((b) => b.id);
  } else {
    const { data: reserva } = await supabase
      .from("bookings")
      .select("id, status")
      .eq("id", sujeto.id)
      .maybeSingle();
    if (!reserva) return { error: "reserva no encontrada", status: 404 };
    if (reserva.status !== "pending_payment") {
      return {
        error:
          // ⚠️ NO HAY ESTADO `expired`: `expire_stale_bookings` deja la reserva
          // en `cancelled`, que es el único estado con el que llega aquí una
          // reserva a la que se le acabó el hold mientras se tecleaba la tarjeta.
          reserva.status === "cancelled"
            ? "Se acabó el tiempo de reserva y se liberó el horario. Vuelve a elegirlo para pagar."
            : `la reserva está en ${reserva.status}`,
        status: 409,
      };
    }
    reservas = [reserva.id];
  }

  // ── 2 · el `DP-…` y el estado del pago, con `service_role` ────────────────
  // ⚠️ El error se relanza como 500 y NO se trata como «no hay»: a
  // `service_role` puede faltarle un grant y eso muerde en tiempo de ejecución
  // (regla de oro 9). Confundirlo con «sin cobro abierto» le diría al alumno que
  // vuelva a empezar cuando su cobro está vivo.
  const { data: pagos, error } = await admin
    .from("payments")
    .select("id, status, provider, provider_payment_id")
    .in("booking_id", reservas);
  if (error) {
    console.error("[confirmar-dlocal] no se pudieron leer los pagos:", error.message);
    return { error: "no se pudo leer el cobro", status: 500 };
  }

  const filas = pagos ?? [];
  if (filas.length !== reservas.length) {
    return { error: "alguna línea no tiene pago asociado", status: 500 };
  }
  // Con un pedido el cobro es UNO (P-3): `sellarRef` estampa el mismo `DP-…` en
  // todas las líneas, así que basta la primera — pero se comprueba que coinciden,
  // porque si no coincidieran habría dos cobros para el mismo pedido.
  const dp = filas[0]!.provider_payment_id;
  if (!dp) {
    return {
      error: "Este pago no está abierto. Vuelve a cargar la pantalla.",
      status: 409,
    };
  }
  if (filas.some((p) => p.provider_payment_id !== dp)) {
    console.error("[confirmar-dlocal] 🔴 líneas del mismo sujeto con cobros distintos", {
      sujeto,
      referencias: filas.map((p) => p.provider_payment_id),
    });
    return { error: "el cobro de este pedido no es único", status: 409 };
  }
  if (filas.some((p) => p.provider !== "dlocal")) {
    // La cadena de respaldo cambió de pasarela: este formulario no es el suyo.
    return {
      error: "Este pago ya no se cobra por esta pasarela. Vuelve a cargar la pantalla.",
      status: 409,
    };
  }
  const yaCobrado = filas.find((p) => p.status !== "pending");
  if (yaCobrado) {
    // El webhook llegó antes. No es un error del alumno y no se vuelve a empujar.
    return {
      error: "Este pago ya se procesó.",
      status: 409,
      estado: "ya-procesado",
    };
  }

  return { sujeto, dp, reservas, email: user.email ?? null };
}

/**
 * LOS DATOS DEL PAGADOR QUE SE ACEPTAN DEL NAVEGADOR. Lista blanca, no `...cuerpo`.
 *
 * ⚠️ `clientEmail` NO ESTÁ, y no es un descuido: es el correo de la cuenta y sale
 * de la sesión. Y no hay ningún campo de importe, que es la regla de oro 2 — el
 * total lo tiene la sesión de checkout, congelado al crear el cobro desde
 * `payments.gross_amount`.
 */
const CAMPOS_DEL_PAGADOR = [
  "clientFirstName",
  "clientLastName",
  "clientDocument",
  "clientDocumentType",
] as const;

/** El sujeto que viene en la URL (GET) o en el cuerpo (POST). */
function sujetoDe(bookingId: unknown, orderId: unknown): Sujeto | Fallo {
  const b = typeof bookingId === "string" ? bookingId : null;
  const o = typeof orderId === "string" ? orderId : null;
  if (b && o) return { error: "bookingId y orderId son excluyentes", status: 400 };
  if (b) {
    return UUID.test(b) ? { tipo: "booking", id: b } : { error: "bookingId inválido", status: 400 };
  }
  if (o) {
    return UUID.test(o) ? { tipo: "order", id: o } : { error: "orderId inválido", status: 400 };
  }
  return { error: "falta bookingId u orderId", status: 400 };
}

function esFallo(x: unknown): x is Fallo {
  return typeof x === "object" && x !== null && "error" in x && "status" in x;
}

/**
 * ── QUÉ CAMPOS PEDIRLE AL PAGADOR (GET) ─────────────────────────────────────
 *
 * 🔑 LAS REGLAS SON DE dLOCAL, NO NUESTRAS, Y ESO ES TODO EL PUNTO. Su propio
 * checkout pide la lista de campos con `GET /v1/checkout/payment_method/{id}` y
 * viene con la regex de cada uno. Así que aquí no hay ni una expresión regular
 * inventada, ni un dígito verificador, ni una tabla de países que mantener
 * —tampoco `payout_country_rules.document_patterns`, que es del PAYOUT y está
 * indexada por un tipo de documento que el comprador no elige—.
 *
 * Medido para Ecuador (métodos 531 Visa y 743 Pago Efectivo, idénticos):
 *   clientFirstName  ^[^\d]{1,128}$
 *   clientLastName   ^[^\d]{1,128}$
 *   clientDocumentType  COMBO_BOX, un solo valor: CI
 *   clientDocument   ^(\d{9,11}|\d{12,14})$
 *   clientEmail      ^\S+@\S+$
 *
 * ⚠️ Y DESMIENTE DOS COSAS DEL DICTADO §2, medidas el 9-sep-2026:
 *   · el `confirm` **no** pasa sin `clientDocumentType` (`400 {"errorCode":908,
 *     "causeMessage":"Missing field: clientDocumentType"}`);
 *   · y «tres campos» solo se cumple en **Ecuador**, que es el único país con un
 *     único tipo de documento (`CI`) y por tanto el único donde se rellena sin
 *     preguntar. AR (DNI/CUIT/CUIL), BR (CPF/CNPJ), CL (RUN/RUT/CI) y MX
 *     (CURP/RFC/IFE) ven un desplegable, o sea CUATRO campos. Es un dato de
 *     producto, no un fallo: se dice aquí para que nadie lo vuelva a «medir».
 *
 * ⚠️ SE PIDE SOBRE EL PRIMER MÉTODO DE TARJETA, no sobre el que la persona vaya
 * a usar, porque el formulario existe antes de que haya tarjeta que leer. Para
 * EC los dos métodos consultados devolvieron lo mismo; si algún día divergieran,
 * quien manda es el `confirm`, que rechaza con el campo dentro del mensaje y esta
 * pantalla lo señala.
 */
export async function GET(req: Request) {
  if (!isDlocalGoConfigured()) {
    return NextResponse.json({ error: "dLocal Go no configurado" }, { status: 503 });
  }

  const url = new URL(req.url);
  const sujeto = sujetoDe(url.searchParams.get("bookingId"), url.searchParams.get("orderId"));
  if (esFallo(sujeto)) return NextResponse.json({ error: sujeto.error }, { status: sujeto.status });

  const resuelto = await resolver(sujeto);
  if (esFallo(resuelto)) {
    return NextResponse.json(
      { error: resuelto.error, estado: resuelto.estado },
      { status: resuelto.status },
    );
  }

  try {
    const pago = await recuperarPago(resuelto.dp);
    const token = pago.merchant_checkout_token;
    if (!token) {
      return NextResponse.json({ estado: "no-transparente", redirectUrl: pago.redirect_url }, { status: 200 });
    }

    // Paso 1 de la secuencia. Además de inicializar la sesión, es lo único que
    // dice si el transparente está activo: `subType`.
    const sesion = await abrirSesionDeCheckout(token);
    if (sesion.subType !== "TRANSPARENT_CHECKOUT") {
      console.error(
        `[confirmar-dlocal] 🔴 ${resuelto.dp} no es transparente (subType='${sesion.subType}'): ` +
          `hay que activar allow_transparent en la cuenta`,
      );
      return NextResponse.json({ estado: "no-transparente", redirectUrl: pago.redirect_url });
    }

    const metodos = sesion.paymentMethods ?? [];
    const tarjeta = metodos.find((m) => m.type === "CREDIT_CARD");
    if (!tarjeta) {
      // Sin tarjeta no hay transparente: solo su formulario alojado ofrece los
      // medios locales (D-3).
      console.error(
        `[confirmar-dlocal] la cuenta no ofrece tarjeta en ${sesion.country ?? "?"} ` +
          `(métodos: ${metodos.map((m) => m.code).join(", ") || "ninguno"})`,
      );
      return NextResponse.json({ estado: "sin-tarjeta", redirectUrl: pago.redirect_url });
    }

    const { fields } = await camposDelPagador(token, tarjeta.id);

    return NextResponse.json({
      estado: "listo",
      /** Lo necesita el SDK para montar los campos: `fields({country})`. */
      pais: sesion.country ?? pago.country ?? null,
      /** Tal cual los pide dLocal, con SUS regex. El TSX no añade ninguna. */
      campos: fields.map((c: CampoDePagador) => ({
        nombre: c.name,
        tipo: c.type,
        regex: c.regex ?? null,
        opciones: c.values?.map((v) => ({ valor: v.value, etiqueta: v.displayName })) ?? null,
      })),
      redirectUrl: pago.redirect_url ?? null,
    });
  } catch (e) {
    console.error("[confirmar-dlocal] no se pudieron pedir los campos del pagador:", e);
    return NextResponse.json(
      { error: "No se pudo preparar el formulario de pago." },
      { status: e instanceof DlocalCheckoutError && !e.esTransitorio ? 400 : 502 },
    );
  }
}

/**
 * LA TAXONOMÍA DE ERRORES DEL CHECKOUT, traducida a lo que hay que hacer.
 *
 * Espeja el criterio de `api/webhooks/dlocalgo`: lo que es del MOMENTO se
 * reintenta, lo que es de la PETICIÓN no, y lo que deja el cobro vivo no cancela
 * nada —una tarjeta rechazada deja el cobro `PENDING` y la persona reintenta con
 * otra, que es exactamente por lo que `REJECTED` no es `cobro-fallido` allí—.
 *
 * Los códigos salen de la tabla del propio checkout de dLocal
 * (`checkout-sbx.dlocalgo.com/assets/index-*.js`), y los tres que el encargo
 * pedía distinguir están medidos:
 *
 *   · **929** «Transparent Checkout not allowed» → configuración de la cuenta.
 *     No es culpa de la tarjeta y no se arregla reintentando: se sale a la URL
 *     alojada. (Documentado por dLocal; nuestra cuenta lo tiene activo, así que
 *     no se ha podido provocar.)
 *   · **406** «Missing payment method» → el navegador no fijó el método. Es
 *     NUESTRO fallo de secuencia (falta el `prepare-confirm`), no del alumno:
 *     medido creando un cobro y llamando al `confirm` a pelo.
 *   · **404 / 403 / 405 / 308** → ese método no está habilitado para el comercio
 *     o para el país. Se sale a la URL alojada, que sí ofrece los locales.
 *
 * `campo` es lo que convierte un error de dLocal en un error DEBAJO DEL CAMPO
 * (3.3.1): viene de su `causeMessage` («Missing field: clientDocumentType»).
 */
type Motivo = {
  /** Qué hacer: reintentar aquí, salir a la URL alojada, o rendirse. */
  clase: "campo" | "tarjeta" | "caducado" | "alojado" | "secuencia" | "transitorio" | "desconocido";
  /** Para la persona, en español. */
  mensaje: string;
  /** El campo del formulario al que colgar el error, si dLocal lo dice. */
  campo?: string;
  /** HTTP con el que responder. */
  status: number;
};

function motivoDeCheckout(e: DlocalCheckoutError): Motivo {
  const code = e.errorCode;
  const detalle = e.detalle ?? "";

  // ⚠️ 908 ESTÁ SOBRECARGADO en su propia tabla: es «pago ya completado» y
  // también «faltan campos». Se distingue por el `causeMessage`, no por el
  // código, y el orden importa: al revés, un campo que falta se anunciaría como
  // un pago hecho.
  const falta = /Missing field:\s*(\w+)/i.exec(detalle);
  if (falta) {
    return {
      clase: "campo",
      campo: falta[1],
      mensaje: "Falta un dato para poder cobrar. Revisa el formulario.",
      status: 400,
    };
  }
  if (code === 908) {
    return { clase: "caducado", mensaje: "Este pago ya se completó.", status: 409 };
  }

  // Configuración de la cuenta: el transparente no está permitido.
  if (code === 929 || /transparent/i.test(e.message)) {
    return {
      clase: "alojado",
      mensaje: "No podemos cobrar aquí mismo. Te llevamos a la pasarela para terminar.",
      status: 409,
    };
  }

  // Nuestro fallo de secuencia: el `prepare-confirm` no llegó o se perdió.
  if (code === 406) {
    return {
      clase: "secuencia",
      mensaje: "No pudimos preparar el cobro. Vuelve a intentarlo.",
      status: 502,
    };
  }

  // Método no habilitado / no soportado en el país. La URL alojada sí tiene los
  // medios locales (D-3), así que la salida es esa y no un reintento.
  if (code === 404 || code === 403 || code === 405 || code === 308) {
    return {
      clase: "alojado",
      mensaje: "Esa forma de pago no está disponible aquí. Te llevamos a la pasarela.",
      status: 409,
    };
  }

  // El documento, que es el campo que más se equivoca.
  if (code === 201) {
    return {
      clase: "campo",
      campo: "clientDocument",
      mensaje: "Ese número de documento no es válido para tu país. Revísalo.",
      status: 400,
    };
  }
  if (code === 103) {
    return {
      clase: "campo",
      mensaje: "Alguno de tus datos no tiene el formato que pide el banco. Revísalos.",
      status: 400,
    };
  }
  if (code === 306) {
    return {
      clase: "desconocido",
      mensaje: "El importe es menor que el mínimo que acepta la pasarela.",
      status: 409,
    };
  }

  // El token de la tarjeta ya no vale: se vuelve a escribir.
  if (code === 840 || code === 905) {
    return {
      clase: "tarjeta",
      mensaje: "Los datos de la tarjeta caducaron antes de enviarse. Vuelve a escribirlos.",
      status: 400,
    };
  }

  // El checkout caducó (el hold venció, o pasaron 24 h).
  if (code === 823 || code === 906 || code === 920) {
    return {
      clase: "caducado",
      mensaje: "Se acabó el tiempo para pagar esta reserva. Vuelve a elegir tu horario.",
      status: 409,
    };
  }
  if (code === 907) {
    return { clase: "caducado", mensaje: "Este pago se canceló.", status: 409 };
  }

  // La familia «el banco dijo no». El cobro SIGUE VIVO: se reintenta con otra
  // tarjeta y no se cancela nada.
  if (code === 807) {
    return { clase: "tarjeta", mensaje: "Tu tarjeta no tiene fondos suficientes.", status: 402 };
  }
  if (code === 812) {
    return { clase: "tarjeta", mensaje: "Esa tarjeta está vencida.", status: 402 };
  }
  if (code === 813 || code === 814) {
    return {
      clase: "tarjeta",
      mensaje: "Los datos de la tarjeta no son correctos. Revísalos.",
      status: 402,
    };
  }
  if (code === 815 || code === 409) {
    return {
      clase: "tarjeta",
      mensaje: "El importe supera el límite de tu tarjeta. Prueba con otra.",
      status: 402,
    };
  }
  if (code === 927 || code === 808 || code === 827) {
    return {
      clase: "tarjeta",
      mensaje: "Tu banco no acepta esta tarjeta para este pago. Prueba con otra.",
      status: 402,
    };
  }
  if (
    code === 810 ||
    code === 818 ||
    code === 820 ||
    code === 806 ||
    code === 105 ||
    code === 1400 ||
    code === 824 ||
    code === 825 ||
    code === 826 ||
    code === 828
  ) {
    return {
      clase: "tarjeta",
      mensaje: "Tu banco rechazó el pago. Prueba con otra tarjeta o consúltalo con él.",
      status: 402,
    };
  }

  // Fue el momento, no la petición.
  if (code === 802 || code === 809 || code === 811 || code === 850 || code === 853 || code === 858) {
    return {
      clase: "transitorio",
      mensaje: "La pasarela no está respondiendo bien ahora mismo. Prueba en un momento.",
      status: 503,
    };
  }

  return e.esTransitorio
    ? {
        clase: "transitorio",
        mensaje: "La pasarela no está respondiendo bien ahora mismo. Prueba en un momento.",
        status: 503,
      }
    : {
        clase: "desconocido",
        mensaje: "No se pudo completar el pago. Prueba con otra tarjeta.",
        status: 402,
      };
}

export async function POST(req: Request) {
  if (!isDlocalGoConfigured()) {
    return NextResponse.json({ error: "dLocal Go no configurado" }, { status: 503 });
  }

  const cuerpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sujeto = sujetoDe(cuerpo.bookingId, cuerpo.orderId);
  if (esFallo(sujeto)) return NextResponse.json({ error: sujeto.error }, { status: sujeto.status });

  const paymentToken = typeof cuerpo.paymentToken === "string" ? cuerpo.paymentToken.trim() : "";
  const brand = typeof cuerpo.brand === "string" ? cuerpo.brand.trim() : "";
  const tipoTarjeta = typeof cuerpo.type === "string" ? cuerpo.type.trim() : "";
  if (!paymentToken || !brand) {
    return NextResponse.json(
      { error: "falta el token de la tarjeta o su marca" },
      { status: 400 },
    );
  }

  const resuelto = await resolver(sujeto);
  if (esFallo(resuelto)) {
    return NextResponse.json(
      { error: resuelto.error, estado: resuelto.estado },
      { status: resuelto.status },
    );
  }

  // ── el candado, por cobro ─────────────────────────────────────────────────
  if (enVuelo.has(resuelto.dp)) {
    return NextResponse.json(
      { estado: "en-curso", error: "Este pago ya se está procesando. Espera un momento." },
      { status: 409 },
    );
  }
  enVuelo.add(resuelto.dp);

  try {
    const pago = await recuperarPago(resuelto.dp);
    const token = pago.merchant_checkout_token;

    // Su estado manda sobre el nuestro: si el cobro ya no está PENDING, no se
    // empuja nada. Es la misma comprobación que hace `reutilizable` en el
    // adaptador y por el mismo motivo.
    if (pago.status !== "PENDING") {
      return NextResponse.json(
        {
          estado: pago.status === "PAID" ? "ya-procesado" : "caducado",
          error:
            pago.status === "PAID"
              ? "Este pago ya se completó."
              : "Este cobro ya no está abierto. Vuelve a cargar la pantalla.",
        },
        { status: 409 },
      );
    }
    if (!token) {
      return NextResponse.json(
        { estado: "no-transparente", redirectUrl: pago.redirect_url },
        { status: 409 },
      );
    }

    // Paso 1 · inicializar la sesión y confirmar que es transparente.
    const sesion = await abrirSesionDeCheckout(token);
    if (sesion.subType !== "TRANSPARENT_CHECKOUT") {
      return NextResponse.json(
        { estado: "no-transparente", redirectUrl: pago.redirect_url },
        { status: 409 },
      );
    }

    // El correo SIEMPRE del servidor. dLocal lo exige (`clientEmail`) y es el de
    // la cuenta que está pagando, no un campo del formulario. Viene de
    // `resolver`, que ya habló con Auth: no se vuelve a preguntar.
    const valores: Record<string, string> = {
      // dLocal lo acepta vacío (medido). Es el identificador de dispositivo de
      // su servicio antifraude, y montarlo aquí significaría cargar un
      // recolector de huella de terceros en la pantalla de pago: ver el aviso de
      // legales del dictado §6. Queda como decisión de producto, no de código.
      deviceId: typeof cuerpo.deviceId === "string" ? cuerpo.deviceId : "",
      country: (sesion.country ?? pago.country ?? "").toUpperCase(),
      clientEmail: resuelto.email ?? "",
      paymentToken,
      // Una sola cuota. El checkout de dLocal ofrece plan de cuotas y aquí NO se
      // ofrece: el precio que el alumno aceptó es el de `payments.gross_amount`.
      installments: "1",
    };
    for (const campo of CAMPOS_DEL_PAGADOR) {
      const valor = cuerpo[campo];
      if (typeof valor === "string" && valor.trim()) valores[campo] = valor.trim();
    }

    // Paso 2 · fijar el método con lo que dijo el BIN. Sin esto, el paso 3 es un
    // 406 y no dice por qué.
    await fijarMetodoDePago(token, { brand, type: tipoTarjeta || "CREDIT" });

    // Paso 3 · empujar.
    const salida = await confirmarCheckout(token, valores);

    /**
     * ⚠️ ESTO NO ES «PAGADO». Lo dice el dictado §6 y lo dice el webhook: quien
     * acredita es `confirm_payment`, y llega por notificación firmada. Aquí solo
     * se decide qué pantalla ve la persona.
     *
     * `redirectUrl` es el 3DS del banco emisor: la excepción inevitable al
     * «siempre dentro», porque lo impone su banco. La vuelta aterriza en NUESTRA
     * pantalla de confirmación (`success_url` del cobro).
     */
    const redirectUrl =
      salida.redirectUrl ?? (salida.url && !salida.iframe ? salida.url : undefined);

    console.info("[confirmar-dlocal] cobro empujado", {
      cobro: resuelto.dp,
      sujeto: resuelto.sujeto,
      estado: salida.status ?? "(sin estado)",
      con3ds: Boolean(salida.redirectUrl),
    });

    return NextResponse.json({
      // Deliberadamente `empujado` y no `pagado`: lo segundo sería mentir sobre
      // quién acredita.
      estado: redirectUrl ? "3ds" : "empujado",
      detalle: salida.status ?? null,
      redirectUrl,
    });
  } catch (e) {
    if (e instanceof DlocalCheckoutError) {
      const motivo = motivoDeCheckout(e);
      // Se registra ENTERO —es lo único que va a poder mirar quien investigue— y
      // hacia fuera va el mensaje en español, sin interioridades del proveedor.
      const grave = motivo.clase === "secuencia" || motivo.clase === "alojado";
      const log = grave ? console.error : console.warn;
      log(`[confirmar-dlocal] dLocal rechazó el confirm de ${resuelto.dp}`, {
        clase: motivo.clase,
        status: e.status,
        errorCode: e.errorCode,
        mensaje: e.message,
        detalle: e.detalle,
      });

      // Cuando la salida es su checkout alojado, se devuelve la URL: convierte un
      // formulario roto en el checkout de siempre.
      let redirectUrl: string | undefined;
      if (motivo.clase === "alojado") {
        try {
          redirectUrl = (await recuperarPago(resuelto.dp)).redirect_url;
        } catch {
          redirectUrl = undefined;
        }
      }

      return NextResponse.json(
        {
          estado: motivo.clase === "alojado" ? "no-transparente" : motivo.clase,
          error: motivo.mensaje,
          campo: motivo.campo,
          redirectUrl,
        },
        { status: motivo.status },
      );
    }

    console.error(`[confirmar-dlocal] falló el confirm de ${resuelto.dp}:`, e);
    return NextResponse.json(
      {
        estado: "transitorio",
        error: "No pudimos contactar con la pasarela. Prueba de nuevo en un momento.",
      },
      { status: 502 },
    );
  } finally {
    enVuelo.delete(resuelto.dp);
  }
}
