import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { PSP_KEYS, adapterFor } from "@/lib/payments";
import type { PspProvider } from "@/lib/payments/port";

/**
 * X-01 · devuelve de verdad el dinero que la base de datos ya dio por devuelto.
 *
 * QUÉ PASABA. Los tres caminos de reembolso —RN-37 al cancelar, el reembolso
 * manual del admin (US-704) y el vencimiento de aceptación de 24 h (RN-38)—
 * escribían `payments.status = 'refunded'` y `refunded_amount` en Postgres y
 * ahí se acababa. Nadie hablaba con el PSP. Con el ruteo en 'simulated' era
 * inocuo; con un PSP cobrando de verdad es la plataforma anotándose reembolsos
 * que el alumno nunca recibe, y encima avisándole por correo (NTF-10). Los
 * Términos publicados hoy, §13, prometen la devolución «al método de pago
 * original».
 *
 * ⚠️ A2 · YA NO ES UN JOB DE STRIPE. Resuelve el adaptador POR FILA desde
 * `refund_requests.provider`, así que sirve igual para Stripe y para dLocal Go
 * — y para el tercero, sin volver aquí. Lo que decide es el SNAPSHOT de quién
 * cobró, no la regla activa: no se puede devolver por Stripe lo que cobró
 * dLocal.
 *
 * POR QUÉ UN JOB Y NO UNA LLAMADA EN CALIENTE. Uno de los tres caminos
 * (`expire_stale_bookings`) corre en **pg_cron dentro de la base**, sin ninguna
 * petición HTTP donde colgar un reembolso, y Postgres no puede llamar a un PSP.
 * Así que se usa el patrón que el proyecto ya tiene para el correo: la BD
 * ENCOLA (`refund_requests`, migración `20260817170000`) y esto EJECUTA.
 *
 * ⚠️ NO HAY FORMA DE PROBAR ESTO SIN UN COBRO REAL, así que el archivo está
 * escrito para que no se pueda desplegar a ciegas:
 *   · con la cola vacía no hace absolutamente nada y lo dice;
 *   · sin la credencial DE SU PSP, una fila no se toca (queda `pending`, no
 *     `failed`) — y ahora es fila a fila, no una puerta global: una clave que
 *     falta en un proveedor no puede parar la cola del otro;
 *   · `?simulacro=1` enseña exactamente qué mandaría, sin mandarlo;
 *   · cada movimiento de dinero deja una línea en el log con los tres ids que
 *     hacen falta para conciliar (pago, referencia del cargo, reembolso).
 *
 * DÓNDE SE PROGRAMA. En GitHub Actions, como `notifications-send` y por el
 * mismo motivo: Vercel Hobby solo permite UN cron al día y ya lo gasta la purga
 * de grabaciones. Un reembolso que sale mañana a las 4 de la mañana no cumple
 * la promesa de §13. ⚠️ Mientras nadie añada ese workflow (variable
 * `APP_BASE_URL` + secret `CRON_SECRET`), esta ruta no la llama nadie y la cola
 * crece en silencio: `select public.refunds_backlog();` es el termómetro.
 */

/** Node, no edge: por debajo del puerto está el cliente del PSP, igual que los webhooks. */
export const runtime = "nodejs";

/**
 * Tope por pasada. Deliberadamente MÁS BAJO que el de los correos (50): cada
 * vuelta de este bucle mueve dinero y espera a la API del PSP. Lo que sobre
 * sale en la pasada siguiente — para eso 'pending' significa "todavía no".
 */
const LOTE = 25;

/**
 * Una fila de la cola, con lo justo para ejecutarla.
 *
 * ⚠️ Los tipos generados todavía no conocen `refund_requests` (su migración es
 * de hoy y no se ha aplicado): `npm run db:push` + `npm run db:types` los pone
 * al día. Hasta entonces `tsc` se queja de las tres consultas de este archivo.
 */
type SolicitudReembolso = {
  id: string;
  payment_id: string;
  booking_id: string;
  /** Qué pasarela cobró esto. Decide el adaptador, fila a fila. */
  provider: string;
  provider_payment_id: string | null;
  amount: number;
  currency: string;
  reason: string;
};

