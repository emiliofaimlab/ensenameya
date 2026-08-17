import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  esCargoYaReembolsado,
  esFalloTransitorio,
  isStripeConfigured,
  stripe,
} from "@/lib/stripe";

/**
 * X-01 · devuelve de verdad el dinero que la base de datos ya dio por devuelto.
 *
 * QUÉ PASABA. Los tres caminos de reembolso —RN-37 al cancelar, el reembolso
 * manual del admin (US-704) y el vencimiento de aceptación de 24 h (RN-38)—
 * escribían `payments.status = 'refunded'` y `refunded_amount` en Postgres y
 * ahí se acababa. Nadie hablaba con el PSP. Con el ruteo en 'simulated' era
 * inocuo; con Stripe cobrando es la plataforma anotándose reembolsos que el
 * alumno nunca recibe, y encima avisándole por correo (NTF-10). Los Términos
 * publicados hoy, §13, prometen la devolución «al método de pago original».
 *
 * POR QUÉ UN JOB Y NO UNA LLAMADA EN CALIENTE. Uno de los tres caminos
 * (`expire_stale_bookings`) corre en **pg_cron dentro de la base**, sin ninguna
 * petición HTTP donde colgar un `refunds.create`, y Postgres no puede llamar a
 * Stripe. Así que se usa el patrón que el proyecto ya tiene para el correo: la
 * BD ENCOLA (`refund_requests`, migración `20260817170000`) y esto EJECUTA.
 *
 * ⚠️ NO HAY FORMA DE PROBAR ESTO SIN UN COBRO REAL, así que el archivo está
 * escrito para que no se pueda desplegar a ciegas:
 *   · con la cola vacía no hace absolutamente nada y lo dice;
 *   · sin `STRIPE_API_KEY` no toca la cola (queda `pending`, no `failed`);
 *   · `?simulacro=1` enseña exactamente qué mandaría, sin mandarlo;
 *   · cada movimiento de dinero deja una línea en el log con los tres ids que
 *     hacen falta para conciliar (pago, PaymentIntent, reembolso).
 *
 * DÓNDE SE PROGRAMA. En GitHub Actions, como `notifications-send` y por el
 * mismo motivo: Vercel Hobby solo permite UN cron al día y ya lo gasta la purga
 * de grabaciones. Un reembolso que sale mañana a las 4 de la mañana no cumple
 * la promesa de §13. ⚠️ Mientras nadie añada ese workflow (variable
 * `APP_BASE_URL` + secret `CRON_SECRET`), esta ruta no la llama nadie y la cola
 * crece en silencio: `select public.refunds_backlog();` es el termómetro.
 */

/** Node, no edge: se usa el SDK de Stripe, igual que el webhook. */
export const runtime = "nodejs";

/**
 * Tope por pasada. Deliberadamente MÁS BAJO que el de los correos (50): cada
 * vuelta de este bucle mueve dinero y espera a la API de Stripe. Lo que sobre
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
  provider_payment_id: string | null;
  amount: number;
  currency: string;
  reason: string;
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  // FALLA CERRADO, igual que los otros dos jobs. Sin secreto esto sería un
  // endpoint público capaz de vaciar la cola de reembolsos de la plataforma
  // contra Stripe. Que no corra es un problema; que lo dispare cualquiera es
  // otro mucho peor.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurada" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  // Ensayo: lee la cola y cuenta qué haría, sin llamar a Stripe ni escribir
  // nada. Es la única manera de mirar por dentro de este job antes de que mueva
  // el primer euro de verdad. Va detrás del mismo secreto porque enseña
  // importes y referencias de cobro.
  const simulacro = new URL(req.url).searchParams.get("simulacro") === "1";

  const admin = createAdminClient();

  // service_role a propósito: la cola es admin-only por RLS y este trabajo no
  // tiene ninguna persona detrás. Regla de oro 9 — los grants de tabla (select
  // + update por columnas) están en la migración `20260817170000`.
  const { data, error } = await admin
    .from("refund_requests")
    .select("id, payment_id, booking_id, provider_payment_id, amount, currency, reason")
    .eq("status", "pending")
    .eq("provider", "stripe")
    .order("created_at", { ascending: true }) // lo más viejo primero: nadie se queda atrás
    .limit(LOTE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const pendientes: SolicitudReembolso[] = data ?? [];

  // Lo que hay encolado para OTRO proveedor. Hoy siempre 0: solo Stripe cobra.
  // Se cuenta igual porque el día que DLocal entre por esta misma cola sin que
  // nadie le escriba su rama, estas filas se quedarían pendientes para siempre
  // y sin este número nadie se enteraría — que es exactamente el fallo que este
  // job existe para no repetir.
  const { count: otroProveedor } = await admin
    .from("refund_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .neq("provider", "stripe");

  if (simulacro) {
    return NextResponse.json({
      status: "simulacro",
      stripeConfigurado: isStripeConfigured(),
      // Sin `provider_payment_id`: en un ensayo no hace falta sacar
      // referencias de cobro al log de nadie.
      mandaria: pendientes.map((r) => ({
        solicitud: r.id,
        pago: r.payment_id,
        importe: r.amount,
        moneda: r.currency,
        motivo: r.reason,
        conReferencia: Boolean(r.provider_payment_id),
      })),
      pendientesOtroProveedor: otroProveedor ?? 0,
    });
  }

  // Sin clave no se toca la cola: las filas siguen `pending` y salen enteras en
  // la primera pasada con Stripe encendido. Marcarlas de cualquier otra forma
  // sería inventarse que el dinero se movió. (La credencial es el interruptor.)
  if (!isStripeConfigured()) {
    return NextResponse.json({
      status: "sin-stripe",
      reembolsados: 0,
      // Solo lo de este lote (tope `LOTE`), no la cola entera: para el total
      // está `select public.refunds_backlog();`. Si esto viene lleno y sigue
      // sin haber clave, hay alumnos esperando su dinero.
      pendientesEnEsteLote: pendientes.length,
    });
  }

  const ahora = () => new Date().toISOString();

  let reembolsados = 0;
  let importeMovido = 0;
  let yaEstaban = 0;
  let permanentes = 0;
  let reintentables = 0;

  for (const r of pendientes) {
    // Sin referencia del PSP no hay nada que devolver y no lo va a haber: el
    // `pi_…` se sella en el webhook ANTES de dar el cobro por bueno, así que un
    // pago de Stripe cobrado siempre lo tiene. Si falta, la fila está mal desde
    // que se encoló y reintentarla cada cinco minutos no la arregla.
    if (!r.provider_payment_id) {
      await admin
        .from("refund_requests")
        .update({
          status: "failed",
          last_error: "sin provider_payment_id: el pago no tiene referencia en Stripe",
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

    let reembolso: Stripe.Refund | null = null;
    try {
      reembolso = await stripe().refunds.create(
        {
          payment_intent: r.provider_payment_id,
          // ⚠️ PARCIAL. RN-37 devuelve el 50 % cuando el alumno cancela tarde,
          // y el admin puede devolver el trozo que quiera (US-704). El importe
          // sale de la fila —que lo copió de `payments` al encolar— y NUNCA de
          // un cálculo nuevo aquí: dos sitios calculando el mismo porcentaje es
          // dos sitios que pueden discrepar (regla de oro 2).
          amount: r.amount,
          // La taxonomía de Stripe solo admite 'duplicate' | 'fraudulent' |
          // 'requested_by_customer'. Es el tercero incluso cuando cancela el
          // tutor o vence el plazo: 'fraudulent' metería la tarjeta y el correo
          // del alumno en las listas de Radar por una cancelación normal.
          reason: "requested_by_customer",
          metadata: {
            solicitud_id: r.id,
            booking_id: r.booking_id,
            motivo: r.reason,
          },
        },
        {
          // ⚠️ IDEMPOTENCIA, CAMINO 2 DE 2. El `unique` de la cola impide
          // ENCOLAR dos veces el mismo reembolso; esto impide EJECUTARLO dos
          // veces. Hacen falta los dos: si el proceso muere entre la llamada a
          // Stripe y el `update` de la fila, la fila sigue `pending` y la
          // pasada siguiente vuelve a pedir exactamente lo mismo — con esta
          // clave Stripe devuelve EL MISMO reembolso en vez de crear otro. Va
          // atada al id de la solicitud (inmutable) y no al pago, porque un
          // pago puede devolverse en varios tramos legítimos.
          idempotencyKey: `x01-reembolso-${r.id}`,
        },
      );
    } catch (e) {
      // Ya lo devolvió otra mano: el panel de Stripe, o el reembolso de cobro
      // tardío de X-02 sobre este mismo cargo. El dinero está donde tiene que
      // estar, así que la fila se cierra en vez de reintentarse para siempre.
      if (esCargoYaReembolsado(e)) {
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
          pi: r.provider_payment_id,
        });
        yaEstaban++;
        continue;
      }

      const mensaje = e instanceof Error ? e.message : "error desconocido";

      // Transitorio (429, 5xx, red caída): se deja `pending` A PROPÓSITO y lo
      // coge la pasada siguiente. Marcarlo `failed` sería quedarnos con el
      // dinero del alumno por un mal minuto de Stripe. Se anota el intento para
      // que la fila cuente su historia aunque acabe bien.
      if (esFalloTransitorio(e)) {
        await admin
          .from("refund_requests")
          .update({ last_error: mensaje, last_attempt_at: ahora() })
          .eq("id", r.id)
          .eq("status", "pending");
        console.error("[X-01] fallo transitorio, se reintenta", {
          solicitud: r.id,
          pago: r.payment_id,
          error: mensaje,
        });
        reintentables++;
        continue;
      }

      // Todo lo demás es la petición, no el momento: importe mayor que el
      // cargo, PaymentIntent de otra cuenta, cargo ya disputado. Repetirlo dará
      // el mismo error mañana, así que se para y se grita.
      await admin
        .from("refund_requests")
        .update({
          status: "failed",
          last_error: mensaje,
          last_attempt_at: ahora(),
          processed_at: ahora(),
        })
        .eq("id", r.id)
        .eq("status", "pending");
      console.error("[X-01] reembolso RECHAZADO por el PSP — requiere revisión", {
        solicitud: r.id,
        pago: r.payment_id,
        booking: r.booking_id,
        pi: r.provider_payment_id,
        importe: r.amount,
        error: mensaje,
      });
      permanentes++;
      continue;
    }

    // Stripe puede responder con el reembolso ya rechazado (fondos retenidos,
    // cuenta del comercio sin saldo). Tiene `re_…` pero el dinero NO se movió:
    // darlo por bueno sería mentir en la única tabla que dice que se devolvió.
    if (reembolso.status === "failed" || reembolso.status === "canceled") {
      await admin
        .from("refund_requests")
        .update({
          status: "failed",
          provider_refund_id: reembolso.id,
          last_error: `el PSP creó el reembolso pero lo dejó en '${reembolso.status}'`,
          last_attempt_at: ahora(),
          processed_at: ahora(),
        })
        .eq("id", r.id)
        .eq("status", "pending");
      console.error("[X-01] el PSP no completó el reembolso", {
        solicitud: r.id,
        pago: r.payment_id,
        reembolso: reembolso.id,
        estado: reembolso.status,
      });
      permanentes++;
      continue;
    }

    const { error: errorMarca } = await admin
      .from("refund_requests")
      .update({
        status: "refunded",
        provider_refund_id: reembolso.id,
        last_attempt_at: ahora(),
        processed_at: ahora(),
      })
      .eq("id", r.id)
      .eq("status", "pending");

    // El dinero YA SALIÓ. Si la marca falla, la fila sigue `pending` y la
    // próxima pasada volverá a pedir el mismo reembolso — la clave de
    // idempotencia hará que Stripe devuelva este mismo objeto en vez de mover
    // el dinero otra vez, y entonces se reintentará la marca. Por eso el orden
    // es reembolsar → anotar y no al revés: una caída en medio deja un
    // reembolso hecho y sin anotar (recuperable), no una anotación de un
    // reembolso que no existe (imposible de detectar).
    if (errorMarca) {
      console.error("[X-01] ⚠️ reembolso HECHO pero no anotado — se reintenta la marca", {
        solicitud: r.id,
        pago: r.payment_id,
        reembolso: reembolso.id,
        error: errorMarca.message,
      });
      reintentables++;
      continue;
    }

    // Traza de conciliación: con estos tres ids se cierra el círculo entre
    // nuestra base y el panel de Stripe sin tener que adivinar nada. En un
    // sistema que mueve dinero, "no se registró" y "no pasó" tienen que ser
    // distinguibles.
    console.info("[X-01] reembolso ejecutado", {
      solicitud: r.id,
      pago: r.payment_id,
      booking: r.booking_id,
      pi: r.provider_payment_id,
      reembolso: reembolso.id,
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
    // panel de Stripe al final del día.
    importeMovido,
    yaEstabanReembolsados: yaEstaban,
    // Si esto no es 0, hay dinero prometido que NO ha salido y no va a salir
    // solo. Es la línea que hay que vigilar.
    fallosPermanentes: permanentes,
    // Si no baja entre pasadas, el problema es de Stripe (o de la red), no de
    // la cola: las filas siguen `pending` y se reintentan.
    pendientesDeReintento: reintentables,
    pendientesOtroProveedor: otroProveedor ?? 0,
    // Si viene lleno, hay más esperando detrás: la pasada siguiente sigue.
    lote: LOTE,
  });
}