/**
 * El adaptador de una fila, ya estrechado a PSP.
 *
 * `adapterFor` devuelve `AnyProvider` porque una clave desconocida cae al
 * simulado, que no sabe reembolsar. Aquí eso no puede pasar —la consulta filtra
 * por `PSP_KEYS`— pero se comprueba igual en vez de castear: el día que alguien
 * añada una clave a la tabla sin adaptador, esto lo dice en vez de reventar.
 */
function pspDe(clave: string): PspProvider | null {
  const p = adapterFor(clave);
  return p.opensRemoteCheckout ? p : null;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  // FALLA CERRADO, igual que los otros dos jobs. Sin secreto esto sería un
  // endpoint público capaz de vaciar la cola de reembolsos de la plataforma
  // contra el PSP. Que no corra es un problema; que lo dispare cualquiera es
  // otro mucho peor.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurada" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  // Ensayo: lee la cola y cuenta qué haría, sin llamar a nadie ni escribir
  // nada. Es la única manera de mirar por dentro de este job antes de que mueva
  // el primer euro de verdad. Va detrás del mismo secreto porque enseña
  // importes y referencias de cobro.
  const simulacro = new URL(req.url).searchParams.get("simulacro") === "1";

  const admin = createAdminClient();

  // service_role a propósito: la cola es admin-only por RLS y este trabajo no
  // tiene ninguna persona detrás. Regla de oro 9 — los grants de tabla (select
  // + update por columnas) están en la migración `20260817170000`.
  //
  // ⚠️ YA NO ES `.eq("provider", "stripe")`. Este archivo decía cómo
  // generalizarlo el día que hubiera un segundo adaptador, y hoy lo hay: se
  // filtra por `in (PSP_KEYS)` y el adaptador se resuelve POR FILA con
  // `adapterFor(r.provider)`. El cuerpo del bucle no tiene nada de Stripe
  // dentro — la taxonomía de errores es del puerto (`RefundResult`), que para
  // eso existe.
  //
  // Se filtra por la lista de PSP y no se quita el filtro entero a propósito:
  // una fila con `provider = 'simulated'` no se puede reembolsar contra nadie,
  // y arrastrarla al bucle solo serviría para marcarla `failed` por un motivo
  // que no es culpa suya.
  const { data, error } = await admin
    .from("refund_requests")
    .select("id, payment_id, booking_id, provider, provider_payment_id, amount, currency, reason")
    .eq("status", "pending")
    .in("provider", PSP_KEYS)
    .order("created_at", { ascending: true }) // lo más viejo primero: nadie se queda atrás
    .limit(LOTE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const pendientes: SolicitudReembolso[] = data ?? [];

  // Lo que hay encolado para un proveedor SIN ADAPTADOR. Antes esto era «todo
  // lo que no sea stripe» y hoy es «todo lo que no esté en `PSP_KEYS`», que es
  // lo mismo dicho de forma que no haya que volver aquí con el tercer PSP.
  //
  // Si este número no es 0, hay dinero prometido esperando contra una pasarela
  // que nadie sabe llamar: son filas que se quedarían `pending` para siempre y
  // en silencio. Es exactamente el fallo que este job existe para no repetir.
  const { count: otroProveedor } = await admin
    .from("refund_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .not("provider", "in", `(${PSP_KEYS.join(",")})`);

  if (simulacro) {
    return NextResponse.json({
      status: "simulacro",
      // Ya no es un booleano de Stripe: es qué PSP puede devolver dinero AHORA
      // MISMO. Con dos proveedores, «configurado» dejó de ser una sola pregunta
      // y esconderlo detrás de un sí/no ocultaría justo el caso interesante
      // (uno encendido y el otro no, con cola para los dos).
      psps: Object.fromEntries(
        PSP_KEYS.map((k) => [k, pspDe(k)?.canRefund() ?? false]),
      ),
      // Sin `provider_payment_id`: en un ensayo no hace falta sacar
      // referencias de cobro al log de nadie.
      mandaria: pendientes.map((r) => ({
        solicitud: r.id,
        pago: r.payment_id,
        proveedor: r.provider,
        importe: r.amount,
        moneda: r.currency,
        motivo: r.reason,
        conReferencia: Boolean(r.provider_payment_id),
      })),
      pendientesSinAdaptador: otroProveedor ?? 0,
    });
  }

  // ⚠️ LA PUERTA DE «¿HAY CREDENCIAL?» YA NO ES GLOBAL, Y NO PODÍA SEGUIR
  // SIÉNDOLO. Antes, sin `STRIPE_API_KEY` este job devolvía `sin-stripe` y no
  // tocaba NADA. Con dos proveedores eso significaría que una credencial que
  // falta en uno para la cola del OTRO: los reembolsos de dLocal se quedarían
  // esperando a una clave de Stripe que no usan.
  //
  // Así que la pregunta baja al bucle, fila a fila. Sigue valiendo el criterio
  // de siempre: sin clave la fila se queda `pending` —nunca `failed`— y sale
  // entera en la primera pasada con ese proveedor encendido. Marcarla de
  // cualquier otra forma sería inventarse que el dinero se movió.
  //
  // ⚠️ Y sigue siendo `canRefund()` y NO la pregunta del cobro: devolver dinero
  // puede necesitar menos que cobrar (en Stripe, solo la secreta), y exigir de
  // más dejaría la cola parada por una clave que este job no usa.

  const ahora = () => new Date().toISOString();

  let reembolsados = 0;
  let importeMovido = 0;
  let yaEstaban = 0;
  let permanentes = 0;
  let reintentables = 0;
  /** Filas que se dejan intactas porque a su PSP le falta la credencial. */
  let sinCredencial = 0;

  for (const r of pendientes) {
    // El adaptador de ESTA fila. Se resuelve por `refund_requests.provider`,
    // que es el snapshot de quién cobró — no la regla activa de hoy: si alguien
    // cambia `payment_routing_rules` mientras hay reembolsos en cola, esos
    // reembolsos vuelven por donde entró el dinero, que es la única opción que
    // existe (no se puede devolver por Stripe lo que cobró dLocal).
    const psp = pspDe(r.provider);
    if (!psp) {
      // No debería pasar: la consulta filtra por `PSP_KEYS`. Si pasa, es que
      // alguien quitó un adaptador dejando cola detrás. Se deja `pending` y se
      // grita, en vez de marcarla `failed` por un fallo que no es de la fila.
      console.error("[X-01] fila encolada para un proveedor sin adaptador", {
        solicitud: r.id,
        proveedor: r.provider,
      });
      sinCredencial++;
      continue;
    }

    // Sin credencial de SU proveedor: la fila se queda `pending` y ni se toca.
    if (!psp.canRefund()) {
      sinCredencial++;
      continue;
    }

    // Sin referencia del PSP no hay nada que devolver y no lo va a haber: el
    // la referencia del cargo se sella ANTES de dar el cobro por bueno (en el
    // webhook con Stripe, ya al crearlo con dLocal), así que un pago cobrado
    // siempre la tiene. Si falta, la fila está mal desde
    // que se encoló y reintentarla cada cinco minutos no la arregla.
    if (!r.provider_payment_id) {
      await admin
        .from("refund_requests")
        .update({
          status: "failed",
          last_error: `sin provider_payment_id: el pago no tiene referencia en ${r.provider}`,
          last_attempt_at: ahora(),
          processed_at: ahora(),
        })
        .eq("id", r.id)
        .eq("status", "pending");
      console.error("[X-01] reembolso sin referencia de cobro", {
        solicitud: r.id,
        pago: r.payment_id,
        booking: r.booking_id,
        importe: r.amount,
      });
      permanentes++;
      continue;
    }

    const salida = await psp.refund({
      chargeRef: r.provider_payment_id,
      // ⚠️ LA MONEDA VIAJA, y no es decorativa: dLocal Go cobra en unidades
      // MAYORES, así que su adaptador tiene que dividir — y cuánto depende de
      // la moneda (CLP y PYG no tienen céntimos). Stripe la ignora. Sale de la
      // fila, que la copió de `payments` al encolar.
      currency: r.currency,
      // ⚠️ PARCIAL. RN-37 devuelve el 50 % cuando el alumno cancela tarde, y el
      // admin puede devolver el trozo que quiera (US-704). El importe sale de
      // la fila —que lo copió de `payments` al encolar— y NUNCA de un cálculo
      // nuevo aquí: dos sitios calculando el mismo porcentaje es dos sitios que
      // pueden discrepar (regla de oro 2).
      amountMinor: r.amount,
      metadata: {
        solicitud_id: r.id,
        booking_id: r.booking_id,
        motivo: r.reason,
      },
      // ⚠️ IDEMPOTENCIA, CAMINO 2 DE 2. El `unique` de la cola impide ENCOLAR
      // dos veces el mismo reembolso; esto impide EJECUTARLO dos veces. Hacen
      // falta los dos: si el proceso muere entre la llamada al PSP y el
      // `update` de la fila, la fila sigue `pending` y la pasada siguiente
      // vuelve a pedir exactamente lo mismo — con esta clave el proveedor
      // devuelve EL MISMO reembolso en vez de crear otro. Va atada al id de la
      // solicitud (inmutable) y no al pago, porque un pago puede devolverse en
      // varios tramos legítimos.
      idempotencyKey: `x01-reembolso-${r.id}`,
    });

    // Ya lo devolvió otra mano: el panel del PSP, o el reembolso de cobro
    // tardío de X-02 sobre este mismo cargo. El dinero está donde tiene que
    // estar, así que la fila se cierra en vez de reintentarse para siempre.
    if (salida.estado === "ya-reembolsado") {
      await admin
        .from("refund_requests")
        .update({
          status: "refunded",
          last_error: "el PSP dice que el cargo ya estaba reembolsado",
          last_attempt_at: ahora(),
          processed_at: ahora(),
        })
        .eq("id", r.id)
        .eq("status", "pending");
      console.error("[X-01] el cargo ya estaba reembolsado en el PSP", {
        solicitud: r.id,
        pago: r.payment_id,
        cargo: r.provider_payment_id,
      });
      yaEstaban++;
      continue;
    }

    // Transitorio (429, 5xx, red caída): se deja `pending` A PROPÓSITO y lo
    // coge la pasada siguiente. Marcarlo `failed` sería quedarnos con el
    // dinero del alumno por un mal minuto del proveedor. Se anota el intento
    // para que la fila cuente su historia aunque acabe bien.
    if (salida.estado === "transitorio") {
      await admin
        .from("refund_requests")
        .update({ last_error: salida.mensaje, last_attempt_at: ahora() })
        .eq("id", r.id)
        .eq("status", "pending");
      console.error("[X-01] fallo transitorio, se reintenta", {
        solicitud: r.id,
        pago: r.payment_id,
        error: salida.mensaje,
      });
      reintentables++;
      continue;
    }

    // La petición, no el momento: importe mayor que el cargo, referencia de
    // otra cuenta, cargo ya disputado. Repetirlo dará el mismo error mañana,
    // así que se para y se grita.
    if (salida.estado === "rechazado") {
      await admin
        .from("refund_requests")
        .update({
          status: "failed",
          last_error: salida.mensaje,
          last_attempt_at: ahora(),
          processed_at: ahora(),
        })
        .eq("id", r.id)
        .eq("status", "pending");
      console.error("[X-01] reembolso RECHAZADO por el PSP — requiere revisión", {
        solicitud: r.id,
        pago: r.payment_id,
        booking: r.booking_id,
        cargo: r.provider_payment_id,
        importe: r.amount,
        error: salida.mensaje,
      });
      permanentes++;
      continue;
    }

    // El PSP creó el reembolso y lo dejó sin completar (fondos retenidos,
    // cuenta del comercio sin saldo). Tiene referencia pero el dinero NO se
    // movió: darlo por bueno sería mentir en la única tabla que dice que se
    // devolvió.
    if (salida.estado === "no-completado") {
      await admin
        .from("refund_requests")
        .update({
          status: "failed",
          provider_refund_id: salida.refundId,
          last_error: `el PSP creó el reembolso pero lo dejó en '${salida.detalle}'`,
          last_attempt_at: ahora(),
          processed_at: ahora(),
        })
        .eq("id", r.id)
        .eq("status", "pending");
      console.error("[X-01] el PSP no completó el reembolso", {
        solicitud: r.id,
        pago: r.payment_id,
        reembolso: salida.refundId,
        estado: salida.detalle,
      });
      permanentes++;
      continue;
    }

    const { error: errorMarca } = await admin
      .from("refund_requests")
      .update({
        status: "refunded",
        provider_refund_id: salida.refundId,
        last_attempt_at: ahora(),
        processed_at: ahora(),
      })
      .eq("id", r.id)
      .eq("status", "pending");

    // El dinero YA SALIÓ. Si la marca falla, la fila sigue `pending` y la
    // próxima pasada volverá a pedir el mismo reembolso — la clave de
    // idempotencia hará que Stripe devuelva este mismo objeto en vez de mover
    // el dinero otra vez, y entonces se reintentará la marca.
    //
    // ⚠️ CON dLOCAL ESE PARACAÍDAS NO EXISTE: su API de reembolsos NO tiene
    // clave de idempotencia (comprobado contra el sandbox, 1-sep-2026), así que
    // una marca que falle deja la fila `pending` y la pasada siguiente
    // reembolsaría OTRA VEZ. Lo único que hoy lo estrecha es que el fallo de
    // marca es rarísimo (la fila existe, la escritura es de una columna) y que
    // el log lo grita. Es un problema abierto y está anotado como tal, no
    // resuelto. Por eso el orden
    // es reembolsar → anotar y no al revés: una caída en medio deja un
    // reembolso hecho y sin anotar (recuperable), no una anotación de un
    // reembolso que no existe (imposible de detectar).
    if (errorMarca) {
      console.error("[X-01] ⚠️ reembolso HECHO pero no anotado — se reintenta la marca", {
        solicitud: r.id,
        pago: r.payment_id,
        reembolso: salida.refundId,
        error: errorMarca.message,
      });
      reintentables++;
      continue;
    }

    // Traza de conciliación: con estos ids se cierra el círculo entre nuestra
    // base y el panel del PSP sin tener que adivinar nada. En un
    // sistema que mueve dinero, "no se registró" y "no pasó" tienen que ser
    // distinguibles.
    console.info("[X-01] reembolso ejecutado", {
      solicitud: r.id,
      proveedor: r.provider,
      pago: r.payment_id,
      booking: r.booking_id,
      cargo: r.provider_payment_id,
      reembolso: salida.refundId,
      importe: r.amount,
      moneda: r.currency,
      motivo: r.reason,
    });
    reembolsados++;
    importeMovido += r.amount;
  }

  return NextResponse.json({
    status: "ok",
    revisadas: pendientes.length,
    reembolsados,
    // En unidades menores, como en la BD. Es la cifra que debe cuadrar con el
    // panel del PSP al final del día.
    importeMovido,
    yaEstabanReembolsados: yaEstaban,
    // Si esto no es 0, hay dinero prometido que NO ha salido y no va a salir
    // solo. Es la línea que hay que vigilar.
    fallosPermanentes: permanentes,
    // Si no baja entre pasadas, el problema es del PSP (o de la red), no de
    // la cola: las filas siguen `pending` y se reintentan.
    pendientesDeReintento: reintentables,
    // Filas intactas por falta de credencial de su PSP. Si esto no baja al
    // poner las claves, mirar el log: puede ser un proveedor sin adaptador.
    sinCredencial,
    // Encoladas contra una pasarela que nadie sabe llamar. Debe ser 0.
    pendientesSinAdaptador: otroProveedor ?? 0,
    // Si viene lleno, hay más esperando detrás: la pasada siguiente sigue.
    lote: LOTE,
  });
}
